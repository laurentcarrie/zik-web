import type { Song, SongDetail, SongYml } from './types'
import { getStoredPassword } from '../context/AuthContext'
import { API_BASE } from '../config'

function getAuthHeaders(): HeadersInit {
  const password = getStoredPassword()
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }
  if (password) {
    headers['X-Write-Password'] = password
  }
  return headers
}

export async function fetchSongs(): Promise<Song[]> {
  const response = await fetch(`${API_BASE}/api/songs`)
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to fetch songs')
  }
  return response.json()
}

export async function fetchSong(id: string): Promise<SongDetail> {
  const response = await fetch(`${API_BASE}/api/song/${id}`)
  if (!response.ok) {
    throw new Error('Failed to fetch song')
  }
  return response.json()
}

export async function fetchSongYml(id: string): Promise<SongYml> {
  const response = await fetch(`${API_BASE}/api/song/${id}/yml`)
  if (!response.ok) {
    throw new Error('Failed to fetch song YML')
  }
  return response.json()
}

export async function saveSongYml(id: string, content: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/song/${id}/yml`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ content }),
  })
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Unauthorized')
    }
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to save song YML')
  }
}

export async function updateSongs(): Promise<string> {
  const response = await fetch(`${API_BASE}/update`)
  if (!response.ok) {
    throw new Error('Failed to update songs')
  }
  return response.text()
}

export interface MakeResponse {
  success: boolean
  message: string
  report: string | null
}

export class MakeError extends Error {
  report: string | null

  constructor(message: string, report: string | null) {
    super(message)
    this.report = report
  }
}

export async function makeSong(path: string): Promise<MakeResponse> {
  const response = await fetch(`${API_BASE}/api/make`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ path }),
  })
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Unauthorized')
    }
    const data: MakeResponse = await response.json().catch(() => ({ success: false, message: 'Failed to build song', report: null }))
    throw new MakeError(data.message || 'Failed to build song', data.report)
  }
  return response.json()
}
