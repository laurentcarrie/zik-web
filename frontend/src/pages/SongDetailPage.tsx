import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchSong, fetchSongs } from '../api/songs'
import ActionButton, { PdfIcon, DeezerIcon, SpotifyIcon, EditIcon, MakeIcon } from '../components/ActionButton'
import { useAuth, getStoredPassword } from '../context/AuthContext'

const API_BASE = import.meta.env.VITE_API_URL || ''

type MusicService = 'deezerWeb' | 'deezerApp' | 'spotifyWeb' | 'spotifyApp'
type LyricsMode = 'none' | '1-column' | '2-columns'

interface ServiceSettings {
  musicService: MusicService
  pdfEnabled?: boolean
  lyricsMode?: LyricsMode
  lyricsEnabled?: boolean // deprecated
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

function isMobileDevice(): boolean {
  return window.innerWidth < 768 || /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)
}

function getSettings(): ServiceSettings {
  const saved = getCookie('serviceSettings')
  if (saved) {
    const parsed = JSON.parse(saved)
    // Migrate old format to new
    if ('deezerWeb' in parsed && !('musicService' in parsed)) {
      const mobile = isMobileDevice()
      return {
        musicService: mobile ? 'deezerApp' : 'deezerWeb',
        pdfEnabled: parsed.pdfEnabled ?? true,
        lyricsMode: parsed.lyricsMode ?? (parsed.lyricsEnabled === false ? 'none' : '1-column'),
      }
    }
    // Migrate lyricsEnabled to lyricsMode
    if ('lyricsEnabled' in parsed && !('lyricsMode' in parsed)) {
      return {
        ...parsed,
        lyricsMode: parsed.lyricsEnabled === false ? 'none' : '1-column',
      }
    }
    return parsed
  }
  const mobile = isMobileDevice()
  return {
    musicService: mobile ? 'deezerApp' : 'deezerWeb',
    pdfEnabled: true,
    lyricsMode: '1-column',
  }
}

