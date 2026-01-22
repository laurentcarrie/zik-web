import type { Song, SongDetail, SongYml } from './types'

export async function fetchSongs(): Promise<Song[]> {
  const response = await fetch('/api/songs')
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch songs')
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

export async function fetchSongYml(id: string): Promise<SongYml> {
  const response = await fetch(`/api/song/${id}/yml`)
  if (!response.ok) {
    throw new Error('Failed to fetch song YML')
  }
  return response.json()
}

export async function saveSongYml(id: string, content: string): Promise<void> {
  const response = await fetch(`/api/song/${id}/yml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })
  if (!response.ok) {
    throw new Error('Failed to save song YML')
  }
}

export async function updateSongs(): Promise<string> {
  const response = await fetch('/update')
  if (!response.ok) {
    throw new Error('Failed to update songs')
  }
  return response.text()
}
