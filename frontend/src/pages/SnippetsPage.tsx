import { useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchSong } from '../api/songs'
import type { Snippet } from '../api/types'
import { API_BASE, ROUTE_PREFIX } from '../config'

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6 6h12v12H6z" />
    </svg>
  )
}

function SnippetCard({
  snippet,
  playing,
  onToggle,
}: {
  snippet: Snippet
  playing: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()

  return (
    <section className="mb-8 rounded-lg border border-gray-700 bg-gray-800/40 overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
        <h2 className="font-medium text-gray-100 grow">{snippet.name}</h2>

        {snippet.mp3_url && (
          <button
            onClick={onToggle}
            aria-label={playing ? t('snippets.stop') : t('snippets.listen')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white transition-colors active:scale-95 ${
              playing
                ? 'bg-[#dc2626]/70 hover:bg-[#dc2626]/90'
                : 'bg-[#158c3a]/70 hover:bg-[#158c3a]/90'
            }`}
          >
            {playing ? <StopIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
            {playing ? t('snippets.stop') : t('snippets.listen')}
          </button>
        )}

        {snippet.pdf_url && (
          <a
            href={`${API_BASE}${snippet.pdf_url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-lg text-sm font-medium text-white no-underline bg-[#dc2626]/70 hover:bg-[#dc2626]/90 transition-colors"
          >
            {t('snippets.openPdf')}
          </a>
        )}
      </header>

      {snippet.pdf_url ? (
        // view=Fit fits the whole page in the frame: the snippets are
        // cropped to their content, so they range from a few chord boxes to a
        // full tab line and would otherwise sit tiny in a corner.
        <iframe
          src={`${API_BASE}${snippet.pdf_url}#toolbar=0&navpanes=0&view=Fit`}
          title={snippet.name}
          className="w-full h-[220px] bg-white"
        />
      ) : (
        <p className="px-4 py-6 text-gray-400">{t('snippets.noPdf')}</p>
      )}
    </section>
  )
}

export default function SnippetsPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)

  const { data: song, isLoading, error } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
  })

  // One audio element for the whole page: starting a snippet stops the previous.
  function toggle(snippet: Snippet) {
    if (playing === snippet.name) {
      audioRef.current?.pause()
      setPlaying(null)
      return
    }
    if (!snippet.mp3_url) return
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener('ended', () => setPlaying(null))
    }
    audioRef.current.pause()
    audioRef.current.src = `${API_BASE}${snippet.mp3_url}`
    void audioRef.current.play()
    setPlaying(snippet.name)
  }

  if (isLoading) return <div className="p-6 text-gray-300">{t('snippets.loading')}</div>
  if (error || !song) return <div className="p-6 text-red-300">{t('snippets.notFound')}</div>

  const snippets = song.snippets ?? []

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link
        to={`${ROUTE_PREFIX}/song/${id}`}
        className="text-sm text-gray-400 hover:text-gray-200 no-underline"
      >
        &larr; {song.title}
      </Link>

      <h1 className="mt-2 mb-6 text-2xl font-semibold text-gray-100">{t('snippets.title')}</h1>

      {snippets.length === 0 ? (
        <p className="text-gray-400">{t('snippets.none')}</p>
      ) : (
        snippets.map((snippet) => (
          <SnippetCard
            key={snippet.name}
            snippet={snippet}
            playing={playing === snippet.name}
            onToggle={() => toggle(snippet)}
          />
        ))
      )}
    </div>
  )
}
