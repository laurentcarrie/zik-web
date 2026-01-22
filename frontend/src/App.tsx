import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import SongsPage from './pages/SongsPage'
import SongDetailPage from './pages/SongDetailPage'
import SettingsPage from './pages/SettingsPage'
import PressBookPage from './pages/PressBookPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/songs" element={<SongsPage />} />
      <Route path="/song/:id" element={<SongDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/press-book" element={<PressBookPage />} />
    </Routes>
  )
}

export default App
