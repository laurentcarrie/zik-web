import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchSong } from '../api/songs'
import ActionButton from '../components/ActionButton'

interface ServiceSettings {
  deezerWeb: boolean
  deezerApp: boolean
  spotifyWeb: boolean
  spotifyApp: boolean
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

function getSettings(): ServiceSettings {
  const saved = getCookie('serviceSettings')
  return saved ? JSON.parse(saved) : {
    deezerWeb: true,
    deezerApp: true,
    spotifyWeb: false,
    spotifyApp: false,
  }
}

function makeSpotifyUrl(title: string, author: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${title} ${author}`)}`
}

function makeSpotifyAppUrl(title: string, author: string): string {
  return `spotify:search:${encodeURIComponent(`${title} ${author}`)}`
}

export default function SongDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [settings, setSettings] = useState<ServiceSettings>(getSettings)

  useEffect(() => {
    setSettings(getSettings())
  }, [])

  const { data: song, isLoading, error } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || !song) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-red-600">Song not found</p>
          <Link
            to="/songs"
            className="inline-block mt-4 text-[#667eea] hover:underline"
          >
            &larr; Back to Songs
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <Link
          to="/songs"
          className="inline-block mb-4 text-[#667eea] no-underline hover:underline"
        >
          &larr; Back to Songs
        </Link>

        <h1 className="font-[Fontskrivan] font-black text-2xl md:text-3xl text-[#2563eb] mb-2">
          {song.title}
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-6">
          {song.author}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <ActionButton
            href={song.pdf_url}
            variant="pdf"
            target="_blank"
          >
            PDF
          </ActionButton>

          {settings.deezerWeb && (
            <ActionButton
              href={song.deezer_url}
              variant="deezer"
              target="_blank"
            >
              Deezer (Web)
            </ActionButton>
          )}

          {settings.deezerApp && (
            <ActionButton
              href={song.deezer_app_url}
              variant="deezer-app"
            >
              Deezer (App)
            </ActionButton>
          )}

          {settings.spotifyWeb && (
            <ActionButton
              href={makeSpotifyUrl(song.title, song.author)}
              variant="spotify"
              target="_blank"
            >
              Spotify (Web)
            </ActionButton>
          )}

          {settings.spotifyApp && (
            <ActionButton
              href={makeSpotifyAppUrl(song.title, song.author)}
              variant="spotify-app"
            >
              Spotify (App)
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  )
}
