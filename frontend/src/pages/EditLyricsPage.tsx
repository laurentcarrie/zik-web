import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTranslation } from 'react-i18next'
import { fetchSong } from '../api/songs'
import { useAuth, getStoredPassword } from '../context/AuthContext'
import { API_BASE } from '../config'

async function fetchLyrics(songId: string, sectionId: string): Promise<{ content: string }> {
  const res = await fetch(`${API_BASE}/api/song/${songId}/lyrics/${sectionId}`)
  if (!res.ok) {
    if (res.status === 404) {
      return { content: '' }
    }
    throw new Error('Failed to fetch lyrics')
  }
  return res.json()
}

async function saveLyrics(songId: string, sectionId: string, content: string): Promise<void> {
  const password = getStoredPassword()
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (password) {
    headers['X-Write-Password'] = password
  }
  const res = await fetch(`${API_BASE}/api/song/${songId}/lyrics/${sectionId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Unauthorized')
    }
    throw new Error('Failed to save lyrics')
  }
}

const TEX_MACROS = [
  { name: '\\songword{text}', key: 'macros.songword' },
  { name: '\\songwordfb{text}', key: 'macros.songwordfb' },
  { name: '\\songwordl{text}', key: 'macros.songwordl' },
  { name: '\\songwordcount{n}', key: 'macros.songwordcount' },
  { name: '\\songbookcomment{text}', key: 'macros.songbookcomment' },
  { name: '\\songly{file}', key: 'macros.songly' },
  { name: '\\basecouplet{color}{title}{content}', key: 'macros.basecouplet' },
]

export default function EditLyricsPage() {
  const { id, sectionId } = useParams<{ id: string; sectionId: string }>()
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [showMacros, setShowMacros] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const { t } = useTranslation()
  const { isAuthenticated } = useAuth()

  const handleEditorChange = useCallback((value: string) => {
    setContent(value)
    setSaveStatus('idle')
  }, [])

  const { data: song, isLoading: songLoading } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
  })

  const { data: lyricsData, isLoading: lyricsLoading } = useQuery({
    queryKey: ['lyrics', id, sectionId],
    queryFn: () => fetchLyrics(id!, sectionId!),
    enabled: !!id && !!sectionId,
  })

  const saveMutation = useMutation({
    mutationFn: () => saveLyrics(id!, sectionId!, content),
    onSuccess: () => {
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    },
    onError: () => {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 2000)
    },
  })

  useEffect(() => {
    if (lyricsData?.content !== undefined) {
      setContent(lyricsData.content)
    }
  }, [lyricsData])

  function handleSave() {
    saveMutation.mutate()
  }

  function handleClose() {
    navigate(-1)
  }

  // Escape key closes window
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showMacros) { setShowMacros(false); return }
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showMacros])

  if (songLoading || lyricsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-gray-900/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!song) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-gray-900/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-red-400">Song not found</p>
          <button
            onClick={handleClose}
            className="inline-block mt-4 text-[#667eea] hover:underline"
          >
            &larr; Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-4xl mx-auto bg-gray-900/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <button
          onClick={handleClose}
          className="text-[#667eea] no-underline hover:underline mb-4 inline-block"
        >
          &larr; Close
        </button>

        <h1 className="font-[Fontskrivan] font-black text-2xl md:text-3xl text-[#2563eb] mb-1">
          Edit Lyrics: {sectionId}
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-2">
          {song.title} - {song.author}
        </p>

        <CodeMirror
          value={content}
          height="400px"
          theme={oneDark}
          extensions={[StreamLanguage.define(stex)]}
          onChange={handleEditorChange}
          className="border border-gray-700 rounded-lg overflow-hidden"
        />

        <div className="flex items-center gap-4 mt-4">
          <button
            onClick={handleSave}
            disabled={!isAuthenticated || saveMutation.isPending}
            className={`px-6 py-3 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${
              saveStatus === 'success' ? 'bg-green-600' :
              saveStatus === 'error' ? 'bg-red-600' :
              'bg-[#667eea] hover:bg-[#5a67d8] disabled:bg-gray-400'
            }`}
          >
            {saveMutation.isPending ? 'Saving...' : saveStatus === 'success' ? 'Saved!' : saveStatus === 'error' ? 'Error' : 'Save'}
          </button>
          <button
            onClick={() => setShowMacros(true)}
            className="px-4 py-3 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-500 transition-colors"
          >
            {t('macros.button')}
          </button>
        </div>

        {showMacros && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowMacros(false)}>
            <div className="bg-gray-900/95 rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-gray-200 text-xl font-bold">{t('macros.title')}</h2>
                <button onClick={() => setShowMacros(false)} className="text-gray-400 hover:text-gray-200 text-2xl leading-none">&times;</button>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {TEX_MACROS.map(m => (
                    <tr key={m.name} className="border-b border-gray-700">
                      <td className="py-2 pr-4 font-mono text-blue-300 whitespace-nowrap align-top">{m.name}</td>
                      <td className="py-2 text-gray-300">{t(m.key)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
