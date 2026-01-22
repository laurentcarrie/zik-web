use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use std::path::Path;
use strudel_of_lilypond::{LilyPondParser, StrudelGenerator};
use tokio::fs;
use uuid::Uuid;

use super::{SongEntry, SongYml};

pub const BUCKET: &str = "laurent-zik";
const SONGS_PREFIX: &str = "songs/";
const FONT_S3_KEY: &str = "static/skriva-3.woff";
const FONT_LOCAL_PATH: &str = "static/skriva-3.woff";

pub async fn get_all_songs(
    client: &Client,
) -> Result<Vec<(String, String, String, String, String)>, Box<dyn std::error::Error + Send + Sync>>
{
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
    println!("run write_all_songs_to_s3");

    loop {
        let mut request = client.list_objects_v2().bucket(BUCKET).prefix(SONGS_PREFIX);

        if let Some(token) = continuation_token {
            request = request.continuation_token(token);
        }

        let response = request.send().await?;

        for object in response.contents() {
            if let Some(key) = object.key() {
                if key.ends_with("/song.yml") {
                    println!("found song");

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
                            } else {
                                println!("problem with {key}");
                                return Err(
                                    format!("could not load song.yml with key {key}").into()
                                );
                            }
                        }
                        Err(e) => return Err(e.into()),
                    }
                }
            }
        }
        println!("nb songs : {}", &songs.len());
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
        "https://www.deezer.com/search/{}",
        urlencoding::encode(&format!("{title} {author}"))
    )
}

pub fn make_deezer_app_url(title: &str, author: &str) -> String {
    format!(
        "https://www.deezer.com/search/{}",
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

pub async fn get_lyrics_by_key(
    client: &Client,
    key: &str,
    id: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // key is like "songs/author/title/song.yml", extract directory
    let dir = key.rsplit_once('/').map(|(d, _)| d).unwrap_or(key);
    let lyrics_key = format!("{dir}/lyrics/{id}.tex");
    let resp = client
        .get_object()
        .bucket(BUCKET)
        .key(&lyrics_key)
        .send()
        .await?;

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

pub async fn save_lyrics_by_key(
    client: &Client,
    key: &str,
    id: &str,
    content: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // key is like "songs/author/title/song.yml", extract directory
    let dir = key.rsplit_once('/').map(|(d, _)| d).unwrap_or(key);
    let lyrics_key = format!("{dir}/lyrics/{id}.tex");
    client
        .put_object()
        .bucket(BUCKET)
        .key(&lyrics_key)
        .body(ByteStream::from(content.as_bytes().to_vec()))
        .content_type("text/plain")
        .send()
        .await?;

    Ok(())
}

pub async fn write_to_s3(
    client: &Client,
    key: &str,
    data: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    client
        .put_object()
        .bucket(BUCKET)
        .key(key)
        .body(ByteStream::from(data.as_bytes().to_vec()))
        .send()
        .await?;

    Ok(())
}

pub async fn read_from_s3(
    client: &Client,
    key: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let resp = client.get_object().bucket(BUCKET).key(key).send().await?;

    let bytes = resp.body.collect().await?.into_bytes();
    Ok(String::from_utf8(bytes.to_vec())?)
}

pub fn lilypond_to_html(
    input: &str,
    stem: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let parser = LilyPondParser::new();
    let result = parser.parse(input)?;
    let html = StrudelGenerator::generate_html(&result.staves, Some(&result.tempo), stem);
    Ok(html)
}
