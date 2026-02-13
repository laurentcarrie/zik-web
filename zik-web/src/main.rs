mod edit;
mod song;
mod update;

use aws_config::Region;
use aws_sdk_cloudwatchlogs::Client as CloudWatchLogsClient;
use aws_sdk_lambda::Client as LambdaClient;
use aws_sdk_s3::Client;
use aws_sdk_sesv2::Client as SesClient;
use axum::{
    Json, Router,
    extract::{Path, Query, Request, State},
    http::{Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use song::{
    AnimationConfig, CONTOUR_COUNT, SongItem, contour_names, download_font_from_s3,
    drum_pattern_to_html, edit_lyrics, get_all_songs, get_lyrics_by_key, get_song_pdf,
    get_song_yml, lilypond_to_html, make_cloudfront_url, make_deezer_app_url, make_deezer_url,
    read_from_s3, save_lyrics_by_key, save_lyrics_handler, save_song_yml, write_guitar_embed_to_s3,
    write_tempo_html_to_s3, write_to_s3,
};

use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct AppState {
    s3_client: Client,
    logs_client: CloudWatchLogsClient,
    lambda_client: LambdaClient,
    ses_client: SesClient,
    /// Timestamp when last build was triggered (for immediate status feedback)
    build_triggered_at: Arc<Mutex<Option<std::time::Instant>>>,
    /// S3 URL prefix for song sources, e.g. "s3://bucket-name"
    srcdir_prefix: String,
    /// S3 URL for delivery output, e.g. "s3://bucket-name/delivery"
    delivery: String,
    /// S3 URL for settings file, e.g. "s3://bucket-name/songs/settings.yml"
    settings: String,
}

#[tokio::main]
async fn main() {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let s3_client = Client::new(&config);
    let logs_client = CloudWatchLogsClient::new(&config);
    let lambda_client = LambdaClient::new(&config);
    let ses_client = SesClient::new(&config);

    // Download font from S3 to static directory
    if let Err(e) = download_font_from_s3(&s3_client).await {
        eprintln!("Warning: Failed to download font from S3: {e}");
    }

    let bucket = &*song::BUCKET;
    let root = &*song::BUCKET_ROOT;
    let srcdir_prefix =
        std::env::var("SRCDIR_PREFIX").unwrap_or_else(|_| format!("s3://{bucket}/{root}"));
    let delivery =
        std::env::var("DELIVERY").unwrap_or_else(|_| format!("s3://{bucket}/{root}/delivery"));
    let settings = std::env::var("SETTINGS")
        .unwrap_or_else(|_| format!("s3://{bucket}/{root}/songs/settings.yml"));

    let state = AppState {
        s3_client,
        logs_client,
        lambda_client,
        ses_client,
        build_triggered_at: Arc::new(Mutex::new(None)),
        srcdir_prefix,
        delivery,
        settings,
    };

    // CORS layer for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    // Public API routes (read operations)
    let public_api_routes = Router::new()
        .route("/songs", get(api_songs))
        .route("/song/{id}", get(api_song))
        .route("/song/{id}/yml", get(api_song_yml))
        .route("/song/{id}/lyrics/{section_id}", get(api_lyrics))
        .route("/pdf/{id}", get(api_pdf))
        .route("/pdf-lyrics/{id}", get(api_pdf_lyrics))
        .route("/press-book/photos", get(api_press_book_photos))
        .route("/press-book/photo/{*key}", get(api_press_book_photo))
        .route("/press-book/videos", get(api_press_book_videos))
        .route("/press-book/video/{*key}", get(api_press_book_video))
        .route("/s3/{*key}", get(api_read_from_s3))
        .route("/make-report", get(api_make_report))
        .route("/lambda-status", get(api_lambda_status))
        .route("/lilypond-to-html", post(api_lilypond_to_html))
        .route("/drum-pattern-to-html", post(api_drum_pattern_to_html))
        .route("/guitar-embed/{index}", get(api_guitar_embed))
        .route("/auth/verify", post(verify_password))
        .with_state(state.clone());

    // Protected API routes (write operations) - require auth
    let protected_api_routes = Router::new()
        .route("/song/{id}/yml", post(api_save_song_yml))
        .route("/song/{id}/lyrics/{section_id}", post(api_save_lyrics))
        .route("/s3/{*key}", post(api_write_to_s3))
        .route("/make", post(api_make))
        .route("/invoke-build", post(api_invoke_build))
        .route("/world", post(api_world))
        .layer(middleware::from_fn(write_auth_middleware))
        .with_state(state.clone());

    // Legacy HTML routes (can be removed after full migration)
    let legacy_routes = Router::new()
        .route("/version", get(version))
        .route("/update", get(update::update))
        .route("/save-yml", post(edit::save_yml))
        .route("/pdf", get(serve_pdf))
        .route("/edit-lyrics", get(edit_lyrics))
        .route("/save-lyrics", post(save_lyrics_handler))
        .with_state(state);

    // SPA fallback - serve index.html for all non-API, non-static routes
    let spa_service = ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html"));

    let api_routes = Router::new()
        .merge(public_api_routes)
        .merge(protected_api_routes);

    let app = Router::new()
        .nest("/api", api_routes)
        .merge(legacy_routes)
        .nest_service("/static", ServeDir::new("static"))
        .fallback_service(spa_service)
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    println!("Server running at http://0.0.0.0:8080");
    axum::serve(listener, app).await.unwrap();
}

// API response types
#[derive(Serialize)]
struct ApiError {
    error: String,
}

#[derive(Serialize)]
struct ApiSong {
    id: String,
    title: String,
    author: String,
    deezer_url: String,
    deezer_app_url: String,
    key: String,
    tempo: u16,
    tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct ApiSongDetail {
    id: String,
    title: String,
    author: String,
    deezer_url: String,
    deezer_app_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pdf_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pdf_lyrics_url: Option<String>,
    key: String,
    tempo: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    tempo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn api_songs(State(state): State<AppState>) -> Response {
    match get_all_songs(&state.s3_client).await {
        Ok(items) => {
            let api_songs: Vec<ApiSong> = items
                .into_iter()
                .map(|s| {
                    let deezer_url = make_deezer_url(&s.title, &s.author);
                    let deezer_app_url = make_deezer_app_url(&s.title, &s.author);
                    ApiSong {
                        id: s.id,
                        title: s.title,
                        author: s.author,
                        deezer_url,
                        deezer_app_url,
                        key: s.key,
                        tempo: s.tempo,
                        tags: s.tags,
                        error: s.error,
                    }
                })
                .collect();
            Json(api_songs).into_response()
        }
        Err(e) => {
            let error_msg = e.to_string();
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError { error: error_msg }),
            )
                .into_response()
        }
    }
}

async fn api_song(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiSongDetail>, StatusCode> {
    let items = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let s = items
        .into_iter()
        .find(|s| s.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let SongItem {
        id,
        title,
        author,
        key,
        tempo,
        tags: _,
        error,
    } = s;
    let deezer_url = make_deezer_url(&title, &author);
    let deezer_app_url = make_deezer_app_url(&title, &author);

    // Check if PDFs exist
    let song_info = band_songbook::model::SongInfo {
        title: title.clone(),
        author: author.clone(),
        tempo: 0,
        time_signature: None,
        tags: vec![],
    };
    let pdf_name = song_info.file_stem_of_song();

    // Check main PDF
    let pdf_key = song::s3_key(&format!("delivery/pdf/{pdf_name}.pdf"));
    let pdf_url = match state
        .s3_client
        .head_object()
        .bucket(song::BUCKET.as_str())
        .key(&pdf_key)
        .send()
        .await
    {
        Ok(_) => Some(format!("/api/pdf/{id}")),
        Err(_) => None,
    };

    // Check lyrics PDF
    let lyrics_key = song::s3_key(&format!("delivery/pdf-lyrics-1-column/{pdf_name}-lyrics.pdf"));
    let pdf_lyrics_url = match state
        .s3_client
        .head_object()
        .bucket(song::BUCKET.as_str())
        .key(&lyrics_key)
        .send()
        .await
    {
        Ok(_) => Some(format!("/api/pdf-lyrics/{id}")),
        Err(_) => None,
    };

    // Generate tempo HTML and upload to S3
    let tempo_url = if error.is_none() && tempo > 0 {
        write_tempo_html_to_s3(&state.s3_client, &author, &title, tempo)
            .await
            .ok()
    } else {
        None
    };

    Ok(Json(ApiSongDetail {
        id,
        title,
        author,
        deezer_url,
        deezer_app_url,
        pdf_url,
        pdf_lyrics_url,
        key,
        tempo,
        tempo_url,
        error,
    }))
}

#[derive(Serialize)]
struct ApiSongYml {
    content: String,
}

async fn api_song_yml(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiSongYml>, StatusCode> {
    let items = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let s = items
        .into_iter()
        .find(|s| s.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let content = get_song_yml(&state.s3_client, &s.key)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    println!("content : {:?}", &content);
    // let song_yml: SongYml = serde_yaml::from_str(&content)
    //     .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // println!("structure length: {}", song_yml.structure.len());

    Ok(Json(ApiSongYml { content }))
}

#[derive(Deserialize)]
struct SaveYmlBody {
    content: String,
}

async fn api_save_song_yml(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<SaveYmlBody>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    // Validate that the content is a valid Song structure
    if let Err(e) = serde_yaml::from_str::<band_songbook::model::Song>(&body.content) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError {
                error: format!("Invalid song YAML: {e}"),
            }),
        ));
    }

    let items = get_all_songs(&state.s3_client).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError {
                error: "Failed to load songs".into(),
            }),
        )
    })?;

    let s = items.into_iter().find(|s| s.id == id).ok_or((
        StatusCode::NOT_FOUND,
        Json(ApiError {
            error: "Song not found".into(),
        }),
    ))?;

    save_song_yml(&state.s3_client, &s.key, &body.content)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError {
                    error: "Failed to save".into(),
                }),
            )
        })?;

    Ok(StatusCode::OK)
}

