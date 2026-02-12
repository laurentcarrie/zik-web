use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use band_songbook::model::{SongInfo, World, WorldItem};
use std::path::Path;
use tokio::fs;
use uuid::Uuid;

use super::{SongEntry, SongYml};

pub const BUCKET: &str = "zik-laurent";
pub const CLOUDFRONT_URL: &str = "https://dtuq2blkj3udo.cloudfront.net";
const SONGS_PREFIX: &str = "songs/";
const FONT_S3_KEY: &str = "static/skriva-3.woff";
const FONT_LOCAL_PATH: &str = "static/skriva-3.woff";

pub struct SongItem {
    pub id: String,
    pub title: String,
    pub author: String,
    pub key: String,
    pub tempo: u16,
    pub tags: Vec<String>,
    pub error: Option<String>,
}

pub async fn get_all_songs(
    client: &Client,
) -> Result<Vec<SongItem>, Box<dyn std::error::Error + Send + Sync>> {
    let resp = client
        .get_object()
        .bucket(BUCKET)
        .key("songs/world.yml")
        .send()
        .await
        .map_err(|e| {
            if e.to_string().contains("NoSuchKey") {
                format!("songs/world.yml not found in S3 bucket '{BUCKET}'. Run 'Re-index' from the Settings page to generate it.").into()
            } else {
                Box::new(e) as Box<dyn std::error::Error + Send + Sync>
            }
        })?;

    let bytes = resp.body.collect().await?.into_bytes();
    let world: World = serde_yaml::from_slice(&bytes)?;

    let mut items = Vec::new();

    for (rel_path, item) in world.items {
        let path_str = rel_path.display().to_string();
        let dir = path_str.trim_end_matches("/song.yml");
        let id = dir.replace('/', "--");
        let key = format!("songs/{path_str}");

        match item {
            WorldItem::Song(song) => {
                items.push(SongItem {
                    id,
                    title: song.info.title,
                    author: song.info.author,
                    key,
                    tempo: song.info.tempo,
                    tags: song.info.tags,
                    error: None,
                });
            }
            WorldItem::Error(msg) => {
                // Derive title/author from path: "author_name/song_title/song.yml"
                let parts: Vec<&str> = dir.split('/').collect();
                let (author, title) = if parts.len() >= 2 {
                    (parts[0].to_string(), parts[1].to_string())
                } else {
                    (dir.to_string(), dir.to_string())
                };
                items.push(SongItem {
                    id,
                    title,
                    author,
                    key,
                    tempo: 0,
                    tags: vec![],
                    error: Some(msg),
                });
            }
        }
    }

    Ok(items)
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
            if let Some(key) = object.key()
                && key.ends_with("/song.yml")
            {
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
                            return Err(format!("could not load song.yml with key {key}").into());
                        }
                    }
                    Err(e) => return Err(e.into()),
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

pub fn make_cloudfront_url(key: &str) -> String {
    format!("{CLOUDFRONT_URL}/{key}")
}

pub async fn get_song_pdf(
    client: &Client,
    author: &str,
    title: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let song_info = SongInfo {
        title: title.to_string(),
        author: author.to_string(),
        tempo: 0,
        time_signature: None,
        tags: vec![],
    };
    let pdf_name = song_info.file_stem_of_song();
    let key = format!("delivery/pdf/{pdf_name}.pdf");
    let resp = client.get_object().bucket(BUCKET).key(&key).send().await?;

    let bytes = resp.body.collect().await?.into_bytes();
    Ok(bytes.to_vec())
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
