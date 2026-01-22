import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import SongsPage from './pages/SongsPage'
import SongDetailPage from './pages/SongDetailPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/songs" element={<SongsPage />} />
      <Route path="/song/:id" element={<SongDetailPage />} />
    </Routes>
  )
}

export default App
