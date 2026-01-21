use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use serde::{Deserialize, Serialize};

pub const BUCKET: &str = "laurent-zik";
const SONGS_PREFIX: &str = "songs/";

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
    pub title: String,
    pub author: String,
}

pub async fn get_all_songs(client: &Client) -> Result<Vec<(String, String)>, Box<dyn std::error::Error + Send + Sync>> {
    let resp = client
        .get_object()
        .bucket(BUCKET)
        .key("all-songs.yml")
        .send()
        .await?;

    let bytes = resp.body.collect().await?.into_bytes();
    let songs: Vec<SongEntry> = serde_yaml::from_slice(&bytes)?;

    Ok(songs.into_iter().map(|s| (s.title, s.author)).collect())
}

pub async fn write_all_songs_to_s3(client: &Client) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut songs = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let mut request = client
            .list_objects_v2()
            .bucket(BUCKET)
            .prefix(SONGS_PREFIX);

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
                                    title: song_yml.info.title,
                                    author: song_yml.info.author,
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
