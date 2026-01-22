use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct SongFiles {
    pub lilypond: Vec<String>,
    pub tex: Vec<String>,
    pub wav: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SongInfo {
    pub title: String,
    pub author: String,
    #[allow(dead_code)]
    pub tempo: u32,
}

#[derive(Serialize, Deserialize)]
pub struct SongYml {
    pub files: SongFiles,
    pub info: SongInfo,
    #[allow(dead_code)]
    pub structure: Vec<Structure>,
}

#[derive(Serialize, Deserialize)]
pub struct SongEntry {
    pub id: String,
    pub title: String,
    pub author: String,
    pub key: String,
    pub deezer_url: String,
}

#[derive(Serialize, Deserialize)]
pub struct Chords {
    #[serde(rename = "type")]
    pub _type: String,
    pub title: String,
    pub section_body: Option<String>,
    pub rows: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Ref {
    #[serde(rename = "type")]
    pub _type: Option<String>,
    pub title: String,
    pub section_body: Option<String>,
    pub link: String,
}

#[derive(Serialize, Deserialize)]
// #[serde(tag = "type")]
pub enum StructureItem {
    Chords(Chords),
    Ref(Ref),
    HRule(u32),
    NewColumn,
}

#[derive(Serialize, Deserialize)]
pub struct Structure {
    pub id: String,
    pub item: StructureItem,
}
