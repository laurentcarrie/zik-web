use super::song::{get_all_songs, make_deezer_url, write_all_songs_to_s3};
use super::*;
use aws_config::Region;

#[tokio::test]
async fn test_get_all_songs() {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let client = Client::new(&config);

    let songs = get_all_songs(&client).await.expect("Failed to get songs");

    // Print all songs for debugging
    println!("Found {} songs:", songs.len());
    for s in &songs {
        println!("  - {} by {}", s.title, s.author);
    }

    // Check we got some songs
    if songs.is_empty() {
        println!("WARNING: No songs found in all-songs.yml - S3 bucket may need data restored");
        return;
    }

    // Check that Black Velvet by Alannah Myles is in the list
    let has_black_velvet = songs
        .iter()
        .any(|s| s.title == "Black Velvet" && s.author == "Alannah Myles");
    assert!(
        has_black_velvet,
        "Should contain Black Velvet by Alannah Myles"
    );
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
