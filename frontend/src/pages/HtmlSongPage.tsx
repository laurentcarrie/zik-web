import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchSong, fetchSongs, fetchSongStructure } from '../api/songs'
import type { ParsedSection, ParsedChordRow, ChordGlyph } from '../api/songs'
import { API_BASE } from '../config'

function useClickSync(sessionName: string | null, initialBpm?: number) {
  const [bpm, setBpm] = useState(initialBpm || 120)
  const [running, setRunning] = useState(false)
  const [beatNumber, setBeatNumber] = useState(0)
  const [connected, setConnected] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const [sessionSong, setSessionSong] = useState<string | null>(null)
  const [sessionBar, setSessionBar] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const clockOffsetRef = useRef(0)
  const schedulerRef = useRef<number | null>(null)
  const originRef = useRef(0)
  const bpmRef = useRef(initialBpm || 120)
  const runningRef = useRef(false)
  const scheduledUpToRef = useRef(0)
  const soundOnRef = useRef(false)
  const initialBpmSentRef = useRef(false)

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

  const VISUAL_LEAD_MS = 150
  const visualBeatRef = useRef(-1)

  const startScheduler = useCallback(() => {
    stopScheduler()
    const ctx = ensureAudioCtx()
    visualBeatRef.current = -1
    const schedule = () => {
      if (!runningRef.current) { schedulerRef.current = null; return }
      const intervalMs = 60000 / bpmRef.current
      const now = Date.now()
      const localOrigin = originRef.current - clockOffsetRef.current
      // Schedule audio clicks (look-ahead 100ms)
      while (true) {
        const beatTime = localOrigin + scheduledUpToRef.current * intervalMs
        if (beatTime > now + 100) break
        if (beatTime > now - 50) {
          const audioTime = ctx.currentTime + (beatTime - now) / 1000
          if (audioTime > ctx.currentTime && soundOnRef.current) {
            playClick(audioTime, scheduledUpToRef.current % 4 === 0)
          }
        }
        scheduledUpToRef.current++
      }
      // Visual lead: show the beat we'll be at VISUAL_LEAD_MS from now
      const visualBeat = Math.max(0, Math.floor((now + VISUAL_LEAD_MS - localOrigin) / intervalMs))
      if (visualBeat !== visualBeatRef.current) {
        visualBeatRef.current = visualBeat
        setBeatNumber(visualBeat)
      }
      schedulerRef.current = window.setTimeout(schedule, 25)
    }
    schedule()
  }, [ensureAudioCtx, playClick, stopScheduler])

  useEffect(() => {
    if (!sessionName) {
      setConnected(false)
      setSessionSong(null)
      setRunning(false)
      runningRef.current = false
      setBeatNumber(0)
      stopScheduler()
      return
    }

    setConnected(false)
    setSessionSong(null)
    initialBpmSentRef.current = false

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
        if (!initialBpmSentRef.current && initialBpm && msg.client_count === 1) {
          initialBpmSentRef.current = true
          ws.send(JSON.stringify({ type: 'SetBpm', bpm: initialBpm }))
        }
        setBpm(msg.bpm)
        bpmRef.current = msg.bpm
        setRunning(msg.running)
        runningRef.current = msg.running
        setBeatNumber(msg.beat_number)
        originRef.current = msg.origin
        setSessionSong(msg.song || '')
        setSessionBar(msg.bar || 0)
        if (msg.running) {
          stopScheduler()
          scheduledUpToRef.current = msg.beat_number
          startScheduler()
        } else {
          stopScheduler()
        }
      }
      if (msg.type === 'Tick') {
        // Visual beat is handled by the scheduler with lead time
      }
    }

    ws.onclose = () => {
      setConnected(false)
      stopScheduler()
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      } else {
        ws.onopen = () => ws.close()
      }
      stopScheduler()
    }
  }, [sessionName, startScheduler, stopScheduler])

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg))
  }, [])

  const toggleSound = useCallback(() => {
    ensureAudioCtx()
    const next = !soundOnRef.current
    soundOnRef.current = next
    setSoundOn(next)
  }, [ensureAudioCtx])

  const toggleRunning = useCallback(() => {
    ensureAudioCtx()
    if (sessionName) {
      send(running ? { type: 'Stop' } : { type: 'Start' })
    } else {
      // Local-only mode
      if (running) {
        runningRef.current = false
        setRunning(false)
        stopScheduler()
      } else {
        runningRef.current = true
        setRunning(true)
        setBeatNumber(0)
        originRef.current = Date.now()
        clockOffsetRef.current = 0
        scheduledUpToRef.current = 0
        startScheduler()
      }
    }
  }, [ensureAudioCtx, sessionName, send, running, stopScheduler, startScheduler])

  const changeBpm = useCallback((newBpm: number) => {
    if (sessionName) {
      send({ type: 'SetBpm', bpm: newBpm })
    } else {
      // Local-only mode
      if (runningRef.current) {
        const now = Date.now()
        const oldInterval = 60000 / bpmRef.current
        const elapsed = (now - originRef.current) / oldInterval
        const newInterval = 60000 / newBpm
        originRef.current = now - elapsed * newInterval
      }
      bpmRef.current = newBpm
      setBpm(newBpm)
    }
  }, [sessionName, send])

  const sendSong = useCallback((song: string) => {
    if (sessionName) send({ type: 'SetSong', song })
  }, [sessionName, send])

  const sendBar = useCallback((bar: number) => {
    if (sessionName) send({ type: 'SetBar', bar })
  }, [sessionName, send])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    stopScheduler()
  }, [stopScheduler])

  return { bpm, running, beatNumber, connected, soundOn, sessionSong, sessionBar, toggleSound, toggleRunning, changeBpm, sendSong, sendBar, disconnect }
}

