use axum::{
    Form,
    extract::{Query, State},
    response::{Html, Redirect},
};
use serde::Deserialize;

use super::lyrics::{get_lyrics, save_lyrics};
use crate::AppState;

#[derive(Deserialize)]
pub struct LyricsQuery {
    author: String,
    title: String,
    section: String,
}

pub async fn edit_lyrics(
    State(state): State<AppState>,
    Query(query): Query<LyricsQuery>,
) -> Html<String> {
    let content = get_lyrics(&state.storage, &query.author, &query.title, &query.section)
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
        <a href="javascript:window.close()" class="back-link">← Close</a>
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
pub struct SaveLyricsForm {
    author: String,
    title: String,
    section: String,
    content: String,
}

pub async fn save_lyrics_handler(
    State(state): State<AppState>,
    Form(form): Form<SaveLyricsForm>,
) -> Redirect {
    let _ = save_lyrics(
        &state.storage,
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
