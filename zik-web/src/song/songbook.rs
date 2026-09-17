//! Songbooks assembled on demand: a selection of songs merged into one PDF,
//! plus the `llms.txt` page that tells AI assistants how to link to them.

use std::collections::BTreeMap;

use super::songs::{ApiSong, SongItem};

/// Most songs a single songbook may collate.
pub const MAX_SONGBOOK_SONGS: usize = 100;

/// Which songs go into a songbook. Every given criterion must match.
#[derive(Debug, Default)]
pub struct SongbookFilter {
    /// Song ids, in the order they are collated.
    pub ids: Vec<String>,
    /// Author, matched case-insensitively.
    pub author: Option<String>,
    /// Tag, matched case-insensitively.
    pub tag: Option<String>,
}

impl SongbookFilter {
    /// Builds a filter from the raw query values: `ids` is comma-separated,
    /// and blank values count as absent.
    pub fn from_query(ids: Option<&str>, author: Option<&str>, tag: Option<&str>) -> Self {
        fn non_blank(v: Option<&str>) -> Option<&str> {
            v.map(str::trim).filter(|v| !v.is_empty())
        }
        Self {
            ids: ids
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .collect(),
            author: non_blank(author).map(str::to_string),
            tag: non_blank(tag).map(str::to_string),
        }
    }

    /// Short name describing the selection, for the PDF file name.
    pub fn slug(&self) -> String {
        let label = match (&self.author, &self.tag) {
            (Some(author), _) => author.as_str(),
            (None, Some(tag)) => tag.as_str(),
            (None, None) => "selection",
        };
        let slug: String = label
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect();
        let slug = slug
            .split('-')
            .filter(|p| !p.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        if slug.is_empty() {
            "selection".to_string()
        } else {
            slug
        }
    }
}

/// Picks the songs of a songbook. With `ids`, songs come in the order given;
/// otherwise they are sorted by author then title. Errors are meant to be
/// shown to the caller as-is.
pub fn select_songs<'a>(
    songs: &'a [SongItem],
    filter: &SongbookFilter,
) -> Result<Vec<&'a SongItem>, String> {
    if filter.ids.is_empty() && filter.author.is_none() && filter.tag.is_none() {
        return Err("Give at least one of: ids, author, tag".to_string());
    }

    let mut selected: Vec<&SongItem> = if filter.ids.is_empty() {
        let mut all: Vec<&SongItem> = songs.iter().collect();
        all.sort_by(|a, b| (&a.author, &a.title).cmp(&(&b.author, &b.title)));
        all
    } else {
        let unknown: Vec<&str> = filter
            .ids
            .iter()
            .filter(|id| !songs.iter().any(|s| &s.id == *id))
            .map(String::as_str)
            .collect();
        if !unknown.is_empty() {
            return Err(format!("Unknown song ids: {}", unknown.join(", ")));
        }
        filter
            .ids
            .iter()
            .filter_map(|id| songs.iter().find(|s| &s.id == id))
            .collect()
    };

    if let Some(author) = &filter.author {
        selected.retain(|s| s.author.eq_ignore_ascii_case(author));
    }
    if let Some(tag) = &filter.tag {
        selected.retain(|s| s.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)));
    }
    if selected.len() > MAX_SONGBOOK_SONGS {
        return Err(format!(
            "{} songs selected, a songbook holds at most {MAX_SONGBOOK_SONGS}",
            selected.len()
        ));
    }
    Ok(selected)
}

