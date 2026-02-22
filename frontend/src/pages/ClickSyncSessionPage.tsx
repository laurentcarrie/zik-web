import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'

export default function ClickSyncSessionPage() {
  const { session } = useParams<{ session: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}${API_BASE}/api/click-sync/${encodeURIComponent(session || 'default')}`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'State') {
        ws.close()
        if (msg.song) {
          document.cookie = `clickSyncSession=${encodeURIComponent(session || 'default')};path=/;max-age=31536000`
          navigate(`/htmlsong/${msg.song}`, { replace: true })
        } else {
          navigate('/songs', { replace: true })
        }
      }
    }

    return () => { ws.close() }
  }, [session, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center text-white">
      <p className="text-gray-400">Connecting...</p>
    </div>
  )
}