function makeSpotifyUrl(title: string, author: string): string {
  const query = encodeURIComponent(`${title} ${author}`)
  return `https://open.spotify.com/search/${query}/tracks`
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
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [settings, setSettings] = useState<ServiceSettings>(getSettings)
  const [buildError, setBuildError] = useState<{ pathbuf: string } | null>(null)
  const [logContent, setLogContent] = useState<string>('')
  const [showLogModal, setShowLogModal] = useState(false)
  const [logModalTitle, setLogModalTitle] = useState('')
  const [logSearchQuery, setLogSearchQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [lambdaRunning, setLambdaRunning] = useState<boolean | null>(null)
  const [lambdaTimestamp, setLambdaTimestamp] = useState<string>('')
  const [lambdaDuration, setLambdaDuration] = useState<number | null>(null)
  const [building, setBuilding] = useState(false)
  const [buildMessage, setBuildMessage] = useState<string | null>(null)
  const { isAuthenticated } = useAuth()

  // Clear build message when navigating to a different song
  useEffect(() => {
    setBuildMessage(null)
  }, [id])

  useEffect(() => {
    setSettings(getSettings())
    checkLambdaStatus()

    // Continuously poll lambda status every 5 seconds
    const statusInterval = setInterval(checkLambdaStatus, 5000)
    return () => clearInterval(statusInterval)
  }, [])

  function formatDuration(secs: number): string {
    const mins = Math.floor(secs / 60)
    const remainingSecs = secs % 60
    if (mins > 0) {
      return `${mins}m ${remainingSecs}s`
    }
    return `${remainingSecs}s`
  }

  async function checkLambdaStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/lambda-status`)
      if (res.ok) {
        const data = await res.json()
        setLambdaRunning(data.running)
        setLambdaTimestamp(data.timestamp || '')
        setLambdaDuration(data.duration_secs ?? null)
      }
    } catch {
      setLambdaRunning(null)
    }
  }

  async function triggerBuild() {
    setBuilding(true)
    setBuildMessage(null)

    // Check if a build is already running
    try {
      const statusRes = await fetch(`${API_BASE}/api/lambda-status`)
      if (statusRes.ok) {
        const statusData = await statusRes.json()
        if (statusData.running) {
          setBuildMessage(t('song.buildAlreadyRunning'))
          setBuilding(false)
          return
        }
      }
    } catch {
      // Continue anyway if status check fails
    }

    try {
      const password = getStoredPassword()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (password) {
        headers['X-Write-Password'] = password
      }
      const res = await fetch(`${API_BASE}/api/invoke-build`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ song_key: song?.key, author: song?.author, title: song?.title }),
      })
      const data = await res.json()
      setBuildMessage(data.message)
      // Start polling for build status
      if (data.success) {
        startBuildPolling()
      }
    } catch {
      setBuildMessage('Build request failed')
    } finally {
      setBuilding(false)
    }
  }

  function startBuildPolling() {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/lambda-status`)
        if (res.ok) {
          const data = await res.json()
          setLambdaRunning(data.running)
          setLambdaTimestamp(data.timestamp || '')
          setLambdaDuration(data.duration_secs ?? null)

          // Stop polling when build is done
          if (!data.running) {
            clearInterval(pollInterval)
            setBuildMessage(t('song.buildCompleted'))
            // Refresh song data
            refetchSong()
            // Refresh build error status
            refreshBuildError()
          }
        }
      } catch {
        clearInterval(pollInterval)
      }
    }, 3000) // Poll every 3 seconds
  }

  async function refreshBuildError() {
    if (!song?.key) return
    try {
      const reportRes = await fetch(`${API_BASE}/api/make-report`)
      if (reportRes.ok) {
        const reportData = await reportRes.json()
        const keyParts = song.key.split('/')
        if (keyParts.length >= 3) {
          const songDir = `${keyParts[1]}/${keyParts[2]}`
          const failed = reportData.nodes?.find((node: { pathbuf: string; status: string }) =>
            node.status === 'BuildFailed' && node.pathbuf.startsWith(songDir)
          )
          setBuildError(failed || null)
        }
      }
    } catch {
      // Ignore
    }
  }

  const { data: song, isLoading, error, refetch: refetchSong } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
  })

  // Fetch all songs for navigation
  const { data: allSongs } = useQuery({
    queryKey: ['songs'],
    queryFn: fetchSongs,
  })

  // Compute sorted songs and prev/next navigation
  const { prevSong, nextSong } = useMemo(() => {
    if (!allSongs || !id) return { prevSong: null, nextSong: null }

    const sorted = [...allSongs].sort((a, b) => {
      const authorCompare = a.author.localeCompare(b.author)
      if (authorCompare !== 0) return authorCompare
      return a.title.localeCompare(b.title)
    })

    const currentIndex = sorted.findIndex(s => s.id === id)
    if (currentIndex === -1) return { prevSong: null, nextSong: null }

    return {
      prevSong: currentIndex > 0 ? sorted[currentIndex - 1] : null,
      nextSong: currentIndex < sorted.length - 1 ? sorted[currentIndex + 1] : null,
    }
  }, [allSongs, id])

  // Keyboard shortcuts for navigation and modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Escape closes modal
      if (e.key === 'Escape' && showLogModal) {
        setShowLogModal(false)
        setLogSearchQuery('')
        setCurrentMatchIndex(0)
        return
      }
      // Don't navigate if user is typing in an input or modal is open
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || showLogModal) {
        return
      }
      if (e.key === 'ArrowLeft' && prevSong) {
        navigate(`/song/${prevSong.id}`)
      } else if (e.key === 'ArrowRight' && nextSong) {
        navigate(`/song/${nextSong.id}`)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [prevSong, nextSong, navigate, showLogModal])

  // Check for build errors when song is loaded
  useEffect(() => {
    if (!song?.key) return
    const songKey = song.key

    async function checkBuildError() {
      try {
        const res = await fetch(`${API_BASE}/api/make-report`)
        if (res.ok) {
          const data = await res.json()
          // Extract directory from key: "songs/author/title/song.yml" -> "author/title"
          const keyParts = songKey.split('/')
          if (keyParts.length >= 3) {
            const songDir = `${keyParts[1]}/${keyParts[2]}`
            const failed = data.nodes?.find((node: { pathbuf: string; status: string }) =>
              node.status === 'BuildFailed' && node.pathbuf.startsWith(songDir)
            )
            setBuildError(failed || null)
          }
        }
      } catch {
        // Ignore
      }
    }
    checkBuildError()
  }, [song?.key])

  async function openLogFile(pathbuf: string, type: 'stdout' | 'stderr') {
    const logKey = `sandbox/logs/${pathbuf}.${type}`
    setLogModalTitle(`${pathbuf} - ${type}`)
    setLogContent('Loading...')
    setShowLogModal(true)
    try {
      const res = await fetch(`${API_BASE}/api/s3/${logKey}`)
      if (res.ok) {
        const data = await res.json()
        setLogContent(data.data || '(empty)')
      } else {
        setLogContent('Failed to load log file')
      }
    } catch {
      setLogContent('Failed to load log file')
    }
  }

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
            &larr; {t('nav.backToSongs')}
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
            &larr; {t('nav.backToSongs')}
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => prevSong && navigate(`/song/${prevSong.id}`)}
              disabled={!prevSong}
              className="px-3 py-1 text-sm rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={prevSong ? `${prevSong.author} - ${prevSong.title}` : undefined}
            >
              &larr; {t('nav.prev')}
            </button>
            <button
              onClick={() => nextSong && navigate(`/song/${nextSong.id}`)}
              disabled={!nextSong}
              className="px-3 py-1 text-sm rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={nextSong ? `${nextSong.author} - ${nextSong.title}` : undefined}
            >
              {t('nav.next')} &rarr;
            </button>
          </div>
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
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-4">
          {song.author}
        </p>

        {song.error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm font-semibold mb-1">Parse error</p>
            <p className="text-red-600 text-xs font-mono whitespace-pre-wrap">{song.error}</p>
          </div>
        )}

        {lambdaRunning !== null && (
          <div className="mb-4">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
              lambdaRunning
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                lambdaRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
              }`}></span>
              {lambdaRunning ? t('song.buildRunning') : t('song.idle')}
              {lambdaTimestamp && (
                <span className="ml-1 opacity-75">
                  ({lambdaRunning ? t('song.started') : t('song.lastRun')}: {lambdaTimestamp}
                  {lambdaDuration !== null && `, ${formatDuration(lambdaDuration)}`})
                </span>
              )}
            </span>
          </div>
        )}

        {buildError && (
          <div className="mb-6 p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center gap-3">
              <span className="text-red-600 font-medium">{t('song.buildFailed')}</span>
              <span className="font-mono text-sm text-gray-600">{buildError.pathbuf}</span>
              <button
                onClick={() => openLogFile(buildError.pathbuf, 'stdout')}
                className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                stdout
              </button>
              <button
                onClick={() => openLogFile(buildError.pathbuf, 'stderr')}
                className="px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
              >
                stderr
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 sm:flex-wrap">
          {song.tempo_url ? (
            <a
              href={song.tempo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-3 text-white no-underline rounded-lg text-base font-medium h-[44px] w-full sm:w-auto justify-center transition-colors active:scale-95 bg-orange-500/70 hover:bg-orange-500/90"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M12,1.75L8.57,2.67L4.06,19.53C4.03,19.68 4,19.84 4,20C4,21.11 4.89,22 6,22H18C19.11,22 20,21.11 20,20C20,19.84 19.97,19.68 19.94,19.53L18.58,14.42L17,16L17.2,17H13.41L16.25,14.16L14.84,12.75L10.59,17H6.8L10.29,4H13.71L15.17,9.43L16.8,7.79L15.43,2.67L12,1.75M11.25,5V14.75L12.75,13.25V5H11.25M19.79,7.8L16.96,10.63L16.25,9.92L14.84,11.34L17.66,14.16L19.08,12.75L18.37,12.04L21.2,9.21L19.79,7.8Z"/>
              </svg>
              {song.tempo}
            </a>
          ) : song.tempo > 0 ? (
            <span className="flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-medium h-[44px] w-full sm:w-auto justify-center bg-gray-400/50 cursor-not-allowed">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M12,1.75L8.57,2.67L4.06,19.53C4.03,19.68 4,19.84 4,20C4,21.11 4.89,22 6,22H18C19.11,22 20,21.11 20,20C20,19.84 19.97,19.68 19.94,19.53L18.58,14.42L17,16L17.2,17H13.41L16.25,14.16L14.84,12.75L10.59,17H6.8L10.29,4H13.71L15.17,9.43L16.8,7.79L15.43,2.67L12,1.75M11.25,5V14.75L12.75,13.25V5H11.25M19.79,7.8L16.96,10.63L16.25,9.92L14.84,11.34L17.66,14.16L19.08,12.75L18.37,12.04L21.2,9.21L19.79,7.8Z"/>
              </svg>
              {song.tempo}
            </span>
          ) : null}

          <ActionButton
            href={song.pdf_url}
            variant="pdf"
            target="_blank"
            disabled={!song.pdf_url}
            title={!song.pdf_url ? t('song.pdfMissing') : undefined}
          >
            <PdfIcon className="w-5 h-5" /> {t('buttons.pdf')}
          </ActionButton>

          {(settings.lyricsMode ?? '1-column') !== 'none' && (
            <ActionButton
              href={song.pdf_lyrics_url ? `${song.pdf_lyrics_url}?columns=${(settings.lyricsMode ?? '1-column') === '2-columns' ? '2' : '1'}` : undefined}
              variant="pdf"
              target="_blank"
              disabled={!song.pdf_lyrics_url}
              title={!song.pdf_lyrics_url ? t('song.lyricsMissing') : undefined}
            >
              <PdfIcon className="w-5 h-5" /> {t('buttons.lyrics')}
            </ActionButton>
          )}

          {settings.musicService === 'deezerWeb' && (
            <ActionButton
              href={song.deezer_url}
              variant="deezer"
              target="_blank"
            >
              <DeezerIcon className="w-5 h-5" /> {t('buttons.web')}
            </ActionButton>
          )}

          {settings.musicService === 'deezerApp' && (
            <ActionButton
              href={song.deezer_app_url}
              variant="deezer-app"
            >
              <DeezerIcon className="w-5 h-5" /> {t('buttons.app')}
            </ActionButton>
          )}

          {settings.musicService === 'spotifyWeb' && (
            <ActionButton
              href={makeSpotifyUrl(song.title, song.author)}
              variant="spotify"
              target="_blank"
            >
              <SpotifyIcon className="w-5 h-5" /> {t('buttons.web')}
            </ActionButton>
          )}

          {settings.musicService === 'spotifyApp' && (
            <ActionButton
              href={makeSpotifyAppUrl(song.title, song.author)}
              variant="spotify-app"
            >
              <SpotifyIcon className="w-5 h-5" /> {t('buttons.app')}
            </ActionButton>
          )}

          <ActionButton
            href={`/edit-yml/${song.id}`}
            variant="edit"
            disabled={!isAuthenticated}
            title={!isAuthenticated ? t('settings.enableEditBuildFirst') : undefined}
          >
            <EditIcon className="w-5 h-5" /> {t('buttons.edit')}
          </ActionButton>

          <div className="relative group w-full sm:w-auto">
            <button
              onClick={triggerBuild}
              disabled={building || !isAuthenticated}
              className={isAuthenticated
                ? "flex items-center gap-2 px-4 py-3 text-white no-underline rounded-lg text-base font-medium h-[44px] w-full justify-center transition-colors active:scale-95 bg-[#8b5cf6]/70 hover:bg-[#8b5cf6]/90 disabled:bg-gray-400/50 disabled:cursor-not-allowed"
                : "flex items-center gap-2 px-4 py-2 text-white no-underline rounded-lg text-sm font-medium h-[44px] w-full justify-center bg-gray-400/50 cursor-not-allowed"
              }
            >
              <MakeIcon className="w-5 h-5" /> {building ? '...' : t('buttons.build')}
            </button>
            {!isAuthenticated && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                {t('settings.enableEditBuildFirst')}
              </div>
            )}
          </div>

        </div>

        {buildMessage && (
          <div className={`mt-4 p-3 rounded-lg ${buildMessage.includes('succeeded') ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
            {buildMessage}
          </div>
        )}
      </div>

      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-800 text-xl font-bold">{logModalTitle}</h2>
              <button
                onClick={() => { setShowLogModal(false); setLogSearchQuery('') }}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="mb-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Search in log..."
                  value={logSearchQuery}
                  onChange={(e) => { setLogSearchQuery(e.target.value); setCurrentMatchIndex(0) }}
                  onKeyDown={(e) => {
                    const matches = logContent.match(new RegExp(logSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []
                    if (e.key === 'Enter' && matches.length > 0) {
                      e.preventDefault()
                      const nextIndex = e.shiftKey
                        ? (currentMatchIndex - 1 + matches.length) % matches.length
                        : (currentMatchIndex + 1) % matches.length
                      setCurrentMatchIndex(nextIndex)
                    }
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                {logSearchQuery && (() => {
                  const matches = logContent.match(new RegExp(logSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []
                  return matches.length > 0 && (
                    <>
                      <button
                        onClick={() => setCurrentMatchIndex((currentMatchIndex - 1 + matches.length) % matches.length)}
                        className="px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
                        title="Previous match (Shift+Enter)"
                      >
                        &uarr;
                      </button>
                      <button
                        onClick={() => setCurrentMatchIndex((currentMatchIndex + 1) % matches.length)}
                        className="px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
                        title="Next match (Enter)"
                      >
                        &darr;
                      </button>
                    </>
                  )
                })()}
              </div>
              {logSearchQuery && (
                <span className="text-sm text-gray-500 mt-1 block">
                  {(() => {
                    const matches = logContent.match(new RegExp(logSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []
                    return matches.length > 0 ? `${currentMatchIndex + 1} of ${matches.length} matches` : 'No matches'
                  })()}
                </span>
              )}
            </div>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-96 text-sm font-mono whitespace-pre-wrap">
              {logSearchQuery ? (
                (() => {
                  let matchCount = -1
                  return logContent.split(new RegExp(`(${logSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')).map((part, i) => {
                    if (part.toLowerCase() === logSearchQuery.toLowerCase()) {
                      matchCount++
                      const isCurrentMatch = matchCount === currentMatchIndex
                      return (
                        <mark
                          key={i}
                          ref={isCurrentMatch ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
                          className={isCurrentMatch ? 'bg-orange-500 text-white' : 'bg-yellow-400 text-black'}
                        >
                          {part}
                        </mark>
                      )
                    }
                    return part
                  })
                })()
              ) : (
                logContent
              )}
            </pre>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setShowLogModal(false); setLogSearchQuery(''); setCurrentMatchIndex(0) }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
