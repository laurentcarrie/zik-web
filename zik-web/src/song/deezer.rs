//! The metadata Deezer holds for a song, for `/api/song/{id}/deezer`.
//!
//! A song names its original recording with `external_id: !Deezer "<id>"` in
//! its `song.yml`; this module turns that id into the track's metadata.
//!
//! Deezer answers an unknown id with HTTP 200 and an `error` object rather
//! than a 4xx, so the status code alone never tells whether the call worked.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;

/// How long to wait on Deezer before giving up, so a slow third party cannot
/// hold a request open.
const TIMEOUT: Duration = Duration::from_secs(10);

/// Pause between two calls of a refresh, to stay well under Deezer's limit of
/// roughly fifty calls per five seconds from one address.
const BETWEEN_CALLS: Duration = Duration::from_millis(150);

/// What went wrong reaching Deezer, mapped to a status code by the handler.
#[derive(Debug)]
pub enum DeezerError {
    /// The call itself failed: DNS, TLS, timeout, or a non-success status.
    Unreachable(String),
    /// Deezer answered, but with an `error` object instead of a track.
    NoSuchTrack(String),
    /// Deezer answered with something that is not a track.
    Unreadable(String),
}

impl std::fmt::Display for DeezerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreachable(e) => write!(f, "could not reach Deezer: {e}"),
            Self::NoSuchTrack(e) => write!(f, "Deezer knows no such track: {e}"),
            Self::Unreadable(e) => write!(f, "could not read Deezer's answer: {e}"),
        }
    }
}

/// The metadata of a track, as `/api/song/{id}/deezer` serves it: the fields
/// of Deezer's track worth having, without the ones that are ours to know
/// (`track_token`, `available_countries`, `gain`).
#[derive(Debug, Serialize, PartialEq)]
pub struct DeezerTrack {
    /// The Deezer track id, the same as the song's `external_id`.
    pub id: u64,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Length of the recording, in seconds.
    pub duration: u32,
    /// Deezer's own tempo, to compare with the song's `tempo`. Deezer gives
    /// `0` when it does not know, which is served as absent rather than as a
    /// song of no tempo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f64>,
    /// Deezer's popularity counter. It moves on its own, so a stored one is
    /// only true as of the moment it was read -- see [`CachedTrack`].
    pub rank: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    /// The track's page on Deezer.
    pub link: String,
    /// A thirty-second excerpt (MP3), when Deezer offers one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    /// The album cover, at Deezer's largest size.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

/// Deezer's own shape, kept private: only what [`DeezerTrack`] needs.
#[derive(Deserialize)]
struct RawTrack {
    id: u64,
    title: String,
    duration: u32,
    bpm: Option<f64>,
    #[serde(default)]
    rank: u64,
    release_date: Option<String>,
    link: String,
    preview: Option<String>,
    artist: RawNamed,
    album: RawAlbum,
}

#[derive(Deserialize)]
struct RawNamed {
    name: String,
}

#[derive(Deserialize)]
struct RawAlbum {
    title: String,
    cover_xl: Option<String>,
}

/// Deezer reports a failure in the body of an otherwise successful response.
#[derive(Deserialize)]
struct RawError {
    error: RawErrorBody,
}

#[derive(Deserialize)]
struct RawErrorBody {
    message: String,
    code: i64,
}

/// Turns Deezer's answer into a track, telling its three failure modes apart.
///
/// Split from the call itself so the shapes Deezer returns can be tested
/// without reaching the network.
pub fn track_of_response(body: &str) -> Result<DeezerTrack, DeezerError> {
    // The error object comes back with HTTP 200, so it must be ruled out
    // before parsing a track -- otherwise it reads as a missing-field error.
    if let Ok(e) = serde_json::from_str::<RawError>(body) {
        return Err(DeezerError::NoSuchTrack(format!(
            "{} (code {})",
            e.error.message, e.error.code
        )));
    }

    let raw: RawTrack = serde_json::from_str(body).map_err(|e| {
        DeezerError::Unreadable(format!(
            "{e}, in {}",
            body.chars().take(200).collect::<String>()
        ))
    })?;

    Ok(DeezerTrack {
        id: raw.id,
        title: raw.title,
        artist: raw.artist.name,
        album: raw.album.title,
        duration: raw.duration,
        // Deezer says 0 when it has no tempo for the track.
        bpm: raw.bpm.filter(|b| *b > 0.0),
        rank: raw.rank,
        release_date: raw.release_date.filter(|d| !d.is_empty()),
        link: raw.link,
        preview: raw.preview.filter(|p| !p.is_empty()),
        cover: raw.album.cover_xl.filter(|c| !c.is_empty()),
    })
}

/// Fetches the metadata Deezer holds for a track id.
pub async fn track(client: &reqwest::Client, deezer_id: &str) -> Result<DeezerTrack, DeezerError> {
    let url = format!(
        "https://api.deezer.com/track/{}",
        urlencoding::encode(deezer_id)
    );
    let response = client
        .get(&url)
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|e| DeezerError::Unreachable(e.to_string()))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| DeezerError::Unreachable(e.to_string()))?;

    if !status.is_success() {
        return Err(DeezerError::Unreachable(format!("HTTP {status}")));
    }

    track_of_response(&body)
}