#[derive(Serialize)]
struct ApiLyrics {
    content: String,
}

async fn api_lyrics(
    State(state): State<AppState>,
    Path((id, section_id)): Path<(String, String)>,
) -> Result<Json<ApiLyrics>, StatusCode> {
    let items = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let s = items
        .into_iter()
        .find(|s| s.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let content = get_lyrics_by_key(&state.s3_client, &s.key, &section_id)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(ApiLyrics { content }))
}

#[derive(Deserialize)]
struct SaveLyricsBody {
    content: String,
}

async fn api_save_lyrics(
    State(state): State<AppState>,
    Path((id, section_id)): Path<(String, String)>,
    Json(body): Json<SaveLyricsBody>,
) -> Result<StatusCode, StatusCode> {
    let items = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let s = items
        .into_iter()
        .find(|s| s.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;

    save_lyrics_by_key(&state.s3_client, &s.key, &section_id, &body.content)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

async fn api_pdf(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let items = match get_all_songs(&state.s3_client).await {
        Ok(s) => s,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to load songs").into_response();
        }
    };

    let s = match items.into_iter().find(|s| s.id == id) {
        Some(s) => s,
        None => return (StatusCode::NOT_FOUND, "Song not found").into_response(),
    };

    match get_song_pdf(&state.s3_client, &s.author, &s.title).await {
        Ok(pdf_bytes) => {
            let filename = format!("{} - {}.pdf", s.author, s.title);
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/pdf"),
                    (
                        header::CONTENT_DISPOSITION,
                        &format!("inline; filename=\"{filename}\""),
                    ),
                ],
                pdf_bytes,
            )
                .into_response()
        }
        Err(e) => (StatusCode::NOT_FOUND, format!("PDF not found: {e}")).into_response(),
    }
}

