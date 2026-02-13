import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState, useRef, useCallback } from 'react'
import HomePage from './pages/HomePage'
import SongsPage from './pages/SongsPage'

const SongDetailPage = lazy(() => import('./pages/SongDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const PressBookPage = lazy(() => import('./pages/PressBookPage'))
const EditYmlPage = lazy(() => import('./pages/EditYmlPage'))
const EditLyricsPage = lazy(() => import('./pages/EditLyricsPage'))
const EditLilypondPage = lazy(() => import('./pages/EditLilypondPage'))
const EditTexPage = lazy(() => import('./pages/EditTexPage'))
const EditDrumsPage = lazy(() => import('./pages/EditDrumsPage'))
const EditDrumsGlobalPage = lazy(() => import('./pages/EditDrumsGlobalPage'))
const MasterPage = lazy(() => import('./pages/MasterPage'))
const UpdatePage = lazy(() => import('./pages/UpdatePage'))

function getNextIndex(currentIndex: number, count: number): number {
  return (currentIndex + 1) % count
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
    fetch(`/api/guitar-embed/${index}`)
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
    loadEmbed(0)
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
      <Suspense>
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
      </Suspense>
    </>
  )
}

export default App
