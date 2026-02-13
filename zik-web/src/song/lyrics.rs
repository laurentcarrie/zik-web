use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;

use super::songs::{BUCKET, s3_key};

pub async fn get_lyrics(
    client: &Client,
    author: &str,
    title: &str,
    section_id: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let key = s3_key(&format!("songs/{author}/{title}/lyrics/{section_id}.tex"));
    let resp = client.get_object().bucket(BUCKET.as_str()).key(&key).send().await?;

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
        .bucket(BUCKET.as_str())
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
    let key = s3_key(&format!("songs/{author}/{title}/lyrics/{section_id}.tex"));
    client
        .put_object()
        .bucket(BUCKET.as_str())
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
        .bucket(BUCKET.as_str())
        .key(&lyrics_key)
        .body(ByteStream::from(content.as_bytes().to_vec()))
        .content_type("text/plain")
        .send()
        .await?;

    Ok(())
}
