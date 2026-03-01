import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { fetchSong, fetchSongs, fetchSongStructure } from '../api/songs'
import type { ParsedSection, ParsedChordRow, ChordGlyph } from '../api/songs'
import { useAuth } from '../context/AuthContext'
import { API_BASE } from '../config'
import { useAudioClickTrack } from '../hooks/useAudioClickTrack'

function Tip({ text, children, side }: { text: string; children: React.ReactNode; side?: 'bottom' | 'right' }) {
  const pos = side === 'right'
    ? 'left-full top-1/2 -translate-y-1/2 ml-1'
    : 'left-1/2 -translate-x-1/2 top-full mt-1'
  return (
    <span className="relative group">
      {children}
      <span className={`pointer-events-none absolute px-2 py-1 text-xs rounded bg-black/90 text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[60] ${pos}`}>
        {text}
      </span>
    </span>
  )
}

function useClickSync(sessionName: string | null, initialBpm?: number, initialSoundOn?: boolean) {
  const [bpm, setBpm] = useState(initialBpm || 120)
  const [running, setRunning] = useState(false)
  const [beatNumber, setBeatNumber] = useState(0)
  const [connected, setConnected] = useState(false)
  const [soundOn, setSoundOn] = useState(initialSoundOn ?? false)
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
  const soundOnRef = useRef(initialSoundOn ?? false)
  const initialBpmSentRef = useRef(false)
  const noSchedulerRef = useRef(false)

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

  const [visualLeadMs, setVisualLeadMs] = useState(0)
  const visualLeadRef = useRef(0)
  const [audioOffsetMs, setAudioOffsetMs] = useState(0)
  const audioOffsetRef = useRef(0)
  const muteRef = useRef(false)
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
          const audioTime = ctx.currentTime + (beatTime - now + audioOffsetRef.current) / 1000
          if (audioTime > ctx.currentTime && soundOnRef.current && !muteRef.current) {
            playClick(audioTime, scheduledUpToRef.current % 4 === 0)
          }
        }
        scheduledUpToRef.current++
      }
      // Visual: show the last beat that has actually been scheduled for audio
      const timeBeat = Math.max(0, Math.floor((now + visualLeadRef.current - localOrigin) / intervalMs))
      const visualBeat = Math.min(timeBeat, Math.max(0, scheduledUpToRef.current - 1))
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
        originRef.current = msg.origin
        setSessionSong(msg.song || '')
        setSessionBar(msg.bar || 0)
        if (noSchedulerRef.current) {
          // Audio track drives beats — don't overwrite beatNumber from server
          stopScheduler()
        } else {
          setBeatNumber(msg.beat_number)
          if (msg.running) {
            stopScheduler()
            scheduledUpToRef.current = msg.beat_number
            startScheduler()
          } else {
            stopScheduler()
          }
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
    if (sessionName && wsRef.current?.readyState === WebSocket.OPEN) {
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

  const resetToBarStart = useCallback(() => {
    if (sessionName && wsRef.current?.readyState === WebSocket.OPEN) {
      // Connected to session: don't override origin, server state drives sync.
      // Just restart scheduler to pick up the new barOffset immediately.
      stopScheduler()
      if (runningRef.current) startScheduler()
    } else {
      // Local-only mode: reset origin so beat restarts from 0
      stopScheduler()
      originRef.current = Date.now() + 30
      scheduledUpToRef.current = 0
      setBeatNumber(0)
      visualBeatRef.current = 0
      if (runningRef.current) startScheduler()
    }
  }, [sessionName, stopScheduler, startScheduler])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    stopScheduler()
  }, [stopScheduler])

  const setNoScheduler = useCallback((v: boolean) => { noSchedulerRef.current = v }, [])
  const getElapsedSeconds = useCallback(() => (Date.now() - originRef.current + clockOffsetRef.current) / 1000, [])

  const playClickNow = useCallback((isDownbeat: boolean) => {
    if (!soundOnRef.current || muteRef.current) return
    const ctx = ensureAudioCtx()
    playClick(ctx.currentTime, isDownbeat)
  }, [ensureAudioCtx, playClick])

  return { bpm, running, beatNumber, setBeatNumber, connected, soundOn, sessionSong, sessionBar, toggleSound, toggleRunning, changeBpm, sendSong, sendBar, resetToBarStart, visualLeadMs, setVisualLeadMs: (ms: number) => { visualLeadRef.current = ms; setVisualLeadMs(ms) }, audioOffsetMs, setAudioOffsetMs: (ms: number) => { audioOffsetRef.current = ms; setAudioOffsetMs(ms) }, muteRef, disconnect, setRunning, stopScheduler, setNoScheduler, getElapsedSeconds, playClickNow }
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

