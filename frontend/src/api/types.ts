export interface Song {
  id: string
  title: string
  author: string
  deezer_url: string
  deezer_app_url: string
  key: string
  tempo: number
  tags: string[]
  error?: string
}

export interface SongDetail extends Song {
  pdf_url?: string
  pdf_lyrics_url?: string
  tempo_url?: string
}

export interface SongYml {
  content: string
}
