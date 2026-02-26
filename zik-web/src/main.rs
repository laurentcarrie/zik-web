mod click_sync;
mod edit;
mod song;
mod update;

use aws_config::Region;
use aws_sdk_cloudwatchlogs::Client as CloudWatchLogsClient;
use aws_sdk_lambda::Client as LambdaClient;
use aws_sdk_s3::Client;
use aws_sdk_sesv2::Client as SesClient;
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, Request, State},
    http::{Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use song::{
    Animations, SongItem, drum_pattern_to_html, edit_lyrics, get_all_songs, get_lyrics_by_key,
    get_song_pdf, get_song_yml, lilypond_to_html, load_animations, make_cloudfront_url,
    make_deezer_app_url, make_deezer_url, read_from_s3, save_animations, save_lyrics_by_key,
    save_lyrics_handler, save_song_yml, write_animation_embed_to_s3, write_tempo_html_to_s3,
    write_to_s3,
};

#[derive(Clone)]
struct BandName(String);

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

    let click_sync_manager = click_sync::ClickSyncManager::new();
    click_sync_manager.clone().spawn_cleanup();

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
        .route("/song/{id}/structure", get(api_song_structure))
        .route("/song/{id}/lyrics/{section_id}", get(api_lyrics))
        .route("/pdf/{id}", get(api_pdf))
        .route("/pdf-lyrics/{id}", get(api_pdf_lyrics))
        .route("/mp3/{id}", get(api_mp3))
        .route("/clicks/{id}", get(api_clicks))
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
        .route("/animations", get(api_get_animations))
        .route("/config", get(api_config))
        .route("/auth/verify", post(verify_password))
        .route("/click-sync/{name}", get(click_sync::ws_handler))
        .route(
            "/click-sync/{name}/touch",
            post(click_sync::touch_session_handler),
        )
        .route(
            "/click-sync-sessions",
            get(click_sync::list_sessions_handler),
        )
        .layer(Extension(click_sync_manager))
        .with_state(state.clone());

    // Protected API routes (write operations) - require auth
    let protected_api_routes = Router::new()
        .route("/song/{id}/yml", post(api_save_song_yml))
        .route("/animations", post(api_save_animations))
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

    let inner = Router::new()
        .nest("/api", api_routes)
        .merge(legacy_routes)
        .fallback_service(spa_service);

    let mtl = inner
        .clone()
        .nest_service(
            "/static",
            ServeDir::new("static/mtl").fallback(ServeDir::new("static")),
        )
        .layer(Extension(BandName("mtl".to_string())));
    let sunny = inner
        .clone()
        .nest_service(
            "/static",
            ServeDir::new("static/sunny-bd").fallback(ServeDir::new("static")),
        )
        .layer(Extension(BandName("sunny-bd".to_string())));

    let app = Router::new()
        .route("/", get(root_landing))
        .route("/root", get(band_picker))
        .nest("/mtl", mtl)
        .nest("/sunny-bd", sunny)
        .merge(inner.layer(Extension(BandName(String::new()))))
        .nest_service("/static", ServeDir::new("static"))
        .layer(middleware::from_fn(websocket_header_fix))
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
    mp3_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    clicks_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn band_tag(band: &str) -> Option<&str> {
    match band {
        "mtl" => Some("move-the-line"),
        "sunny-bd" => Some("sunny-bd"),
        _ => None,
    }
}

async fn api_songs(
    State(state): State<AppState>,
    Extension(BandName(band)): Extension<BandName>,
) -> Response {
    match get_all_songs(&state.s3_client).await {
        Ok(items) => {
            let tag_filter = band_tag(&band);
            let api_songs: Vec<ApiSong> = items
                .into_iter()
                .filter(|s| tag_filter.is_none_or(|tag| s.tags.iter().any(|t| t == tag)))
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
    let lyrics_key = song::s3_key(&format!(
        "delivery/pdf-lyrics-1-column/{pdf_name}-lyrics.pdf"
    ));
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

    // Check for song.mp3 and clicks.yml in song directory
    let song_dir = key.trim_end_matches("/song.yml");
    let mp3_url = match state.s3_client.head_object()
        .bucket(song::BUCKET.as_str()).key(&format!("{song_dir}/song.mp3")).send().await {
        Ok(_) => Some(format!("/api/mp3/{id}")),
        Err(_) => None,
    };
    let clicks_url = match state.s3_client.head_object()
        .bucket(song::BUCKET.as_str()).key(&format!("{song_dir}/clicks.yml")).send().await {
        Ok(_) => Some(format!("/api/clicks/{id}")),
        Err(_) => None,
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
        mp3_url,
        clicks_url,
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

#[derive(Serialize)]
struct ChordGlyph {
    display: String,
    font: String,
    char: String,
}

#[derive(Serialize)]
struct ParsedChordBar {
    chords: Vec<ChordGlyph>,
}

#[derive(Serialize)]
struct ParsedChordRow {
    bars: Vec<ParsedChordBar>,
    repeat: u32,
    bar_number: i32,
}

#[derive(Serialize)]
struct ParsedSection {
    id: String,
    title: String,
    color: Option<String>,
    rows: Vec<ParsedChordRow>,
}

#[derive(Serialize)]
struct ParsedSongStructure {
    sections: Vec<ParsedSection>,
}

fn chord_display(chord: &band_songbook::chords::model::Chord) -> String {
    use band_songbook::chords::model::{Accidental, Alteration};
    let mut s = chord.name.clone();
    match chord.accidental {
        Accidental::Sharp => s.push('#'),
        Accidental::Flat => s.push('b'),
        Accidental::None => {}
    }
    if chord.minor {
        s.push('m');
    }
    match chord.alteration {
        Alteration::Six => s.push('6'),
        Alteration::Seven => s.push('7'),
        Alteration::MajorSeven => s.push_str("7M"),
        Alteration::Sus2 => s.push_str("sus2"),
        Alteration::Sus4 => s.push_str("sus4"),
        Alteration::Dim => s.push_str("dim"),
        Alteration::None | Alteration::Nofith => {}
    }
    s
}

fn baritem_to_glyph(item: &band_songbook::chords::model::BarItem) -> ChordGlyph {
    use band_songbook::chords::model::{Accidental, Alteration, BarItem};

    match item {
        BarItem::Rest(_) => ChordGlyph {
            display: String::new(),
            font: "songbook_sharp".into(),
            char: "\u{2013}".into(), // en-dash
        },
        BarItem::Chord(chord) => {
            let display = chord_display(chord);

            // Determine font based on accidental + sus
            let is_sus = matches!(chord.alteration, Alteration::Sus2 | Alteration::Sus4);
            let font = if is_sus {
                match chord.accidental {
                    Accidental::Flat => "songbook_flat", // flat+sus uses flat font
                    _ => "songbook_sus",
                }
            } else {
                match chord.accidental {
                    Accidental::Flat => "songbook_flat",
                    Accidental::Sharp => "songbook_sharp",
                    Accidental::None => "songbook",
                }
            };

            // Note index: A=0, B=1, C=2, D=3, E=4, F=5, G=6
            let note_idx = match chord.name.as_str() {
                "A" => 0,
                "B" => 1,
                "C" => 2,
                "D" => 3,
                "E" => 4,
                "F" => 5,
                "G" => 6,
                _ => 0,
            };

            let ch = if is_sus {
                if chord.accidental == Accidental::Flat {
                    // flat+sus: q,r,s,t,u,v,w
                    (b'q' + note_idx as u8) as char
                } else {
                    // sus2/sus4: just the note letter
                    (b'A' + note_idx as u8) as char
                }
            } else {
                match (&chord.alteration, chord.minor) {
                    (Alteration::None | Alteration::Nofith | Alteration::Six, false) => {
                        // Major: A-G
                        (b'A' + note_idx as u8) as char
                    }
                    (Alteration::None | Alteration::Nofith | Alteration::Six, true) => {
                        // Minor: H-N
                        (b'H' + note_idx as u8) as char
                    }
                    (Alteration::Seven, false) => {
                        // 7th: O-U
                        (b'O' + note_idx as u8) as char
                    }
                    (Alteration::Seven, true) => {
                        // m7th: V-\ (V,W,X,Y,Z,[,\)
                        (b'V' + note_idx as u8) as char
                    }
                    (Alteration::MajorSeven, _) => {
                        // 7M: c-i
                        (b'c' + note_idx as u8) as char
                    }
                    (Alteration::Dim, _) => {
                        // dim: j-p
                        (b'j' + note_idx as u8) as char
                    }
                    _ => (b'A' + note_idx as u8) as char,
                }
            };

            ChordGlyph {
                display,
                font: font.into(),
                char: ch.to_string(),
            }
        }
    }
}

fn default_section_color(section_type: &str) -> Option<String> {
    let color = match section_type {
        "intro" => "LavenderBlush2",
        "couplet" => "Wheat1",
        "couplet2" | "couplet3" => "MistyRose2",
        "prerefrain" | "prerefrain1" => "blue",
        "refrain" => "Coral1",
        "refrainb" => "MistyRose2",
        "pont" => "NavajoWhite2",
        "outro" => "Aquamarine2",
        "solo" => "red",
        "interlude" => "orange",
        "riff" => "blue",
        "fill" => "Aquamarine2",
        _ => return None,
    };
    Some(color.to_string())
}

async fn api_song_structure(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ParsedSongStructure>, StatusCode> {
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

    let song: band_songbook::model::Song =
        serde_yaml::from_str(&content).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let barcount_map =
        band_songbook::chords::bar_numbering::barcount_map_of_structure(&song.structure);

    // Build maps of id -> rows and id -> color for Ref resolution
    let mut rows_by_id: std::collections::HashMap<String, &Vec<String>> =
        std::collections::HashMap::new();
    let mut color_by_id: std::collections::HashMap<String, Option<String>> =
        std::collections::HashMap::new();
    for item in &song.structure {
        if let band_songbook::model::SectionItem::Chords(ref chords) = item.item {
            rows_by_id.insert(item.id.clone(), &chords.rows);
            let color = chords
                .color
                .clone()
                .or_else(|| default_section_color(&chords.section_type));
            color_by_id.insert(item.id.clone(), color);
        }
    }

    let mut sections = Vec::new();
    for item in &song.structure {
        let (title, color, raw_rows) = match &item.item {
            band_songbook::model::SectionItem::Chords(chords) => {
                let color = chords
                    .color
                    .clone()
                    .or_else(|| default_section_color(&chords.section_type));
                (chords.title.clone(), color, Some(&chords.rows))
            }
            band_songbook::model::SectionItem::Ref(ref_section) => {
                let rows = rows_by_id.get(&ref_section.link).copied();
                let color = ref_section
                    .color
                    .clone()
                    .or_else(|| {
                        ref_section
                            .section_type
                            .as_deref()
                            .and_then(default_section_color)
                    })
                    .or_else(|| color_by_id.get(&ref_section.link).cloned().flatten());
                (ref_section.title.clone(), color, rows)
            }
            _ => continue,
        };

        let bar_numbers = barcount_map
            .get(&item.id)
            .map(|(nums, _)| nums.clone())
            .unwrap_or_default();

        let parsed_rows: Vec<ParsedChordRow> = raw_rows
            .into_iter()
            .flat_map(|rows| rows.iter())
            .enumerate()
            .filter_map(|(i, row)| {
                let parsed = band_songbook::chords::parse::parse(row).ok()?;
                let bars = parsed
                    .bars
                    .iter()
                    .map(|bar| ParsedChordBar {
                        chords: bar.items.iter().map(baritem_to_glyph).collect(),
                    })
                    .collect();
                Some(ParsedChordRow {
                    bars,
                    repeat: parsed.repeat.n,
                    bar_number: bar_numbers.get(i).copied().unwrap_or(0),
                })
            })
            .collect();

        sections.push(ParsedSection {
            id: item.id.clone(),
            title,
            color,
            rows: parsed_rows,
        });
    }

    Ok(Json(ParsedSongStructure { sections }))
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

async fn api_mp3(State(state): State<AppState>, Path(id): Path<String>) -> Response {
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

    let song_dir = s.key.trim_end_matches("/song.yml");
    let mp3_key = format!("{song_dir}/song.mp3");

    match state
        .s3_client
        .get_object()
        .bucket(song::BUCKET.as_str())
        .key(&mp3_key)
        .send()
        .await
    {
        Ok(resp) => {
            let bytes = match resp.body.collect().await {
                Ok(b) => b.into_bytes(),
                Err(_) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read MP3")
                        .into_response()
                }
            };
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "audio/mpeg")],
                bytes.to_vec(),
            )
                .into_response()
        }
        Err(e) => (StatusCode::NOT_FOUND, format!("MP3 not found: {e}")).into_response(),
    }
}

async fn api_clicks(State(state): State<AppState>, Path(id): Path<String>) -> Response {
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

    let song_dir = s.key.trim_end_matches("/song.yml");
    let clicks_key = format!("{song_dir}/clicks.yml");

    match state
        .s3_client
        .get_object()
        .bucket(song::BUCKET.as_str())
        .key(&clicks_key)
        .send()
        .await
    {
        Ok(resp) => {
            let bytes = match resp.body.collect().await {
                Ok(b) => b.into_bytes(),
                Err(_) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read clicks.yml")
                        .into_response()
                }
            };
            // Parse YAML with ticks field and return as JSON array
            let content = String::from_utf8_lossy(&bytes);
            #[derive(serde::Deserialize)]
            struct ClickData { ticks: Vec<f64> }
            match serde_yaml::from_str::<ClickData>(&content) {
                Ok(data) => Json(data.ticks).into_response(),
                Err(e) => {
                    (StatusCode::BAD_REQUEST, format!("Invalid clicks.yml: {e}")).into_response()
                }
            }
        }
        Err(e) => (StatusCode::NOT_FOUND, format!("clicks.yml not found: {e}")).into_response(),
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

fn press_book_photos_path() -> String {
    let dir = std::env::var("PRESS_BOOK_DIR")
        .unwrap_or_else(|_| "press-book/truskell-2025-06-06".to_string());
    format!("{dir}/photos/")
}

fn press_book_videos_path() -> String {
    let dir = std::env::var("PRESS_BOOK_DIR")
        .unwrap_or_else(|_| "press-book/truskell-2025-06-06".to_string());
    format!("{dir}/videos/")
}

async fn api_press_book_photos(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    let mut photos = Vec::new();
    let mut continuation_token: Option<String> = None;
    let prefix = song::s3_key(&press_book_photos_path());

    loop {
        let mut request = state
            .s3_client
            .list_objects_v2()
            .bucket(song::BUCKET.as_str())
            .prefix(&prefix);

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
    let photos_prefix = song::s3_key(&press_book_photos_path());
    if !key.starts_with(&photos_prefix) {
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

    let prefix = song::s3_key(&press_book_videos_path());

    loop {
        let mut request = state
            .s3_client
            .list_objects_v2()
            .bucket(song::BUCKET.as_str())
            .prefix(&prefix);

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
    let videos_prefix = song::s3_key(&press_book_videos_path());
    if !key.starts_with(&videos_prefix) {
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
    Extension(BandName(band)): Extension<BandName>,
    Path(index): Path<usize>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let animations =
        load_animations(&band).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let names: Vec<&str> = animations.items.iter().map(|a| a.name.as_str()).collect();
    let count = animations.items.len();
    let url = write_animation_embed_to_s3(&state.s3_client, &band, &animations, index)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        serde_json::json!({ "url": url, "count": count, "names": names }),
    ))
}

async fn api_get_animations(
    Extension(BandName(band)): Extension<BandName>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let animations =
        load_animations(&band).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let value = serde_json::to_value(&animations)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(value))
}

async fn api_config(Extension(BandName(band)): Extension<BandName>) -> Json<serde_json::Value> {
    let favicon = std::env::var("FAVICON").ok().map(|filename| {
        if band.is_empty() {
            format!("/static/{filename}")
        } else {
            format!("/static/{band}/{filename}")
        }
    });
    Json(serde_json::json!({ "favicon": favicon }))
}

async fn api_save_animations(
    Extension(BandName(band)): Extension<BandName>,
    Json(animations): Json<Animations>,
) -> Result<StatusCode, (StatusCode, String)> {
    save_animations(&band, &animations)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::OK)
}

async fn root_landing() -> impl IntoResponse {
    Redirect::permanent("/mtl")
}

async fn band_picker() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Songbook</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #1a1a2e; font-family: system-ui, sans-serif; }
  .buttons { display: flex; flex-direction: column; gap: 1.5rem; }
  a { display: block; padding: 1.5rem 3rem; border-radius: 12px; text-decoration: none; color: white; font-size: 1.5rem; font-weight: 600; text-align: center; transition: transform 0.15s, box-shadow 0.15s; }
  a:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
  .mtl { background: linear-gradient(135deg, #2563eb, #7c3aed); }
  .sunny { background: linear-gradient(135deg, #ea580c, #eab308); }
</style>
</head>
<body>
<div class="buttons">
  <a class="mtl" href="/mtl">Move The Line</a>
  <a class="sunny" href="/sunny-bd">Sunny Bd</a>
</div>
</body>
</html>"#,
    )
}

async fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// ALBs strip hop-by-hop headers (Connection, Upgrade) when proxying.
/// This middleware restores them for WebSocket requests detected via Sec-WebSocket-Key.
async fn websocket_header_fix(mut request: Request, next: Next) -> Response {
    if request.headers().contains_key(header::SEC_WEBSOCKET_KEY)
        && !request
            .headers()
            .get(header::CONNECTION)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().contains("upgrade"))
    {
        let headers = request.headers_mut();
        headers.insert(header::CONNECTION, "Upgrade".parse().unwrap());
        headers.insert(header::UPGRADE, "websocket".parse().unwrap());
    }
    next.run(request).await
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
    write_to_s3(
        &state.s3_client,
        &song::s3_key("songs/world.yml"),
        &yaml_content,
    )
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