#[derive(Deserialize)]
struct PdfLyricsQuery {
    columns: Option<String>,
}

async fn api_pdf_lyrics(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PdfLyricsQuery>,
) -> Response {
    let items = match get_all_songs(&state.s3_client).await {
        Ok(s) => s,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to load songs").into_response();
        }
    };

    let s = match items.into_iter().find(|s| s.id == id) {
        Some(s) => s,
        None => return (StatusCode::NOT_FOUND, "Song not found").into_response(),
    };

    // Use same naming convention as regular PDF but in pdf folder
    let song_info = band_songbook::model::SongInfo {
        title: s.title.clone(),
        author: s.author.clone(),
        tempo: 0,
        time_signature: None,
        tags: vec![],
    };
    let pdf_name = song_info.file_stem_of_song();
    let folder = match query.columns.as_deref() {
        Some("2") => "pdf-lyrics-2-column",
        _ => "pdf-lyrics-1-column",
    };
    let key = song::s3_key(&format!("delivery/{folder}/{pdf_name}-lyrics.pdf"));

    match state
        .s3_client
        .get_object()
        .bucket(song::BUCKET.as_str())
        .key(&key)
        .send()
        .await
    {
        Ok(resp) => {
            let bytes = match resp.body.collect().await {
                Ok(b) => b.into_bytes().to_vec(),
                Err(_) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read PDF")
                        .into_response();
                }
            };
            let filename = format!("{} - {} (Lyrics).pdf", s.author, s.title);
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/pdf"),
                    (
                        header::CONTENT_DISPOSITION,
                        &format!("inline; filename=\"{filename}\""),
                    ),
                ],
                bytes,
            )
                .into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Lyrics PDF not found").into_response(),
    }
}

