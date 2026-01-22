export interface Song {
  id: string
  title: string
  author: string
  deezer_url: string
  deezer_app_url: string
}

export interface SongDetail extends Song {
  pdf_url: string
  key: string
}

export interface SongYml {
  content: string
}
