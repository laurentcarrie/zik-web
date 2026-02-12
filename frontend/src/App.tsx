import { Routes, Route } from 'react-router-dom'
import { useEffect, useState, useRef, useCallback } from 'react'
import HomePage from './pages/HomePage'
import SongsPage from './pages/SongsPage'
import SongDetailPage from './pages/SongDetailPage'
import SettingsPage from './pages/SettingsPage'
import PressBookPage from './pages/PressBookPage'
import EditYmlPage from './pages/EditYmlPage'
import EditLyricsPage from './pages/EditLyricsPage'
import EditLilypondPage from './pages/EditLilypondPage'
import EditTexPage from './pages/EditTexPage'
import EditDrumsPage from './pages/EditDrumsPage'
import EditDrumsGlobalPage from './pages/EditDrumsGlobalPage'
import MasterPage from './pages/MasterPage'
import UpdatePage from './pages/UpdatePage'

function getEnabledContours(): number[] | null {
  try {
    const match = document.cookie.match(/(^| )enabledContours=([^;]+)/)
    if (match) return JSON.parse(decodeURIComponent(match[2]))
  } catch {}
  return null // null means all enabled
}

function getAnimationConfig(): string {
  try {
    const match = document.cookie.match(/(^| )animationConfig=([^;]+)/)
    if (match) {
      const config = JSON.parse(decodeURIComponent(match[2]))
      const params = new URLSearchParams()
      if (config.show_contour !== undefined) params.set('show_contour', String(config.show_contour))
      if (config.speed !== undefined) params.set('speed', String(config.speed))
      if (config.show_trace !== undefined) params.set('show_trace', String(config.show_trace))
      if (config.trace_length !== undefined) params.set('trace_length', String(config.trace_length))
      if (config.show_nh !== undefined) params.set('show_nh', String(config.show_nh))
      if (config.trace_width !== undefined) params.set('trace_width', String(config.trace_width))
      if (config.interpolation !== undefined) params.set('interpolation', String(config.interpolation))
      const qs = params.toString()
      return qs ? `?${qs}` : ''
    }
  } catch {}
  return ''
}

function getNextEnabledIndex(currentIndex: number, count: number): number {
  const enabled = getEnabledContours()
  if (!enabled || enabled.length === 0) {
    return (currentIndex + 1) % count
  }
  const currentPos = enabled.indexOf(currentIndex)
  if (currentPos === -1) {
    return enabled[0]
  }
  return enabled[(currentPos + 1) % enabled.length]
}

function getFirstEnabledIndex(): number {
  const enabled = getEnabledContours()
  return (enabled && enabled.length > 0) ? enabled[0] : 0
}

function isAnimationEnabled(): boolean {
  try {
    const match = document.cookie.match(/(^| )animationEnabled=([^;]+)/)
    if (match) return match[2] === 'true'
  } catch {}
  return true // enabled by default
}

function App() {
  const [animEnabled, setAnimEnabled] = useState(isAnimationEnabled)
  const [guitarUrl, setGuitarUrl] = useState<string | null>(null)
  const indexRef = useRef(0)
  const countRef = useRef(1)
  const namesRef = useRef<string[]>([])

  const loadEmbed = useCallback((index: number) => {
    const qs = getAnimationConfig()
    fetch(`/api/guitar-embed/${index}${qs}`)
      .then(r => r.json())
      .then(data => {
        setGuitarUrl(data.url + '?t=' + Date.now())
        countRef.current = data.count
        if (data.names) {
          namesRef.current = data.names
          window.dispatchEvent(new CustomEvent('contour-names', { detail: data.names }))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadEmbed(getFirstEnabledIndex())
  }, [loadEmbed])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'guitar-animation-complete') {
        indexRef.current = getNextEnabledIndex(indexRef.current, countRef.current)
        loadEmbed(indexRef.current)
      }
      if (e.data?.type === 'guitar-harmonics') {
        window.dispatchEvent(new CustomEvent('harmonics-update', {
          detail: { harmonics: e.data.harmonics, maxHarmonics: e.data.maxHarmonics }
        }))
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [loadEmbed])

  useEffect(() => {
    const handler = () => loadEmbed(indexRef.current)
    window.addEventListener('reload-animation', handler)
    return () => window.removeEventListener('reload-animation', handler)
  }, [loadEmbed])

  useEffect(() => {
    const handler = () => setAnimEnabled(isAnimationEnabled())
    window.addEventListener('animation-toggled', handler)
    return () => window.removeEventListener('animation-toggled', handler)
  }, [])

  return (
    <>
      {animEnabled && guitarUrl && (
        <iframe
          key={guitarUrl}
          src={guitarUrl}
          className="guitar-background"
          title="Guitar background"
        />
      )}
      <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/songs" element={<SongsPage />} />
      <Route path="/song/:id" element={<SongDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/press-book" element={<PressBookPage />} />
      <Route path="/edit-yml/:id" element={<EditYmlPage />} />
      <Route path="/edit-lyrics/:id/:sectionId" element={<EditLyricsPage />} />
      <Route path="/edit-lilypond/:id/:filename" element={<EditLilypondPage />} />
      <Route path="/edit-tex/:id/:filename" element={<EditTexPage />} />
      <Route path="/edit-drums/:id/:filename" element={<EditDrumsPage />} />
      <Route path="/edit-drums-global/:name" element={<EditDrumsGlobalPage />} />
      <Route path="/master/:id" element={<MasterPage />} />
      <Route path="/update" element={<UpdatePage />} />
    </Routes>
    </>
  )
}

export default App
