import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE } from '../config'

interface AudioClickTrackOptions {
  bpm: number
}

interface AudioClickTrackResult {
  loading: boolean
  loaded: boolean
  error: string | null
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  hasClicks: boolean
  detectedBeatNumber: number
  play: () => void
  pause: () => void
  stop: () => void
  seek: (time: number) => void
  setVolume: (v: number) => void
}

export function useAudioClickTrack(
  mp3Url: string | null,
  clicksUrl: string | null,
  opts: AudioClickTrackOptions,
): AudioClickTrackResult {
  const { bpm } = opts

  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [hasClicks, setHasClicks] = useState(false)
  const [detectedBeatNumber, setDetectedBeatNumber] = useState(-1)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const startTimeRef = useRef(0)
  const offsetRef = useRef(0)
  const playingRef = useRef(false)
  const pollRef = useRef<number | null>(null)
  const volumeRef = useRef(1)
  const timeUpdateRef = useRef<number | null>(null)
  const prevUrlRef = useRef<string | null>(null)

  // Click timestamps (absolute, in seconds)
  const clickTimesRef = useRef<number[]>([])
  const nextClickIdxRef = useRef(0)
  const beatCountRef = useRef(0)

  const bpmRef = useRef(bpm)
  bpmRef.current = bpm

  // Load MP3 + clicks.yml
  useEffect(() => {
    if (!mp3Url) {
      bufferRef.current = null
      clickTimesRef.current = []
      setLoaded(false)
      setLoading(false)
      setError(null)
      prevUrlRef.current = null
      return
    }
    if (mp3Url === prevUrlRef.current) return
    prevUrlRef.current = mp3Url

    setLoading(true)
    setLoaded(false)
    setError(null)

    const ctx = audioCtxRef.current || new AudioContext()
    audioCtxRef.current = ctx

    // Load MP3 and clicks in parallel
    const mp3Promise = fetch(`${API_BASE}${mp3Url}`)
      .then(res => {
        if (!res.ok) throw new Error(`MP3: HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then(data => ctx.decodeAudioData(data))

    const clicksPromise = clicksUrl
      ? fetch(`${API_BASE}${clicksUrl}`)
          .then(res => {
            if (!res.ok) throw new Error(`Clicks: HTTP ${res.status}`)
            return res.json() as Promise<number[]>
          })
      : Promise.resolve([] as number[])

    Promise.all([mp3Promise, clicksPromise])
      .then(([decoded, clicks]) => {
        bufferRef.current = decoded
        setDuration(decoded.duration)

        if (clicks.length > 0) {
          // clicks.yml: absolute timestamps in seconds
          clickTimesRef.current = clicks
          setHasClicks(true)

        } else {
          clickTimesRef.current = []
          setHasClicks(false)
        }

        setLoading(false)
        setLoaded(true)
      })
      .catch(err => {
        setError(err.message || 'Failed to load audio')
        setLoading(false)
      })
  }, [mp3Url, clicksUrl])

  // Clean up on URL change or unmount
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.stop() } catch { /* ignore */ }
        sourceRef.current = null
      }
      if (pollRef.current) cancelAnimationFrame(pollRef.current)
      if (timeUpdateRef.current) clearInterval(timeUpdateRef.current)
      playingRef.current = false
    }
  }, [mp3Url])

  const stopTracking = useCallback(() => {
    if (pollRef.current) {
      cancelAnimationFrame(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startTracking = useCallback(() => {
    stopTracking()
    const clicks = clickTimesRef.current
    if (clicks.length === 0) return

    const track = () => {
      if (!playingRef.current || !audioCtxRef.current) return

      const elapsed = offsetRef.current + (audioCtxRef.current.currentTime - startTimeRef.current)
      const idx = nextClickIdxRef.current

      if (idx < clicks.length && elapsed >= clicks[idx]) {
        setDetectedBeatNumber(beatCountRef.current)
        beatCountRef.current++
        nextClickIdxRef.current = idx + 1
      }

      pollRef.current = requestAnimationFrame(track)
    }
    pollRef.current = requestAnimationFrame(track)
  }, [stopTracking])

  const play = useCallback(() => {
    const ctx = audioCtxRef.current
    const buffer = bufferRef.current
    if (!ctx || !buffer) return

    if (ctx.state === 'suspended') ctx.resume()

    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch { /* ignore */ }
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const playbackGain = ctx.createGain()
    source.connect(playbackGain)
    playbackGain.gain.value = volumeRef.current
    playbackGain.connect(ctx.destination)

    sourceRef.current = source
    gainRef.current = playbackGain

    // Set click index for current offset
    const clicks = clickTimesRef.current
    const offset = offsetRef.current
    nextClickIdxRef.current = clicks.findIndex(t => t >= offset)
    if (nextClickIdxRef.current === -1) nextClickIdxRef.current = clicks.length

    startTimeRef.current = ctx.currentTime
    source.start(0, offset)

    source.onended = () => {
      if (playingRef.current) {
        playingRef.current = false
        setPlaying(false)
        stopTracking()
        if (timeUpdateRef.current) clearInterval(timeUpdateRef.current)
        offsetRef.current = 0
        setCurrentTime(0)
      }
    }

    playingRef.current = true
    setPlaying(true)
    startTracking()

    if (timeUpdateRef.current) clearInterval(timeUpdateRef.current)
    timeUpdateRef.current = window.setInterval(() => {
      if (!playingRef.current || !audioCtxRef.current) return
      const t = offsetRef.current + (audioCtxRef.current.currentTime - startTimeRef.current)
      setCurrentTime(t)
    }, 250)
  }, [startTracking, stopTracking])

  const pause = useCallback(() => {
    if (!playingRef.current || !audioCtxRef.current) return

    offsetRef.current += audioCtxRef.current.currentTime - startTimeRef.current

    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch { /* ignore */ }
      sourceRef.current = null
    }
    playingRef.current = false
    setPlaying(false)
    stopTracking()
    if (timeUpdateRef.current) clearInterval(timeUpdateRef.current)
  }, [stopTracking])

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch { /* ignore */ }
      sourceRef.current = null
    }
    playingRef.current = false
    setPlaying(false)
    stopTracking()
    if (timeUpdateRef.current) clearInterval(timeUpdateRef.current)
    offsetRef.current = 0
    beatCountRef.current = 0
    nextClickIdxRef.current = 0
    setDetectedBeatNumber(-1)
    setCurrentTime(0)
  }, [stopTracking])

  const seek = useCallback((time: number) => {
    const buffer = bufferRef.current
    if (!buffer) return
    const clampedTime = Math.max(0, Math.min(time, buffer.duration))

    const clicks = clickTimesRef.current
    const newIdx = clicks.findIndex(t => t >= clampedTime)
    nextClickIdxRef.current = newIdx === -1 ? clicks.length : newIdx
    beatCountRef.current = 0
    setDetectedBeatNumber(-1)

    if (playingRef.current) {
      if (sourceRef.current) {
        try { sourceRef.current.stop() } catch { /* ignore */ }
        sourceRef.current = null
      }
      playingRef.current = false
      stopTracking()
      if (timeUpdateRef.current) clearInterval(timeUpdateRef.current)

      offsetRef.current = clampedTime
      setCurrentTime(clampedTime)
      play()
    } else {
      offsetRef.current = clampedTime
      setCurrentTime(clampedTime)
    }
  }, [play, stopTracking])

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    volumeRef.current = clamped
    setVolumeState(clamped)
    if (gainRef.current) {
      gainRef.current.gain.value = clamped
    }
  }, [])

  return {
    loading,
    loaded,
    error,
    playing,
    currentTime,
    duration,
    volume,
    hasClicks,
    detectedBeatNumber,
    play,
    pause,
    stop,
    seek,
    setVolume,
  }
}