const FONT_MAP: Record<string, string> = {
  songbook: 'Songbook',
  songbook_flat: 'SongbookFlat',
  songbook_sharp: 'SongbookSharp',
  songbook_sus: 'SongbookSus',
}

// X11 color names to CSS hex (used in song section colors)
const X11_COLORS: Record<string, string> = {
  wheat1: '#ffe7ba',
  coral1: '#ff7256',
  darkseagreen1: '#c1ffc1',
  mistyrose2: '#eed5d2',
  lightcyan2: '#d1eeee',
  navajowhite2: '#eecfa1',
  aquamarine2: '#76eec6',
  lavenderblush2: '#eee0e5',
  white: '#ffffff',
  red: '#ff0000',
  blue: '#0000ff',
  orange: '#ffa500',
}

function x11ToCSS(color: string | null): string | undefined {
  if (!color) return undefined
  // Strip TikZ opacity modifier like "!10" or "!20"
  const base = color.replace(/![0-9]+$/, '').toLowerCase()
  return X11_COLORS[base]
}

function ChordCell({ glyph }: { glyph: ChordGlyph }) {
  const fontFamily = FONT_MAP[glyph.font] || 'Songbook'
  return (
    <span style={{ fontFamily }} className="text-2xl leading-none">
      {glyph.char}
    </span>
  )
}

