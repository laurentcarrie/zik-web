import type { Song, SongDetail } from './types'

export async function fetchSongs(): Promise<Song[]> {
  const response = await fetch('/api/songs')
  if (!response.ok) {
    throw new Error('Failed to fetch songs')
  }
  return response.json()
}

export async function fetchSong(id: string): Promise<SongDetail> {
  const response = await fetch(`/api/song/${id}`)
  if (!response.ok) {
    throw new Error('Failed to fetch song')
  }
  return response.json()
}