/// What is kept in `songs/deezer.yml`: the fields of a track that do not go
/// stale on their own, so a request can be answered without calling Deezer.
///
/// `preview` is left out on purpose. Deezer signs it with a fifteen-minute
/// expiry (`hdnea=exp=...`), so a stored one is a dead link; it stays on
/// `/api/song/{id}/deezer`, which reads Deezer live.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CachedTrack {
    pub id: u64,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f64>,
    /// True as of `fetched_at` and no later: Deezer keeps moving it.
    pub rank: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    pub link: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    /// When this entry was read from Deezer, RFC 3339. An entry Deezer failed
    /// to answer for keeps its old value and its old date, so the age of each
    /// entry is its own.
    pub fetched_at: String,
}

/// `songs/deezer.yml`: every track the songs name, by Deezer id.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct DeezerCache {
    #[serde(default)]
    pub tracks: BTreeMap<String, CachedTrack>,
}

impl DeezerCache {
    pub fn get(&self, deezer_id: &str) -> Option<&CachedTrack> {
        self.tracks.get(deezer_id)
    }
}

/// What a refresh did, so the re-index can report it without inspecting the
/// cache itself.
#[derive(Debug, Default, PartialEq)]
pub struct RefreshReport {
    pub read: usize,
    /// Ids Deezer would not answer for, which kept whatever they held before.
    pub failed: Vec<String>,
    /// Ids that failed and had nothing to keep.
    pub missing: Vec<String>,
}

fn cached_of_track(track: DeezerTrack, fetched_at: &str) -> CachedTrack {
    CachedTrack {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        bpm: track.bpm,
        rank: track.rank,
        release_date: track.release_date,
        link: track.link,
        cover: track.cover,
        fetched_at: fetched_at.to_string(),
    }
}

/// Reads every given track from Deezer into a fresh cache.
///
/// Deezer allows about fifty calls per five seconds from one address, so the
/// ids are read one at a time with a pause between them. A re-index already
/// downloads the whole song directory, so the seconds this adds are cheap --
/// and they are spent once per re-index rather than once per request.
///
/// A track Deezer will not answer for keeps the entry it had in `previous`,
/// because a stale rank is worth more than no track at all. Nothing here
/// fails: a re-index must not be lost to Deezer being down.
pub async fn refresh(
    client: &reqwest::Client,
    deezer_ids: &[String],
    previous: &DeezerCache,
    fetched_at: &str,
) -> (DeezerCache, RefreshReport) {
    let mut cache = DeezerCache::default();
    let mut report = RefreshReport::default();

    for deezer_id in deezer_ids {
        match track(client, deezer_id).await {
            Ok(t) => {
                cache
                    .tracks
                    .insert(deezer_id.clone(), cached_of_track(t, fetched_at));
                report.read += 1;
            }
            Err(e) => {
                eprintln!("deezer refresh: {deezer_id}: {e}");
                match previous.get(deezer_id) {
                    Some(kept) => {
                        cache.tracks.insert(deezer_id.clone(), kept.clone());
                        report.failed.push(deezer_id.clone());
                    }
                    None => report.missing.push(deezer_id.clone()),
                }
            }
        }
        tokio::time::sleep(BETWEEN_CALLS).await;
    }

    (cache, report)
}

