import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

interface PasswordModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function PasswordModal({ isOpen, onClose, onSuccess }: PasswordModalProps) {
  const { setPassword, verifyPassword } = useAuth()
  const [inputPassword, setInputPassword] = useState('')
  const [error, setError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)

  if (!isOpen) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsVerifying(true)

    try {
      const isValid = await verifyPassword(inputPassword)
      if (isValid) {
        setPassword(inputPassword)
        setInputPassword('')
        onSuccess()
      } else {
        setError('Invalid password')
      }
    } catch {
      setError('Failed to verify password')
    } finally {
      setIsVerifying(false)
    }
  }

  function handleClose() {
    setInputPassword('')
    setError('')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full mx-4">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Authentication Required</h2>
        <p className="text-gray-600 mb-4">
          Please enter the write password to continue.
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={inputPassword}
            onChange={(e) => setInputPassword(e.target.value)}
            placeholder="Enter password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] mb-3"
            autoFocus
          />

          {error && (
            <p className="text-red-600 text-sm mb-3">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isVerifying || !inputPassword}
              className="flex-1 px-4 py-3 bg-[#667eea] text-white rounded-lg font-medium hover:bg-[#5a67d8] disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isVerifying ? 'Verifying...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
