import { Routes, Route } from 'react-router-dom'
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

function App() {
  return (
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
  )
}

export default App
