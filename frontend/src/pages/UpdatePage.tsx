import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateSongs } from '../api/songs'

export default function UpdatePage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')

  const handleUpdate = async () => {
    setStatus('loading')
    setMessage('')
    try {
      const result = await updateSongs()
      setStatus('success')
      setMessage(result)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <button
          onClick={() => navigate(-1)}
          className="inline-block mb-4 text-[#667eea] hover:underline bg-transparent border-none cursor-pointer text-base"
        >
          &larr; Back
        </button>

        <h1 className="text-gray-800 text-2xl md:text-3xl font-bold mb-6">Update Songs</h1>

        <p className="text-gray-600 mb-6">
          This will scan all song files in S3 and regenerate the songs index.
        </p>

        <button
          onClick={handleUpdate}
          disabled={status === 'loading'}
          className="px-6 py-3 bg-[#667eea] text-white rounded-lg font-medium hover:bg-[#5a67d8] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'loading' ? 'Updating...' : 'Update Songs'}
        </button>

        {status === 'success' && (
          <div className="mt-4 p-4 bg-green-100 text-green-800 rounded-lg">
            {message}
          </div>
        )}

        {status === 'error' && (
          <div className="mt-4 p-4 bg-red-100 text-red-800 rounded-lg">
            Error: {message}
          </div>
        )}
      </div>
    </div>
  )
}
