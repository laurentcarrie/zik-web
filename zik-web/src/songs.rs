use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use axum::response::Html;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;
use uuid::Uuid;

pub const BUCKET: &str = "laurent-zik";
const SONGS_PREFIX: &str = "songs/";
const FONT_S3_KEY: &str = "static/skriva-3.woff";
const FONT_LOCAL_PATH: &str = "static/skriva-3.woff";

#[derive(Deserialize)]
struct SongInfo {
    title: String,
    author: String,
}

#[derive(Deserialize)]
struct SongYml {
    info: SongInfo,
}

#[derive(Serialize, Deserialize)]
pub struct SongEntry {
    pub id: String,
    pub title: String,
    pub author: String,
    pub key: String,
    pub deezer_url: String,
}

pub async fn get_all_songs(
    client: &Client,
) -> Result<Vec<(String, String, String, String, String)>, Box<dyn std::error::Error + Send + Sync>> {
    let resp = client
        .get_object()
        .bucket(BUCKET)
        .key("all-songs.yml")
        .send()
        .await?;

    let bytes = resp.body.collect().await?.into_bytes();
    let songs: Vec<SongEntry> = serde_yaml::from_slice(&bytes)?;

    Ok(songs
        .into_iter()
        .map(|s| (s.id, s.title, s.author, s.key, s.deezer_url))
        .collect())
}

pub async fn write_all_songs_to_s3(
    client: &Client,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut songs = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let mut request = client.list_objects_v2().bucket(BUCKET).prefix(SONGS_PREFIX);

        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }

        let response = request.send().await?;

        for object in response.contents() {
            if let Some(key) = object.key() {
                if key.ends_with("/song.yml") {
                    match client.get_object().bucket(BUCKET).key(key).send().await {
                        Ok(resp) => {
                            let bytes = resp.body.collect().await?.into_bytes();
                            if let Ok(song_yml) = serde_yaml::from_slice::<SongYml>(&bytes) {
                                songs.push(SongEntry {
                                    id: Uuid::new_v4().to_string(),
                                    title: song_yml.info.title.clone(),
                                    author: song_yml.info.author.clone(),
                                    key: key.to_string(),
                                    deezer_url: make_deezer_url(
                                        &song_yml.info.title,
                                        &song_yml.info.author,
                                    ),
                                });
                            }
                        }
                        Err(_) => continue,
                    }
                }
            }
        }

        if response.is_truncated() == Some(true) {
            continuation_token = response.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    let yaml = serde_yaml::to_string(&songs)?;
    client
        .put_object()
        .bucket(BUCKET)
        .key("all-songs.yml")
        .body(ByteStream::from(yaml.into_bytes()))
        .content_type("text/yaml")
        .send()
        .await?;

    Ok(())
}

pub async fn download_font_from_s3(
    client: &Client,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let local_path = Path::new(FONT_LOCAL_PATH);

    // Create parent directory if it doesn't exist
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let resp = client
        .get_object()
        .bucket(BUCKET)
        .key(FONT_S3_KEY)
        .send()
        .await?;

    let bytes = resp.body.collect().await?.into_bytes();
    fs::write(local_path, bytes).await?;

    println!("Downloaded {FONT_LOCAL_PATH} from S3");
    Ok(())
}

pub async fn get_song_yml(
    client: &Client,
    key: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let resp = client.get_object().bucket(BUCKET).key(key).send().await?;

    let bytes = resp.body.collect().await?.into_bytes();
    Ok(String::from_utf8(bytes.to_vec())?)
}

pub async fn save_song_yml(
    client: &Client,
    key: &str,
    content: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    client
        .put_object()
        .bucket(BUCKET)
        .key(key)
        .body(ByteStream::from(content.as_bytes().to_vec()))
        .content_type("text/yaml")
        .send()
        .await?;

    Ok(())
}

pub fn make_deezer_url(title: &str, author: &str) -> String {
    format!(
        "https://www.deezer.com/search/{}/track",
        urlencoding::encode(&format!("{title} {author}"))
    )
}

pub fn make_deezer_app_url(title: &str, author: &str) -> String {
    format!(
        "deezer://www.deezer.com/search/{}/track",
        urlencoding::encode(&format!("{title} {author}"))
    )
}

fn normalize_for_pdf_key(s: &str) -> String {
    s.to_lowercase().replace([' ', '\'', '\u{2019}'], "_")
}

pub async fn get_song_pdf(
    client: &Client,
    author: &str,
    title: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let normalized_author = normalize_for_pdf_key(author);
    let normalized_title = normalize_for_pdf_key(title);
    let key = format!("pdf/{normalized_author}--@--{normalized_title}.pdf");
    let resp = client.get_object().bucket(BUCKET).key(&key).send().await?;

    let bytes = resp.body.collect().await?.into_bytes();
    Ok(bytes.to_vec())
}

pub async fn get_lyrics(
    client: &Client,
    author: &str,
    title: &str,
    section_id: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let key = format!("songs/{author}/{title}/lyrics/{section_id}.tex");
    let resp = client.get_object().bucket(BUCKET).key(&key).send().await?;

    let bytes = resp.body.collect().await?.into_bytes();
    Ok(String::from_utf8(bytes.to_vec())?)
}

pub async fn save_lyrics(
    client: &Client,
    author: &str,
    title: &str,
    section_id: &str,
    content: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let key = format!("songs/{author}/{title}/lyrics/{section_id}.tex");
    client
        .put_object()
        .bucket(BUCKET)
        .key(&key)
        .body(ByteStream::from(content.as_bytes().to_vec()))
        .content_type("text/plain")
        .send()
        .await?;

    Ok(())
}

pub async fn display_song(client: &Client, id: &str) -> Html<String> {
    let songs = get_all_songs(client).await.unwrap_or_default();

    match songs.iter().find(|(song_id, _, _, _, _)| song_id == id) {
        Some((_, title, author, _key, deezer_url)) => Html(format!(
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
        .btn-pdf {{
            background: #dc2626;
        }}
        .btn-pdf:hover {{
            background: #b91c1c;
        }}
        .btn-deezer {{
            background: #a238ff;
        }}
        .btn-deezer:hover {{
            background: #8a1fe0;
        }}
        .btn-deezer-app {{
            background: #ff6b35;
        }}
        .btn-deezer-app:hover {{
            background: #e55a2b;
        }}
    </style>
</head>
<body>
    <div class="container">
        <a href="/songs" class="back-link">← Back to Songs</a>
        <h1>{}</h1>
        <p class="author">{}</p>
        <div class="button-row">
            <a href="/pdf?title={}&author={}" class="btn btn-pdf" target="_blank">PDF</a>
            <a href="{}" class="btn btn-deezer" target="_blank">Deezer (Web)</a>
            <a href="{}" class="btn btn-deezer-app">Deezer (App)</a>
        </div>
    </div>
</body>
</html>"#,
            html_escape(title),
            html_escape(title),
            html_escape(author),
            urlencoding::encode(title),
            urlencoding::encode(author),
            deezer_url,
            make_deezer_app_url(title, author)
        )),
        None => Html("<h1>Song not found</h1>".to_string()),
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
