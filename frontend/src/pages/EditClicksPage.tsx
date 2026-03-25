import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { fetchSong } from '../api/songs'
import { useAuth, getStoredPassword } from '../context/AuthContext'
import PasswordModal from '../components/PasswordModal'
import { API_BASE } from '../config'

async function fetchClicks(songKey: string, hasClicks: boolean): Promise<{ data: string }> {
  const dir = songKey.substring(0, songKey.lastIndexOf('/'))
  const s3Key = `${dir}/clicks-def.yml`
  const res = await fetch(`${API_BASE}/api/s3/${s3Key}`)
  if (!res.ok) {
    if (res.status === 404) {
      if (hasClicks) {
        throw new Error('clicks-def.yml not found but has_clicks is true — file may be missing from S3')
      }
      return { data: '' }
    }
    throw new Error('Failed to fetch clicks-def.yml')
  }
  const json = await res.json()
  if (hasClicks && !json.data?.trim()) {
    throw new Error('clicks-def.yml is empty but has_clicks is true')
  }
  return json
}

async function saveClicks(songKey: string, data: string): Promise<void> {
  const dir = songKey.substring(0, songKey.lastIndexOf('/'))
  const s3Key = `${dir}/clicks-def.yml`
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
    throw new Error('Failed to save clicks-def.yml')
  }
}

export default function EditClicksPage() {
  const { id } = useParams<{ id: string }>()
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

  const { data: clicksData, isLoading: clicksLoading, error: clicksError } = useQuery({
    queryKey: ['clicks', id],
    queryFn: () => fetchClicks(song!.key, song!.has_clicks),
    enabled: !!song?.key,
  })

  const saveMutation = useMutation({
    mutationFn: () => saveClicks(song!.key, content),
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
    if (clicksData?.data !== undefined) {
      setContent(clicksData.data)
    }
  }, [clicksData])

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

  if (songLoading || clicksLoading) {
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

  if (clicksError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-gray-900/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-red-400">{(clicksError as Error).message}</p>
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
          Edit clicks-def.yml
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-2">
          {song.title} - {song.author}
        </p>

        <CodeMirror
          value={content}
          height="400px"
          theme={oneDark}
          extensions={[yaml()]}
          onChange={handleEditorChange}
          className="border border-gray-700 rounded-lg overflow-hidden"
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
