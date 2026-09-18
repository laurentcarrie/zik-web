//! The metadata Deezer holds for a song, for `/api/song/{id}/deezer`.
//!
//! A song names its original recording with `external_id: !Deezer "<id>"` in
//! its `song.yml`; this module turns that id into the track's metadata.
//!
//! Deezer answers an unknown id with HTTP 200 and an `error` object rather
//! than a 4xx, so the status code alone never tells whether the call worked.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// How long to wait on Deezer before giving up, so a slow third party cannot
/// hold a request open.
const TIMEOUT: Duration = Duration::from_secs(10);

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
/// (`track_token`, `available_countries`, rank, gain).
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
