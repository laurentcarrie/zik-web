import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchSong, fetchSongYml } from '../api/songs'
import { API_BASE } from '../config'
import yaml from 'js-yaml'

const customTags = [
  '!Chords', '!Lyrics', '!Tab', '!Notes', '!Section',
  '!Verse', '!Chorus', '!Bridge', '!Intro', '!Outro',
  '!NewColumn', '!HorizontalRule', '!HRule', '!Ref'
]

function createCustomSchema() {
  const types = customTags.flatMap(tag => [
    new yaml.Type(tag, { kind: 'scalar', construct: (data: unknown) => ({ __tag: tag, __data: data }) }),
    new yaml.Type(tag, { kind: 'mapping', construct: (data: unknown) => ({ __tag: tag, ...(data as object) }) }),
    new yaml.Type(tag, { kind: 'sequence', construct: (data: unknown) => ({ __tag: tag, __data: data }) }),
  ])
  return yaml.DEFAULT_SCHEMA.extend(types)
}

const CUSTOM_SCHEMA = createCustomSchema()

interface StructureItem {
  id?: string
  item?: { __tag?: string; title?: string; type?: string; link?: string; rows?: string[] }
}

interface ParsedYaml {
  structure?: StructureItem[]
}

interface Section {
  id: string
  title: string
  rows: string[]
}

interface SessionInfo {
  name: string
  bpm: number
  running: boolean
  client_count: number
}

function useClickSync(sessionName: string | null) {
  const [bpm, setBpm] = useState(120)
  const [running, setRunning] = useState(false)
  const [beatNumber, setBeatNumber] = useState(0)
  const [connected, setConnected] = useState(false)
  const [soundOn, setSoundOn] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const clockOffsetRef = useRef(0)
  const schedulerRef = useRef<number | null>(null)
  const originRef = useRef(0)
  const bpmRef = useRef(120)
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
      if (!runningRef.current) { schedulerRef.current = null; return }
      const intervalMs = 60000 / bpmRef.current
      const now = Date.now()
      while (true) {
        const beatTime = originRef.current - clockOffsetRef.current + scheduledUpToRef.current * intervalMs
        if (beatTime > now + 100) break
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

  useEffect(() => {
    if (!sessionName) {
      setConnected(false)
      setRunning(false)
      setBeatNumber(0)
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}${API_BASE}/api/click-sync/${encodeURIComponent(sessionName)}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      const offsets: number[] = []
      let round = 0
      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data)
        if (msg.type !== 'Pong') return
        const now = Date.now()
        const rtt = now - msg.client_time
        offsets.push(msg.server_time - msg.client_time - rtt / 2)
        round++
        if (round < 5) {
          ws.send(JSON.stringify({ type: 'Ping', client_time: Date.now() }))
        } else {
          ws.removeEventListener('message', handler)
          offsets.sort((a, b) => a - b)
          clockOffsetRef.current = offsets[Math.floor(offsets.length / 2)]
        }
      }
      ws.addEventListener('message', handler)
      ws.send(JSON.stringify({ type: 'Ping', client_time: Date.now() }))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'State') {
        setBpm(msg.bpm)
        bpmRef.current = msg.bpm
        setRunning(msg.running)
        runningRef.current = msg.running
        setBeatNumber(msg.beat_number)
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
      stopScheduler()
    }

    return () => { ws.close(); stopScheduler() }
  }, [sessionName, startScheduler, stopScheduler])

  const send = useCallback((msg: object) => {
    wsRef.current?.send(JSON.stringify(msg))
  }, [])

  const toggleSound = useCallback(() => {
    ensureAudioCtx()
    const next = !soundOnRef.current
    soundOnRef.current = next
    setSoundOn(next)
  }, [ensureAudioCtx])

  const toggleRunning = useCallback(() => {
    ensureAudioCtx()
    send(running ? { type: 'Stop' } : { type: 'Start' })
  }, [ensureAudioCtx, send, running])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    stopScheduler()
  }, [stopScheduler])

  return { bpm, running, beatNumber, connected, soundOn, toggleSound, toggleRunning, disconnect }
}

