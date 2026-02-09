import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import CodeMirror from '@uiw/react-codemirror'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import yaml from 'js-yaml'
import { useAuth, getStoredPassword } from '../context/AuthContext'
import PasswordModal from '../components/PasswordModal'

const API_BASE = import.meta.env.VITE_API_URL || ''
const SETTINGS_KEY = 'songs/settings.yml'

interface ServiceSettings {
  deezerWeb: boolean
  deezerApp: boolean
  spotifyWeb: boolean
  spotifyApp: boolean
  pdfEnabled: boolean
  lyricsEnabled: boolean
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
      pdfEnabled: true,
      lyricsEnabled: true,
    }
  })
  const [version, setVersion] = useState<string>('')
  const [settingsYml, setSettingsYml] = useState<string>('')
  const [settingsYmlLoaded, setSettingsYmlLoaded] = useState(false)
  const [settingsYmlSaving, setSettingsYmlSaving] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordAction, setPasswordAction] = useState<'save' | 'enable'>('save')
  const [showRenderingSettings, setShowRenderingSettings] = useState(false)
  const [isYamlValid, setIsYamlValid] = useState(true)
  const [yamlErrorMessage, setYamlErrorMessage] = useState('')
  const [showMakeReport, setShowMakeReport] = useState(false)
  const [makeReportLoading, setMakeReportLoading] = useState(false)
  const [failedNodes, setFailedNodes] = useState<Array<{ pathbuf: string }>>([])
  const [logContent, setLogContent] = useState<string>('')
  const [showLogModal, setShowLogModal] = useState(false)
  const [logModalTitle, setLogModalTitle] = useState('')
  const [makeReportYml, setMakeReportYml] = useState<string>('')
  const [makeReportTimestamp, setMakeReportTimestamp] = useState<string>('')
  const [showRawMakeReport, setShowRawMakeReport] = useState(false)
  const [lambdaRunning, setLambdaRunning] = useState<boolean | null>(null)
  const [lambdaTimestamp, setLambdaTimestamp] = useState<string>('')
  const [lambdaDuration, setLambdaDuration] = useState<number | null>(null)
  const [songs, setSongs] = useState<Array<{ id: string; key: string }>>([])
  const { isAuthenticated, clearPassword } = useAuth()

  const handleEditorChange = useCallback((value: string) => {
    setSettingsYml(value)
  }, [])

  function validateYaml(text: string) {
    if (!text.trim()) {
      setIsYamlValid(true)
      setYamlErrorMessage('')
      return
    }
    try {
      yaml.load(text)
      setIsYamlValid(true)
      setYamlErrorMessage('')
    } catch (e) {
      const error = e as Error
      setIsYamlValid(false)
      setYamlErrorMessage(error.message || 'Invalid YAML')
    }
  }

  useEffect(() => {
    validateYaml(settingsYml)
  }, [settingsYml])

  useEffect(() => {
    fetch('/version')
      .then(res => res.text())
      .then(setVersion)
      .catch(() => setVersion('unknown'))
  }, [])

  async function loadSettingsYml() {
    try {
      const res = await fetch(`${API_BASE}/api/s3/${SETTINGS_KEY}`)
      if (res.ok) {
        const data = await res.json()
        setSettingsYml(data.data)
        setSettingsYmlLoaded(true)
      } else if (res.status === 404) {
        setSettingsYml('# settings.yml\n# Add your build settings here\n')
        setSettingsYmlLoaded(true)
      } else {
        alert('Failed to load settings.yml')
      }
    } catch {
      alert('Failed to load settings.yml')
    }
  }

  async function openRenderingSettings() {
    if (!settingsYmlLoaded) {
      await loadSettingsYml()
    }
    setShowRenderingSettings(true)
  }

  function formatDuration(secs: number): string {
    const mins = Math.floor(secs / 60)
    const remainingSecs = secs % 60
    if (mins > 0) {
      return `${mins}m ${remainingSecs}s`
    }
    return `${remainingSecs}s`
  }

  // Convert pathbuf like "author/title/main.pdf" to key like "songs/author/title/song.yml"
  function pathbufToKey(pathbuf: string): string {
    const parts = pathbuf.split('/')
    if (parts.length >= 2) {
      return `songs/${parts[0]}/${parts[1]}/song.yml`
    }
    return ''
  }

  function findSongIdByPathbuf(pathbuf: string): string | null {
    const key = pathbufToKey(pathbuf)
    const song = songs.find(s => s.key === key)
    return song?.id || null
  }

  async function checkLambdaStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/lambda-status`)
      if (res.ok) {
        const data = await res.json()
        setLambdaRunning(data.running)
        setLambdaTimestamp(data.timestamp || '')
        setLambdaDuration(data.duration_secs ?? null)
      }
    } catch {
      setLambdaRunning(null)
      setLambdaTimestamp('')
      setLambdaDuration(null)
    }
  }

  async function openMakeReport() {
    setShowMakeReport(true)
    setMakeReportLoading(true)
    setFailedNodes([])
    setMakeReportYml('')
    setMakeReportTimestamp('')
    setLambdaRunning(null)
    checkLambdaStatus()
    // Fetch songs to map pathbuf to song id
    try {
      const songsRes = await fetch(`${API_BASE}/api/songs`)
      if (songsRes.ok) {
        const songsData = await songsRes.json()
        setSongs(songsData)
      }
    } catch {
      // Ignore
    }
    try {
      const res = await fetch(`${API_BASE}/api/make-report`)
      if (res.ok) {
        const data = await res.json()
        if (data.last_modified) {
          setMakeReportTimestamp(data.last_modified)
        }
        if (data.nodes) {
          // Store full YAML for display
          setMakeReportYml(yaml.dump({ nodes: data.nodes }))
          const failed = data.nodes.filter((node: { status: string }) =>
            node.status === 'BuildFailed'
          )
          setFailedNodes(failed)
        }
      }
    } catch {
      // Failed to load
    } finally {
      setMakeReportLoading(false)
    }
  }

  async function openLogFile(pathbuf: string, type: 'stdout' | 'stderr') {
    const logKey = `sandbox/logs/${pathbuf}.${type}`
    setLogModalTitle(`${pathbuf} - ${type}`)
    setLogContent('Loading...')
    setShowLogModal(true)
    try {
      const res = await fetch(`${API_BASE}/api/s3/${logKey}`)
      if (res.ok) {
        const data = await res.json()
        setLogContent(data.data || '(empty)')
      } else {
        setLogContent('Failed to load log file')
      }
    } catch {
      setLogContent('Failed to load log file')
    }
  }

  async function saveSettingsYml() {
    if (!isAuthenticated) {
      setPasswordAction('save')
      setShowPasswordModal(true)
      return
    }
    setSettingsYmlSaving(true)
    try {
      const password = getStoredPassword()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (password) {
        headers['X-Write-Password'] = password
      }
      const res = await fetch(`${API_BASE}/api/s3/${SETTINGS_KEY}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: settingsYml }),
      })
      if (res.ok) {
        alert('Settings saved!')
      } else if (res.status === 401) {
        setPasswordAction('save')
        setShowPasswordModal(true)
      } else {
        alert('Failed to save settings.yml')
      }
    } catch {
      alert('Failed to save settings.yml')
    } finally {
      setSettingsYmlSaving(false)
    }
  }

  function handlePasswordSuccess() {
    setShowPasswordModal(false)
    if (passwordAction === 'save') {
      saveSettingsYml()
    }
    // For 'enable' action, the isAuthenticated state is automatically updated by the auth context
  }

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
          <h2 className="text-gray-700 text-lg font-semibold mb-3">PDF Buttons</h2>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-100">
            <input
              type="checkbox"
              checked={settings.pdfEnabled ?? true}
              onChange={() => handleChange('pdfEnabled')}
              className="w-5 h-5 accent-[#dc2626]"
            />
            <span className="text-gray-700">PDF (Chord Sheet)</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-100">
            <input
              type="checkbox"
              checked={settings.lyricsEnabled ?? true}
              onChange={() => handleChange('lyricsEnabled')}
              className="w-5 h-5 accent-[#dc2626]"
            />
            <span className="text-gray-700">Lyrics PDF</span>
          </label>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 space-y-4">
          <h2 className="text-gray-700 text-lg font-semibold mb-3">Music Services</h2>

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-100">
            <input
              type="checkbox"
              checked={settings.deezerWeb}
              onChange={() => handleChange('deezerWeb')}
              className="w-5 h-5 accent-[#191414]"
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

        <div className="mt-8 pt-6 border-t border-gray-200">
          <h2 className="text-gray-700 text-lg font-semibold mb-3">Edit / Build</h2>
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-100">
            <input
              type="checkbox"
              checked={isAuthenticated}
              onChange={() => {
                if (!isAuthenticated) {
                  setPasswordAction('enable')
                  setShowPasswordModal(true)
                } else {
                  clearPassword()
                }
              }}
              className="w-5 h-5 accent-[#667eea]"
            />
            <span className="text-gray-700">
              {isAuthenticated ? 'Edit/Build enabled (click to disable)' : 'Enter password to enable Edit/Build'}
            </span>
          </label>
          {isAuthenticated && (
            <p className="text-green-600 text-sm ml-11">Write access is active</p>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 flex gap-3">
          <button
            onClick={openRenderingSettings}
            className="px-4 py-2 bg-[#667eea] text-white rounded-lg hover:bg-[#5a67d8]"
          >
            Rendering Settings
          </button>
          <button
            onClick={openMakeReport}
            className="px-4 py-2 bg-[#10b981] text-white rounded-lg hover:bg-[#059669]"
          >
            Make Report
          </button>
        </div>
      </div>

      {showRenderingSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-800 text-xl font-bold">Rendering Settings</h2>
              <button
                onClick={() => setShowRenderingSettings(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <CodeMirror
              value={settingsYml}
              onChange={handleEditorChange}
              extensions={[yamlLang()]}
              theme={oneDark}
              height="400px"
              className="rounded-lg overflow-hidden border border-gray-300"
            />
            {!isYamlValid && yamlErrorMessage && (
              <div className="mt-2 p-3 bg-red-100 text-red-700 rounded-lg text-sm font-mono">
                {yamlErrorMessage}
              </div>
            )}
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={saveSettingsYml}
                disabled={settingsYmlSaving || !isYamlValid}
                className="px-4 py-2 bg-[#667eea] text-white rounded-lg hover:bg-[#5a67d8] disabled:bg-gray-400"
              >
                {settingsYmlSaving ? 'Saving...' : 'Save'}
              </button>
              <span className={`text-sm px-3 py-1 rounded ${isYamlValid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {isYamlValid ? 'Valid YAML' : 'Invalid YAML'}
              </span>
              <button
                onClick={loadSettingsYml}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Reload
              </button>
              <button
                onClick={() => setShowRenderingSettings(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showMakeReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-gray-800 text-xl font-bold">Build Failed Nodes</h2>
                  {lambdaRunning !== null && (
                    <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                      lambdaRunning
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        lambdaRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                      }`}></span>
                      {lambdaRunning ? 'Build Running' : 'Idle'}
                      {lambdaTimestamp && (
                        <span className="ml-1 opacity-75">
                          ({lambdaRunning ? 'started' : 'last run'}: {lambdaTimestamp}
                          {lambdaDuration !== null && `, ${formatDuration(lambdaDuration)}`})
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {makeReportTimestamp && (
                  <p className="text-gray-500 text-sm mt-1">
                    Last updated: {makeReportTimestamp}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowMakeReport(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            {makeReportLoading ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-500">Loading...</p>
              </div>
            ) : failedNodes.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-green-600 font-medium">No failed builds!</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-auto">
                {failedNodes.map((node, index) => {
                  const songId = findSongIdByPathbuf(node.pathbuf)
                  return (
                    <div key={index} className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
                      <span className="flex-1 font-mono text-sm text-gray-800 truncate" title={node.pathbuf}>
                        {node.pathbuf}
                      </span>
                      {songId && (
                        <Link
                          to={`/song/${songId}`}
                          className="px-3 py-1 text-sm bg-purple-500 text-white rounded hover:bg-purple-600 no-underline"
                        >
                          Song
                        </Link>
                      )}
                      <button
                        onClick={() => openLogFile(node.pathbuf, 'stdout')}
                        className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        stdout
                      </button>
                      <button
                        onClick={() => openLogFile(node.pathbuf, 'stderr')}
                        className="px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
                      >
                        stderr
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={openMakeReport}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Reload
              </button>
              <button
                onClick={() => setShowRawMakeReport(true)}
                className="px-4 py-2 bg-[#667eea] text-white rounded-lg hover:bg-[#5a67d8]"
              >
                Show make-report.yml
              </button>
              <button
                onClick={() => setShowMakeReport(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showRawMakeReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-800 text-xl font-bold">make-report.yml</h2>
              <button
                onClick={() => setShowRawMakeReport(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <CodeMirror
              value={makeReportYml}
              extensions={[yamlLang()]}
              theme={oneDark}
              height="500px"
              readOnly
              className="rounded-lg overflow-hidden border border-gray-300"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowRawMakeReport(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-800 text-xl font-bold">{logModalTitle}</h2>
              <button
                onClick={() => setShowLogModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto max-h-96 text-sm font-mono whitespace-pre-wrap">
              {logContent}
            </pre>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowLogModal(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <PasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={handlePasswordSuccess}
      />
    </div>
  )
}
