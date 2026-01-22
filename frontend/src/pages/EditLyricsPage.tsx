import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { oneDark } from '@codemirror/theme-one-dark'
import { fetchSong } from '../api/songs'

const API_BASE = import.meta.env.VITE_API_URL || ''

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
  const res = await fetch(`${API_BASE}/api/song/${songId}/lyrics/${sectionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    throw new Error('Failed to save lyrics')
  }
}

export default function EditLyricsPage() {
  const { id, sectionId } = useParams<{ id: string; sectionId: string }>()
  const [content, setContent] = useState('')

  const handleEditorChange = useCallback((value: string) => {
    setContent(value)
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
      alert('Saved successfully!')
    },
    onError: () => {
      alert('Failed to save')
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
    window.close()
  }

  if (songLoading || lyricsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (!song) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-red-600">Song not found</p>
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
      <div className="max-w-4xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
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
          className="border border-gray-300 rounded-lg overflow-hidden"
        />

        <div className="flex items-center gap-4 mt-4">
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-6 py-3 bg-[#667eea] text-white rounded-lg font-medium hover:bg-[#5a67d8] disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
