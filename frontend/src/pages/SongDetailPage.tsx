import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchSong } from '../api/songs'
import ActionButton, { PdfIcon, DeezerIcon, SpotifyIcon, EditIcon } from '../components/ActionButton'

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
  const query = encodeURIComponent(`${title} ${author}`)
  return `https://open.spotify.com/search/${query}`
}

function makeSpotifyAppUrl(title: string, author: string): string {
  const query = encodeURIComponent(`${title} ${author}`)
  return `spotify:search:${query}`
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"
        clipRule="evenodd"
      />
    </svg>
  )
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
        <div className="flex justify-between items-center mb-4">
          <Link
            to="/songs"
            className="text-[#667eea] no-underline hover:underline"
          >
            &larr; Back to Songs
          </Link>
          <Link
            to="/settings"
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            title="Settings"
          >
            <GearIcon className="w-5 h-5" />
          </Link>
        </div>

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
            <PdfIcon className="w-5 h-5" /> PDF
          </ActionButton>

          {settings.deezerWeb && (
            <ActionButton
              href={song.deezer_url}
              variant="deezer"
              target="_blank"
            >
              <DeezerIcon className="w-5 h-5" /> Web
            </ActionButton>
          )}

          {settings.deezerApp && (
            <ActionButton
              href={song.deezer_app_url}
              variant="deezer-app"
            >
              <DeezerIcon className="w-5 h-5" /> App
            </ActionButton>
          )}

          {settings.spotifyWeb && (
            <ActionButton
              href={makeSpotifyUrl(song.title, song.author)}
              variant="spotify"
              target="_blank"
            >
              <SpotifyIcon className="w-5 h-5" /> Web
            </ActionButton>
          )}

          {settings.spotifyApp && (
            <ActionButton
              href={makeSpotifyAppUrl(song.title, song.author)}
              variant="spotify-app"
            >
              <SpotifyIcon className="w-5 h-5" /> App
            </ActionButton>
          )}

          <ActionButton
            href={`/edit-yml?key=${encodeURIComponent(song.key)}`}
            variant="edit"
          >
            <EditIcon className="w-5 h-5" /> Edit
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