const PRESS_BOOK_PHOTOS_PREFIX: &str = "press-book/truskell-2025-06-06/photos/";
const PRESS_BOOK_VIDEOS_PREFIX: &str = "press-book/truskell-2025-06-06/videos/";

async fn api_press_book_photos(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let mut photos = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let mut request = state
            .s3_client
            .list_objects_v2()
            .bucket(song::BUCKET.as_str())
            .prefix(PRESS_BOOK_PHOTOS_PREFIX);

        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }

        let response = request
            .send()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        for object in response.contents() {
            if let Some(key) = object.key() {
                // Only include image files
                let lower_key = key.to_lowercase();
                if lower_key.ends_with(".jpg")
                    || lower_key.ends_with(".jpeg")
                    || lower_key.ends_with(".png")
                    || lower_key.ends_with(".gif")
                    || lower_key.ends_with(".webp")
                {
                    photos.push(make_cloudfront_url(key));
                }
            }
        }

        if response.is_truncated() == Some(true) {
            continuation_token = response.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    photos.sort();
    Ok(Json(photos))
}

async fn api_press_book_photo(State(state): State<AppState>, Path(key): Path<String>) -> Response {
    // Validate the key is within the press-book photos folder
    if !key.starts_with(PRESS_BOOK_PHOTOS_PREFIX) {
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }

    match state
        .s3_client
        .get_object()
        .bucket(song::BUCKET.as_str())
        .key(&key)
        .send()
        .await
    {
        Ok(resp) => {
            let content_type = resp
                .content_type()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "image/jpeg".to_string());

            match resp.body.collect().await {
                Ok(bytes) => (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, content_type)],
                    bytes.into_bytes().to_vec(),
                )
                    .into_response(),
                Err(_) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read image").into_response()
                }
            }
        }
        Err(_) => (StatusCode::NOT_FOUND, "Photo not found").into_response(),
    }
}

async fn api_press_book_videos(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let mut videos = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let mut request = state
            .s3_client
            .list_objects_v2()
            .bucket(song::BUCKET.as_str())
            .prefix(PRESS_BOOK_VIDEOS_PREFIX);

        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }

        let response = request
            .send()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        for object in response.contents() {
            if let Some(key) = object.key() {
                // Only include video files
                let lower_key = key.to_lowercase();
                if lower_key.ends_with(".mp4")
                    || lower_key.ends_with(".mov")
                    || lower_key.ends_with(".webm")
                    || lower_key.ends_with(".avi")
                {
                    videos.push(make_cloudfront_url(key));
                }
            }
        }

        if response.is_truncated() == Some(true) {
            continuation_token = response.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    videos.sort();
    Ok(Json(videos))
}