function ChordGrid({ row, color, maxBars, dark, activeBar }: { row: ParsedChordRow; color?: string; maxBars: number; dark: boolean; activeBar: number }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const bgStyle = color ? { backgroundColor: color + 'e6' } : undefined
  const emptyCells = maxBars - row.bars.length
  const lastBarIdx = row.bars.length - 1
  const n = row.bars.length
  const totalBars = n * (row.repeat > 1 ? row.repeat : 1)
  const isInRow = row.bar_number > 0 && activeBar >= row.bar_number && activeBar < row.bar_number + totalBars
  const highlightIdx = isInRow ? (activeBar - row.bar_number) % n : -1

  useEffect(() => {
    if (isInRow && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isInRow])

  return (
    <div ref={rowRef} className="flex items-center gap-1 mb-1">
      <span className={`text-xs w-6 text-right shrink-0 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
        {row.bar_number > 0 ? row.bar_number : ''}
      </span>
      <div
        className="grid gap-px flex-1"
        style={{ gridTemplateColumns: `repeat(${maxBars}, 1fr)` }}
      >
        {row.bars.map((bar, j) => {
          const isActive = j === highlightIdx
          const cellStyle = isActive
            ? { backgroundColor: '#76eec6', boxShadow: '0 0 12px 4px rgba(118, 238, 198, 0.5)', transform: 'scale(1.08)', zIndex: 10 }
            : bgStyle
          return (
            <div
              key={j}
              className={`border px-2 py-1 text-black flex justify-around items-center relative transition-all duration-100 ${dark ? 'border-gray-600' : 'border-gray-300'} ${isActive ? 'border-2 border-yellow-400 rounded-md' : ''}`}
              style={cellStyle}
            >
              {bar.chords.length > 0
                ? bar.chords.map((g, k) => <ChordCell key={k} glyph={g} />)
                : <span>{'\u00a0'}</span>}
              {row.repeat > 1 && j === lastBarIdx && (
                <span className={`text-xs absolute -right-1 translate-x-full ${dark ? 'text-gray-400' : 'text-gray-500'}`}>x{row.repeat}</span>
              )}
            </div>
          )
        })}
        {Array.from({ length: emptyCells }, (_, j) => (
          <div key={`empty-${j}`} />
        ))}
      </div>
    </div>
  )
}

function htmlOfLatex(latex: string, activeFbIndex?: number): string {
  // Remove LaTeX comment lines (lines starting with optional spaces then %)
  let html = latex.replace(/^[ ]*%.*/gm, '')
  // Remove empty lines
  html = html.replace(/^\s*\n/gm, '')
  // Escape HTML entities
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // \color{color}{text} → <span style="color: color">text</span>
  html = html.replace(/\\color\{([^}]+)\}\{([^}]+)\}/g, '<span style="color: $1">$2</span>')
  // \\ → newline
  html = html.replace(/\\\\\n?/g, '<br>')
  // Process inner macros first so nested macros work (e.g. \songwordfb{\songwordcount{n}text})
  // \songwordcount{n}{text} → n as subscript index before text
  html = html.replace(/\\songwordcount\{([^}]+)\}\{([^}]+)\}/g, '<sub style="font-size: 0.7em; opacity: 0.6">$1</sub>$2')
  // \songwordcount{n} → n as subscript index
  html = html.replace(/\\songwordcount\{([^}]+)\}/g, '<sub style="font-size: 0.7em; opacity: 0.6">$1</sub>')
  // \songwordfb{text} → text in a red box, highlight active bar
  let fbCount = 0
  html = html.replace(/\\songwordfb\{([^}]+)\}/g, (_, text) => {
    const idx = fbCount++
    const isActive = idx === activeFbIndex
    const style = isActive
      ? 'border: 2px solid red; border-radius: 3px; padding: 0 3px; color: white; background: red; font-weight: bold'
      : 'border: 1px solid red; border-radius: 3px; padding: 0 3px; color: red'
    return `<span style="${style}">${text}</span>`
  })
  // \songwordl{text} → text in a blue box
  html = html.replace(/\\songwordl\{([^}]+)\}/g, '<span style="border: 1px solid #3b82f6; border-radius: 3px; padding: 0 3px; color: #3b82f6">$1</span>')
  // \songbookcomment{text} → red italic text
  html = html.replace(/\\songbookcomment\{([^}]+)\}/g, '<span style="color: red; font-style: italic">$1</span>')
  return html
}

function SectionLyrics({ songId, sectionId, dark, activeFbIndex, active }: { songId: string; sectionId: string; dark: boolean; activeFbIndex?: number; active?: boolean }) {
  const { data } = useQuery({
    queryKey: ['lyrics', songId, sectionId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/song/${songId}/lyrics/${sectionId}`)
      if (!res.ok) return null
      const json = await res.json()
      return json.content as string
    },
  })
  if (!data) return null
  return (
    <pre
      className={`whitespace-pre-wrap mt-1 mb-2 ${active ? 'text-lg' : 'text-sm'} ${dark ? 'text-gray-300' : 'text-gray-600'}`}
      dangerouslySetInnerHTML={{ __html: htmlOfLatex(data, activeFbIndex) }}
    />
  )
}

