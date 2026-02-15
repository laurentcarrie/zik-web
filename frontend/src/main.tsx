import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { BAND_NAME, ROUTE_PREFIX } from './config'
import './i18n'
import './index.css'
import App from './App.tsx'
import LandingPage from './pages/LandingPage'

// Load font and background image dynamically (paths depend on route prefix)
const fontFace = new FontFace('Fontskrivan', `url(${ROUTE_PREFIX}/static/skriva-3.woff)`)
fontFace.load().then(font => document.fonts.add(font))
document.body.style.background = `url(${ROUTE_PREFIX}/static/background.jpg) repeat center center fixed`
document.body.style.backgroundSize = BAND_NAME === 'mtl' ? 'contain' : '480px'
const bandDisplayNames: Record<string, string> = { mtl: 'Move The Line', 'sunny-bd': 'Sunny Bd' }
if (bandDisplayNames[BAND_NAME]) {
  document.documentElement.style.setProperty('--band-text', `'${bandDisplayNames[BAND_NAME]}'`)
}
if (BAND_NAME === 'sunny-bd') {
  const s = document.documentElement.style
  s.setProperty('--spin-color', 'rgba(0, 0, 0, 0.06)')
  s.setProperty('--spin-stroke', 'rgba(0, 0, 0, 0.08)')
  s.setProperty('--spin-k0', 'rgba(37, 99, 235, 0.12)')
  s.setProperty('--spin-c0', 'rgba(37, 99, 235, 0.04)')
  s.setProperty('--spin-k1', 'rgba(235, 37, 99, 0.12)')
  s.setProperty('--spin-c1', 'rgba(235, 37, 99, 0.04)')
  s.setProperty('--spin-k2', 'rgba(37, 200, 80, 0.12)')
  s.setProperty('--spin-c2', 'rgba(37, 200, 80, 0.04)')
  s.setProperty('--spin-k3', 'rgba(235, 165, 37, 0.12)')
  s.setProperty('--spin-c3', 'rgba(235, 165, 37, 0.04)')
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
})

// Redirect / to /mtl
if (!BAND_NAME && window.location.pathname === '/') {
  window.location.replace('/mtl')
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {BAND_NAME ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter basename={ROUTE_PREFIX}>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      ) : (
        <LandingPage />
      )}
    </StrictMode>,
  )
}