function ChordGrid({ row, color, maxBars, dark, activeBar, scrollBar, disableScroll, onBarClick }: { row: ParsedChordRow; color?: string; maxBars: number; dark: boolean; activeBar: number; scrollBar: number; disableScroll?: boolean; onBarClick?: (barNumber: number) => void }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const bgStyle = color ? { backgroundColor: color + 'e6' } : undefined
  const emptyCells = maxBars - row.bars.length
  const lastBarIdx = row.bars.length - 1
  const n = row.bars.length
  const totalBars = n * (row.repeat > 1 ? row.repeat : 1)
  const isInRow = row.bar_number > 0 && activeBar >= row.bar_number && activeBar < row.bar_number + totalBars
  const isScrollRow = row.bar_number > 0 && scrollBar >= row.bar_number && scrollBar < row.bar_number + totalBars
  const highlightIdx = isInRow ? (activeBar - row.bar_number) % n : -1

  useEffect(() => {
    if (isScrollRow && !disableScroll && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isScrollRow, disableScroll])

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
              className={`border px-2 py-1 text-black flex justify-around items-center relative transition-all duration-100 ${dark ? 'border-gray-600' : 'border-gray-300'} ${isActive ? 'border-2 border-yellow-400 rounded-md' : ''} ${onBarClick && row.bar_number > 0 ? 'cursor-pointer' : ''}`}
              style={cellStyle}
              onClick={() => onBarClick && row.bar_number > 0 && onBarClick(row.bar_number + j)}
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
  // \songwordfb{text} → text in a red box, highlight active bar (\songwordfb{} = whitespace)
  let fbCount = 0
  html = html.replace(/\\songwordfb\{([^}]*)\}/g, (_, text) => {
    const idx = fbCount++
    const isActive = idx === activeFbIndex
    const display = text || '&nbsp;'
    const style = isActive
      ? 'border: 2px solid red; border-radius: 3px; padding: 0 3px; color: white; background: red; font-weight: bold'
      : 'border: 1px solid red; border-radius: 3px; padding: 0 3px; color: red'
    const idAttr = isActive ? ' id="active-lyrics-fb"' : ''
    return `<span${idAttr} style="${style}">${display}</span>`
  })
  // \songwordl{text} → text in a blue box
  html = html.replace(/\\songwordl\{([^}]+)\}/g, '<span style="border: 1px solid #3b82f6; border-radius: 3px; padding: 0 3px; color: #3b82f6">$1</span>')
  // \songbookcomment{text} → red italic text
  html = html.replace(/\\songbookcomment\{([^}]+)\}/g, '<span style="color: coral; font-style: italic">$1</span>')
  // \tiny{text} → just text
  html = html.replace(/\\tiny\{([^}]*)\}/g, '$1')
  // \_ → _
  html = html.replace(/\\_/g, '_')
  // \textonehalf → ½
  html = html.replace(/\\textonehalf/g, '½')
  // ~ → non-breaking space (LaTeX convention)
  html = html.replace(/~/g, ' ')
  return html
}

