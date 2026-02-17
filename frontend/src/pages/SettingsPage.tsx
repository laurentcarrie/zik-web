import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import CodeMirror from '@uiw/react-codemirror'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import yaml from 'js-yaml'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useAuth, getStoredPassword } from '../context/AuthContext'
import PasswordModal from '../components/PasswordModal'
import { API_BASE, ROUTE_PREFIX } from '../config'
const SETTINGS_KEY = 'songs/settings.yml'

type MusicService = 'deezerWeb' | 'deezerApp' | 'spotifyWeb' | 'spotifyApp'

type LyricsMode = 'none' | '1-column' | '2-columns'

interface ServiceSettings {
  musicService: MusicService
  pdfEnabled: boolean
  lyricsMode: LyricsMode
  lyricsEnabled?: boolean // deprecated, for migration
}

interface HarmonicRange {
  from: number
  step: number
  to: number
  speed: number
}

interface HarmonicSteps {
  ranges: HarmonicRange[]
}

interface Congruence {
  modulo: number
  congruents: number[]
}

type WhenToShow = 'Always' | 'Never' | { Congruence: Congruence }

interface EmbedOptions {
  max_harmonics: number
  steps: HarmonicSteps
  show_contour: WhenToShow
  show_point: boolean
  show_trace: WhenToShow
  trace_length: number
  opacity: number
  show_nh: boolean
  trace_width: number
  contour_width: number
  show_fourier_circles: WhenToShow
  trace_colors: string[]
}

interface AnimationText {
  text: string
  font: string
}

interface SvgPathItem {
  path: string
  flip_y: boolean
}

type AnimationEnum = { Text: AnimationText } | { SvgPath: SvgPathItem }

interface AnimationItem {
  name: string
  item: AnimationEnum
  embed_options: EmbedOptions
}

interface Animations {
  items: AnimationItem[]
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

function isMobileDevice(): boolean {
  return window.innerWidth < 768 || /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)
}

