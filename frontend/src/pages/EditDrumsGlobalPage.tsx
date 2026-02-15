import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { useAuth, getStoredPassword } from '../context/AuthContext'
import PasswordModal from '../components/PasswordModal'
import { API_BASE } from '../config'

async function fetchDrumPattern(name: string): Promise<{ data: string }> {
  const s3Key = `drum-patterns/${name}.yml`
  const res = await fetch(`${API_BASE}/api/s3/${s3Key}`)
  if (!res.ok) {
    if (res.status === 404) {
      return { data: '' }
    }
    throw new Error('Failed to fetch drum pattern')
  }
  return res.json()
}

async function saveDrumPattern(name: string, data: string): Promise<void> {
  const s3Key = `drum-patterns/${name}.yml`
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
    throw new Error('Failed to save drum pattern')
  }
}

export default function EditDrumsGlobalPage() {
  const { name } = useParams<{ name: string }>()
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const { isAuthenticated } = useAuth()

  const handleEditorChange = useCallback((value: string) => {
    setContent(value)
  }, [])

  useEffect(() => {
    if (!name) return
    setLoading(true)
    fetchDrumPattern(name)
      .then(data => setContent(data.data))
      .catch(() => setContent(''))
      .finally(() => setLoading(false))
  }, [name])

  const saveMutation = useMutation({
    mutationFn: () => saveDrumPattern(name!, content),
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !showPasswordModal) {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showPasswordModal])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-500">Loading...</p>
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

        <h1 className="font-[Fontskrivan] font-black text-2xl md:text-3xl text-[#2563eb] mb-2">
          Edit Drum Pattern: {name}
        </h1>

        <CodeMirror
          value={content}
          height="400px"
          theme={oneDark}
          extensions={[yaml()]}
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
