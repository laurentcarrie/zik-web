use super::storage::Storage;

pub fn generate_tempo_html(author: &str, title: &str, tempo: u16) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>{title} - {author}</title>
  <script src="https://unpkg.com/@strudel/embed@latest"></script>
  <style>
    html, body {{ margin: 0; padding: 0; width: 100%; height: 100%; }}
    strudel-repl {{ width: 100%; height: 100%; display: block; }}
    strudel-repl iframe {{ width: 100%; height: 100%; border: none; }}
  </style>
</head>
<body>
  <strudel-repl>
<!--

// {author}
// {title}

const tempo = {tempo};

$: stack(
  sound("[bd sd bd sd]"),
  sound("[hh@0.5 hh@0.5 hh@0.5 hh@0.5 hh@0.5 hh@0.5 hh@0.5 hh@0.5]"),
)
  .color('blue')
  ._punchcard()
  .cpm(tempo/4/1)
-->
  </strudel-repl>
</body>
</html>"#
    )
}

pub async fn write_tempo_html_to_s3(
    storage: &Storage,
    author: &str,
    title: &str,
    tempo: u16,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let song_info = band_songbook::model::SongInfo {
        title: title.to_string(),
        author: author.to_string(),
        tempo: 0,
        time_signature: None,
        tags: vec![],
    };
    let pdf_name = song_info.file_stem_of_song();
    let key = storage.full_key(&format!("delivery/tempo/{pdf_name}.html"));

    let html = generate_tempo_html(author, title, tempo);
    storage
        .put_bytes(key.as_str(), html.into_bytes(), Some("text/html"))
        .await?;

    Ok(storage.content_url(&key))
}
