import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

interface ServiceSettings {
  deezerWeb: boolean
  deezerApp: boolean
  spotifyWeb: boolean
  spotifyApp: boolean
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

function setCookie(name: string, value: string, days: number = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<ServiceSettings>(() => {
    const saved = getCookie('serviceSettings')
    return saved ? JSON.parse(saved) : {
      deezerWeb: true,
      deezerApp: true,
      spotifyWeb: false,
      spotifyApp: false,
    }
  })
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    fetch('/version')
      .then(res => res.text())
      .then(setVersion)
      .catch(() => setVersion('unknown'))
  }, [])

  const handleChange = (key: keyof ServiceSettings) => {
    const newSettings = { ...settings, [key]: !settings[key] }
    setSettings(newSettings)
    setCookie('serviceSettings', JSON.stringify(newSettings))
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <button
          onClick={() => navigate(-1)}
          className="inline-block mb-4 text-[#667eea] hover:underline bg-transparent border-none cursor-pointer text-base"
        >
          &larr; Back
        </button>

        <p className="text-gray-500 text-base mb-2">Version {version}</p>
        <h1 className="text-gray-800 text-2xl md:text-3xl font-bold mb-6">Settings</h1>

        <div className="space-y-4">
          <h2 className="text-gray-700 text-lg font-semibold mb-3">Music Services</h2>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-100">
            <input
              type="checkbox"
              checked={settings.deezerWeb}
              onChange={() => handleChange('deezerWeb')}
              className="w-5 h-5 accent-[#a238ff]"
            />
            <span className="text-gray-700">Deezer (Web)</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-100">
            <input
              type="checkbox"
              checked={settings.deezerApp}
              onChange={() => handleChange('deezerApp')}
              className="w-5 h-5 accent-[#ff6b35]"
            />
            <span className="text-gray-700">Deezer (App)</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-100">
            <input
              type="checkbox"
              checked={settings.spotifyWeb}
              onChange={() => handleChange('spotifyWeb')}
              className="w-5 h-5 accent-[#1DB954]"
            />
            <span className="text-gray-700">Spotify (Web)</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-100">
            <input
              type="checkbox"
              checked={settings.spotifyApp}
              onChange={() => handleChange('spotifyApp')}
              className="w-5 h-5 accent-[#1DB954]"
            />
            <span className="text-gray-700">Spotify (App)</span>
          </label>
        </div>
      </div>
    </div>
  )
}
