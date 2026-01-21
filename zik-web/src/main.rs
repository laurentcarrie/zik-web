mod songs;

use axum::{extract::{Path, Query, State}, response::{Html, Redirect, IntoResponse, Response}, routing::{get, post}, Form, Router, http::{header, StatusCode}};
use tower_http::services::ServeDir;
use aws_sdk_s3::Client;
use aws_config::Region;
use serde::Deserialize;

use songs::{get_all_songs, write_all_songs_to_s3, download_font_from_s3, get_song_yml, save_song_yml, get_song_pdf, get_lyrics, save_lyrics};

#[derive(Clone)]
struct AppState {
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
        eprintln!("Warning: Failed to download font from S3: {}", e);
    }

    let state = AppState { s3_client };

    let app = Router::new()
        .route("/", get(index))
        .route("/grilles", get(grilles))
        .route("/edit", get(edit_list))
        .route("/version", get(version))
        .route("/update", get(update))
        .route("/song/:id", get(display_song))
        .route("/edit-yml", get(edit_yml))
        .route("/save-yml", post(save_yml))
        .route("/pdf", get(serve_pdf))
        .route("/edit-lyrics", get(edit_lyrics))
        .route("/save-lyrics", post(save_lyrics_handler))
        .nest_service("/static", ServeDir::new("static"))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    println!("Server running at http://0.0.0.0:8080");
    axum::serve(listener, app).await.unwrap();
}