function setCookie(name: string, value: string, days: number = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`
}

function whenToShowType(v: WhenToShow): string {
  if (v === 'Always') return 'Always'
  if (v === 'Never') return 'Never'
  return 'Congruence'
}

function WhenToShowSelect({ label, value, onChange }: { label: string; value: WhenToShow; onChange: (v: WhenToShow) => void }) {
  const { t } = useTranslation()
  const type = whenToShowType(value)
  const congruence = typeof value === 'object' ? value.Congruence : { modulo: 2, congruents: [1] }
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-gray-300 text-sm font-medium">{label}:</span>
        <select value={type}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'Always') onChange('Always')
            else if (v === 'Never') onChange('Never')
            else onChange({ Congruence: congruence })
          }}
          className="px-2 py-1 text-sm border border-gray-600 rounded bg-gray-800 text-gray-200">
          <option value="Always">{t('settings.always')}</option>
          <option value="Never">{t('settings.never')}</option>
          <option value="Congruence">{t('settings.onceEvery')}</option>
        </select>
      </div>
      {type === 'Congruence' && (
        <div className="flex items-center gap-2 mt-1 ml-4">
          <span className="text-gray-400 text-xs">modulo</span>
          <input type="number" value={congruence.modulo} min={1}
            onChange={(e) => onChange({ Congruence: { ...congruence, modulo: Number(e.target.value) } })}
            className="w-16 px-2 py-1 text-sm border border-gray-600 rounded bg-gray-800 text-gray-200" />
          <span className="text-gray-400 text-xs">congruents</span>
          <input type="text" value={congruence.congruents.join(',')}
            onChange={(e) => {
              const nums = e.target.value.split(',').map(Number).filter(n => !isNaN(n))
              onChange({ Congruence: { ...congruence, congruents: nums } })
            }}
            className="w-20 px-2 py-1 text-sm border border-gray-600 rounded bg-gray-800 text-gray-200" />
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [settings, setSettings] = useState<ServiceSettings>(() => {
    const saved = getCookie('serviceSettings')
    if (saved) {
      const parsed = JSON.parse(saved)
      // Migrate old format
      if ('deezerWeb' in parsed && !('musicService' in parsed)) {
        const mobile = isMobileDevice()
        return {
          musicService: mobile ? 'deezerApp' : 'deezerWeb',
          pdfEnabled: parsed.pdfEnabled ?? true,
          lyricsMode: parsed.lyricsMode ?? (parsed.lyricsEnabled === false ? 'none' : '1-column'),
        }
      }
      // Migrate lyricsEnabled to lyricsMode
      if ('lyricsEnabled' in parsed && !('lyricsMode' in parsed)) {
        return {
          ...parsed,
          lyricsMode: parsed.lyricsEnabled === false ? 'none' : '1-column',
        }
      }
      return parsed
    }
    const mobile = isMobileDevice()
    return {
      musicService: mobile ? 'deezerApp' : 'deezerWeb',
      pdfEnabled: true,
      lyricsMode: '1-column' as LyricsMode,
    }
  })
  const [version, setVersion] = useState<string>('')
  const [settingsYml, setSettingsYml] = useState<string>('')
  const [settingsYmlLoaded, setSettingsYmlLoaded] = useState(false)
  const [settingsYmlSaving, setSettingsYmlSaving] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordAction, setPasswordAction] = useState<'save' | 'enable' | 'saveAnimations'>('save')
  const [showRenderingSettings, setShowRenderingSettings] = useState(false)
  const [showSequences, setShowSequences] = useState(false)
  const [patternNames, setPatternNames] = useState<string[]>([])
  const [patternsLoading, setPatternsLoading] = useState(false)
  const [patternListening, setPatternListening] = useState<string | null>(null)
  const [patternTempo, setPatternTempo] = useState(120)
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
  const [worldLoading, setWorldLoading] = useState(false)
  const [worldMessage, setWorldMessage] = useState<string | null>(null)
  const [showAnimation, setShowAnimation] = useState(false)
  const [animations, setAnimations] = useState<Animations | null>(null)
  const [selectedAnimIndex, setSelectedAnimIndex] = useState(0)
  const [animationsLoading, setAnimationsLoading] = useState(false)
  const [animationsSaving, setAnimationsSaving] = useState(false)
  const [animationsSaved, setAnimationsSaved] = useState(false)
  const [originalAnimations, setOriginalAnimations] = useState<Animations | null>(null)
  const [enabledContours, setEnabledContours] = useState<number[]>(() => {
    const saved = getCookie('enabledContours')
    if (saved) return JSON.parse(saved)
    return []  // empty means all enabled
  })
  const [languagePref, setLanguagePref] = useState<'en' | 'fr' | 'browser'>(() => {
    const saved = getCookie('languagePref')
    return (saved as 'en' | 'fr' | 'browser') || 'browser'
  })
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
    fetch(`${API_BASE}/version`)
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

  async function loadPatterns() {
    setPatternsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/s3/drum-patterns/all-patterns.yml`)
      if (res.ok) {
        const data = await res.json()
        const parsed = yaml.load(data.data) as string[] | null
        setPatternNames(parsed || [])
      } else {
        setPatternNames([])
      }
    } catch {
      setPatternNames([])
    } finally {
      setPatternsLoading(false)
    }
  }

  async function handleListenPattern(name: string) {
    setPatternListening(name)
    try {
      // Fetch the pattern YAML from S3
      const res = await fetch(`${API_BASE}/api/s3/drum-patterns/${name}.yml`)
      if (!res.ok) throw new Error('Failed to fetch pattern file')
      const s3Data = await res.json()

      // Convert to HTML via backend
      const htmlRes = await fetch(`${API_BASE}/api/drum-pattern-to-html`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: s3Data.data, name, tempo: patternTempo }),
      })
      if (!htmlRes.ok) {
        const errorText = await htmlRes.text()
        throw new Error(errorText || 'Failed to convert drum pattern to HTML')
      }
      const htmlData = await htmlRes.json()

      const newWindow = window.open('', '_blank')
      if (newWindow) {
        newWindow.document.write(htmlData.html)
        newWindow.document.close()
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Failed to load pattern: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setPatternListening(null)
    }
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
    setLogContent(t('settings.loading'))
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

  async function triggerWorld() {
    if (!isAuthenticated) {
      setPasswordAction('save')
      setShowPasswordModal(true)
      return
    }
    setWorldLoading(true)
    setWorldMessage(null)
    try {
      const password = getStoredPassword()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (password) {
        headers['X-Write-Password'] = password
      }
      const res = await fetch(`${API_BASE}/api/world`, {
        method: 'POST',
        headers,
      })
      if (!res.ok) {
        try {
          const data = await res.json()
          setWorldMessage(data.message || `Error ${res.status}`)
        } catch {
          setWorldMessage(`Error ${res.status}: ${res.statusText}`)
        }
        return
      }
      const data = await res.json()
      setWorldMessage(data.message)
    } catch (e) {
      setWorldMessage(`Failed to generate world.yml: ${e}`)
    } finally {
      setWorldLoading(false)
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

  async function loadAnimations() {
    setAnimationsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/animations`)
      if (res.ok) {
        const data: Animations = await res.json()
        setAnimations(data)
        setOriginalAnimations(JSON.parse(JSON.stringify(data)))
      }
    } catch {
      // ignore
    } finally {
      setAnimationsLoading(false)
    }
  }

  async function openAnimationSettings() {
    setShowAnimation(true)
    if (!animations) {
      await loadAnimations()
    }
  }

  async function saveAnimations() {
    if (!animations) return
    if (!isAuthenticated) {
      setPasswordAction('saveAnimations')
      setShowPasswordModal(true)
      return
    }
    setAnimationsSaving(true)
    try {
      const password = getStoredPassword()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (password) {
        headers['X-Write-Password'] = password
      }
      const res = await fetch(`${API_BASE}/api/animations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(animations),
      })
      if (res.ok) {
        setAnimationsSaved(true)
        setTimeout(() => setAnimationsSaved(false), 2000)
      } else if (res.status === 401) {
        setPasswordAction('save')
        setShowPasswordModal(true)
      } else {
        alert('Failed to save animations')
      }
    } catch {
      alert('Failed to save animations')
    } finally {
      setAnimationsSaving(false)
    }
  }

  function updateEmbedOption<K extends keyof EmbedOptions>(key: K, value: EmbedOptions[K]) {
    if (!animations) return
    const updated = { ...animations }
    updated.items = [...updated.items]
    updated.items[selectedAnimIndex] = {
      ...updated.items[selectedAnimIndex],
      embed_options: { ...updated.items[selectedAnimIndex].embed_options, [key]: value },
    }
    setAnimations(updated)
  }

  function handlePasswordSuccess() {
    setShowPasswordModal(false)
    if (passwordAction === 'save') {
      saveSettingsYml()
    } else if (passwordAction === 'saveAnimations') {
      saveAnimations()
    }
    // For 'enable' action, the isAuthenticated state is automatically updated by the auth context
  }

  const handleCheckboxChange = (key: 'pdfEnabled') => {
    const newSettings = { ...settings, [key]: !settings[key] }
    setSettings(newSettings)
    setCookie('serviceSettings', JSON.stringify(newSettings))
  }

  const handleMusicServiceChange = (service: MusicService) => {
    const newSettings = { ...settings, musicService: service }
    setSettings(newSettings)
    setCookie('serviceSettings', JSON.stringify(newSettings))
  }

  const handleLanguageChange = (pref: 'en' | 'fr' | 'browser') => {
    setLanguagePref(pref)
    setCookie('languagePref', pref)
    if (pref === 'browser') {
      const browserLang = navigator.language.split('-')[0]
      i18n.changeLanguage(browserLang === 'fr' ? 'fr' : 'en')
    } else {
      i18n.changeLanguage(pref)
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-6 bg-black/70">
      <div className="max-w-2xl mx-auto bg-gray-900/95 rounded-xl p-4 md:p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => navigate(-1)}
            className="text-[#8b9cf7] hover:underline bg-transparent border-none cursor-pointer text-sm"
          >
            &larr; {t('nav.back')}
          </button>
          <span className="text-gray-500 text-xs">{t('settings.version')} {version}</span>
        </div>

        <h1 className="text-gray-100 text-xl font-bold mb-4">{t('settings.title')}</h1>

        <div className="space-y-1">
          <h2 className="text-gray-300 text-sm font-semibold mb-1">{t('settings.pdfButtons')}</h2>
          <label className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded hover:bg-gray-800">
            <input
              type="checkbox"
              checked={settings.pdfEnabled ?? true}
              onChange={() => handleCheckboxChange('pdfEnabled')}
              className="w-4 h-4 accent-[#dc2626]"
            />
            <span className="text-gray-300 text-sm">{t('settings.pdfChordSheet')}</span>
          </label>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={(settings.lyricsMode ?? '1-column') !== 'none'}
                onChange={() => {
                  const enabled = (settings.lyricsMode ?? '1-column') !== 'none'
                  const newSettings = { ...settings, lyricsMode: (enabled ? 'none' : '1-column') as LyricsMode }
                  setSettings(newSettings)
                  setCookie('serviceSettings', JSON.stringify(newSettings))
                }}
                className="w-4 h-4 accent-[#dc2626]"
              />
              <span className="text-gray-300 text-sm">{t('settings.lyricsPdf')}</span>
            </label>
            {(settings.lyricsMode ?? '1-column') !== 'none' && (
              <select
                value={settings.lyricsMode ?? '1-column'}
                onChange={(e) => {
                  const newSettings = { ...settings, lyricsMode: e.target.value as LyricsMode }
                  setSettings(newSettings)
                  setCookie('serviceSettings', JSON.stringify(newSettings))
                }}
                className="px-2 py-1 text-sm border border-gray-600 rounded-lg bg-gray-800 text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#dc2626]"
              >
                <option value="1-column">{t('settings.lyrics1Column')}</option>
                <option value="2-columns">{t('settings.lyrics2Columns')}</option>
              </select>
            )}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-gray-700 space-y-1">
          <h2 className="text-gray-300 text-sm font-semibold mb-1">{t('settings.animation')}</h2>
          <label className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded hover:bg-gray-800">
            <input
              type="checkbox"
              checked={document.cookie.match(/(^| )animationEnabled=([^;]+)/)?.[2] !== 'false'}
              onChange={(e) => {
                setCookie('animationEnabled', String(e.target.checked))
                window.dispatchEvent(new Event('animation-toggled'))
              }}
              className="w-4 h-4 accent-pink-500"
            />
            <span className="text-gray-300 text-sm">{t('settings.animation')}</span>
          </label>
        </div>

        <div className="mt-4 pt-3 border-t border-gray-700 space-y-1">
          <h2 className="text-gray-300 text-sm font-semibold mb-1">{t('language.title')}</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-2">
            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input
                type="radio"
                name="language"
                checked={languagePref === 'en'}
                onChange={() => handleLanguageChange('en')}
                className="w-4 h-4 accent-[#667eea]"
              />
              <span className="text-gray-300 text-sm">{t('language.english')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input
                type="radio"
                name="language"
                checked={languagePref === 'fr'}
                onChange={() => handleLanguageChange('fr')}
                className="w-4 h-4 accent-[#667eea]"
              />
              <span className="text-gray-300 text-sm">{t('language.french')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input
                type="radio"
                name="language"
                checked={languagePref === 'browser'}
                onChange={() => handleLanguageChange('browser')}
                className="w-4 h-4 accent-[#667eea]"
              />
              <span className="text-gray-300 text-sm">{t('language.browserPreference')}</span>
            </label>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-gray-700">
          <div className="flex items-center gap-3 px-2">
            <h2 className="text-gray-300 text-sm font-semibold">{t('settings.musicServices')}</h2>
            <select
              value={settings.musicService}
              onChange={(e) => handleMusicServiceChange(e.target.value as MusicService)}
              className="flex-1 px-2 py-1.5 text-sm border border-gray-600 rounded-lg bg-gray-800 text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#667eea]"
            >
              <option value="deezerWeb">{t('settings.deezerWeb')}</option>
              <option value="deezerApp">{t('settings.deezerApp')}</option>
              <option value="spotifyWeb">{t('settings.spotifyWeb')}</option>
              <option value="spotifyApp">{t('settings.spotifyApp')}</option>
            </select>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-gray-700">
          <h2 className="text-gray-300 text-sm font-semibold mb-1">{t('settings.editBuild')}</h2>
          <label className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded hover:bg-gray-800">
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
              className="w-4 h-4 accent-[#667eea]"
            />
            <span className="text-gray-300 text-sm">
              {isAuthenticated ? t('settings.editBuildEnabled') : t('settings.enterPassword')}
            </span>
          </label>
          {isAuthenticated && (
            <p className="text-green-400 text-xs ml-6">{t('settings.writeAccessActive')}</p>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-700 flex gap-2">
          <button
            onClick={openRenderingSettings}
            className="px-3 py-1.5 text-sm bg-[#667eea] text-white rounded-lg hover:bg-[#5a67d8]"
          >
            {t('settings.renderingSettings')}
          </button>
          <button
            onClick={openMakeReport}
            className="px-3 py-1.5 text-sm bg-[#10b981] text-white rounded-lg hover:bg-[#059669]"
          >
            {t('settings.makeReport')}
          </button>
          <button
            onClick={triggerWorld}
            disabled={worldLoading || !isAuthenticated}
            className="px-3 py-1.5 text-sm bg-[#8b5cf6] text-white rounded-lg hover:bg-[#7c3aed] disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {worldLoading ? '...' : 'Re-index'}
          </button>
          <button
            onClick={openAnimationSettings}
            className="px-3 py-1.5 text-sm bg-pink-500 text-white rounded-lg hover:bg-pink-600"
          >
            {t('settings.uselessAnimation')}
          </button>
        </div>
        {worldMessage && (
          <div className="mt-2 px-2 text-sm text-gray-400">
            {worldMessage}
          </div>
        )}
      </div>

      {showRenderingSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900/95 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-200 text-xl font-bold">{t('settings.renderingSettings')}</h2>
              <button
                onClick={() => setShowRenderingSettings(false)}
                className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
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
              className="rounded-lg overflow-hidden border border-gray-600"
            />
            {!isYamlValid && yamlErrorMessage && (
              <div className="mt-2 p-3 bg-red-900/50 text-red-300 rounded-lg text-sm font-mono">
                {yamlErrorMessage}
              </div>
            )}
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={saveSettingsYml}
                disabled={settingsYmlSaving || !isYamlValid}
                className="px-4 py-2 bg-[#667eea] text-white rounded-lg hover:bg-[#5a67d8] disabled:bg-gray-400"
              >
                {settingsYmlSaving ? t('settings.saving') : t('settings.save')}
              </button>
              <span className={`text-sm px-3 py-1 rounded ${isYamlValid ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                {isYamlValid ? t('settings.validYaml') : t('settings.invalidYaml')}
              </span>
              <button
                onClick={loadSettingsYml}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600"
              >
                {t('settings.reload')}
              </button>
              <button
                onClick={() => setShowRenderingSettings(false)}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 ml-auto"
              >
                {t('settings.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSequences && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900/95 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-200 text-xl font-bold">Drum Patterns</h2>
              <button
                onClick={() => setShowSequences(false)}
                className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <label className="text-gray-300 text-sm font-medium whitespace-nowrap">Tempo: {patternTempo}</label>
              <input
                type="range"
                min={40}
                max={240}
                value={patternTempo}
                onChange={(e) => setPatternTempo(Number(e.target.value))}
                className="flex-1 accent-orange-500"
              />
            </div>
            {patternsLoading ? (
              <p className="text-gray-400">Loading...</p>
            ) : patternNames.length === 0 ? (
              <p className="text-gray-400 italic">No patterns found</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {patternNames.map((name) => (
                  <div key={name} className="flex flex-col gap-1">
                    <a
                      href={`${ROUTE_PREFIX}/edit-drums-global/${encodeURIComponent(name)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      {name}
                    </a>
                    <button
                      onClick={() => handleListenPattern(name)}
                      disabled={patternListening !== null}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] bg-orange-300 text-orange-900 rounded-lg text-sm hover:bg-orange-400 transition-colors disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                      {patternListening === name ? 'Loading...' : 'Listen'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={loadPatterns}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600"
              >
                Reload
              </button>
              <button
                onClick={() => setShowSequences(false)}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showMakeReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900/95 rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-gray-200 text-xl font-bold">{t('settings.buildFailedNodes')}</h2>
                  {lambdaRunning !== null && (
                    <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                      lambdaRunning
                        ? 'bg-green-900/50 text-green-300'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        lambdaRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                      }`}></span>
                      {lambdaRunning ? t('song.buildRunning') : t('song.idle')}
                      {lambdaRunning ? (
                        lambdaDuration !== null && (
                          <span className="ml-1 opacity-75">
                            ({formatDuration(lambdaDuration)})
                          </span>
                        )
                      ) : lambdaTimestamp && (
                        <span className="ml-1 opacity-75">
                          ({t('song.lastRun')}: {lambdaTimestamp}
                          {lambdaDuration !== null && `, ${formatDuration(lambdaDuration)}`})
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {makeReportTimestamp && (
                  <p className="text-gray-400 text-sm mt-1">
                    {t('settings.lastUpdated')}: {makeReportTimestamp}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowMakeReport(false)}
                className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            {makeReportLoading ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-400">{t('settings.loading')}</p>
              </div>
            ) : failedNodes.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-green-400 font-medium">{t('settings.noFailedBuilds')}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-auto">
                {failedNodes.map((node, index) => {
                  const songId = findSongIdByPathbuf(node.pathbuf)
                  return (
                    <div key={index} className="flex items-center gap-3 p-3 bg-red-900/30 rounded-lg border border-red-800">
                      <span className="flex-1 font-mono text-sm text-gray-200 truncate" title={node.pathbuf}>
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
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600"
              >
                {t('settings.reload')}
              </button>
              <button
                onClick={() => setShowRawMakeReport(true)}
                className="px-4 py-2 bg-[#667eea] text-white rounded-lg hover:bg-[#5a67d8]"
              >
                {t('settings.showMakeReport')}
              </button>
              <button
                onClick={() => setShowMakeReport(false)}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 ml-auto"
              >
                {t('settings.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRawMakeReport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-gray-900/95 rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-200 text-xl font-bold">make-report.yml</h2>
              <button
                onClick={() => setShowRawMakeReport(false)}
                className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
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
              className="rounded-lg overflow-hidden border border-gray-600"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowRawMakeReport(false)}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 ml-auto"
              >
                {t('settings.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-gray-900/95 rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-200 text-xl font-bold">{logModalTitle}</h2>
              <button
                onClick={() => setShowLogModal(false)}
                className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
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
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 ml-auto"
              >
                {t('settings.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAnimation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900/95 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-gray-100 text-xl font-bold">{t('settings.uselessAnimation')}</h2>
              <button
                onClick={() => setShowAnimation(false)}
                className="text-gray-400 hover:text-gray-200 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            {animationsLoading ? (
              <p className="text-gray-500">{t('settings.loading')}</p>
            ) : !animations || animations.items.length === 0 ? (
              <p className="text-gray-500 italic">{t('settings.noAnimations')}</p>
            ) : (() => {
              const safeIndex = selectedAnimIndex < animations.items.length ? selectedAnimIndex : 0
              const anim = animations.items[safeIndex]
              const opts = anim.embed_options
              const itemType = 'Text' in anim.item ? 'Text' : 'SvgPath'
              const itemValue = 'Text' in anim.item ? `${anim.item.Text.text} (${anim.item.Text.font})` : ('SvgPath' in anim.item ? anim.item.SvgPath.path : '')
              return (
                <div className="space-y-4">
                  {animations.items.length > 1 && (
                    <div>
                      <label className="text-gray-300 text-sm font-medium">{t('settings.animation')}</label>
                      <select
                        value={selectedAnimIndex}
                        onChange={(e) => setSelectedAnimIndex(Number(e.target.value))}
                        className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-600 rounded-lg bg-gray-800 text-gray-200"
                      >
                        {animations.items.map((a, i) => (
                          <option key={i} value={i}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="p-3 bg-gray-800 rounded-lg">
                    <span className="text-gray-400 text-xs uppercase">{itemType}</span>
                    {'Text' in anim.item ? (
                      <p className="text-gray-200 text-lg mt-1" style={{ fontFamily: anim.item.Text.font }}>
                        {anim.item.Text.text}
                      </p>
                    ) : (
                      <p className="text-gray-200 text-sm font-mono mt-1 break-all">{itemValue}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-gray-300 text-sm font-medium">
                      {t('settings.maxHarmonics')}: {opts.max_harmonics}
                    </label>
                    <input type="range" min={500} max={10000} step={500} value={opts.max_harmonics}
                      onChange={(e) => updateEmbedOption('max_harmonics', Number(e.target.value))}
                      className="w-full accent-pink-500" />
                  </div>

                  <div>
                    <label className="text-gray-300 text-sm font-medium">
                      {t('settings.speed')}: {(opts.steps.ranges[0]?.speed ?? 3).toFixed(1)}
                    </label>
                    <input type="range" min={0.5} max={10} step={0.1} value={opts.steps.ranges[0]?.speed ?? 3}
                      onChange={(e) => {
                        const speed = Number(e.target.value)
                        updateEmbedOption('steps', { ...opts.steps, ranges: opts.steps.ranges.map(r => ({ ...r, speed })) })
                      }}
                      className="w-full accent-pink-500" />
                  </div>

                  <div>
                    <label className="text-gray-300 text-sm font-medium">
                      {t('settings.opacity')}: {opts.opacity.toFixed(2)}
                    </label>
                    <input type="range" min={0} max={1} step={0.01} value={opts.opacity}
                      onChange={(e) => updateEmbedOption('opacity', Number(e.target.value))}
                      className="w-full accent-pink-500" />
                  </div>

                  <div>
                    <label className="text-gray-300 text-sm font-medium">
                      {t('settings.traceLength')}: {opts.trace_length}
                    </label>
                    <input type="range" min={10} max={1000} step={10} value={opts.trace_length}
                      onChange={(e) => updateEmbedOption('trace_length', Number(e.target.value))}
                      className="w-full accent-pink-500" />
                  </div>

                  <div>
                    <label className="text-gray-300 text-sm font-medium">
                      {t('settings.traceWidth')}: {opts.trace_width.toFixed(1)}
                    </label>
                    <input type="range" min={0.1} max={5} step={0.1} value={opts.trace_width}
                      onChange={(e) => updateEmbedOption('trace_width', Number(e.target.value))}
                      className="w-full accent-pink-500" />
                  </div>

                  <div>
                    <label className="text-gray-300 text-sm font-medium">
                      {t('settings.contourWidth')}: {opts.contour_width.toFixed(1)}
                    </label>
                    <input type="range" min={0.1} max={5} step={0.1} value={opts.contour_width}
                      onChange={(e) => updateEmbedOption('contour_width', Number(e.target.value))}
                      className="w-full accent-pink-500" />
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={opts.show_point}
                        onChange={() => updateEmbedOption('show_point', !opts.show_point)}
                        className="w-4 h-4 accent-pink-500" />
                      <span className="text-gray-300 text-sm">{t('settings.showPoint')}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={opts.show_nh}
                        onChange={() => updateEmbedOption('show_nh', !opts.show_nh)}
                        className="w-4 h-4 accent-pink-500" />
                      <span className="text-gray-300 text-sm">{t('settings.showHarmonicsCounter')}</span>
                    </label>
                  </div>

                  <WhenToShowSelect label={t('settings.showContour')} value={opts.show_contour}
                    onChange={(v) => updateEmbedOption('show_contour', v)} />
                  <WhenToShowSelect label={t('settings.showTrace')} value={opts.show_trace}
                    onChange={(v) => updateEmbedOption('show_trace', v)} />
                  <WhenToShowSelect label={t('settings.showFourierCircles')} value={opts.show_fourier_circles}
                    onChange={(v) => updateEmbedOption('show_fourier_circles', v)} />

                  <div className="pt-3 border-t border-gray-700">
                    <h3 className="text-gray-300 text-sm font-semibold mb-2">{t('settings.harmonicRanges')}</h3>
                    <div className="space-y-1">
                      {opts.steps.ranges.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs">{t('settings.from')}</span>
                          <input type="number" value={r.from} min={0}
                            onChange={(e) => {
                              const newRanges = [...opts.steps.ranges]
                              newRanges[i] = { ...newRanges[i], from: Number(e.target.value) }
                              updateEmbedOption('steps', { ...opts.steps, ranges: newRanges })
                            }}
                            className="w-16 px-2 py-1 text-sm border border-gray-600 rounded bg-gray-800 text-gray-200" />
                          <span className="text-gray-400 text-xs">{t('settings.to')}</span>
                          <input type="number" value={r.to} min={1}
                            onChange={(e) => {
                              const newRanges = [...opts.steps.ranges]
                              newRanges[i] = { ...newRanges[i], to: Number(e.target.value) }
                              updateEmbedOption('steps', { ...opts.steps, ranges: newRanges })
                            }}
                            className="w-16 px-2 py-1 text-sm border border-gray-600 rounded bg-gray-800 text-gray-200" />
                          <span className="text-gray-400 text-xs">{t('settings.step')}</span>
                          <input type="number" value={r.step} min={1}
                            onChange={(e) => {
                              const newRanges = [...opts.steps.ranges]
                              newRanges[i] = { ...newRanges[i], step: Number(e.target.value) }
                              updateEmbedOption('steps', { ...opts.steps, ranges: newRanges })
                            }}
                            className="w-16 px-2 py-1 text-sm border border-gray-600 rounded bg-gray-800 text-gray-200" />
                          <span className="text-gray-400 text-xs">{t('settings.speed')}</span>
                          <input type="number" value={r.speed} min={0.1} step={0.1}
                            onChange={(e) => {
                              const newRanges = [...opts.steps.ranges]
                              newRanges[i] = { ...newRanges[i], speed: Number(e.target.value) }
                              updateEmbedOption('steps', { ...opts.steps, ranges: newRanges })
                            }}
                            className="w-16 px-2 py-1 text-sm border border-gray-600 rounded bg-gray-800 text-gray-200" />
                          <button onClick={() => {
                            const newRanges = opts.steps.ranges.filter((_, j) => j !== i)
                            updateEmbedOption('steps', { ...opts.steps, ranges: newRanges })
                          }} className="text-red-400 hover:text-red-600 text-sm">&times;</button>
                        </div>
                      ))}
                      <button onClick={() => {
                        const last = opts.steps.ranges[opts.steps.ranges.length - 1]
                        const speed = last?.speed ?? 3.0
                        const newRange = { from: last ? last.to : 0, step: 1, to: last ? last.to + 100 : 100, speed }
                        updateEmbedOption('steps', { ...opts.steps, ranges: [...opts.steps.ranges, newRange] })
                      }} className="text-pink-500 hover:text-pink-700 text-sm">{t('settings.addRange')}</button>
                    </div>
                  </div>

                  {animations.items.length > 1 && (
                    <div className="pt-3 border-t border-gray-700">
                      <h3 className="text-gray-300 text-sm font-semibold mb-2">{t('settings.enabledAnimations')}</h3>
                      <div className="space-y-1">
                        {animations.items.map((a, idx) => {
                          const allEnabled = enabledContours.length === 0
                          const isEnabled = allEnabled || enabledContours.includes(idx)
                          return (
                            <label key={idx} className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded hover:bg-gray-800">
                              <input type="checkbox" checked={isEnabled}
                                onChange={() => {
                                  let next: number[]
                                  if (allEnabled) {
                                    next = animations.items.map((_, i) => i).filter(i => i !== idx)
                                  } else if (isEnabled) {
                                    next = enabledContours.filter(i => i !== idx)
                                  } else {
                                    next = [...enabledContours, idx].sort()
                                  }
                                  if (next.length === animations.items.length) next = []
                                  setEnabledContours(next)
                                  setCookie('enabledContours', JSON.stringify(next))
                                  window.dispatchEvent(new CustomEvent('enabled-contours-changed', { detail: next }))
                                }}
                                className="w-4 h-4 accent-pink-500" />
                              <span className="text-gray-300 text-sm">{a.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
            <div className="flex gap-3 mt-6">
              <button
                onClick={async () => {
                  await saveAnimations()
                  window.dispatchEvent(new Event('reload-animation'))
                }}
                disabled={animationsSaving}
                className={`px-4 py-2 text-white rounded-lg disabled:bg-gray-400 ${animationsSaved ? 'bg-green-500' : 'bg-pink-500 hover:bg-pink-600'}`}
              >
                {animationsSaving ? t('settings.saving') : animationsSaved ? t('settings.saved') : t('settings.saveApply')}
              </button>
              <button
                onClick={loadAnimations}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600"
              >
                {t('settings.reload')}
              </button>
              <button
                onClick={() => {
                  if (originalAnimations) {
                    setAnimations(JSON.parse(JSON.stringify(originalAnimations)))
                  }
                }}
                disabled={!originalAnimations}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-gray-400"
              >
                {t('settings.resetDefaults')}
              </button>
              <button
                onClick={() => setShowAnimation(false)}
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 ml-auto"
              >
                {t('settings.close')}
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