async fn api_press_book_video(State(state): State<AppState>, Path(key): Path<String>) -> Response {
    // Validate the key is within the press-book videos folder
    if !key.starts_with(PRESS_BOOK_VIDEOS_PREFIX) {
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }

    match state
        .s3_client
        .get_object()
        .bucket(song::BUCKET.as_str())
        .key(&key)
        .send()
        .await
    {
        Ok(resp) => {
            let content_type = resp
                .content_type()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "video/mp4".to_string());

            match resp.body.collect().await {
                Ok(bytes) => (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, content_type)],
                    bytes.into_bytes().to_vec(),
                )
                    .into_response(),
                Err(_) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read video").into_response()
                }
            }
        }
        Err(_) => (StatusCode::NOT_FOUND, "Video not found").into_response(),
    }
}

#[derive(Serialize)]
struct ReadS3Response {
    data: String,
}

#[derive(Serialize, Deserialize)]
struct MakeReportNode {
    pathbuf: String,
    status: String,
    #[serde(default)]
    digest: Option<String>,
    #[serde(default)]
    absolute_path: Option<String>,
    #[serde(default)]
    stdout_path: Option<String>,
    #[serde(default)]
    stderr_path: Option<String>,
    #[serde(default)]
    tag: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct MakeReportYml {
    nodes: Vec<MakeReportNode>,
}

#[derive(Serialize)]
struct MakeReportResponse {
    nodes: Vec<MakeReportNode>,
    last_modified: Option<String>,
}

async fn api_read_from_s3(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<ReadS3Response>, StatusCode> {
    println!("read from s3 {key:?}");
    let data = read_from_s3(&state.s3_client, &key)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(ReadS3Response { data }))
}

async fn api_make_report(
    State(state): State<AppState>,
) -> Result<Json<MakeReportResponse>, StatusCode> {
    let key = song::s3_key("sandbox/make-report.yml");
    let resp = state
        .s3_client
        .get_object()
        .bucket(song::BUCKET.as_str())
        .key(&key)
        .send()
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let last_modified = resp.last_modified().map(|dt| {
        dt.fmt(aws_sdk_s3::primitives::DateTimeFormat::DateTime)
            .unwrap_or_default()
    });

    let bytes = resp
        .body
        .collect()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .into_bytes();

    let report: MakeReportYml =
        serde_yaml::from_slice(&bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(MakeReportResponse {
        nodes: report.nodes,
        last_modified,
    }))
}

#[derive(Serialize)]
struct LambdaStatusResponse {
    running: bool,
    concurrent_executions: f64,
    timestamp: Option<String>,
    duration_secs: Option<i64>,
}

async fn api_lambda_status(
    State(state): State<AppState>,
) -> Result<Json<LambdaStatusResponse>, StatusCode> {
    use aws_sdk_cloudwatchlogs::types::OrderBy;

    // Get the latest log stream
    let logs_resp = state
        .logs_client
        .describe_log_streams()
        .log_group_name("/aws/lambda/band-songbook")
        .order_by(OrderBy::LastEventTime)
        .descending(true)
        .limit(1)
        .send()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let stream = logs_resp.log_streams().first();

    if stream.is_none() {
        return Ok(Json(LambdaStatusResponse {
            running: false,
            concurrent_executions: 0.0,
            timestamp: None,
            duration_secs: None,
        }));
    }

    let stream = stream.unwrap();
    let stream_name = stream.log_stream_name().unwrap_or_default();
    let start_ms = stream.first_event_timestamp();
    let end_ms = stream.last_event_timestamp();

    // Get the last few log events to check if Lambda finished
    let events_resp = state
        .logs_client
        .get_log_events()
        .log_group_name("/aws/lambda/band-songbook")
        .log_stream_name(stream_name)
        .start_from_head(false)
        .limit(5)
        .send()
        .await
        .ok();

    // Check if the last event indicates completion (REPORT or END)
    let logs_show_running = events_resp
        .as_ref()
        .and_then(|r| r.events().last())
        .map(|event| {
            let msg = event.message().unwrap_or_default();
            // If last event contains REPORT or END, Lambda has finished
            !msg.contains("REPORT") && !msg.contains("END RequestId")
        })
        .unwrap_or(false);

    // Check if we recently triggered a build (within 90 seconds)
    // This provides immediate feedback before CloudWatch logs propagate
    let recently_triggered = {
        let triggered_at = state.build_triggered_at.lock().await;
        triggered_at
            .map(|t| t.elapsed().as_secs() < 90)
            .unwrap_or(false)
    };

    // Consider running if logs show running OR we recently triggered a build
    // Clear the triggered flag if logs show completion
    let running = if logs_show_running {
        true
    } else if recently_triggered {
        // Logs might be delayed, trust the triggered flag
        true
    } else {
        // Logs show completed and no recent trigger
        // Clear the triggered flag if it exists
        *state.build_triggered_at.lock().await = None;
        false
    };

    // Get duration from triggered_at if running from recent trigger
    let triggered_duration = {
        let triggered_at = state.build_triggered_at.lock().await;
        triggered_at.map(|t| t.elapsed().as_secs() as i64)
    };

    let (timestamp, duration_secs) = if running && recently_triggered && !logs_show_running {
        // Running from recent trigger but logs haven't caught up
        let now = chrono::Utc::now();
        (
            Some(now.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
            triggered_duration,
        )
    } else if running {
        // Running according to logs
        let ts = start_ms.map(|ms| {
            let secs = ms / 1000;
            let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
            dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
        });
        let dur = start_ms.map(|start| {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;
            (now_ms - start) / 1000
        });
        (ts, dur)
    } else {
        // Completed
        let ts = end_ms.map(|ms| {
            let secs = ms / 1000;
            let dt = chrono::DateTime::from_timestamp(secs, 0).unwrap_or_default();
            dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
        });
        let dur = start_ms.and_then(|start| end_ms.map(|end| (end - start) / 1000));
        (ts, dur)
    };

    Ok(Json(LambdaStatusResponse {
        running,
        concurrent_executions: if running { 1.0 } else { 0.0 },
        timestamp,
        duration_secs,
    }))
}

#[derive(Deserialize)]
struct WriteS3Body {
    data: String,
}

async fn api_write_to_s3(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<WriteS3Body>,
) -> Result<StatusCode, StatusCode> {
    write_to_s3(&state.s3_client, &key, &body.data)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
struct LilypondToHtmlBody {
    input: String,
    stem: String,
    tempo: Option<u32>,
}

#[derive(Serialize)]
struct LilypondToHtmlResponse {
    html: String,
}

async fn api_lilypond_to_html(
    Json(body): Json<LilypondToHtmlBody>,
) -> Result<Json<LilypondToHtmlResponse>, (StatusCode, String)> {
    // Replace \songtempo with actual tempo value if provided
    let input = if let Some(tempo) = body.tempo {
        body.input.replace("\\songtempo", &tempo.to_string())
    } else {
        body.input
    };

    let html = lilypond_to_html(&input, &body.stem)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(LilypondToHtmlResponse { html }))
}

#[derive(Deserialize)]
struct DrumPatternToHtmlBody {
    data: String,
    name: String,
    tempo: Option<u32>,
}

async fn api_drum_pattern_to_html(
    Json(body): Json<DrumPatternToHtmlBody>,
) -> Result<Json<LilypondToHtmlResponse>, (StatusCode, String)> {
    let tempo = body.tempo.unwrap_or(120);
    let html = drum_pattern_to_html(&body.data, &body.name, tempo)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(LilypondToHtmlResponse { html }))
}

async fn api_guitar_embed(
    State(state): State<AppState>,
    Path(index): Path<usize>,
    axum::extract::Query(config): axum::extract::Query<AnimationConfig>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let url = write_guitar_embed_to_s3(&state.s3_client, index, &config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        serde_json::json!({ "url": url, "count": CONTOUR_COUNT, "names": contour_names() }),
    ))
}

async fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// Auth middleware for write operations
async fn write_auth_middleware(request: Request, next: Next) -> Result<Response, StatusCode> {
    let expected = std::env::var("WRITE_PASSWORD").ok();

    // Skip auth if no password configured
    if expected.is_none() {
        return Ok(next.run(request).await);
    }

    let provided = request
        .headers()
        .get("X-Write-Password")
        .and_then(|h| h.to_str().ok());

    if provided == expected.as_deref() {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

#[derive(Deserialize)]
struct VerifyPasswordRequest {
    password: String,
}

async fn verify_password(Json(req): Json<VerifyPasswordRequest>) -> impl IntoResponse {
    let expected = std::env::var("WRITE_PASSWORD").unwrap_or_default();
    if req.password == expected {
        StatusCode::OK
    } else {
        StatusCode::UNAUTHORIZED
    }
}

#[derive(Deserialize)]
struct MakeRequest {
    path: String,
}

#[derive(Serialize)]
struct MakeResponse {
    success: bool,
    message: String,
    report: Option<String>,
}

async fn api_make(
    State(state): State<AppState>,
    Json(req): Json<MakeRequest>,
) -> Result<Json<MakeResponse>, (StatusCode, Json<MakeResponse>)> {
    // Extract directory from song path (e.g., "songs/author/title/song.yml" -> "songs/author/title")
    let dir = req.path.trim_end_matches("/song.yml");

    // Build S3 URLs for srcdir and sandbox
    let srcdir = format!("s3://{}/{}", &*song::BUCKET, dir);
    let sandbox = format!("s3://{}/{}/sandbox", &*song::BUCKET, &*song::BUCKET_ROOT);

    // Create a temporary local sandbox directory
    let local_sandbox = tempfile::tempdir().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(MakeResponse {
                success: false,
                message: format!("Failed to create temp directory: {e}"),
                report: None,
            }),
        )
    })?;

    println!("api_make: srcdir={srcdir}");
    println!("api_make: sandbox={sandbox}");

    let result = band_songbook::make_all_with_storage(
        &srcdir,
        local_sandbox.path(),
        None,
        None,
        &sandbox,
        &[],
    )
    .await;

    // Try to read the make-report.yml from S3
    let report_key = song::s3_key("sandbox/make-report.yml");
    let report = read_from_s3(&state.s3_client, &report_key).await.ok();

    match result {
        Ok((success, _graph)) => {
            if success {
                Ok(Json(MakeResponse {
                    success: true,
                    message: "Build succeeded".to_string(),
                    report,
                }))
            } else {
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(MakeResponse {
                        success: false,
                        message: "Build failed".to_string(),
                        report,
                    }),
                ))
            }
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(MakeResponse {
                success: false,
                message: e,
                report,
            }),
        )),
    }
}