function SectionLyrics({ songId, sectionId, dark, activeFbIndex, active, fontSize, italic }: { songId: string; sectionId: string; dark: boolean; activeFbIndex?: number; active?: boolean; fontSize?: string; italic?: boolean }) {
  const { data } = useQuery({
    queryKey: ['lyricsHtml', songId, sectionId],
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
      className={`whitespace-pre-wrap mt-1 mb-2 ${active ? '' : 'text-sm'} ${italic ? 'italic' : ''} ${dark ? 'text-gray-300' : 'text-gray-600'}`}
      style={active ? { fontSize: fontSize || '1.125rem' } : undefined}
      dangerouslySetInnerHTML={{ __html: htmlOfLatex(data, activeFbIndex) }}
    />
  )
}

function SectionView({ section, nextSection, maxBars, dark, activeBar, scrollBar, beatNumber, songId, showGrid, showLyrics, showAllLyrics, nextLabel, onTitleClick, running, flash, lyricsFontSize, editLyrics, bpm }: { section: ParsedSection; nextSection?: ParsedSection; maxBars: number; dark: boolean; activeBar: number; scrollBar: number; beatNumber: number; songId: string; showGrid: boolean; showLyrics: boolean; showAllLyrics: boolean; nextLabel: string; onTitleClick: (barNumber: number) => void; running: boolean; flash: boolean; lyricsFontSize: string; editLyrics: boolean; bpm: number }) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const { isAuthenticated } = useAuth()
  const cssColor = x11ToCSS(section.color)
  const firstBarNumber = section.rows.length > 0 ? section.rows[0].bar_number : 0
  const elapsedMinutes = bpm > 0 ? (firstBarNumber - 1) * 4 / bpm : 0
  const elapsedMin = Math.floor(elapsedMinutes)
  const elapsedSec = Math.floor((elapsedMinutes - elapsedMin) * 60)
  const sectionTotalBars = section.rows.reduce((sum, r) => sum + r.bars.length * (r.repeat > 1 ? r.repeat : 1), 0)
  const isActiveSection = activeBar >= 0 && section.rows.some(r => {
    const total = r.bars.length * (r.repeat > 1 ? r.repeat : 1)
    return r.bar_number > 0 && activeBar >= r.bar_number && activeBar < r.bar_number + total
  })
  const isScrollSection = scrollBar >= 0 && section.rows.some(r => {
    const total = r.bars.length * (r.repeat > 1 ? r.repeat : 1)
    return r.bar_number > 0 && scrollBar >= r.bar_number && scrollBar < r.bar_number + total
  })

  useEffect(() => {
    if (!isScrollSection) return
    if (showGrid && showLyrics) {
      requestAnimationFrame(() => {
        const el = document.getElementById('active-lyrics-fb')
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else if (sectionRef.current) {
          sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      })
    } else if (sectionRef.current) {
      sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isScrollSection, showGrid, showLyrics, scrollBar])

  return (
    <>
      <div
        ref={sectionRef}
        className={`transition-all duration-200 ${isActiveSection ? 'rounded-2xl p-4 ' + (dark ? 'bg-gray-800/70' : 'bg-gray-100/80') : 'rounded-lg pl-3'}`}
        style={cssColor ? { borderLeft: `4px solid ${cssColor}` } : undefined}
      >
        <div className={`flex items-center gap-3 mb-1 rounded-lg transition-all duration-100 ${isActiveSection && flash ? 'bg-white/50' : ''}`} style={isActiveSection && flash ? { boxShadow: '0 0 20px 5px rgba(255,255,255,0.4)' } : undefined}>
          <h2
            className={`font-bold cursor-pointer hover:underline transition-all duration-200 ${isActiveSection ? 'text-4xl' : 'text-lg'}`}
            style={{ color: cssColor || (dark ? '#d1d5db' : '#374151') }}
            onClick={() => firstBarNumber > 0 && onTitleClick(running ? firstBarNumber : Math.max(1, firstBarNumber - 1))}
          >{section.title}</h2>
          <span className={`text-xs tabular-nums ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{elapsedMin}:{String(elapsedSec).padStart(2, '0')}</span>
          {editLyrics && isAuthenticated && (
            <Link
              to={`/edit-lyrics/${songId}/${section.id}`}
              className={`p-1 rounded transition-colors ${isAuthenticated ? (dark ? 'text-gray-400 hover:text-blue-400 hover:bg-gray-700' : 'text-gray-400 hover:text-blue-600 hover:bg-gray-200') : 'pointer-events-none opacity-30'}`}
              tabIndex={isAuthenticated ? 0 : -1}
              title="Edit lyrics"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
              </svg>
            </Link>
          )}
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
        {showLyrics && (isActiveSection || isScrollSection || showAllLyrics) && (
          <div className="text-center">
            <SectionLyrics songId={songId} sectionId={section.id} dark={dark} activeFbIndex={isActiveSection ? activeBar - firstBarNumber : undefined} active={isActiveSection || isScrollSection} fontSize={lyricsFontSize} />
          </div>
        )}
        {showGrid && section.rows.length > 0 && (
          <div>
            {section.rows.map((row, j) => (
              <ChordGrid key={j} row={row} color={cssColor} maxBars={maxBars} dark={dark} activeBar={activeBar} scrollBar={scrollBar} disableScroll={showLyrics} onBarClick={onTitleClick} />
            ))}
          </div>
        )}
      </div>
      {showLyrics && (isActiveSection || isScrollSection) && !showAllLyrics && nextSection && (
        <div className={`mt-3 pl-3 italic text-center opacity-70 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
          <span className={`text-base font-semibold ${dark ? 'text-gray-400' : 'text-gray-400'}`}>
            {nextLabel}: {nextSection.title}
          </span>
          <SectionLyrics songId={songId} sectionId={nextSection.id} dark={dark} italic />
        </div>
      )}
    </>
  )
}

function cookieBool(name: string, defaultValue: boolean): boolean {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  if (!m) return defaultValue
  return decodeURIComponent(m[2]) !== 'false'
}

export default function HtmlSongPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const [sessionFromParams] = useState(() => {
    const m = document.cookie.match(/(^| )clickSyncSession=([^;]+)/)
    return m ? decodeURIComponent(m[2]) || null : null
  })
  const [darkMode, setDarkMode] = useState(true)
  const [barOffset, setBarOffset] = useState(0)
  const [showGrid, setShowGrid] = useState(() => cookieBool('htmlSongGrid', true))
  const [showLyrics, setShowLyrics] = useState(true)
  const [flash, setFlash] = useState(false)
  const [flashEnabled, setFlashEnabled] = useState(() => cookieBool('htmlSongFlash', true))
  const [showAllLyrics, setShowAllLyrics] = useState(() => cookieBool('htmlSongAllLyrics', false))
  const [initialSoundOn] = useState(() => cookieBool('htmlSongSound', false))
  const [editLyrics] = useState(() => cookieBool('htmlSongEditLyrics', false))
  const [highlight, setHighlight] = useState(true)
  const [showOffsets, setShowOffsets] = useState(false)
  const [bannerVertical, setBannerVertical] = useState(() => cookieBool('htmlSongBannerVertical', false))
  const [rangeStart, setRangeStart] = useState(0)
  const [rangeEnd, setRangeEnd] = useState(0)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [showSectionPicker, setShowSectionPicker] = useState(false)
  const tapTimesRef = useRef<number[]>([])
  const [lyricsFontSize] = useState(() => {
    const m = document.cookie.match(/(^| )htmlSongLyricsFontSize=([^;]+)/)
    return m ? decodeURIComponent(m[2]) : '1.125rem'
  })

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

  const sections = structure?.sections ?? []

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
  const { bpm, running, beatNumber, setBeatNumber, connected, soundOn, sessionSong, sessionBar, toggleSound, toggleRunning, changeBpm, sendSong, sendBar, resetToBarStart, visualLeadMs, setVisualLeadMs, audioOffsetMs, setAudioOffsetMs, muteRef, setRunning: setClickSyncRunning, stopScheduler, setNoScheduler, getElapsedSeconds, playClickNow } = useClickSync(sessionFromParams, songTempo, initialSoundOn)
  muteRef.current = !highlight

  // Audio click track: switch to song-with-click.mp3 when metronome is on
  const hasClicksMp3 = !!song?.mp3_with_clicks_url
  const effectiveMp3Url = (soundOn && hasClicksMp3 ? song?.mp3_with_clicks_url : song?.mp3_url) ?? null
  const audioTrack = useAudioClickTrack(effectiveMp3Url, song?.clicks_url ?? null, { bpm })
  const hasAudioTrack = !!effectiveMp3Url && audioTrack.loaded
  const audioTrackEnabled = hasAudioTrack
  const [audioMuted, setAudioMuted] = useState(false)
  const useAudioForBeats = hasAudioTrack && audioTrack.playing && audioTrack.hasClicks

  // Audio-aware seek to bar
  const seekToBar = useCallback((barNumber: number) => {
    if (audioTrackEnabled && hasAudioTrack) {
      const time = (barNumber - 1) * 4 * 60 / bpm
      audioTrack.seek(time)
      setBarOffset(barNumber)
      setBeatNumber(0)
    }
  }, [audioTrackEnabled, hasAudioTrack, bpm, audioTrack, setBarOffset, setBeatNumber])

  // Drive beatNumber from audio click detection (detectedBeatNumber is -1 until first click)
  useEffect(() => {
    if (useAudioForBeats && audioTrack.detectedBeatNumber >= 0) {
      setBeatNumber(audioTrack.detectedBeatNumber)
      // Skip generated beeps when ticks are baked into the MP3
      if (!hasClicksMp3) {
        playClickNow(audioTrack.detectedBeatNumber % 4 === 0)
      }
    }
  }, [useAudioForBeats, audioTrack.detectedBeatNumber, setBeatNumber, playClickNow, hasClicksMp3])

  // Tell useClickSync to skip scheduler when audio track will drive beats
  useEffect(() => {
    setNoScheduler(audioTrackEnabled && hasAudioTrack)
  }, [audioTrackEnabled, hasAudioTrack, setNoScheduler])

  // React to session running changes: start/stop audio track
  useEffect(() => {
    if (!sessionFromParams || !audioTrackEnabled || !hasAudioTrack) return
    if (running && !audioTrack.playing) {
      // Session started (from any client) → start audio
      stopScheduler()
      const elapsed = getElapsedSeconds()
      if (elapsed > 0.5) {
        setBeatNumber(0)
        if (audioTrack.hasClicks) setBarOffset(1)
        audioTrack.seek(elapsed)
      } else {
        const startBar = sections[rangeStart]?.rows[0]?.bar_number ?? 1
        seekToBar(startBar)
        audioTrack.play()
      }
    } else if (!running && audioTrack.playing) {
      // Session stopped → stop audio
      audioTrack.stop()
    }
  }, [running, sessionFromParams, audioTrackEnabled, hasAudioTrack, audioTrack, stopScheduler, setBeatNumber, getElapsedSeconds, sections, rangeStart, seekToBar])

  // Update BPM when song tempo loads (async query resolves after hook init)
  const songTempoAppliedRef = useRef(false)
  useEffect(() => {
    if (songTempo && !songTempoAppliedRef.current) {
      songTempoAppliedRef.current = true
      changeBpm(songTempo)
    }
  }, [songTempo, changeBpm])

  const handleTap = useCallback(() => {
    const now = performance.now()
    const taps = tapTimesRef.current
    if (taps.length > 0 && now - taps[taps.length - 1] > 3000) {
      tapTimesRef.current = []
    }
    tapTimesRef.current.push(now)
    if (tapTimesRef.current.length >= 2) {
      const intervals = tapTimesRef.current.slice(-8).reduce((acc: number[], t, i, arr) =>
        i > 0 ? [...acc, t - arr[i - 1]] : acc, [])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      changeBpm(Math.round(60000 / avg))
    }
  }, [changeBpm])

  const currentBar = Math.floor(beatNumber / 4) + barOffset

  // Re-initialize range when song changes or sections load
  useEffect(() => {
    setRangeStart(0)
    setRangeEnd(Math.max(0, sections.length - 1))
  }, [id, sections.length])

  const activeSectionIndex = useMemo(() => {
    if (!running) return -1
    return sections.findIndex(s => s.rows.some(r => {
      const total = r.bars.length * (r.repeat > 1 ? r.repeat : 1)
      return r.bar_number > 0 && currentBar >= r.bar_number && currentBar < r.bar_number + total
    }))
  }, [running, currentBar, sections])

  const jumpToSection = useCallback((sectionIndex: number) => {
    if (sectionIndex < 0 || sectionIndex >= sections.length) return
    const s = sections[sectionIndex]
    const firstBar = s.rows.length > 0 ? s.rows[0].bar_number : 0
    if (firstBar <= 0) return
    if (audioTrackEnabled && hasAudioTrack) {
      seekToBar(firstBar)
      stopScheduler()
      audioTrack.play()
      setClickSyncRunning(true)
      sendBar(firstBar)
    } else if (running) {
      setBarOffset(firstBar)
      resetToBarStart()
      sendBar(firstBar)
    } else {
      setBarOffset(firstBar - 1)
      toggleRunning()
      sendBar(firstBar - 1)
    }
  }, [sections, running, beatNumber, setBarOffset, sendBar, resetToBarStart, toggleRunning, audioTrackEnabled, hasAudioTrack, seekToBar, audioTrack, stopScheduler, setClickSyncRunning])

  // Audio-aware toggle for start/stop
  const handleToggleRunning = useCallback(() => {
    if (audioTrackEnabled && hasAudioTrack) {
      if (sessionFromParams) {
        // In session: go through WebSocket — audio starts reactively from running state change
        toggleRunning()
      } else {
        // Local-only: direct control
        if (audioTrack.playing) {
          audioTrack.pause()
          setClickSyncRunning(false)
        } else {
          const startBar = sections[rangeStart]?.rows[0]?.bar_number ?? 1
          stopScheduler()
          seekToBar(startBar)
          audioTrack.play()
          setClickSyncRunning(true)
        }
      }
    } else {
      if (audioTrack.playing) audioTrack.stop()
      if (!running) {
        jumpToSection(rangeStart)
      } else {
        toggleRunning()
      }
    }
  }, [audioTrackEnabled, hasAudioTrack, audioTrack, toggleRunning, setClickSyncRunning, stopScheduler, sessionFromParams, sections, rangeStart, seekToBar, running, jumpToSection])

  // When changing song locally (prev/next buttons): stop metronome, reset bar, push to session
  const prevIdRef = useRef(id)
  useEffect(() => {
    if (prevIdRef.current !== id) {
      prevIdRef.current = id
      songTempoAppliedRef.current = false
      setBarOffset(0)
      setShowSectionPicker(false)
      if (audioTrack.playing) audioTrack.stop()
      if (running) toggleRunning()
      // Push song change to session (only when user navigates, not on initial mount)
      if (connected && id) {
        sendSong(id)
        sendBar(0)
      }
    }
  }, [id, connected, running, sendSong, sendBar, toggleRunning, audioTrack])

  // Follow song changes from other clients (or adopt session song on connect)
  const prevSessionSongRef = useRef<string | null>(null)
  useEffect(() => {
    if (!connected || sessionSong === null) return
    const prev = prevSessionSongRef.current
    prevSessionSongRef.current = sessionSong
    if (prev === sessionSong) return
    if (prev === null) {
      // Initial connect: always push our song to the session
      if (id && sessionSong !== id) sendSong(id)
      return
    }
    if (sessionSong === '' || sessionSong === id) {
      if (id && sessionSong !== id) sendSong(id)
      return
    }
    navigate(`/htmlsong/${sessionSong}`, { replace: true })
  }, [connected, sessionSong, id, navigate, sendSong])

  // Sync bar offset from server when another client jumps to a section
  useEffect(() => {
    if (connected && sessionBar > 0) {
      const expectedBar = Math.floor(beatNumber / 4) + barOffset
      if (sessionBar !== expectedBar) {
        setBarOffset(sessionBar - Math.floor(beatNumber / 4))
      }
    }
  }, [connected, sessionBar])

  // Flash screen on downbeat
  useEffect(() => {
    if (flashEnabled && running && beatNumber % 4 === 0) {
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 150)
      return () => clearTimeout(timer)
    }
  }, [running, beatNumber, flashEnabled])

  // Stop metronome after the last bar in the range (or loop)
  const stoppedAtEndRef = useRef(false)
  const loopingRef = useRef(false)
  const rangeLastBar = useMemo(() => {
    let max = 0
    for (let i = rangeStart; i <= rangeEnd && i < sections.length; i++) {
      for (const r of sections[i].rows) {
        const last = r.bar_number + r.bars.length * (r.repeat > 1 ? r.repeat : 1) - 1
        if (last > max) max = last
      }
    }
    return max
  }, [sections, rangeStart, rangeEnd])
  useEffect(() => {
    if (running && rangeLastBar > 0 && currentBar > rangeLastBar && !stoppedAtEndRef.current && !loopingRef.current) {
      if (loopEnabled) {
        loopingRef.current = true
        const firstBar = sections[rangeStart]?.rows[0]?.bar_number ?? 1
        const loopBar = Math.max(1, firstBar - 1)
        if (audioTrackEnabled && hasAudioTrack) {
          seekToBar(loopBar)
          sendBar(loopBar)
        } else if (running) {
          setBarOffset(loopBar)
          resetToBarStart()
          sendBar(loopBar)
        }
      } else {
        stoppedAtEndRef.current = true
        if (audioTrackEnabled && audioTrack.playing) {
          audioTrack.stop()
          setClickSyncRunning(false)
        } else {
          toggleRunning()
        }
        setBarOffset(0)
      }
    }
    if (running && currentBar <= rangeLastBar) {
      stoppedAtEndRef.current = false
      loopingRef.current = false
    }
  }, [currentBar, running, rangeLastBar, toggleRunning, audioTrackEnabled, audioTrack, setClickSyncRunning, loopEnabled, rangeStart, sections, hasAudioTrack, seekToBar, stopScheduler, sendBar, setBarOffset, resetToBarStart])


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

  const tipSide = bannerVertical ? 'right' as const : 'bottom' as const

  return (
    <div className={`min-h-screen p-4 md:p-8 relative ${bannerVertical ? 'ml-12' : ''}`}>
      <div className={`fixed z-50 flex items-center justify-center ${bannerVertical ? 'top-0 left-0 bottom-0 flex-col gap-1.5 py-2 px-1.5' : 'top-0 left-0 right-0 flex-wrap gap-1.5 sm:gap-3 py-1.5 sm:py-2 px-2 sm:px-4'} ${darkMode ? 'bg-gray-900/95' : 'bg-white/95'} ${bannerVertical ? (darkMode ? 'border-r border-gray-700' : 'border-r border-gray-200') : (darkMode ? 'border-b border-gray-700' : 'border-b border-gray-200')}`}>
        <span className={`text-sm font-mono font-bold tabular-nums ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {currentBar}
        </span>
        <Tip side={tipSide} text={t('htmlSong.tipDecreaseTempo')}>
          <button
            onClick={() => changeBpm(Math.max(20, Math.round(bpm) - 1))}
            className={`px-2 py-1.5 rounded-lg text-sm font-bold transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          >
            &minus;
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipTapTempo')}>
          <button
            onClick={handleTap}
            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors cursor-pointer ${darkMode ? 'bg-orange-600 hover:bg-orange-500 text-white' : 'bg-orange-500 hover:bg-orange-400 text-white'}`}
          >
            {Math.round(bpm)}
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipIncreaseTempo')}>
          <button
            onClick={() => changeBpm(Math.min(300, Math.round(bpm) + 1))}
            className={`px-2 py-1.5 rounded-lg text-sm font-bold transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          >
            +
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipPrevSection')}>
          <button
            onClick={() => jumpToSection(Math.max(rangeStart, activeSectionIndex - 1))}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipResetBeat')}>
          <button
            onClick={() => jumpToSection(Math.max(rangeStart, activeSectionIndex))}
            className={`px-2 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          >
            ●
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipNextSection')}>
          <button
            onClick={() => jumpToSection(Math.min(rangeEnd, (activeSectionIndex >= 0 ? activeSectionIndex : rangeStart - 1) + 1))}
            disabled={activeSectionIndex >= rangeEnd}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" /></svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipSectionRange')}>
          <button
            onClick={() => setShowSectionPicker(!showSectionPicker)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${rangeStart > 0 || rangeEnd < sections.length - 1 ? 'bg-orange-600 text-white' : showSectionPicker ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M3 5h2v14H3zm16 0h2v14h-2zM7 11h10v2H7z" /></svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={running ? t('htmlSong.tipStop') : t('htmlSong.tipStart')}>
          <button
            onClick={handleToggleRunning}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${running ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">{running ? <path d="M6 6h12v12H6z" /> : <path d="M8 5v14l11-7z" />}</svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipLoop')}>
          <button
            onClick={() => setLoopEnabled(!loopEnabled)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${loopEnabled ? 'bg-green-600 text-white' : darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" /></svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipSound')}>
          <button
            onClick={toggleSound}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${soundOn ? 'bg-green-500/70 hover:bg-green-500/90' : darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
              <path d="M12,1.75L8.57,2.67L4.06,19.53C4.03,19.68 4,19.84 4,20C4,21.11 4.89,22 6,22H18C19.11,22 20,21.11 20,20C20,19.84 19.97,19.68 19.94,19.53L18.58,14.42L17,16L17.2,17H13.41L16.25,14.16L14.84,12.75L10.59,17H6.8L10.29,4H13.71L15.17,9.43L16.8,7.79L15.43,2.67L12,1.75M11.25,5V14.75L12.75,13.25V5H11.25M19.79,7.8L16.96,10.63L16.25,9.92L14.84,11.34L17.66,14.16L19.08,12.75L18.37,12.04L21.2,9.21L19.79,7.8Z" />
              {!soundOn && (
                <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={song?.mp3_url ? t('htmlSong.tipAudioTrack') : 'No song.mp3'}>
          <button
            onClick={() => {
              if (!hasAudioTrack) return
              const next = !audioMuted
              setAudioMuted(next)
              audioTrack.setVolume(next ? 0 : 1)
            }}
            disabled={!song?.mp3_url}
            className={`p-1.5 rounded-lg transition-colors relative ${!song?.mp3_url ? (darkMode ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-gray-300 text-gray-400 cursor-not-allowed') : hasAudioTrack && !audioMuted ? 'bg-purple-600 text-white cursor-pointer' : darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 cursor-pointer' : 'bg-gray-200 hover:bg-gray-300 text-gray-700 cursor-pointer'}`}
          >
            {audioTrack.loading && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </span>
            )}
            <svg viewBox="0 0 24 24" fill="currentColor" className={`w-4 h-4 ${audioTrack.loading ? 'opacity-30' : ''}`}>
              <path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z" />
            </svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipFlash')}>
          <button
            onClick={() => setFlashEnabled(!flashEnabled)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${flashEnabled ? 'bg-yellow-500/70 hover:bg-yellow-500/90' : darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
              <path d="M7 2v11h3v9l7-12h-4l4-8z" />
            </svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipGrid')}>
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showGrid ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z" /></svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipLyrics')}>
          <button
            onClick={() => setShowLyrics(!showLyrics)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showLyrics ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h12v2H3z" /></svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipAllLyrics')}>
          <button
            onClick={() => setShowAllLyrics(!showAllLyrics)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showAllLyrics ? 'bg-purple-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M3 4h18v2H3zm0 4h18v2H3zm0 4h18v2H3zm0 4h18v2H3zm0 4h18v2H3z" /></svg>
          </button>
        </Tip>
        <Tip side={tipSide} text={t('htmlSong.tipHighlight')}>
          <button
            onClick={() => setHighlight(!highlight)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${highlight ? 'bg-yellow-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M11 7l6 6-8.5 8.5H2v-6.5L11 7zm7-2l-2-2a1.5 1.5 0 00-2.12 0L12 5l6 6 2-1.88A1.5 1.5 0 0018 5z" /></svg>
          </button>
        </Tip>
        <button
          onClick={() => setShowOffsets(!showOffsets)}
          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showOffsets ? (darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-300 text-gray-700') : darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-400' : 'bg-gray-200 hover:bg-gray-300 text-gray-500'}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
        </button>
        {showOffsets && (
          <>
            <Tip side={tipSide} text={t('htmlSong.tipDecreaseVisualLead')}>
              <button
                onClick={() => setVisualLeadMs(visualLeadMs - 10)}
                className={`px-1.5 py-1 text-xs rounded font-mono transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
              >
                &minus;
              </button>
            </Tip>
            <Tip side={tipSide} text={t('htmlSong.tipVisualLead')}>
              <span className={`text-xs font-mono tabular-nums ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {visualLeadMs}ms
              </span>
            </Tip>
            <Tip side={tipSide} text={t('htmlSong.tipIncreaseVisualLead')}>
              <button
                onClick={() => setVisualLeadMs(visualLeadMs + 10)}
                className={`px-1.5 py-1 text-xs rounded font-mono transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
              >
                +
              </button>
            </Tip>
            <Tip side={tipSide} text={t('htmlSong.tipDecreaseAudioOffset')}>
              <button
                onClick={() => setAudioOffsetMs(audioOffsetMs - 10)}
                className={`px-1.5 py-1 text-xs rounded font-mono transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
              >
                &minus;
              </button>
            </Tip>
            <Tip side={tipSide} text={t('htmlSong.tipAudioOffset')}>
              <span className={`text-xs font-mono tabular-nums ${darkMode ? 'text-orange-400' : 'text-orange-500'}`}>
                {audioOffsetMs > 0 ? '+' : ''}{audioOffsetMs}ms
              </span>
            </Tip>
            <Tip side={tipSide} text={t('htmlSong.tipIncreaseAudioOffset')}>
              <button
                onClick={() => setAudioOffsetMs(audioOffsetMs + 10)}
                className={`px-1.5 py-1 text-xs rounded font-mono transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
              >
                +
              </button>
            </Tip>
          </>
        )}
        <button
          onClick={() => { const next = !bannerVertical; setBannerVertical(next); document.cookie = `htmlSongBannerVertical=${next};path=/;max-age=${365 * 86400}` }}
          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-400' : 'bg-gray-200 hover:bg-gray-300 text-gray-500'}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">{bannerVertical ? <path d="M4 4h16v2H4zm0 9h16v2H4zm0 9h16v2H4z" /> : <path d="M4 4h2v16H4zm9 0h2v16h-2zm9 0h2v16h-2z" />}</svg>
        </button>
      </div>
      {audioTrackEnabled && hasAudioTrack && audioTrack.duration > 0 && !bannerVertical && (
        <div className="fixed z-50 left-0 right-0" style={{ top: '44px' }}>
          <div
            className="h-1 bg-purple-500 transition-all duration-200"
            style={{ width: `${(audioTrack.currentTime / audioTrack.duration) * 100}%` }}
          />
        </div>
      )}
      {!bannerVertical && <div className="h-20 sm:h-12" />}
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

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${connected ? 'text-green-400' : darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            {connected ? sessionFromParams : t('htmlSong.notConnected')}
          </span>
          <span className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            <span className="flex items-center gap-1" title="song.mp3">
              <span className={`inline-block w-2 h-2 rounded-full ${song?.mp3_url ? 'bg-green-400' : 'bg-gray-600'}`} />
              mp3
            </span>
            <span className="flex items-center gap-1" title="clicks.yml">
              <span className={`inline-block w-2 h-2 rounded-full ${song?.clicks_url ? 'bg-green-400' : 'bg-gray-600'}`} />
              clicks
            </span>
            <span className="flex items-center gap-1" title="song-with-click.mp3">
              <span className={`inline-block w-2 h-2 rounded-full ${song?.mp3_with_clicks_url ? 'bg-green-400' : 'bg-gray-600'}`} />
              mp3/click
            </span>
          </span>
        </div>

        {sections.length === 0 ? (
          <p className="text-gray-500">No sections found</p>
        ) : (
          <div className="space-y-4">
            {(() => {
              const maxBars = Math.max(...sections.flatMap(s => s.rows.map(r => r.bars.length)), 1)
              const activeBar = running && highlight ? currentBar : -1
              const scrollBar = running ? currentBar : -1
              return sections.map((s, i) => (
                <SectionView key={`${s.id}-${i}`} section={s} nextSection={sections[i + 1]} maxBars={maxBars} dark={darkMode} activeBar={activeBar} scrollBar={scrollBar} beatNumber={beatNumber} songId={id!} showGrid={showGrid} showLyrics={showLyrics} showAllLyrics={showAllLyrics} nextLabel={t('htmlSong.next')} running={running} flash={flash} lyricsFontSize={lyricsFontSize} editLyrics={editLyrics} bpm={bpm} onTitleClick={(barNumber) => {
                  if (audioTrackEnabled && hasAudioTrack) {
                    seekToBar(barNumber)
                    if (!audioTrack.playing) {
                      stopScheduler()
                      audioTrack.play()
                      setClickSyncRunning(true)
                    }
                    sendBar(barNumber)
                  } else if (running) {
                    setBarOffset(barNumber)
                    resetToBarStart()
                    sendBar(barNumber)
                  } else {
                    setBarOffset(barNumber - 1)
                    handleToggleRunning()
                    sendBar(barNumber - 1)
                  }
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
      {showSectionPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setShowSectionPicker(false)}>
          <div className="bg-gray-900 rounded-2xl p-4 max-w-sm w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-bold text-lg">Section range</h3>
              <div className="flex items-center gap-2">
                {(rangeStart > 0 || rangeEnd < sections.length - 1) && (
                  <button
                    onClick={() => { setRangeStart(0); setRangeEnd(sections.length - 1) }}
                    className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 cursor-pointer"
                  >
                    Reset
                  </button>
                )}
                <button onClick={() => setShowSectionPicker(false)} className="text-gray-400 hover:text-white text-2xl leading-none cursor-pointer px-1">&times;</button>
              </div>
            </div>
            {sections.map((s, i) => {
              const inRange = i >= rangeStart && i <= rangeEnd
              const cssColor = x11ToCSS(s.color)
              return (
                <div key={i} className={`flex items-center gap-2 py-1.5 px-2 rounded-lg mb-1 ${inRange ? 'bg-gray-700/50' : ''}`}>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cssColor || '#888' }} />
                  <span className={`flex-1 text-sm truncate ${inRange ? 'text-white' : 'text-gray-500'}`}>{s.title}</span>
                  <button
                    onClick={() => { setRangeStart(i); if (i > rangeEnd) setRangeEnd(i) }}
                    className={`px-2 py-0.5 text-xs rounded cursor-pointer ${i === rangeStart ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                  >
                    {t('htmlSong.sectionRangeFrom')}
                  </button>
                  <button
                    onClick={() => { setRangeEnd(i); if (i < rangeStart) setRangeStart(i) }}
                    className={`px-2 py-0.5 text-xs rounded cursor-pointer ${i === rangeEnd ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                  >
                    {t('htmlSong.sectionRangeTo')}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