async fn index(State(_state): State<AppState>) -> Html<&'static str> {
    Html(r#"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>M T L</title>
    <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">
    <link rel="manifest" href="/static/site.webmanifest">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            min-height: 100vh;
            background: url('/static/Move-the-line-affiche.jpg') repeat center center fixed;
            background-size: contain;
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .container {
            position: relative;
            text-align: center;
            padding: 2rem;
        }
        nav {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        nav a {
            display: block;
            padding: 1rem 2rem;
            background: rgba(0, 0, 0, 0.5);
            color: white;
            text-decoration: none;
            border-radius: 10px;
            font-size: 1.1rem;
            transition: all 0.3s ease;
            backdrop-filter: blur(5px);
        }
        nav a:hover {
            background: rgba(0, 0, 0, 0.7);
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="container">
        <nav>
            <a href="/grilles">Grilles</a>
            <a href="/paroles">Paroles</a>
            <a href="/deezer">Deezer</a>
            <a href="/edit">Edit</a>
        </nav>
    </div>
</body>
</html>
"#)
}

async fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

async fn update(State(state): State<AppState>) -> String {
    match write_all_songs_to_s3(&state.s3_client).await {
        Ok(_) => "Updated".to_string(),
        Err(e) => format!("Error: {:?}", e),
    }
}

async fn display_song(State(state): State<AppState>, Path(id): Path<usize>) -> Html<String> {
    let songs = get_all_songs(&state.s3_client).await.unwrap_or_default();

    match songs.get(id) {
        Some((title, author, key)) => Html(format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{} - M T L</title>
    <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">
    <style>
        @font-face {{
            font-family: 'Fontskrivan';
            src: url('/static/skriva-3.woff') format('woff');
        }}
        body {{
            min-height: 100vh;
            background: url('/static/Move-the-line-affiche.jpg') repeat center center fixed;
            background-size: contain;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 2rem;
        }}
        .container {{
            max-width: 800px;
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
            font-family: 'Fontskrivan', cursive;
            font-weight: 900;
            font-size: 2em;
            color: #2563eb;
            -webkit-text-stroke: 0.5px #2563eb;
            margin-bottom: 0.5rem;
        }}
        .author {{
            font-family: 'Fontskrivan', cursive;
            font-weight: 900;
            font-size: 1.5em;
            color: #ea580c;
            -webkit-text-stroke: 0.5px #ea580c;
        }}
        .button-row {{
            display: flex;
            gap: 1rem;
            margin-top: 1.5rem;
        }}
        .btn {{
            display: inline-block;
            padding: 0.75rem 1.5rem;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-size: 1rem;
        }}
        .btn-edit {{
            background: #667eea;
        }}
        .btn-edit:hover {{
            background: #5a67d8;
        }}
        .btn-pdf {{
            background: #dc2626;
        }}
        .btn-pdf:hover {{
            background: #b91c1c;
        }}
    </style>
</head>
<body>
    <div class="container">
        <a href="/grilles" class="back-link">← Back to Grilles</a>
        <h1>{}</h1>
        <p class="author">{}</p>
        <div class="button-row">
            <a href="/edit-yml?key={}" class="btn btn-edit">Edit YML</a>
            <a href="/pdf?title={}&author={}" class="btn btn-pdf" target="_blank">View PDF</a>
        </div>
    </div>
</body>
</html>"#,
            html_escape(title),
            html_escape(title),
            html_escape(author),
            urlencoding::encode(key),
            urlencoding::encode(title),
            urlencoding::encode(author)
        )),
        None => Html("<h1>Song not found</h1>".to_string()),
    }
}

#[derive(Deserialize)]
struct EditYmlQuery {
    key: String,
}

async fn edit_yml(State(state): State<AppState>, Query(query): Query<EditYmlQuery>) -> Html<String> {
    // Extract author and title from key (format: songs/<author>/<title>/song.yml)
    let parts: Vec<&str> = query.key.split('/').collect();
    let (author, title) = if parts.len() >= 3 {
        (parts[1], parts[2])
    } else {
        ("", "")
    };

    match get_song_yml(&state.s3_client, &query.key).await {
        Ok(yml_content) => Html(format!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit YML - M T L</title>
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
            margin-bottom: 1rem;
        }}
        .key-info {{
            color: #666;
            font-size: 0.9rem;
            margin-bottom: 1rem;
            word-break: break-all;
        }}
        .CodeMirror {{
            height: 500px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
        }}
        .button-row {{
            display: flex;
            gap: 1rem;
            margin-top: 1rem;
            align-items: center;
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
        .save-btn:disabled {{
            background: #ccc;
            cursor: not-allowed;
        }}
        .status {{
            font-size: 0.9rem;
            padding: 0.5rem 1rem;
            border-radius: 5px;
        }}
        .status.valid {{
            background: #d4edda;
            color: #155724;
        }}
        .status.invalid {{
            background: #f8d7da;
            color: #721c24;
        }}
        .error-details {{
            margin-top: 0.5rem;
            padding: 0.5rem;
            background: #f8d7da;
            border-radius: 5px;
            font-family: monospace;
            font-size: 0.85rem;
            color: #721c24;
            display: none;
        }}
        .sections-container {{
            margin-top: 1.5rem;
            padding-top: 1rem;
            border-top: 1px solid #ddd;
        }}
        .sections-container h3 {{
            margin-bottom: 0.75rem;
            color: #333;
        }}
        .section-buttons {{
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }}
        .section-btn {{
            padding: 0.5rem 1rem;
            background: #10b981;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-size: 0.9rem;
        }}
        .section-btn:hover {{
            background: #059669;
        }}
    </style>
</head>
<body>
    <div class="container">
        <a href="/edit" class="back-link">← Back to Edit List</a>
        <h1>Edit YML</h1>
        <p class="key-info">{}</p>
        <form method="post" action="/save-yml" id="yml-form">
            <input type="hidden" name="key" value="{}">
            <input type="hidden" id="author" value="{}">
            <input type="hidden" id="title" value="{}">
            <textarea name="content" id="editor">{}</textarea>
            <div class="error-details" id="error-details"></div>
            <div class="button-row">
                <button type="submit" class="save-btn" id="save-btn">Save</button>
                <span class="status" id="status"></span>
            </div>
        </form>
        <div class="sections-container">
            <h3>Edit Lyrics</h3>
            <div class="section-buttons" id="section-buttons"></div>
        </div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/yaml/yaml.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js"></script>
    <script>
        const textarea = document.getElementById('editor');
        const status = document.getElementById('status');
        const saveBtn = document.getElementById('save-btn');
        const errorDetails = document.getElementById('error-details');

        // Create a custom schema that allows any tag (both scalar and mapping types)
        const tagNames = ['!Chords', '!Lyrics', '!Tab', '!Notes', '!Section', '!Verse', '!Chorus', '!Bridge', '!Intro', '!Outro', '!NewColumn', '!HorizontalRule'];
        const customTags = [];
        tagNames.forEach(tag => {{
            // Scalar type
            customTags.push(new jsyaml.Type(tag, {{
                kind: 'scalar',
                construct: data => data,
            }}));
            // Mapping type
            customTags.push(new jsyaml.Type(tag, {{
                kind: 'mapping',
                construct: data => data,
            }}));
            // Sequence type
            customTags.push(new jsyaml.Type(tag, {{
                kind: 'sequence',
                construct: data => data,
            }}));
        }});
        const CUSTOM_SCHEMA = jsyaml.DEFAULT_SCHEMA.extend(customTags);

        const editor = CodeMirror.fromTextArea(textarea, {{
            mode: 'yaml',
            theme: 'monokai',
            lineNumbers: true,
            indentUnit: 2,
            tabSize: 2,
            indentWithTabs: false,
            lineWrapping: true,
            autoCloseBrackets: true
        }});

        function validateYaml() {{
            const content = editor.getValue();
            try {{
                jsyaml.load(content, {{ schema: CUSTOM_SCHEMA }});
                status.textContent = '✓ Valid YAML';
                status.className = 'status valid';
                saveBtn.disabled = false;
                errorDetails.style.display = 'none';
                return true;
            }} catch (e) {{
                // If it's an unknown tag error, try to be more lenient
                if (e.message && e.message.includes('unknown tag')) {{
                    status.textContent = '⚠ Custom tags detected';
                    status.className = 'status valid';
                    saveBtn.disabled = false;
                    errorDetails.style.display = 'none';
                    return true;
                }}
                status.textContent = '✗ Invalid YAML';
                status.className = 'status invalid';
                saveBtn.disabled = true;
                errorDetails.textContent = e.message;
                errorDetails.style.display = 'block';
                return false;
            }}
        }}

        editor.on('change', validateYaml);
        validateYaml();

        document.getElementById('yml-form').addEventListener('submit', function(e) {{
            textarea.value = editor.getValue();
            if (!validateYaml()) {{
                e.preventDefault();
            }}
        }});

        // Extract sections from structure array and create edit buttons
        function updateSectionButtons() {{
            const content = editor.getValue();
            const author = document.getElementById('author').value;
            const title = document.getElementById('title').value;
            const sectionButtonsContainer = document.getElementById('section-buttons');
            sectionButtonsContainer.innerHTML = '';

            try {{
                const yaml = jsyaml.load(content, {{ schema: CUSTOM_SCHEMA }});
                const structure = yaml && yaml.structure ? yaml.structure : [];

                structure.forEach(item => {{
                    if (item && item.id) {{
                        const btn = document.createElement('a');
                        btn.href = '/edit-lyrics?author=' + encodeURIComponent(author) + '&title=' + encodeURIComponent(title) + '&section=' + encodeURIComponent(item.id);
                        btn.className = 'section-btn';
                        btn.textContent = item.id;
                        btn.target = '_blank';
                        sectionButtonsContainer.appendChild(btn);
                    }}
                }});

                if (structure.length === 0) {{
                    sectionButtonsContainer.innerHTML = '<em style="color: #999;">No sections found in structure</em>';
                }}
            }} catch (e) {{
                sectionButtonsContainer.innerHTML = '<em style="color: #999;">Unable to parse structure</em>';
            }}
        }}

        editor.on('change', updateSectionButtons);
        updateSectionButtons();
    </script>
</body>
</html>"#,
            html_escape(&query.key),
            html_escape(&query.key),
            html_escape(&author),
            html_escape(&title),
            html_escape(&yml_content)
        )),
        Err(e) => Html(format!("<h1>Error loading YML: {}</h1>", e)),
    }
}