#[derive(Serialize)]
struct InvokeBuildResponse {
    success: bool,
    message: String,
}

async fn send_build_notification(ses_client: &SesClient, song_dir: &str) {
    // Get email addresses from environment variables
    let notification_email = match std::env::var("NOTIFICATION_EMAIL") {
        Ok(email) => email,
        Err(_) => {
            eprintln!("NOTIFICATION_EMAIL not set, skipping email notification");
            return;
        }
    };
    let sender_email = std::env::var("SENDER_EMAIL").unwrap_or_else(|_| notification_email.clone());
    use aws_sdk_sesv2::types::{Body, Content, Destination, EmailContent, Message};

    let subject = Content::builder()
        .data(format!("Build triggered: {song_dir}"))
        .build()
        .unwrap();

    let body_text = Content::builder()
        .data(format!(
            "A build has been triggered for:\n\n{}\n\nTime: {}",
            song_dir,
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
        ))
        .build()
        .unwrap();

    let body = Body::builder().text(body_text).build();
    let message = Message::builder().subject(subject).body(body).build();
    let email_content = EmailContent::builder().simple(message).build();

    let destination = Destination::builder()
        .to_addresses(&notification_email)
        .build();

    let result = ses_client
        .send_email()
        .from_email_address(&sender_email)
        .destination(destination)
        .content(email_content)
        .send()
        .await;

    match result {
        Ok(_) => println!("Build notification email sent to {notification_email}"),
        Err(e) => eprintln!("Failed to send notification email: {e}"),
    }
}

#[derive(Deserialize)]
struct InvokeBuildRequest {
    song_key: String,
    author: String,
    title: String,
}

