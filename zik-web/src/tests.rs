use super::*;
use super::songs::{BUCKET, SongEntry};
use aws_config::Region;

#[tokio::test]
async fn test_get_all_songs() {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let client = Client::new(&config);

    let songs = get_all_songs(&client).await.expect("Failed to get songs");

    // Check we got some songs
    assert!(!songs.is_empty(), "Should have at least one song");

    // Check that Black Velvet by Alannah Myles is in the list
    let has_black_velvet = songs.iter().any(|(title, author)| {
        title == "Black Velvet" && author == "Alannah Myles"
    });
    assert!(has_black_velvet, "Should contain Black Velvet by Alannah Myles");

    // Print all songs for debugging
    println!("Found {} songs:", songs.len());
    for (title, author) in &songs {
        println!("  - {} by {}", title, author);
    }
}

#[tokio::test]
async fn test_write_all_songs_to_s3() {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new("eu-west-3"))
        .load()
        .await;
    let client = Client::new(&config);

    // Write all songs to S3
    write_all_songs_to_s3(&client).await.expect("Failed to write songs to S3");

    // Verify by reading back the file
    let resp = client
        .get_object()
        .bucket(BUCKET)
        .key("all-songs.yml")
        .send()
        .await
        .expect("Failed to read all-songs.yml");

    let bytes = resp.body.collect().await.expect("Failed to read body").into_bytes();
    let songs: Vec<SongEntry> = serde_yaml::from_slice(&bytes).expect("Failed to parse YAML");

    // Check we got some songs
    assert!(!songs.is_empty(), "Should have at least one song");

    // Check that Black Velvet by Alannah Myles is in the list
    let has_black_velvet = songs.iter().any(|s| {
        s.title == "Black Velvet" && s.author == "Alannah Myles"
    });
    assert!(has_black_velvet, "Should contain Black Velvet by Alannah Myles");

    println!("Wrote {} songs to all-songs.yml", songs.len());
}