#[derive(Deserialize)]
struct SaveYmlForm {
    key: String,
    content: String,
}

async fn save_yml(State(state): State<AppState>, Form(form): Form<SaveYmlForm>) -> Redirect {
    match save_song_yml(&state.s3_client, &form.key, &form.content).await {
        Ok(_) => Redirect::to(&format!("/edit-yml?key={}", urlencoding::encode(&form.key))),
        Err(_) => Redirect::to(&format!("/edit-yml?key={}&error=1", urlencoding::encode(&form.key))),
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
                    (header::CONTENT_DISPOSITION, &format!("inline; filename=\"{}\"", filename)),
                ],
                pdf_bytes,
            ).into_response()
        }
        Err(e) => (
            StatusCode::NOT_FOUND,
            format!("PDF not found: {}", e),
        ).into_response(),
    }
}

#[derive(Deserialize)]
struct LyricsQuery {
    author: String,
    title: String,
    section: String,
}

async fn edit_lyrics(State(state): State<AppState>, Query(query): Query<LyricsQuery>) -> Html<String> {
    let content = get_lyrics(&state.s3_client, &query.author, &query.title, &query.section)
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

async fn save_lyrics_handler(State(state): State<AppState>, Form(form): Form<SaveLyricsForm>) -> Redirect {
    let _ = save_lyrics(&state.s3_client, &form.author, &form.title, &form.section, &form.content).await;
    Redirect::to(&format!(
        "/edit-lyrics?author={}&title={}&section={}",
        urlencoding::encode(&form.author),
        urlencoding::encode(&form.title),
        urlencoding::encode(&form.section)
    ))
}

#[derive(Deserialize)]
struct GrillesQuery {
    #[serde(default)]
    sort: Option<String>,
}

async fn grilles(State(state): State<AppState>, Query(query): Query<GrillesQuery>) -> Html<String> {
    let mut songs = get_all_songs(&state.s3_client).await.unwrap_or_default();

    let sort_by = query.sort.as_deref().unwrap_or("title");
    match sort_by {
        "author" => songs.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()).then(a.0.to_lowercase().cmp(&b.0.to_lowercase()))),
        _ => songs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()).then(a.1.to_lowercase().cmp(&b.1.to_lowercase()))),
    }

    let mut song_list = String::new();
    for (title, author, _key) in &songs {
        let pdf_url = format!("/pdf?title={}&author={}", urlencoding::encode(title), urlencoding::encode(author));
        if sort_by == "author" {
            song_list.push_str(&format!(
                r#"<li><a href="{}" class="song-link" target="_blank"><span class="author">{}</span> <span class="connector">performs</span> <span class="title">{}</span></a></li>"#,
                pdf_url,
                html_escape(author),
                html_escape(title)
            ));
        } else {
            song_list.push_str(&format!(
                r#"<li><a href="{}" class="song-link" target="_blank"><span class="title">{}</span> <span class="connector">by</span> <span class="author">{}</span></a></li>"#,
                pdf_url,
                html_escape(title),
                html_escape(author)
            ));
        }
    }

    Html(format!(r#"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grilles - M T L</title>
    <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">
    <link rel="manifest" href="/static/site.webmanifest">
    <style>
        @font-face {{
            font-family: 'Fontskrivan';
            src: url('/static/skriva-3.woff') format('woff');
            font-weight: normal;
            font-style: normal;
        }}
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            min-height: 100vh;
            background: url('/static/Move-the-line-affiche.jpg') repeat center center fixed;
            background-size: contain;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 2rem;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 2rem;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
        }}
        h1 {{
            color: #333;
            margin-bottom: 1.5rem;
            font-size: 2rem;
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
        ul {{
            list-style: none;
        }}
        li {{
            padding: 0.75rem 0;
            border-bottom: 1px solid #eee;
        }}
        li:last-child {{
            border-bottom: none;
        }}
        .song-link {{
            text-decoration: none;
            display: block;
        }}
        .song-link:hover {{
            opacity: 0.8;
        }}
        .title {{
            font-family: 'Fontskrivan', cursive;
            font-weight: 900;
            font-size: 1.2em;
            color: #2563eb;
            -webkit-text-stroke: 0.5px #2563eb;
        }}
        .author {{
            font-family: 'Fontskrivan', cursive;
            font-weight: 900;
            font-size: 1.2em;
            color: #ea580c;
            -webkit-text-stroke: 0.5px #ea580c;
        }}
        .connector {{
            color: #999;
            font-size: 0.85em;
        }}
        .count {{
            color: #999;
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }}
        .sort-buttons {{
            margin-bottom: 1rem;
        }}
        .sort-btn {{
            padding: 0.5rem 1rem;
            margin-right: 0.5rem;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            text-decoration: none;
            font-size: 0.9rem;
            background: #eee;
            color: #333;
        }}
        .sort-btn:hover {{
            background: #ddd;
        }}
        .sort-btn.active {{
            background: #667eea;
            color: white;
        }}
        .search-box {{
            margin-bottom: 1rem;
        }}
        .search-box input {{
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 1rem;
        }}
        .search-box input:focus {{
            outline: none;
            border-color: #667eea;
        }}
        .hidden {{
            display: none;
        }}
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back</a>
        <h1>Grilles</h1>
        <div class="sort-buttons">
            <a href="/grilles?sort=title" class="sort-btn {}" data-sort="title">Sort by Title</a>
            <a href="/grilles?sort=author" class="sort-btn {}" data-sort="author">Sort by Author</a>
        </div>
        <div class="search-box">
            <input type="text" id="search" placeholder="Search..." autocomplete="off">
        </div>
        <p class="count"><span id="visible-count">{}</span> songs</p>
        <ul id="song-list">
            {}
        </ul>
    </div>
    <script>
        const searchInput = document.getElementById('search');
        const songList = document.getElementById('song-list');
        const visibleCount = document.getElementById('visible-count');
        const songs = songList.querySelectorAll('li');

        function fuzzyMatch(text, query) {{
            let ti = 0;
            for (let qi = 0; qi < query.length; qi++) {{
                const char = query[qi];
                while (ti < text.length && text[ti] !== char) ti++;
                if (ti >= text.length) return false;
                ti++;
            }}
            return true;
        }}

        searchInput.addEventListener('input', function() {{
            const query = this.value.toLowerCase();
            let count = 0;
            songs.forEach(song => {{
                const title = song.querySelector('.title').textContent.toLowerCase();
                const author = song.querySelector('.author').textContent.toLowerCase();
                const match = fuzzyMatch(title + ' ' + author, query);
                song.classList.toggle('hidden', !match);
                if (match) count++;
            }});
            visibleCount.textContent = count;
        }});
    </script>
</body>
</html>
"#,
    if sort_by == "title" { "active" } else { "" },
    if sort_by == "author" { "active" } else { "" },
    songs.len(),
    song_list))
}

