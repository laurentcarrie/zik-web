mod edit;
mod songs;
mod update;

use aws_config::Region;
use aws_sdk_s3::Client;
use axum::{
    Form, Json, Router,
    extract::{Path, Query, State},
    http::{StatusCode, header, Method},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use songs::{download_font_from_s3, get_all_songs, get_lyrics, get_song_pdf, make_deezer_app_url, make_deezer_url, save_lyrics};

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

    // API routes
    let api_routes = Router::new()
        .route("/songs", get(api_songs))
        .route("/song/:id", get(api_song))
        .route("/pdf/:id", get(api_pdf))
        .with_state(state.clone());

    // Legacy HTML routes (can be removed after full migration)
    let legacy_routes = Router::new()
        .route("/edit", get(edit::edit_list))
        .route("/version", get(version))
        .route("/update", get(update::update))
        .route("/edit-yml", get(edit::edit_yml))
        .route("/save-yml", post(edit::save_yml))
        .route("/pdf", get(serve_pdf))
        .route("/edit-lyrics", get(edit_lyrics))
        .route("/save-lyrics", post(save_lyrics_handler))
        .with_state(state);

    // SPA fallback - serve index.html for all non-API, non-static routes
    let spa_service = ServeDir::new("dist")
        .not_found_service(ServeFile::new("dist/index.html"));

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

async fn api_songs(State(state): State<AppState>) -> Result<Json<Vec<ApiSong>>, StatusCode> {
    let songs = get_all_songs(&state.s3_client)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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

    Ok(Json(api_songs))
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
    let pdf_url = format!("/api/pdf/{id}");

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

async fn api_pdf(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let songs = match get_all_songs(&state.s3_client).await {
        Ok(s) => s,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to load songs").into_response(),
    };

    let song = match songs.into_iter().find(|(song_id, _, _, _, _)| song_id == &id) {
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

async fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
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

#[derive(Deserialize)]
struct LyricsQuery {
    author: String,
    title: String,
    section: String,
}

async fn edit_lyrics(
    State(state): State<AppState>,
    Query(query): Query<LyricsQuery>,
) -> Html<String> {
    let content = get_lyrics(
        &state.s3_client,
        &query.author,
        &query.title,
        &query.section,
    )
    .await
    .unwrap_or_default();

    Html(format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Lyrics - {} - M T L</title>
    <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/monokai.min.css">
    <style>
        body {{
            min-height: 100vh;
            background: url('/static/Move-the-line-affiche.jpg') repeat center center fixed;
            background-size: contain;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 2rem;
        }}
        .container {{
            max-width: 900px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 2rem;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
        }}
        .back-link {{
            display: inline-block;
            margin-bottom: 1rem;
            color: #667eea;
            text-decoration: none;
        }}
        .back-link:hover {{
            text-decoration: underline;
        }}
        h1 {{
            color: #333;
            margin-bottom: 0.5rem;
        }}
        .info {{
            color: #666;
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }}
        .CodeMirror {{
            height: 400px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
        }}
        .button-row {{
            display: flex;
            gap: 1rem;
            margin-top: 1rem;
        }}
        .save-btn {{
            padding: 0.75rem 1.5rem;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            cursor: pointer;
        }}
        .save-btn:hover {{
            background: #5a67d8;
        }}
    </style>
</head>
<body>
    <div class="container">
        <a href="javascript:history.back()" class="back-link">← Back</a>
        <h1>Edit Lyrics: {}</h1>
        <p class="info">{} / {}</p>
        <form method="post" action="/save-lyrics" id="lyrics-form">
            <input type="hidden" name="author" value="{}">
            <input type="hidden" name="title" value="{}">
            <input type="hidden" name="section" value="{}">
            <textarea name="content" id="editor">{}</textarea>
            <div class="button-row">
                <button type="submit" class="save-btn">Save</button>
            </div>
        </form>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/stex/stex.min.js"></script>
    <script>
        const textarea = document.getElementById('editor');
        const editor = CodeMirror.fromTextArea(textarea, {{
            mode: 'stex',
            theme: 'monokai',
            lineNumbers: true,
            lineWrapping: true
        }});

        document.getElementById('lyrics-form').addEventListener('submit', function(e) {{
            textarea.value = editor.getValue();
        }});
    </script>
</body>
</html>"#,
        html_escape(&query.section),
        html_escape(&query.section),
        html_escape(&query.author),
        html_escape(&query.title),
        html_escape(&query.author),
        html_escape(&query.title),
        html_escape(&query.section),
        html_escape(&content)
    ))
}

#[derive(Deserialize)]
struct SaveLyricsForm {
    author: String,
    title: String,
    section: String,
    content: String,
}

async fn save_lyrics_handler(
    State(state): State<AppState>,
    Form(form): Form<SaveLyricsForm>,
) -> Redirect {
    let _ = save_lyrics(
        &state.s3_client,
        &form.author,
        &form.title,
        &form.section,
        &form.content,
    )
    .await;
    Redirect::to(&format!(
        "/edit-lyrics?author={}&title={}&section={}",
        urlencoding::encode(&form.author),
        urlencoding::encode(&form.title),
        urlencoding::encode(&form.section)
    ))
}

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests;