function SectionView({ section, nextSection, maxBars, dark, activeBar, beatNumber, songId, showGrid, showLyrics, nextLabel, onTitleClick }: { section: ParsedSection; nextSection?: ParsedSection; maxBars: number; dark: boolean; activeBar: number; beatNumber: number; songId: string; showGrid: boolean; showLyrics: boolean; nextLabel: string; onTitleClick: (barNumber: number) => void }) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const cssColor = x11ToCSS(section.color)
  const firstBarNumber = section.rows.length > 0 ? section.rows[0].bar_number : 0
  const sectionTotalBars = section.rows.reduce((sum, r) => sum + r.bars.length * (r.repeat > 1 ? r.repeat : 1), 0)
  const isActiveSection = activeBar >= 0 && section.rows.some(r => {
    const total = r.bars.length * (r.repeat > 1 ? r.repeat : 1)
    return r.bar_number > 0 && activeBar >= r.bar_number && activeBar < r.bar_number + total
  })

  useEffect(() => {
    if (isActiveSection && !showGrid && sectionRef.current) {
      sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isActiveSection, showGrid])

  return (
    <>
      <div
        ref={sectionRef}
        className={`transition-all duration-200 ${isActiveSection ? 'rounded-2xl p-4 ' + (dark ? 'bg-gray-800/70' : 'bg-gray-100/80') : 'rounded-lg pl-3'}`}
        style={cssColor ? { borderLeft: `4px solid ${cssColor}` } : undefined}
      >
        <div className="flex items-center gap-3 mb-1">
          <h2
            className={`font-bold cursor-pointer hover:underline transition-all duration-200 ${isActiveSection ? 'text-4xl' : 'text-lg'}`}
            style={{ color: cssColor || (dark ? '#d1d5db' : '#374151') }}
            onClick={() => firstBarNumber > 0 && onTitleClick(firstBarNumber)}
          >{section.title}</h2>
          {isActiveSection && (
            <>
              <div className="flex gap-2.5">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-5 h-5 rounded-full transition-all duration-75 ${
                      beatNumber % 4 === i
                        ? i === 0 ? 'bg-orange-500 scale-125' : 'bg-white scale-125'
                        : dark ? 'bg-gray-600' : 'bg-gray-300'
                    }`}
                  />
                ))}
              </div>
              <span className={`text-2xl font-mono font-bold ${dark ? 'text-gray-200' : 'text-gray-700'}`}>
                {activeBar - firstBarNumber + 1}/{sectionTotalBars} - {activeBar}
              </span>
            </>
          )}
        </div>
        {showLyrics && isActiveSection && (
          <div className="text-center">
            <SectionLyrics songId={songId} sectionId={section.id} dark={dark} activeFbIndex={activeBar - firstBarNumber} active />
          </div>
        )}
        {showGrid && section.rows.length > 0 && (
          <div>
            {section.rows.map((row, j) => (
              <ChordGrid key={j} row={row} color={cssColor} maxBars={maxBars} dark={dark} activeBar={activeBar} />
            ))}
          </div>
        )}
      </div>
      {showLyrics && isActiveSection && nextSection && (
        <div className={`mt-3 pl-3 italic text-center ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
          <span className={`text-sm font-semibold ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
            {nextLabel}: {nextSection.title}
          </span>
          <SectionLyrics songId={songId} sectionId={nextSection.id} dark={dark} />
        </div>
      )}
    </>
  )
}

export default function HtmlSongPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const cookieMatch = document.cookie.match(/(^| )clickSyncSession=([^;]+)/)
  const sessionFromParams = searchParams.get('session') || (cookieMatch ? decodeURIComponent(cookieMatch[2]) : null) || 'private'
  const [darkMode, setDarkMode] = useState(true)
  const [barOffset, setBarOffset] = useState(0)
  const [showGrid, setShowGrid] = useState(true)
  const [showLyrics, setShowLyrics] = useState(true)

  const { data: song, isLoading: songLoading, isError: songError } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
    retry: false,
  })

  const { data: structure, isLoading: structureLoading, isError: structureError } = useQuery({
    queryKey: ['songStructure', id],
    queryFn: () => fetchSongStructure(id!),
    enabled: !!id,
    retry: false,
  })

  const { data: allSongs } = useQuery({
    queryKey: ['songs'],
    queryFn: fetchSongs,
  })

  const { prevSong, nextSong } = useMemo(() => {
    if (!allSongs || !id) return { prevSong: null, nextSong: null }
    const sorted = [...allSongs].sort((a, b) => {
      const cmp = a.author.localeCompare(b.author)
      return cmp !== 0 ? cmp : a.title.localeCompare(b.title)
    })
    const idx = sorted.findIndex(s => s.id === id)
    if (idx === -1) return { prevSong: null, nextSong: null }
    return {
      prevSong: idx > 0 ? sorted[idx - 1] : null,
      nextSong: idx < sorted.length - 1 ? sorted[idx + 1] : null,
    }
  }, [allSongs, id])

  const songTempo = song?.tempo && song.tempo > 0 ? song.tempo : undefined
  const navigate = useNavigate()
  const { bpm, running, beatNumber, connected, soundOn, sessionSong, sessionBar, toggleSound, toggleRunning, changeBpm, sendSong, sendBar } = useClickSync(sessionFromParams, songTempo)

  const currentBar = Math.floor(beatNumber / 4) + barOffset

  const sections = structure?.sections ?? []
  const lastBar = Math.max(...sections.flatMap(s =>
    s.rows.map(r => r.bar_number + r.bars.length * (r.repeat > 1 ? r.repeat : 1) - 1)
  ), 0)

  // When changing song: stop metronome and reset bar count
  const prevIdRef = useRef(id)
  useEffect(() => {
    if (prevIdRef.current !== id) {
      prevIdRef.current = id
      setBarOffset(0)
      if (running) toggleRunning()
    }
  }, [id, running, toggleRunning])

  // Send our song to the session on connect or when navigating songs
  useEffect(() => {
    if (connected && id) {
      sendSong(id)
    }
  }, [connected, id, sendSong])

  // Follow song changes from other clients
  const prevSessionSongRef = useRef<string | null>(null)
  useEffect(() => {
    if (!connected || !sessionSong) return
    const prev = prevSessionSongRef.current
    prevSessionSongRef.current = sessionSong
    if (prev === sessionSong) return
    if (sessionSong === id) return
    navigate(`/htmlsong/${sessionSong}`, { replace: true })
  }, [connected, sessionSong, id, navigate])

  // Sync bar offset from server when another client jumps to a section
  useEffect(() => {
    if (connected && sessionBar > 0) {
      const expectedBar = Math.floor(beatNumber / 4) + barOffset
      if (sessionBar !== expectedBar) {
        setBarOffset(sessionBar - Math.floor(beatNumber / 4))
      }
    }
  }, [connected, sessionBar])

  // Stop metronome after the last bar
  useEffect(() => {
    if (running && lastBar > 0 && currentBar > lastBar) {
      toggleRunning()
    }
  }, [currentBar, running, lastBar, toggleRunning])


  // Redirect to songs list if song doesn't exist
  useEffect(() => {
    if (songError || structureError) {
      navigate('/songs', { replace: true })
    }
  }, [songError, structureError, navigate])

  if (songLoading || structureLoading || songError || structureError) {
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
      <div className={`max-w-3xl mx-auto rounded-2xl p-4 md:p-8 shadow-2xl ${darkMode ? 'bg-gray-900/95' : 'bg-white/95'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              to={`/song/${id}`}
              className="text-[#8b9cf7] no-underline hover:underline"
            >
              &larr; {t('nav.back')}
            </Link>
            <button
              onClick={() => prevSong && navigate(`/htmlsong/${prevSong.id}`)}
              disabled={!prevSong}
              className={`px-2 py-1 text-xs rounded-lg border transition-colors ${darkMode ? 'text-gray-200 border-gray-600 hover:bg-gray-700' : 'text-gray-700 border-gray-300 hover:bg-gray-200'} disabled:opacity-30 disabled:cursor-not-allowed`}
              title={prevSong ? `${prevSong.author} - ${prevSong.title}` : undefined}
            >
              &larr; {t('nav.prev')}
            </button>
            <button
              onClick={() => nextSong && navigate(`/htmlsong/${nextSong.id}`)}
              disabled={!nextSong}
              className={`px-2 py-1 text-xs rounded-lg border transition-colors ${darkMode ? 'text-gray-200 border-gray-600 hover:bg-gray-700' : 'text-gray-700 border-gray-300 hover:bg-gray-200'} disabled:opacity-30 disabled:cursor-not-allowed`}
              title={nextSong ? `${nextSong.author} - ${nextSong.title}` : undefined}
            >
              {t('nav.next')} &rarr;
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const match = document.cookie.match(/(^| )animationEnabled=([^;]+)/)
                const current = match ? match[2] === 'true' : true
                const next = !current
                document.cookie = `animationEnabled=${next};path=/;max-age=${365 * 86400}`
                window.dispatchEvent(new Event('animation-toggled'))
              }}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
              title="Toggle animation"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className={`w-5 h-5 ${document.cookie.match(/(^| )animationEnabled=([^;]+)/)?.[2] !== 'false' ? 'text-green-400' : darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-yellow-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
              title={darkMode ? 'Light mode' : 'Dark mode'}
            >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              {darkMode ? (
                <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 00-1.41 0 .996.996 0 000 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 000-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 000-1.41.996.996 0 00-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z" />
              ) : (
                <path d="M9.37 5.51A7.35 7.35 0 009.1 7.5c0 4.08 3.32 7.4 7.4 7.4.68 0 1.35-.09 1.99-.27A7.014 7.014 0 0112 19c-3.86 0-7-3.14-7-7 0-2.93 1.81-5.45 4.37-6.49zM12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 01-4.4 2.26 5.403 5.403 0 01-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" />
              )}
            </svg>
          </button>
            <Link
              to="/settings"
              className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
              title="Settings"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
            </Link>
          </div>
        </div>

        <h1 className="font-[Fontskrivan] font-black text-2xl md:text-3xl text-[#2563eb] mt-4 mb-1">
          {song?.title}
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-2">
          {song?.author}
        </p>

        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => { if (!connected) return; toggleRunning() }}
            disabled={!connected}
            className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors cursor-pointer
              ${running ? 'bg-green-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}
              ${!connected ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {running ? 'Stop' : 'Start'}
          </button>
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors cursor-pointer
              ${showGrid ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
          >
            {t('htmlSong.grid')}
          </button>
          <button
            onClick={() => setShowLyrics(!showLyrics)}
            className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors cursor-pointer
              ${showLyrics ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
          >
            {t('htmlSong.lyrics')}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-6 flex-wrap">
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

          <input
            type="range"
            min={30}
            max={300}
            value={Math.round(bpm)}
            onChange={(e) => changeBpm(Number(e.target.value))}
            className="w-24 accent-orange-500 cursor-pointer"
          />

          <button
            onClick={toggleSound}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${soundOn ? 'bg-green-500/70 hover:bg-green-500/90' : darkMode ? 'bg-gray-600 hover:bg-gray-700' : 'bg-gray-300 hover:bg-gray-400'}`}
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
            <>
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full transition-all duration-75 ${
                      beatNumber % 4 === i
                        ? i === 0 ? 'bg-orange-500 scale-125' : 'bg-white scale-125'
                        : darkMode ? 'bg-gray-600' : 'bg-gray-300'
                    }`}
                  />
                ))}
              </div>
              <span className={`text-sm font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {currentBar}
              </span>
            </>
          )}

          <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${connected ? 'text-green-400' : darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            {sessionFromParams}
          </span>
        </div>

        {sections.length === 0 ? (
          <p className="text-gray-500">No sections found</p>
        ) : (
          <div className="space-y-4">
            {(() => {
              const maxBars = Math.max(...sections.flatMap(s => s.rows.map(r => r.bars.length)), 1)
              const activeBar = running ? currentBar : -1
              return sections.map((s, i) => (
                <SectionView key={`${s.id}-${i}`} section={s} nextSection={sections[i + 1]} maxBars={maxBars} dark={darkMode} activeBar={activeBar} beatNumber={beatNumber} songId={id!} showGrid={showGrid} showLyrics={showLyrics} nextLabel={t('htmlSong.next')} onTitleClick={(barNumber) => {
                  if (running) {
                    setBarOffset(barNumber - Math.floor(beatNumber / 4))
                  } else {
                    setBarOffset(barNumber)
                    toggleRunning()
                  }
                  sendBar(barNumber)
                }} />
              ))
            })()}
          </div>
        )}

        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={`mt-6 w-full py-2 rounded-lg text-sm transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
        >
          &uarr; {t('htmlSong.backToTop')}
        </button>
      </div>
    </div>
  )
}