async fn edit_list(State(state): State<AppState>, Query(query): Query<GrillesQuery>) -> Html<String> {
    let mut songs = get_all_songs(&state.s3_client).await.unwrap_or_default();

    let sort_by = query.sort.as_deref().unwrap_or("title");
    match sort_by {
        "author" => songs.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()).then(a.0.to_lowercase().cmp(&b.0.to_lowercase()))),
        _ => songs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()).then(a.1.to_lowercase().cmp(&b.1.to_lowercase()))),
    }

    let mut song_list = String::new();
    for (title, author, key) in &songs {
        let edit_url = format!("/edit-yml?key={}", urlencoding::encode(key));
        if sort_by == "author" {
            song_list.push_str(&format!(
                r#"<li><a href="{}" class="song-link"><span class="author">{}</span> <span class="connector">performs</span> <span class="title">{}</span></a></li>"#,
                edit_url,
                html_escape(author),
                html_escape(title)
            ));
        } else {
            song_list.push_str(&format!(
                r#"<li><a href="{}" class="song-link"><span class="title">{}</span> <span class="connector">by</span> <span class="author">{}</span></a></li>"#,
                edit_url,
                html_escape(title),
                html_escape(author)
            ));
        }
    }

    Html(format!(r#"
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit - M T L</title>
    <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/static/favicon-16x16.png">
    <link rel="manifest" href="/static/site.webmanifest">
    <style>
        @font-face {{
            font-family: 'Fontskrivan';
            src: url('/static/skriva-3.woff') format('woff');
            font-weight: normal;
            font-style: normal;
        }}
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            min-height: 100vh;
            background: url('/static/Move-the-line-affiche.jpg') repeat center center fixed;
            background-size: contain;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 2rem;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 2rem;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
        }}
        h1 {{
            color: #333;
            margin-bottom: 1.5rem;
            font-size: 2rem;
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
        ul {{
            list-style: none;
        }}
        li {{
            padding: 0.75rem 0;
            border-bottom: 1px solid #eee;
        }}
        li:last-child {{
            border-bottom: none;
        }}
        .song-link {{
            text-decoration: none;
            display: block;
        }}
        .song-link:hover {{
            opacity: 0.8;
        }}
        .title {{
            font-family: 'Fontskrivan', cursive;
            font-weight: 900;
            font-size: 1.2em;
            color: #2563eb;
            -webkit-text-stroke: 0.5px #2563eb;
        }}
        .author {{
            font-family: 'Fontskrivan', cursive;
            font-weight: 900;
            font-size: 1.2em;
            color: #ea580c;
            -webkit-text-stroke: 0.5px #ea580c;
        }}
        .connector {{
            color: #999;
            font-size: 0.85em;
        }}
        .count {{
            color: #999;
            font-size: 0.9rem;
            margin-bottom: 1rem;
        }}
        .sort-buttons {{
            margin-bottom: 1rem;
        }}
        .sort-btn {{
            padding: 0.5rem 1rem;
            margin-right: 0.5rem;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            text-decoration: none;
            font-size: 0.9rem;
            background: #eee;
            color: #333;
        }}
        .sort-btn:hover {{
            background: #ddd;
        }}
        .sort-btn.active {{
            background: #667eea;
            color: white;
        }}
        .search-box {{
            margin-bottom: 1rem;
        }}
        .search-box input {{
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 1rem;
        }}
        .search-box input:focus {{
            outline: none;
            border-color: #667eea;
        }}
        .hidden {{
            display: none;
        }}
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back</a>
        <h1>Edit Songs</h1>
        <div class="sort-buttons">
            <a href="/edit?sort=title" class="sort-btn {}" data-sort="title">Sort by Title</a>
            <a href="/edit?sort=author" class="sort-btn {}" data-sort="author">Sort by Author</a>
        </div>
        <div class="search-box">
            <input type="text" id="search" placeholder="Search..." autocomplete="off">
        </div>
        <p class="count"><span id="visible-count">{}</span> songs</p>
        <ul id="song-list">
            {}
        </ul>
    </div>
    <script>
        const searchInput = document.getElementById('search');
        const songList = document.getElementById('song-list');
        const visibleCount = document.getElementById('visible-count');
        const songs = songList.querySelectorAll('li');

        function fuzzyMatch(text, query) {{
            let ti = 0;
            for (let qi = 0; qi < query.length; qi++) {{
                const char = query[qi];
                while (ti < text.length && text[ti] !== char) ti++;
                if (ti >= text.length) return false;
                ti++;
            }}
            return true;
        }}

        searchInput.addEventListener('input', function() {{
            const query = this.value.toLowerCase();
            let count = 0;
            songs.forEach(song => {{
                const title = song.querySelector('.title').textContent.toLowerCase();
                const author = song.querySelector('.author').textContent.toLowerCase();
                const match = fuzzyMatch(title + ' ' + author, query);
                song.classList.toggle('hidden', !match);
                if (match) count++;
            }});
            visibleCount.textContent = count;
        }});
    </script>
</body>
</html>
"#,
    if sort_by == "title" { "active" } else { "" },
    if sort_by == "author" { "active" } else { "" },
    songs.len(),
    song_list))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests;
