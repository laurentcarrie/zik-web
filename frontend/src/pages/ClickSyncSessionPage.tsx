import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'

export default function ClickSyncSessionPage() {
  const { session } = useParams<{ session: string }>()
  const [searchParams] = useSearchParams()
  const initialBpm = Number(searchParams.get('bpm')) || null
  const navigate = useNavigate()

  const [bpm, setBpm] = useState(initialBpm || 120)
  const [running, setRunning] = useState(false)
  const [beatNumber, setBeatNumber] = useState(0)
  const [clientCount, setClientCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [syncStatus, setSyncStatus] = useState('Not synced')
  const [bpmDraft, setBpmDraft] = useState('')
  const [editingBpm, setEditingBpm] = useState(false)
  const [soundOn, setSoundOn] = useState(false)

  const initialBpmSentRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const clockOffsetRef = useRef(0)
  const schedulerRef = useRef<number | null>(null)
  const originRef = useRef(0)
  const bpmRef = useRef(initialBpm || 120)
  const runningRef = useRef(false)
  const scheduledUpToRef = useRef(0)
  const soundOnRef = useRef(false)

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }, [])

  const playClick = useCallback((time: number, isDownbeat: boolean) => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = isDownbeat ? 1500 : 1000
    gain.gain.setValueAtTime(0.5, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03)
    osc.start(time)
    osc.stop(time + 0.03)
  }, [])

  const stopScheduler = useCallback(() => {
    if (schedulerRef.current) {
      clearTimeout(schedulerRef.current)
      schedulerRef.current = null
    }
  }, [])

  const startScheduler = useCallback(() => {
    stopScheduler()
    const ctx = ensureAudioCtx()

    const schedule = () => {
      if (!runningRef.current) {
        schedulerRef.current = null
        return
      }

      const intervalMs = 60000 / bpmRef.current
      const now = Date.now()
      const lookaheadMs = 100

      while (true) {
        const beatTime =
          originRef.current - clockOffsetRef.current + scheduledUpToRef.current * intervalMs
        if (beatTime > now + lookaheadMs) break
        // Don't play beats more than 50ms in the past
        if (beatTime > now - 50) {
          const audioTime = ctx.currentTime + (beatTime - now) / 1000
          if (audioTime > ctx.currentTime && soundOnRef.current) {
            playClick(audioTime, scheduledUpToRef.current % 4 === 0)
          }
        }
        scheduledUpToRef.current++
      }

      schedulerRef.current = window.setTimeout(schedule, 25)
    }

    schedule()
  }, [ensureAudioCtx, playClick, stopScheduler])

  const syncClock = useCallback((ws: WebSocket): Promise<number> => {
    return new Promise((resolve) => {
      const offsets: number[] = []
      let round = 0
      const totalRounds = 5

      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data)
        if (msg.type !== 'Pong') return

        const now = Date.now()
        const rtt = now - msg.client_time
        const offset = msg.server_time - msg.client_time - rtt / 2
        offsets.push(offset)
        round++

        if (round < totalRounds) {
          ws.send(JSON.stringify({ type: 'Ping', client_time: Date.now() }))
        } else {
          ws.removeEventListener('message', handler)
          offsets.sort((a, b) => a - b)
          const median = offsets[Math.floor(offsets.length / 2)]
          resolve(median)
        }
      }

      ws.addEventListener('message', handler)
      ws.send(JSON.stringify({ type: 'Ping', client_time: Date.now() }))
    })
  }, [])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}${API_BASE}/api/click-sync/${encodeURIComponent(session || 'default')}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = async () => {
      setConnected(true)
      setSyncStatus('Syncing...')
      const offset = await syncClock(ws)
      clockOffsetRef.current = offset
      setSyncStatus(`Synced (offset: ${offset.toFixed(1)}ms)`)
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'State') {
        // If session has a song active, redirect to its HtmlSong page
        if (msg.song) {
          ws.close()
          navigate(`/htmlsong/${msg.song}?session=${encodeURIComponent(session || 'default')}`, { replace: true })
          return
        }
        // Set initial BPM if we're the first client and have a bpm param
        if (!initialBpmSentRef.current && initialBpm && msg.client_count === 1) {
          initialBpmSentRef.current = true
          ws.send(JSON.stringify({ type: 'SetBpm', bpm: initialBpm }))
        }
        setBpm(msg.bpm)
        bpmRef.current = msg.bpm
        setRunning(msg.running)
        runningRef.current = msg.running
        setBeatNumber(msg.beat_number)
        setClientCount(msg.client_count)
        originRef.current = msg.origin

        if (msg.running) {
          stopScheduler()
          scheduledUpToRef.current = msg.beat_number
          startScheduler()
        } else {
          stopScheduler()
        }
      }
      if (msg.type === 'Tick') {
        setBeatNumber(msg.beat_number)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setSyncStatus('Disconnected')
      stopScheduler()
    }

    return () => {
      ws.close()
      stopScheduler()
    }
  }, [syncClock, startScheduler, stopScheduler])

  const send = useCallback((msg: object) => {
    wsRef.current?.send(JSON.stringify(msg))
  }, [])

  const handleStartStop = () => {
    ensureAudioCtx()
    send(running ? { type: 'Stop' } : { type: 'Start' })
  }

  const handleBpmChange = (newBpm: number) => {
    send({ type: 'SetBpm', bpm: newBpm })
  }

  return (
    <div className="min-h-screen p-4 md:p-8 text-white">
      <div className="max-w-3xl mx-auto">
      <Link to="/click" className="text-[#8b9cf7] no-underline hover:underline">
        &larr; Sessions
      </Link>
      <h1 className="text-3xl font-bold mt-4 mb-8 text-center">{session}</h1>

      <div className="mb-6 text-sm text-gray-400 text-center">
        <span
          className={`inline-block w-2 h-2 rounded-full mr-2 ${connected ? 'bg-green-500' : 'bg-red-500'}`}
        />
        {syncStatus}
        {connected && ` \u00b7 ${clientCount} client${clientCount !== 1 ? 's' : ''}`}
      </div>

      <div className="mb-8 text-center flex flex-col items-center">
        <input
          type="number"
          min={30}
          max={300}
          value={editingBpm ? bpmDraft : Math.round(bpm)}
          onFocus={(e) => {
            setEditingBpm(true)
            setBpmDraft(String(Math.round(bpm)))
            e.target.select()
          }}
          onChange={(e) => setBpmDraft(e.target.value)}
          onBlur={() => {
            setEditingBpm(false)
            const v = Number(bpmDraft)
            if (v >= 30 && v <= 300) handleBpmChange(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          className="w-28 text-6xl font-mono font-bold text-center text-white bg-transparent
                     border-b-2 border-gray-600 focus:border-white focus:outline-none
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                     [&::-webkit-inner-spin-button]:appearance-none"
        />
        <input
          type="range"
          min={30}
          max={300}
          value={bpm}
          onChange={(e) => handleBpmChange(Number(e.target.value))}
          className="w-64 cursor-pointer mt-4 block mx-auto"
        />
        <div className="text-sm text-gray-400 mt-1">BPM</div>
      </div>

      <div className="flex gap-3 mb-8 justify-center">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-6 h-6 rounded-full transition-all duration-75 ${
              running && beatNumber % 4 === i
                ? i === 0
                  ? 'bg-orange-500 scale-125'
                  : 'bg-white scale-125'
                : 'bg-gray-600'
            }`}
          />
        ))}
      </div>

      <div className="flex gap-4 items-center justify-center">
        <button
          onClick={handleStartStop}
          disabled={!connected}
          className={`px-8 py-3 rounded-lg text-lg font-semibold transition-all
            ${running ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}
            ${!connected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {running ? 'Stop' : 'Start'}
        </button>
        <button
          onClick={() => {
            const next = !soundOn
            setSoundOn(next)
            soundOnRef.current = next
          }}
          className="p-3 rounded-lg transition-all cursor-pointer bg-gray-600 hover:bg-gray-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            {soundOn ? (
              <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
            ) : (
              <>
                <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06Z" />
                <path stroke="currentColor" strokeWidth={2} strokeLinecap="round" d="M17.25 9.75l5.5 5.5m0-5.5l-5.5 5.5" />
              </>
            )}
          </svg>
        </button>
      </div>
      </div>
    </div>
  )
}