async fn api_invoke_build(
    State(state): State<AppState>,
    Json(body): Json<InvokeBuildRequest>,
) -> Result<Json<InvokeBuildResponse>, (StatusCode, Json<InvokeBuildResponse>)> {
    use aws_sdk_lambda::primitives::Blob;

    // song_key is like "songs/author/title/song.yml", extract the directory
    let song_dir = body.song_key.trim_end_matches("/song.yml");
    let pattern = format!("{}{}", body.author, body.title);
    let srcdir = format!("{}/songs", state.srcdir_prefix);
    let delivery = state.delivery.clone();
    let settings = state.settings.clone();
    let all_songs = format!("{}/all-songs.yml", state.srcdir_prefix);

    let payload = serde_json::json!({
        "srcdir": srcdir,
        "delivery": delivery,
        "settings": settings,
        "all_songs": all_songs,
        "pattern": pattern,
        "log_level": "info",
    });
    let payload_bytes = serde_json::to_vec(&payload).unwrap_or_default();

    println!("Invoking Lambda with payload: {payload:?}");

    let result = state
        .lambda_client
        .invoke()
        .function_name("band-songbook")
        .invocation_type(aws_sdk_lambda::types::InvocationType::Event) // Async invocation
        .payload(Blob::new(payload_bytes))
        .send()
        .await;

    match result {
        Ok(_) => {
            // Mark build as triggered for immediate status feedback
            *state.build_triggered_at.lock().await = Some(std::time::Instant::now());

            // Send email notification (fire and forget)
            let ses = state.ses_client.clone();
            let dir = song_dir.to_string();
            tokio::spawn(async move {
                send_build_notification(&ses, &dir).await;
            });

            Ok(Json(InvokeBuildResponse {
                success: true,
                message: format!("Build triggered for {song_dir}"),
            }))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeBuildResponse {
                success: false,
                message: format!("Failed to invoke Lambda: {e}"),
            }),
        )),
    }
}

#[derive(Serialize)]
struct WorldResponse {
    success: bool,
    message: String,
}

async fn api_world(
    State(state): State<AppState>,
) -> Result<Json<WorldResponse>, (StatusCode, Json<WorldResponse>)> {
    use band_songbook::storage::{StoragePath, download_to_local};

    let srcdir = format!("{}/songs", state.srcdir_prefix);
    let srcdir_path = StoragePath::parse(&srcdir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(WorldResponse {
                success: false,
                message: format!("Invalid srcdir: {e}"),
            }),
        )
    })?;

    // Download songs from S3 to a temp directory
    let temp_dir = tempfile::tempdir().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(WorldResponse {
                success: false,
                message: format!("Failed to create temp directory: {e}"),
            }),
        )
    })?;

    download_to_local(&srcdir_path, temp_dir.path())
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(WorldResponse {
                    success: false,
                    message: format!("Failed to download songs: {e}"),
                }),
            )
        })?;

    // Call world_of_srcdir on the local temp directory
    let world = band_songbook::world_of_srcdir(temp_dir.path());

    // Serialize to YAML
    let yaml_content = serde_yaml::to_string(&world).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(WorldResponse {
                success: false,
                message: format!("Failed to serialize world: {e}"),
            }),
        )
    })?;

    // Write world.yml to S3
    write_to_s3(&state.s3_client, &song::s3_key("songs/world.yml"), &yaml_content)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(WorldResponse {
                    success: false,
                    message: format!("Failed to write world.yml: {e}"),
                }),
            )
        })?;

    Ok(Json(WorldResponse {
        success: true,
        message: format!("world.yml written with {} songs", world.items.len()),
    }))
}

#[derive(Deserialize)]
struct PdfQuery {
    title: String,
    author: String,
}

async fn serve_pdf(State(state): State<AppState>, Query(query): Query<PdfQuery>) -> Response {
    match get_song_pdf(&state.s3_client, &query.author, &query.title).await {
        Ok(pdf_bytes) => {
            let filename = format!("{} - {}.pdf", query.author, query.title);
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/pdf"),
                    (
                        header::CONTENT_DISPOSITION,
                        &format!("inline; filename=\"{filename}\""),
                    ),
                ],
                pdf_bytes,
            )
                .into_response()
        }
        Err(e) => (StatusCode::NOT_FOUND, format!("PDF not found: {e}")).into_response(),
    }
}

#[cfg(test)]
mod tests;
