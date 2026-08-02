use band_songbook::model::{SongInfo, World, WorldItem};
use uuid::Uuid;

use super::storage::Storage;
use super::{SongEntry, SongYml};

pub struct SongItem {
    pub id: String,
    pub title: String,
    pub author: String,
    pub key: String,
    pub tempo: u16,
    pub tags: Vec<String>,
    pub has_song: bool,
    pub has_clicks: bool,
    pub error: Option<String>,
}

pub async fn get_all_songs(
    storage: &Storage,
) -> Result<Vec<SongItem>, Box<dyn std::error::Error + Send + Sync>> {
    let world_key = storage.full_key("songs/world.yml");
    let bytes = storage.get_bytes(&world_key).await.map_err(|e| {
        let debug_str = format!("{e:?}");
        if debug_str.contains("NoSuchKey") || e.to_string().contains("No such file") {
            format!(
                "{} not found. Run 'Re-index' from the Settings page to generate it.",
                world_key
            )
            .into()
        } else {
            e
        }
    })?;

    let world: World = serde_yaml::from_slice(&bytes)?;

    let mut items = Vec::new();

    for (rel_path, item) in world.items {
        let path_str = rel_path.display().to_string();
        let dir = path_str.trim_end_matches("/song.yml");
        let id = dir.replace('/', "--");
        let key = storage.full_key(&format!("songs/{path_str}"));

        match item {
            WorldItem::Song(song) => {
                items.push(SongItem {
                    id,
                    title: song.info.title,
                    author: song.info.author,
                    key,
                    tempo: song.info.tempo,
                    tags: song.info.tags,
                    has_song: song.files.has_mp3,
                    has_clicks: song.files.has_clicks,
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
                    has_song: false,
                    has_clicks: false,
                    error: Some(msg),
                });
            }
        }
    }

    Ok(items)
}

pub async fn write_all_songs_to_s3(
    storage: &Storage,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut songs = Vec::new();
    let songs_prefix = storage.full_key("songs/");
    println!("run write_all_songs_to_s3");

    let keys = storage.list_keys(&songs_prefix).await?;
    for key in &keys {
        if key.ends_with("/song.yml") {
            println!("found song");
            match storage.get_bytes(key).await {
                Ok(bytes) => {
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
                Err(e) => return Err(e),
            }
        }
    }
    println!("nb songs : {}", &songs.len());

    let yaml = serde_yaml::to_string(&songs)?;
    let all_songs_key = storage.full_key("all-songs.yml");
    storage
        .put_string(&all_songs_key, &yaml, Some("text/yaml"))
        .await?;

    Ok(())
}

pub async fn get_song_yml(
    storage: &Storage,
    key: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    storage.get_string(key).await
}

pub async fn save_song_yml(
    storage: &Storage,
    key: &str,
    content: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    storage.put_string(key, content, Some("text/yaml")).await
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

pub async fn get_song_pdf(
    storage: &Storage,
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
    let key = storage.full_key(&format!("delivery/pdf/{pdf_name}.pdf"));
    storage.get_bytes(&key).await
}

pub async fn write_data(
    storage: &Storage,
    key: &str,
    data: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    storage.put_string(key, data, None).await
}

pub async fn read_data(
    storage: &Storage,
    key: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    storage.get_string(key).await
}

/// One LilyPond snippet of a song: its section name plus whichever delivered
/// artifacts exist for it.
pub struct SnippetItem {
    pub name: String,
    pub has_pdf: bool,
    pub has_mp3: bool,
}

/// Section names of a song's LilyPond files, mirroring how band-songbook picks
/// them: everything declared under `files.lilypond`, plus anything `body.tex`
/// pulls in with `\songly{}` / `\lyfile{}`.
pub fn snippet_names(song_yml: &str, body_tex: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut push = |n: &str| {
        let n = n.trim().trim_end_matches(".ly").to_string();
        if !n.is_empty() && !names.contains(&n) {
            names.push(n);
        }
    };

    if let Ok(song) = serde_yaml::from_str::<band_songbook::model::Song>(song_yml) {
        for declared in &song.files.lilypond {
            push(declared);
        }
    }

    for macro_name in ["\\songly{", "\\lyfile{"] {
        let mut rest = body_tex;
        while let Some(start) = rest.find(macro_name) {
            rest = &rest[start + macro_name.len()..];
            match rest.find('}') {
                Some(end) => {
                    push(&rest[..end]);
                    rest = &rest[end..];
                }
                None => break,
            }
        }
    }

    names
}

/// List the snippets of a song that actually have delivered artifacts.
pub async fn get_song_snippets(
    storage: &Storage,
    author: &str,
    title: &str,
    song_key: &str,
) -> Vec<SnippetItem> {
    let song_dir = song_key.trim_end_matches("/song.yml");
    let song_yml = storage.get_string(song_key).await.unwrap_or_default();
    let body_tex = storage
        .get_string(&format!("{song_dir}/body.tex"))
        .await
        .unwrap_or_default();

    let song_info = SongInfo {
        title: title.to_string(),
        author: author.to_string(),
        tempo: 0,
        time_signature: None,
        tags: vec![],
    };
    let stem = song_info.file_stem_of_song();

    let mut snippets = Vec::new();
    for name in snippet_names(&song_yml, &body_tex) {
        let pdf_key = storage.full_key(&format!("delivery/pdf-snippets/{stem}-{name}.pdf"));
        let mp3_key = storage.full_key(&format!("delivery/mp3-renders/{stem}-{name}.mp3"));
        let has_pdf = storage.exists(&pdf_key).await.unwrap_or(false);
        let has_mp3 = storage.exists(&mp3_key).await.unwrap_or(false);
        if has_pdf || has_mp3 {
            snippets.push(SnippetItem {
                name,
                has_pdf,
                has_mp3,
            });
        }
    }
    snippets
}

/// Fetch one delivered snippet artifact. `ext` is `pdf` or `mp3`.
pub async fn get_snippet_bytes(
    storage: &Storage,
    author: &str,
    title: &str,
    name: &str,
    ext: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let song_info = SongInfo {
        title: title.to_string(),
        author: author.to_string(),
        tempo: 0,
        time_signature: None,
        tags: vec![],
    };
    let stem = song_info.file_stem_of_song();
    let dir = if ext == "pdf" {
        "pdf-snippets"
    } else {
        "mp3-renders"
    };
    let key = storage.full_key(&format!("delivery/{dir}/{stem}-{name}.{ext}"));
    storage.get_bytes(&key).await
}
