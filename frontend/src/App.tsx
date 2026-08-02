import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState, useRef, useCallback } from 'react'
import HomePage from './pages/HomePage'
import SongsPage from './pages/SongsPage'
import { API_BASE } from './config'

const SongDetailPage = lazy(() => import('./pages/SongDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const PressBookPage = lazy(() => import('./pages/PressBookPage'))
const EditYmlPage = lazy(() => import('./pages/EditYmlPage'))
const EditLyricsPage = lazy(() => import('./pages/EditLyricsPage'))
const EditLilypondPage = lazy(() => import('./pages/EditLilypondPage'))
const EditTexPage = lazy(() => import('./pages/EditTexPage'))
const EditDrumsPage = lazy(() => import('./pages/EditDrumsPage'))
const EditClicksPage = lazy(() => import('./pages/EditClicksPage'))
const EditDrumsGlobalPage = lazy(() => import('./pages/EditDrumsGlobalPage'))
const MasterPage = lazy(() => import('./pages/MasterPage'))
const UpdatePage = lazy(() => import('./pages/UpdatePage'))
const HtmlSongPage = lazy(() => import('./pages/HtmlSongPage'))
const SnippetsPage = lazy(() => import('./pages/SnippetsPage'))
const ClickSyncPage = lazy(() => import('./pages/ClickSyncPage'))
const ClickSyncSessionPage = lazy(() => import('./pages/ClickSyncSessionPage'))

function getEnabledContours(): number[] {
  try {
    const match = document.cookie.match(/(^| )enabledContours=([^;]+)/)
    if (match) {
      const parsed = JSON.parse(decodeURIComponent(match[2]))
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {}
  return [] // empty means all enabled
}

function getNextIndex(currentIndex: number, count: number): number {
  const enabled = getEnabledContours()
  if (enabled.length === 0) return (currentIndex + 1) % count
  const currentPos = enabled.indexOf(currentIndex)
  const nextPos = (currentPos + 1) % enabled.length
  return enabled[nextPos]
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
  const [animError, setAnimError] = useState<string | null>(null)
  const indexRef = useRef(0)
  const countRef = useRef(1)
  const namesRef = useRef<string[]>([])

  const embedCache = useRef<Map<number, { url: string; count: number; names?: string[] }>>(new Map())

  const loadEmbed = useCallback((index: number, bustCache = false) => {
    const cached = embedCache.current.get(index)
    if (cached && !bustCache) {
      setAnimError(null)
      setGuitarUrl(cached.url + '?t=' + Date.now())
      countRef.current = cached.count
      if (cached.names) {
        namesRef.current = cached.names
        window.dispatchEvent(new CustomEvent('contour-names', { detail: cached.names }))
      }
      return
    }
    fetch(`${API_BASE}/api/guitar-embed/${index}`)
      .then(async r => {
        if (!r.ok) {
          const text = await r.text()
          throw new Error(text || `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then(data => {
        embedCache.current.set(index, data)
        setAnimError(null)
        setGuitarUrl(data.url + '?t=' + Date.now())
        countRef.current = data.count
        if (data.names) {
          namesRef.current = data.names
          window.dispatchEvent(new CustomEvent('contour-names', { detail: data.names }))
        }
      })
      .catch(e => setAnimError(e.message))
  }, [])

  useEffect(() => {
    const enabled = getEnabledContours()
    const startIndex = enabled.length > 0 ? enabled[0] : 0
    indexRef.current = startIndex
    loadEmbed(startIndex)
  }, [loadEmbed])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'guitar-animation-complete') {
        const next = getNextIndex(indexRef.current, countRef.current)
        indexRef.current = next
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
    const handler = () => loadEmbed(indexRef.current, true)
    window.addEventListener('reload-animation', handler)
    return () => window.removeEventListener('reload-animation', handler)
  }, [loadEmbed])

  useEffect(() => {
    const handler = (e: Event) => {
      const enabled = (e as CustomEvent).detail as number[]
      const startIndex = enabled.length > 0 ? enabled[0] : 0
      indexRef.current = startIndex
      loadEmbed(startIndex)
    }
    window.addEventListener('enabled-contours-changed', handler)
    return () => window.removeEventListener('enabled-contours-changed', handler)
  }, [loadEmbed])

  useEffect(() => {
    const handler = () => setAnimEnabled(isAnimationEnabled())
    window.addEventListener('animation-toggled', handler)
    return () => window.removeEventListener('animation-toggled', handler)
  }, [])

  return (
    <>
      <a
        href="/root"
        className="fixed top-3 left-3 px-2 py-1 text-xs text-gray-400 bg-black/40 rounded
                   backdrop-blur-sm hover:bg-black/60 hover:text-white transition-colors no-underline z-50"
      >root</a>
      {animError && (
        <div style={{
          position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)',
          background: '#d32f2f', color: 'white', padding: '8px 16px',
          borderRadius: 6, zIndex: 9999, fontSize: 14, maxWidth: '80vw',
          wordBreak: 'break-word'
        }}>
          Animation error: {animError}
        </div>
      )}
      {animEnabled && guitarUrl && (
        <iframe
          key={guitarUrl}
          src={guitarUrl}
          className="guitar-background"
          title="Guitar background"
        />
      )}
      <Suspense>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/songs" element={<SongsPage />} />
          <Route path="/song/:id" element={<SongDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/press-book" element={<PressBookPage />} />
          <Route path="/htmlsong/:id" element={<HtmlSongPage />} />
          <Route path="/snippets/:id" element={<SnippetsPage />} />
          <Route path="/edit-yml/:id" element={<EditYmlPage />} />
          <Route path="/edit-lyrics/:id/:sectionId" element={<EditLyricsPage />} />
          <Route path="/edit-lilypond/:id/:filename" element={<EditLilypondPage />} />
          <Route path="/edit-tex/:id/:filename" element={<EditTexPage />} />
          <Route path="/edit-clicks/:id" element={<EditClicksPage />} />
          <Route path="/edit-drums/:id/:filename" element={<EditDrumsPage />} />
          <Route path="/edit-drums-global/:name" element={<EditDrumsGlobalPage />} />
          <Route path="/master/:id" element={<MasterPage />} />
          <Route path="/update" element={<UpdatePage />} />
          <Route path="/click" element={<ClickSyncPage />} />
          <Route path="/click/:session" element={<ClickSyncSessionPage />} />
        </Routes>
      </Suspense>
    </>
  )
}

export default App
