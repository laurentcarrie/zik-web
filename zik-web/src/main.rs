mod edit;
mod song;
mod update;

use aws_config::Region;
use aws_sdk_s3::Client;
use axum::{
    Json, Router,
    extract::{Path, Query, State, Request},
    http::{Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use song::{
    download_font_from_s3, edit_lyrics, get_all_songs, get_lyrics_by_key, get_song_pdf,
    get_song_yml, lilypond_to_html, make_cloudfront_pdf_url, make_cloudfront_url,
    make_deezer_app_url, make_deezer_url, read_from_s3, save_lyrics_by_key, save_lyrics_handler,
    save_song_yml, write_to_s3,
};

#[derive(Clone)]
pub struct AppState {
    s3_client: Client,
}

#[tokio::main]
async fn main() {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let s3_client = Client::new(&config);

    // Download font from S3 to static directory
    if let Err(e) = download_font_from_s3(&s3_client).await {
        eprintln!("Warning: Failed to download font from S3: {e}");
    }

    let state = AppState { s3_client };

    // CORS layer for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    // Public API routes (read operations)
    let public_api_routes = Router::new()
        .route("/songs", get(api_songs))
        .route("/song/:id", get(api_song))
        .route("/song/:id/yml", get(api_song_yml))
        .route("/song/:id/lyrics/:section_id", get(api_lyrics))
        .route("/pdf/:id", get(api_pdf))
        .route("/press-book/photos", get(api_press_book_photos))
        .route("/press-book/photo/*key", get(api_press_book_photo))
        .route("/press-book/videos", get(api_press_book_videos))
        .route("/press-book/video/*key", get(api_press_book_video))
        .route("/s3/*key", get(api_read_from_s3))
        .route("/make-report", get(api_make_report))
        .route("/lilypond-to-html", post(api_lilypond_to_html))
        .route("/auth/verify", post(verify_password))
        .with_state(state.clone());

    // Protected API routes (write operations) - require auth
    let protected_api_routes = Router::new()
        .route("/song/:id/yml", post(api_save_song_yml))
        .route("/song/:id/lyrics/:section_id", post(api_save_lyrics))
        .route("/s3/*key", post(api_write_to_s3))
        .route("/make", post(api_make))
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
}

#[derive(Serialize)]
struct ApiSongDetail {
    id: String,
    title: String,
    author: String,
    deezer_url: String,
    deezer_app_url: String,
    pdf_url: String,
    key: String,
}

async fn api_songs(State(state): State<AppState>) -> Response {
    match get_all_songs(&state.s3_client).await {
        Ok(songs) => {
            let api_songs: Vec<ApiSong> = songs
                .into_iter()
                .map(|(id, title, author, _key, _deezer_url)| {
                    let deezer_url = make_deezer_url(&title, &author);
                    let deezer_app_url = make_deezer_app_url(&title, &author);
                    ApiSong {
                        id,
                        title,
                        author,
                        deezer_url,
                        deezer_app_url,
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
    let songs = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let song = songs
        .into_iter()
        .find(|(song_id, _, _, _, _)| song_id == &id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let (id, title, author, key, _deezer_url) = song;
    let deezer_url = make_deezer_url(&title, &author);
    let deezer_app_url = make_deezer_app_url(&title, &author);
    let pdf_url = make_cloudfront_pdf_url(&author, &title);

    Ok(Json(ApiSongDetail {
        id,
        title,
        author,
        deezer_url,
        deezer_app_url,
        pdf_url,
        key,
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
    let songs = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let song = songs
        .into_iter()
        .find(|(song_id, _, _, _, _)| song_id == &id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let (_id, _title, _author, key, _deezer_url) = song;

    let content = get_song_yml(&state.s3_client, &key)
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
) -> Result<StatusCode, StatusCode> {
    let songs = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let song = songs
        .into_iter()
        .find(|(song_id, _, _, _, _)| song_id == &id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let (_id, _title, _author, key, _deezer_url) = song;

    save_song_yml(&state.s3_client, &key, &body.content)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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
    let songs = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let song = songs
        .into_iter()
        .find(|(song_id, _, _, _, _)| song_id == &id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let (_id, _title, _author, key, _deezer_url) = song;

    let content = get_lyrics_by_key(&state.s3_client, &key, &section_id)
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
    let songs = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let song = songs
        .into_iter()
        .find(|(song_id, _, _, _, _)| song_id == &id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let (_id, _title, _author, key, _deezer_url) = song;

    save_lyrics_by_key(&state.s3_client, &key, &section_id, &body.content)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

async fn api_pdf(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let songs = match get_all_songs(&state.s3_client).await {
        Ok(s) => s,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to load songs").into_response();
        }
    };

    let song = match songs
        .into_iter()
        .find(|(song_id, _, _, _, _)| song_id == &id)
    {
        Some(s) => s,
        None => return (StatusCode::NOT_FOUND, "Song not found").into_response(),
    };

    let (_id, title, author, _key, _deezer_url) = song;

    match get_song_pdf(&state.s3_client, &author, &title).await {
        Ok(pdf_bytes) => {
            let filename = format!("{author} - {title}.pdf");
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
            .bucket(song::BUCKET)
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
        .bucket(song::BUCKET)
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
            .bucket(song::BUCKET)
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
        .bucket(song::BUCKET)
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
) -> Result<Json<ReadS3Response>, StatusCode> {
    let data = read_from_s3(&state.s3_client, "sandbox/make-report.yml")
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(ReadS3Response { data }))
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

async fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// Auth middleware for write operations
async fn write_auth_middleware(
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let expected = std::env::var("WRITE_PASSWORD").ok();

    // Skip auth if no password configured
    if expected.is_none() {
        return Ok(next.run(request).await);
    }

    let provided = request.headers()
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

async fn verify_password(
    Json(req): Json<VerifyPasswordRequest>,
) -> impl IntoResponse {
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
    let srcdir = format!("s3://{}/{}", song::BUCKET, dir);
    let sandbox = format!("s3://{}/sandbox", song::BUCKET);

    println!("api_make: srcdir={}", srcdir);
    println!("api_make: sandbox={}", sandbox);

    let result = band_songbook::make_all_with_storage(&srcdir, &sandbox, None, None).await;

    // Try to read the make-report.yml from S3
    let report_key = "sandbox/make-report.yml";
    let report = read_from_s3(&state.s3_client, report_key).await.ok();

    match result {
        Ok((success, _graph)) => {
            if success {
                Ok(Json(MakeResponse {
                    success: true,
                    message: "Build succeeded".to_string(),
                    report,
                }))
            } else {
                Err((StatusCode::INTERNAL_SERVER_ERROR, Json(MakeResponse {
                    success: false,
                    message: "Build failed".to_string(),
                    report,
                })))
            }
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(MakeResponse {
            success: false,
            message: e,
            report,
        }))),
    }
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
