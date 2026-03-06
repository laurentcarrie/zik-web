use super::storage::Storage;

pub async fn get_lyrics(
    storage: &Storage,
    author: &str,
    title: &str,
    section_id: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let key = storage.full_key(&format!("songs/{author}/{title}/lyrics/{section_id}.tex"));
    storage.get_string(&key).await
}

pub async fn get_lyrics_by_key(
    storage: &Storage,
    key: &str,
    id: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // key is like "songs/author/title/song.yml", extract directory
    let dir = key.rsplit_once('/').map(|(d, _)| d).unwrap_or(key);
    let lyrics_key = format!("{dir}/lyrics/{id}.tex");
    storage.get_string(&lyrics_key).await
}

pub async fn save_lyrics(
    storage: &Storage,
    author: &str,
    title: &str,
    section_id: &str,
    content: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let key = storage.full_key(&format!("songs/{author}/{title}/lyrics/{section_id}.tex"));
    storage.put_string(&key, content, Some("text/plain")).await
}

pub async fn save_lyrics_by_key(
    storage: &Storage,
    key: &str,
    id: &str,
    content: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // key is like "songs/author/title/song.yml", extract directory
    let dir = key.rsplit_once('/').map(|(d, _)| d).unwrap_or(key);
    let lyrics_key = format!("{dir}/lyrics/{id}.tex");
    storage
        .put_string(&lyrics_key, content, Some("text/plain"))
        .await
}
