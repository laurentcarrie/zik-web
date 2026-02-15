import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { simpleMode } from '@codemirror/legacy-modes/mode/simple-mode'
import { oneDark } from '@codemirror/theme-one-dark'
import { fetchSong } from '../api/songs'
import { useAuth, getStoredPassword } from '../context/AuthContext'
import PasswordModal from '../components/PasswordModal'

// LilyPond syntax highlighting mode
const lilypondMode = simpleMode({
  start: [
    // Block comments %{ %}
    { regex: /%\{/, token: 'comment', push: 'blockComment' },
    // Line comments
    { regex: /%.*/, token: 'comment' },
    // Strings
    { regex: /"(?:[^"\\]|\\.)*"/, token: 'string' },
    // Commands (backslash followed by word)
    { regex: /\\[a-zA-Z]+/, token: 'keyword' },
    // Note names with optional octave marks and accidentals
    { regex: /\b[a-g](is|es|isis|eses)?[',]*\d*\.?/, token: 'atom' },
    // Rest and skip
    { regex: /\b[rs]\d*\.?/, token: 'atom' },
    // Numbers
    { regex: /\d+/, token: 'number' },
    // Braces and brackets
    { regex: /[{}]/, token: 'bracket' },
    { regex: /[<>]/, token: 'bracket' },
    // Scheme expressions
    { regex: /#'?\(/, token: 'meta', push: 'scheme' },
    { regex: /#[tf]/, token: 'atom' },
  ],
  blockComment: [
    { regex: /.*?%\}/, token: 'comment', pop: true },
    { regex: /.*/, token: 'comment' },
  ],
  scheme: [
    { regex: /\)/, token: 'meta', pop: true },
    { regex: /"(?:[^"\\]|\\.)*"/, token: 'string' },
    { regex: /[a-zA-Z_][a-zA-Z0-9_\-?!]*/, token: 'variable' },
    { regex: /\d+/, token: 'number' },
    { regex: /[()]/, token: 'meta' },
  ],
})

import { API_BASE } from '../config'

async function fetchLilypond(songKey: string, filename: string): Promise<{ data: string }> {
  // songKey is like "songs/author/title/song.yml", extract directory
  const dir = songKey.substring(0, songKey.lastIndexOf('/'))
  const s3Key = `${dir}/${filename}`
  const res = await fetch(`${API_BASE}/api/s3/${s3Key}`)
  if (!res.ok) {
    if (res.status === 404) {
      return { data: '' }
    }
    throw new Error('Failed to fetch lilypond file')
  }
  return res.json()
}

async function saveLilypond(songKey: string, filename: string, data: string): Promise<void> {
  const dir = songKey.substring(0, songKey.lastIndexOf('/'))
  const s3Key = `${dir}/${filename}`
  const password = getStoredPassword()
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (password) {
    headers['X-Write-Password'] = password
  }
  const res = await fetch(`${API_BASE}/api/s3/${s3Key}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Unauthorized')
    }
    throw new Error('Failed to save lilypond file')
  }
}

export default function EditLilypondPage() {
  const { id, filename } = useParams<{ id: string; filename: string }>()
  const [content, setContent] = useState('')
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const { isAuthenticated } = useAuth()

  const handleEditorChange = useCallback((value: string) => {
    setContent(value)
  }, [])

  const { data: song, isLoading: songLoading } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
  })

  const { data: lilypondData, isLoading: lilypondLoading } = useQuery({
    queryKey: ['lilypond', id, filename],
    queryFn: () => fetchLilypond(song!.key, filename!),
    enabled: !!song?.key && !!filename,
  })

  const saveMutation = useMutation({
    mutationFn: () => saveLilypond(song!.key, filename!, content),
    onSuccess: () => {
      alert('Saved successfully!')
    },
    onError: (error: Error) => {
      if (error.message === 'Unauthorized') {
        setShowPasswordModal(true)
      } else {
        alert('Failed to save')
      }
    },
  })

  useEffect(() => {
    if (lilypondData?.data !== undefined) {
      setContent(lilypondData.data)
    }
  }, [lilypondData])

  function handleSave() {
    if (!isAuthenticated) {
      setShowPasswordModal(true)
      return
    }
    saveMutation.mutate()
  }

  function handlePasswordSuccess() {
    setShowPasswordModal(false)
    saveMutation.mutate()
  }

  function handleClose() {
    window.close()
  }

  // Escape key closes window
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !showPasswordModal) {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showPasswordModal])

  if (songLoading || lilypondLoading) {
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
          Edit LilyPond: {filename}
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-2">
          {song.title} - {song.author}
        </p>

        <CodeMirror
          value={content}
          height="400px"
          theme={oneDark}
          extensions={[StreamLanguage.define(lilypondMode)]}
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

      <PasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={handlePasswordSuccess}
      />
    </div>
  )
}
