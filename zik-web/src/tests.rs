use super::song::{Storage, get_all_songs, make_deezer_url, write_all_songs_to_s3};
use super::*;
use aws_config::Region;

const TEST_WORLD_YML: &str = r#"items:
- - Alannah Myles/Black Velvet/song.yml
  - !Song
    files:
      lilypond: []
      tex: []
      wav: []
    info:
      title: Black Velvet
      author: Alannah Myles
      tempo: 92
      tags: []
    meta:
      date: null
      digest: null
    structure: []
- - Test Artist/Test Song/song.yml
  - !Song
    files:
      lilypond: []
      tex: []
      wav: []
    info:
      title: Test Song
      author: Test Artist
      tempo: 120
      tags:
        - rock
    meta:
      date: null
      digest: null
    structure: []
"#;

async fn test_storage() -> Storage {
    let bucket = std::env::var("BUCKET").expect("BUCKET env var must be set for tests");
    let root = std::env::var("BUCKET_ROOT").expect("BUCKET_ROOT env var must be set for tests");
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let client = Client::new(&config);
    Storage::S3 {
        client,
        bucket,
        root,
    }
}

async fn setup_test_data(storage: &Storage) {
    let key = storage.full_key("songs/world.yml");
    storage
        .put_string(&key, TEST_WORLD_YML, Some("text/yaml"))
        .await
        .expect("Failed to upload test world.yml");
}

async fn teardown_test_data(storage: &Storage) {
    // For S3 mode, delete the test file. For local mode, just remove the file.
    if let Storage::S3 { client, bucket, .. } = storage {
        let key = storage.full_key("songs/world.yml");
        let _ = client.delete_object().bucket(bucket).key(&key).send().await;
    }
}

#[tokio::test]
async fn test_get_all_songs() {
    let storage = test_storage().await;

    setup_test_data(&storage).await;

    let result = get_all_songs(&storage).await;

    teardown_test_data(&storage).await;

    let songs = result.expect("Failed to get songs");

    println!("Found {} songs:", songs.len());
    for s in &songs {
        println!("  - {} by {}", s.title, s.author);
    }

    assert_eq!(songs.len(), 2, "Should have exactly 2 test songs");

    let has_black_velvet = songs
        .iter()
        .any(|s| s.title == "Black Velvet" && s.author == "Alannah Myles");
    assert!(
        has_black_velvet,
        "Should contain Black Velvet by Alannah Myles"
    );

    let has_test_song = songs
        .iter()
        .any(|s| s.title == "Test Song" && s.author == "Test Artist");
    assert!(has_test_song, "Should contain Test Song by Test Artist");
}

#[tokio::test]
#[ignore] // Legacy: all-songs.yml replaced by world.yml
async fn test_write_all_songs_to_s3() {
    let storage = test_storage().await;

    write_all_songs_to_s3(&storage)
        .await
        .expect("Failed to write songs to S3");
}

#[test]
fn test_parse_local_song_yml() {
    use super::song::SongYml;

    let content = std::fs::read_to_string("song.yml").expect("Failed to read song.yml");

    let song: SongYml =
        serde_yaml::from_str(&content).expect("Failed to parse song.yml as SongYml");

    assert!(!song.info.title.is_empty(), "Song title cannot be empty");
    assert!(!song.info.author.is_empty(), "Song author cannot be empty");
    assert!(!song.structure.is_empty(), "Song structure cannot be empty");
    println!(
        "Success! Title: {}, Author: {}",
        song.info.title, song.info.author
    );
}

#[test]
fn test_make_deezer_url() {
    let url = make_deezer_url("ca me vexe", "mademoiselle K");

    assert!(
        url.starts_with("https://www.deezer.com/search/"),
        "Deezer URL should start with search URL"
    );
    assert!(
        url.contains("ca%20me%20vexe"),
        "URL should contain encoded title"
    );
    assert!(
        url.contains("mademoiselle%20K"),
        "URL should contain encoded author"
    );
    println!("Deezer URL: {url}");
}

#[test]
fn test_snippet_names_merges_yml_and_body() {
    let song_yml = r#"
files:
  lilypond:
    - refrain.ly
    - chordscouplet.ly
  tex: []
  mp3: []
info:
  title: Shout
  author: Tears For Fears
  tempo: 96
  time_signature: null
meta:
  date: "2026-08-02"
structure: []
"#;
    let body_tex = r"\input{song.tikz}
\songly{chordscouplet}
\songly{solo}
\lyfile{intro}
";
    let names = crate::song::songs::snippet_names(song_yml, body_tex);
    // declared first, then the ones only the tex pulls in, without duplicates
    assert_eq!(names, vec!["refrain", "chordscouplet", "solo", "intro"]);
}

#[test]
fn test_snippet_names_tolerates_missing_sources() {
    assert!(crate::song::songs::snippet_names("", "").is_empty());
    assert_eq!(
        crate::song::songs::snippet_names("not: [valid", r"\songly{riff_a}"),
        vec!["riff_a"]
    );
}