/// Concatenates PDF documents with `pdfunite` (poppler-utils).
pub async fn merge_pdfs(
    pdfs: Vec<Vec<u8>>,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    match pdfs.len() {
        0 => return Err("No PDF to merge".into()),
        1 => return Ok(pdfs.into_iter().next().unwrap_or_default()),
        _ => {}
    }
    let dir = tempfile::tempdir()?;
    let mut inputs = Vec::with_capacity(pdfs.len());
    for (i, pdf) in pdfs.iter().enumerate() {
        let path = dir.path().join(format!("{i:03}.pdf"));
        tokio::fs::write(&path, pdf).await?;
        inputs.push(path);
    }
    let output = dir.path().join("songbook.pdf");
    let result = tokio::process::Command::new("pdfunite")
        .args(&inputs)
        .arg(&output)
        .output()
        .await
        .map_err(|e| format!("Failed to run pdfunite: {e}"))?;
    if !result.status.success() {
        return Err(format!(
            "pdfunite failed: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        )
        .into());
    }
    Ok(tokio::fs::read(&output).await?)
}

/// URL of the songbook of every song matching one query parameter.
fn songbook_url(base: &str, param: &str, value: &str) -> String {
    format!("{base}/api/songbook?{param}={}", urlencoding::encode(value))
}

/// The `llms.txt` page (https://llmstxt.org): what the site holds, ready links
/// to every songbook, and every song with all the fields of `/api/songs`, so
/// an assistant can hand the user a URL instead of downloading and merging
/// PDFs itself. Songbook links only count songs with a PDF.
pub fn llms_txt(base: &str, songs: &[ApiSong], books: &[String]) -> String {
    let mut songs: Vec<&ApiSong> = songs.iter().collect();
    songs.sort_by(|a, b| (&a.author, &a.title).cmp(&(&b.author, &b.title)));

    let mut by_author: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut by_tag: BTreeMap<&str, usize> = BTreeMap::new();
    for s in songs.iter().filter(|s| s.pdf_url.is_some()) {
        by_author.entry(&s.author).or_default().push(&s.title);
        for tag in &s.tags {
            *by_tag.entry(tag).or_default() += 1;
        }
    }

    let mut out = format!(
        "# Move The Line songbook

> Chord and lyrics sheets, as PDF, for the songs played by the bands Move The Line, Sunny Bd and Dadrock.

To give someone a PDF with several songs, do not download or merge PDFs yourself:
link to `{base}/api/songbook`, and the server builds the merged PDF.

- `{base}/api/songbook?author=<author>`: every song by an author (case-insensitive)
- `{base}/api/songbook?tag=<tag>`: every song with a tag
- `{base}/api/songbook?ids=<id>,<id>`: the given songs, in that order
- Parameters combine, e.g. `?author=<author>&tag=<tag>`. At most {MAX_SONGBOOK_SONGS} songs.

## API

- [Songs]({base}/api/songs): JSON list of songs, with the fields below
- [Books]({base}/api/books): JSON list of prebuilt books with `name` and `url`

Fields of a song (the Songs section lists them for every song):

- `id`: song id, for `/api/songbook?ids=`
- `title`, `author`: `author` works verbatim in `/api/songbook?author=`
- `tempo`: beats per minute
- `tags`: bands and events the song belongs to, for `/api/songbook?tag=`
- `pdf_url`: chord and lyrics sheet (PDF); absent when there is none
- `mp3_url`: recording (MP3); absent when there is none
- `deezer_url`, `deezer_app_url`: Deezer search for the original recording, on the web and in the app
- `key`: storage key of the song source
- `has_song`: whether the song source declares a recording
- `has_clicks`: whether the song has a click track
- `error`: why the song source could not be read; absent when it was
"
    );

    out.push_str("\n## Songbooks by author\n\n");
    for (author, titles) in &by_author {
        out.push_str(&format!(
            "- [{author}]({}): {}\n",
            songbook_url(base, "author", author),
            titles.join(", ")
        ));
    }

    if !by_tag.is_empty() {
        out.push_str("\n## Songbooks by tag\n\n");
        for (tag, count) in &by_tag {
            out.push_str(&format!(
                "- [{tag}]({}): {count} songs\n",
                songbook_url(base, "tag", tag)
            ));
        }
    }

    if !books.is_empty() {
        out.push_str("\n## Books\n\n");
        for name in books {
            out.push_str(&format!("- [{name}]({base}/api/book/{name})\n"));
        }
    }

    out.push_str("\n## Songs\n");
    for s in &songs {
        out.push_str(&format!("\n### {} - {}\n\n", s.author, s.title));
        let mut field = |name: &str, value: &str| {
            out.push_str(&format!("- `{name}`: {value}\n"));
        };
        field("id", &format!("`{}`", s.id));
        field("title", &s.title);
        field("author", &s.author);
        field("tempo", &s.tempo.to_string());
        field("tags", &s.tags.join(", "));
        if let Some(url) = &s.pdf_url {
            field("pdf_url", url);
        }
        if let Some(url) = &s.mp3_url {
            field("mp3_url", url);
        }
        field("deezer_url", &s.deezer_url);
        field("deezer_app_url", &s.deezer_app_url);
        field("key", &s.key);
        field("has_song", &s.has_song.to_string());
        field("has_clicks", &s.has_clicks.to_string());
        if let Some(error) = &s.error {
            field("error", error);
        }
    }
    out
}
