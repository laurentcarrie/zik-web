pub mod edit_lyrics;
pub mod guitar_logo;
pub mod lilypond;
pub mod lyrics;
pub mod model;
pub mod songs;
pub mod tempo;

pub use edit_lyrics::{edit_lyrics, save_lyrics_handler};
pub use guitar_logo::{AnimationConfig, CONTOUR_COUNT, contour_names, write_guitar_embed_to_s3};
pub use lilypond::{drum_pattern_to_html, lilypond_to_html};
pub use lyrics::{get_lyrics_by_key, save_lyrics_by_key};
pub use model::{SongEntry, SongYml};
pub use songs::{
    BUCKET, BUCKET_ROOT, SongItem, download_font_from_s3, get_all_songs, get_song_pdf,
    get_song_yml, make_cloudfront_url, make_deezer_app_url, make_deezer_url, read_from_s3,
    s3_key, save_song_yml, write_all_songs_to_s3, write_to_s3,
};
pub use tempo::write_tempo_html_to_s3;
