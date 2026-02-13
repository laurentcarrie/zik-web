use super::song::{get_all_songs, make_deezer_url, s3_key, write_all_songs_to_s3, BUCKET};
use super::*;
use aws_config::Region;
use aws_sdk_s3::primitives::ByteStream;

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

async fn setup_test_data(client: &Client) {
    let key = s3_key("songs/world.yml");
    client
        .put_object()
        .bucket(BUCKET.as_str())
        .key(&key)
        .body(ByteStream::from(TEST_WORLD_YML.as_bytes().to_vec()))
        .content_type("text/yaml")
        .send()
        .await
        .expect("Failed to upload test world.yml");
}

async fn teardown_test_data(client: &Client) {
    let key = s3_key("songs/world.yml");
    let _ = client
        .delete_object()
        .bucket(BUCKET.as_str())
        .key(&key)
        .send()
        .await;
}

#[tokio::test]
async fn test_get_all_songs() {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let client = Client::new(&config);

    setup_test_data(&client).await;

    let result = get_all_songs(&client).await;

    teardown_test_data(&client).await;

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
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let client = Client::new(&config);

    write_all_songs_to_s3(&client)
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
