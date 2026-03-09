export interface Song {
  id: string
  title: string
  author: string
  deezer_url: string
  deezer_app_url: string
  key: string
  tempo: number
  tags: string[]
  has_song: boolean
  has_clicks: boolean
  error?: string
}

export interface BarTimeEntry {
  bar: number
  time: number
}

export interface SongDetail extends Song {
  pdf_url?: string
  pdf_lyrics_url?: string
  tempo_url?: string
  mp3_url?: string
  mp3_with_clicks_url?: string
  clicks_url?: string
  bar_times?: BarTimeEntry[]
}

export interface SongYml {
  content: string
}
