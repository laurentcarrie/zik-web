import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { API_BASE, BAND_NAME, CLICK_SYNC_SESSIONS } from '../config'

interface SessionInfo {
  name: string
  bpm: number
  running: boolean
  client_count: number
  song: string
  bar: number
}

export default function ClickSyncPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [newName, setNewName] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const fetchSessions = () => {
      fetch(`${API_BASE}/api/click-sync-sessions`)
        .then((r) => r.json())
        .then((active: SessionInfo[]) => {
          const predefined = CLICK_SYNC_SESSIONS[BAND_NAME] || []
          const merged: SessionInfo[] = predefined.map(name => {
            const found = active.find(s => s.name === name)
            return found || { name, bpm: 120, running: false, client_count: 0, song: '', bar: 0 }
          })
          for (const s of active) {
            if (!predefined.includes(s.name)) {
              merged.push(s)
            }
          }
          setSessions(merged)
        })
        .catch(() => {})
    }
    fetchSessions()
    const interval = setInterval(fetchSessions, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    navigate(`/click/${encodeURIComponent(name)}`)
  }

  return (
    <div className="min-h-screen p-4 md:p-8 text-white">
      <div className="max-w-3xl mx-auto">
      <Link to="/" className="text-[#8b9cf7] no-underline hover:underline">
        &larr; Home
      </Link>
      <h1 className="text-3xl font-bold mb-8 mt-4 text-center">Click Sync</h1>

      <div className="flex gap-2 mb-8 w-full max-w-md mx-auto">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="Session name"
          className="flex-1 px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white
                     placeholder-gray-500 focus:border-white focus:outline-none"
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="px-6 py-2 rounded-lg bg-green-600 hover:bg-green-700 font-semibold
                     transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create
        </button>
      </div>

      <div className="w-full max-w-md mx-auto flex flex-col gap-3">
        {sessions.map((s) => (
          <Link
            key={s.name}
            to={s.song ? `/htmlsong/${s.song}` : `/songs`}
            onClick={() => { document.cookie = `clickSyncSession=${encodeURIComponent(s.name)};path=/;max-age=31536000` }}
            className={`block p-4 rounded-lg transition-colors no-underline text-white ${
              s.client_count > 0 ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-800/50 hover:bg-gray-700/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`font-semibold text-lg ${s.client_count === 0 ? 'text-gray-400' : ''}`}>{s.name}</span>
              <span className={`text-sm ${s.client_count > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                {s.client_count} client{s.client_count !== 1 ? 's' : ''}
              </span>
            </div>
            {s.client_count > 0 && (
              <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                <span>{Math.round(s.bpm)} BPM</span>
                <span
                  className={`inline-block w-2 h-2 rounded-full ${s.running ? 'bg-green-500' : 'bg-gray-600'}`}
                />
                <span>{s.running ? 'Running' : 'Stopped'}</span>
                {s.song && <span className="text-blue-400">{s.song}</span>}
              </div>
            )}
          </Link>
        ))}
      </div>
      </div>
    </div>
  )
}