export default function HtmlSongPage() {
  const { id } = useParams<{ id: string }>()
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])

  const { data: song, isLoading: songLoading } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
  })

  const { data: songYml, isLoading: ymlLoading } = useQuery({
    queryKey: ['songYml', id],
    queryFn: () => fetchSongYml(id!),
    enabled: !!id,
  })

  const { bpm, running, beatNumber, connected, soundOn, toggleSound, toggleRunning, disconnect } = useClickSync(selectedSession)

  // Poll sessions
  useEffect(() => {
    const fetchSessions = () => {
      fetch(`${API_BASE}/api/click-sync-sessions`)
        .then((r) => r.json())
        .then(setSessions)
        .catch(() => {})
    }
    fetchSessions()
    const interval = setInterval(fetchSessions, 3000)
    return () => clearInterval(interval)
  }, [])

  const sections: Section[] = []
  if (songYml?.content) {
    try {
      const parsed = yaml.load(songYml.content, { schema: CUSTOM_SCHEMA }) as ParsedYaml
      if (parsed?.structure) {
        const rowsById = new Map<string, string[]>()
        for (const item of parsed.structure) {
          if (item.id && item.item?.rows) {
            rowsById.set(item.id, item.item.rows)
          }
        }
        for (const item of parsed.structure) {
          if (item.item?.title) {
            const rows = item.item.rows || (item.item.link ? rowsById.get(item.item.link) || [] : [])
            sections.push({ id: item.id || '', title: item.item.title, rows })
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  if (songLoading || ymlLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-gray-900/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto bg-gray-900/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <Link
          to={`/song/${id}`}
          className="text-[#8b9cf7] no-underline hover:underline"
        >
          &larr; Back
        </Link>

        <h1 className="font-[Fontskrivan] font-black text-2xl md:text-3xl text-[#2563eb] mt-4 mb-1">
          {song?.title}
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-4">
          {song?.author}
        </p>

        <div className="flex items-center gap-3 mb-6 flex-wrap">
          {!selectedSession ? (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-gray-400">
                <path d="M12,1.75L8.57,2.67L4.06,19.53C4.03,19.68 4,19.84 4,20C4,21.11 4.89,22 6,22H18C19.11,22 20,21.11 20,20C20,19.84 19.97,19.68 19.94,19.53L18.58,14.42L17,16L17.2,17H13.41L16.25,14.16L14.84,12.75L10.59,17H6.8L10.29,4H13.71L15.17,9.43L16.8,7.79L15.43,2.67L12,1.75M11.25,5V14.75L12.75,13.25V5H11.25M19.79,7.8L16.96,10.63L16.25,9.92L14.84,11.34L17.66,14.16L19.08,12.75L18.37,12.04L21.2,9.21L19.79,7.8Z"/>
              </svg>
              <select
                value=""
                onChange={(e) => { if (e.target.value) setSelectedSession(e.target.value) }}
                className="px-3 py-1.5 text-sm text-white rounded-lg bg-gray-700 border border-gray-600 cursor-pointer focus:outline-none focus:border-gray-400"
              >
                <option value="" disabled>
                  {sessions.length > 0 ? 'Select session...' : 'No active sessions'}
                </option>
                {sessions.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({Math.round(s.bpm)} BPM, {s.client_count} client{s.client_count !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <button
                onClick={toggleRunning}
                disabled={!connected}
                className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors active:scale-95 cursor-pointer
                  ${running ? 'bg-green-500/70 hover:bg-green-500/90' : 'bg-orange-500/70 hover:bg-orange-500/90'}
                  ${!connected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M12,1.75L8.57,2.67L4.06,19.53C4.03,19.68 4,19.84 4,20C4,21.11 4.89,22 6,22H18C19.11,22 20,21.11 20,20C20,19.84 19.97,19.68 19.94,19.53L18.58,14.42L17,16L17.2,17H13.41L16.25,14.16L14.84,12.75L10.59,17H6.8L10.29,4H13.71L15.17,9.43L16.8,7.79L15.43,2.67L12,1.75M11.25,5V14.75L12.75,13.25V5H11.25M19.79,7.8L16.96,10.63L16.25,9.92L14.84,11.34L17.66,14.16L19.08,12.75L18.37,12.04L21.2,9.21L19.79,7.8Z"/>
                </svg>
                {Math.round(bpm)}
              </button>

              <button
                onClick={toggleSound}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${soundOn ? 'bg-green-500/70 hover:bg-green-500/90' : 'bg-gray-600 hover:bg-gray-700'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
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

              {running && (
                <div className="flex gap-1.5">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full transition-all duration-75 ${
                        beatNumber % 4 === i
                          ? i === 0 ? 'bg-orange-500 scale-125' : 'bg-white scale-125'
                          : 'bg-gray-600'
                      }`}
                    />
                  ))}
                </div>
              )}

              <span className="text-xs text-gray-500">{selectedSession}</span>

              <button
                onClick={() => { disconnect(); setSelectedSession(null) }}
                className="text-xs text-gray-500 hover:text-white transition-colors cursor-pointer"
                title="Disconnect"
              >
                &times;
              </button>
            </>
          )}
        </div>

        {sections.length === 0 ? (
          <p className="text-gray-500">No sections found</p>
        ) : (
          <div className="space-y-4">
            {sections.map((s, i) => (
              <div key={`${s.id}-${i}`}>
                <h2 className="text-gray-300 font-semibold text-lg mb-1">{s.title}</h2>
                {s.rows.length > 0 && (
                  <div className="font-mono text-gray-200 text-sm space-y-0.5 ml-2">
                    {s.rows.map((row, j) => (
                      <div key={j}>{row}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