/// What went wrong fetching a cover image, mapped to a status code by the
/// handler.
#[derive(Debug)]
pub enum CoverError {
    /// The cover URL is not one of Deezer's, so it is not ours to fetch.
    NotDeezers(String),
    /// The call itself failed: DNS, TLS, timeout, or a non-success status.
    Unreachable(String),
    /// Something came back, but not an image.
    NotAnImage(String),
}

impl std::fmt::Display for CoverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotDeezers(u) => write!(f, "not a Deezer image URL: {u}"),
            Self::Unreachable(e) => write!(f, "could not reach Deezer's images: {e}"),
            Self::NotAnImage(e) => write!(f, "Deezer's images answered with {e}"),
        }
    }
}

/// A cover as it goes back to the caller: the bytes, and the type to serve
/// them as.
pub struct Cover {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

/// Whether a cover URL is one we will fetch.
///
/// The URLs come from Deezer or from our own cache of it, never from the
/// caller, so this is not a filter on user input; it keeps a wrong entry in
/// the cache from turning the endpoint into an open proxy.
pub fn is_deezer_image_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .split('@')
        .next_back()
        .unwrap_or_default()
        .to_ascii_lowercase();
    host.ends_with(".dzcdn.net") || host.ends_with(".deezer.com")
}

/// The type to serve a cover as: what the CDN declared when we know it, the
/// file extension otherwise.
///
/// The declared type is matched against the image types rather than echoed,
/// so whatever a third party puts in that header cannot become our own
/// `Content-Type`.
pub fn image_content_type(declared: Option<&str>, url: &str) -> Option<&'static str> {
    let declared = declared
        .and_then(|d| d.split(';').next())
        .map(|d| d.trim().to_ascii_lowercase());
    let by_header = match declared.as_deref() {
        Some("image/jpeg" | "image/jpg") => Some("image/jpeg"),
        Some("image/png") => Some("image/png"),
        Some("image/gif") => Some("image/gif"),
        Some("image/webp") => Some("image/webp"),
        _ => None,
    };
    by_header.or_else(|| {
        let path = url.split(['?', '#']).next().unwrap_or_default();
        let path = path.to_ascii_lowercase();
        match path.rsplit('.').next() {
            Some("jpg" | "jpeg") => Some("image/jpeg"),
            Some("png") => Some("image/png"),
            Some("gif") => Some("image/gif"),
            Some("webp") => Some("image/webp"),
            _ => None,
        }
    })
}

/// Downloads a cover from Deezer's image CDN.
pub async fn cover(client: &reqwest::Client, url: &str) -> Result<Cover, CoverError> {
    if !is_deezer_image_url(url) {
        return Err(CoverError::NotDeezers(url.to_string()));
    }

    let response = client
        .get(url)
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|e| CoverError::Unreachable(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(CoverError::Unreachable(format!("HTTP {status}")));
    }

    let declared = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let Some(content_type) = image_content_type(declared.as_deref(), url) else {
        return Err(CoverError::NotAnImage(
            declared.unwrap_or_else(|| "no content type".to_string()),
        ));
    };

    let bytes = response
        .bytes()
        .await
        .map_err(|e| CoverError::Unreachable(e.to_string()))?;

    Ok(Cover {
        bytes: bytes.to_vec(),
        content_type,
    })
}
