import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchSong, fetchSongYml } from '../api/songs'
import yaml from 'js-yaml'

// Custom YAML schema to handle custom tags
const customTags = [
  '!Chords', '!Lyrics', '!Tab', '!Notes', '!Section',
  '!Verse', '!Chorus', '!Bridge', '!Intro', '!Outro',
  '!NewColumn', '!HorizontalRule', '!HRule', '!Ref'
]

function createCustomSchema() {
  const types = customTags.flatMap(tag => [
    new yaml.Type(tag, { kind: 'scalar', construct: (data: unknown) => data }),
    new yaml.Type(tag, { kind: 'mapping', construct: (data: unknown) => data }),
    new yaml.Type(tag, { kind: 'sequence', construct: (data: unknown) => data }),
  ])
  return yaml.DEFAULT_SCHEMA.extend(types)
}

const CUSTOM_SCHEMA = createCustomSchema()

interface StructureItem {
  id?: string
  item?: { rows?: string[]; link?: string; type?: string }
}

interface SectionInfo {
  id: string
  type: string
}

const SECTION_COLORS: Record<string, { bg: string; hover: string }> = {
  intro:      { bg: 'bg-amber-400',   hover: 'hover:bg-amber-500' },
  couplet:    { bg: 'bg-green-500',   hover: 'hover:bg-green-600' },
  couplet2:   { bg: 'bg-green-600',   hover: 'hover:bg-green-700' },
  couplet3:   { bg: 'bg-green-700',   hover: 'hover:bg-green-800' },
  prerefrain: { bg: 'bg-sky-300',     hover: 'hover:bg-sky-400' },
  refrain:    { bg: 'bg-blue-400',    hover: 'hover:bg-blue-500' },
  refrainb:   { bg: 'bg-cyan-400',    hover: 'hover:bg-cyan-500' },
  pont:       { bg: 'bg-purple-400',  hover: 'hover:bg-purple-500' },
  outro:      { bg: 'bg-teal-400',    hover: 'hover:bg-teal-500' },
  solo:       { bg: 'bg-red-400',     hover: 'hover:bg-red-500' },
  interlude:  { bg: 'bg-orange-400',  hover: 'hover:bg-orange-500' },
  riff:       { bg: 'bg-gray-400',    hover: 'hover:bg-gray-500' },
  fill:       { bg: 'bg-teal-200',    hover: 'hover:bg-teal-300' },
  final:      { bg: 'bg-teal-400',    hover: 'hover:bg-teal-500' },
}

const DEFAULT_SECTION_COLOR = { bg: 'bg-emerald-500', hover: 'hover:bg-emerald-600' }

function getSectionColor(type: string) {
  return SECTION_COLORS[type] || DEFAULT_SECTION_COLOR
}

interface SongFiles {
  lilypond?: string[]
  tex?: string[]
  drums?: string[]
}

interface SongInfo {
  tempo?: number
}

interface ParsedYaml {
  structure?: StructureItem[]
  files?: SongFiles
  info?: SongInfo
}

import { API_BASE, ROUTE_PREFIX } from '../config'

export default function EditYmlPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [sections, setSections] = useState<SectionInfo[]>([])
  const [files, setFiles] = useState<SongFiles>({ lilypond: [], tex: [], drums: [] })
  const [tempo, setTempo] = useState<number | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)

  async function handleListen(file: string, songKey: string) {
    setIsLoading(true)
    try {
      const dir = songKey.substring(0, songKey.lastIndexOf('/'))
      const s3Key = `${dir}/${file}`

      // Fetch lilypond data
      const s3Res = await fetch(`${API_BASE}/api/s3/${s3Key}`)
      if (!s3Res.ok) throw new Error('Failed to fetch lilypond file')
      const s3Data = await s3Res.json()
      console.log(s3Data)

      // Convert to HTML
      const stem = file.replace(/\.ly$/, '')
      const htmlRes = await fetch(`${API_BASE}/api/lilypond-to-html`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: s3Data.data, stem, tempo }),
      })
      if (!htmlRes.ok) {
        const errorText = await htmlRes.text()
        throw new Error(errorText || 'Failed to convert lilypond to HTML')
      }
      const htmlData = await htmlRes.json()
      console.log(htmlData)

      // Open HTML in a new window
      const newWindow = window.open('', '_blank')
      if (newWindow) {
        newWindow.document.write(htmlData.html)
        newWindow.document.close()
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Failed to load strudel: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }

  const { data: song, isLoading: songLoading } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
  })

  const { data: ymlData, isLoading: ymlLoading } = useQuery({
    queryKey: ['songYml', id],
    queryFn: () => fetchSongYml(id!),
    enabled: !!id,
  })

  useEffect(() => {
    if (ymlData?.content) {
      parseYaml(ymlData.content)
    }
  }, [ymlData])

  function parseYaml(text: string) {
    try {
      const parsed = yaml.load(text, { schema: CUSTOM_SCHEMA }) as ParsedYaml | null
      const structure = parsed?.structure || []
      // Build a map of id -> type for resolving Ref links
      const typeById: Record<string, string> = {}
      for (const s of structure) {
        if (s?.id && s?.item && typeof s.item === 'object' && s.item.type) {
          typeById[s.id] = s.item.type
        }
      }
      const sectionInfos = structure
        .filter((item): item is StructureItem & { id: string; item: { type?: string; link?: string } } =>
          !!item?.id && !!item?.item && typeof item.item === 'object' &&
          ('rows' in item.item || 'link' in item.item))
        .map(item => {
          const type = item.item.type
            || (item.item.link && typeById[item.item.link])
            || ''
          return { id: item.id, type }
        })
      setSections(sectionInfos)
      setFiles({
        lilypond: parsed?.files?.lilypond || [],
        tex: parsed?.files?.tex || [],
        drums: parsed?.files?.drums || [],
      })
      setTempo(parsed?.info?.tempo)
    } catch {
      setSections([] as SectionInfo[])
      setFiles({ lilypond: [], tex: [], drums: [] })
      setTempo(undefined)
    }
  }

  // Escape key goes back
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        navigate(-1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  if (songLoading || ymlLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-gray-900/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!song) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-gray-900/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-red-400">Song not found</p>
          <button
            onClick={() => navigate(-1)}
            className="inline-block mt-4 text-[#667eea] hover:underline"
          >
            &larr; Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-4xl mx-auto bg-gray-900/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <button
          onClick={() => navigate(-1)}
          className="text-[#667eea] no-underline hover:underline mb-4 inline-block"
        >
          &larr; Back
        </button>

        <h1 className="font-[Fontskrivan] font-black text-2xl md:text-3xl text-[#2563eb] mb-1">
          {song.title}
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-6">
          {song.author}
        </p>

        <div className="flex items-center gap-4 mb-6">
          <a
            href={`${ROUTE_PREFIX}/master/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Master
          </a>
          {song.clicks_url ? (
            <a
              href={`${ROUTE_PREFIX}/edit-clicks/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
              </svg>
              clicks.yml
            </a>
          ) : (
            <span className="inline-flex items-center gap-2 px-6 py-3 bg-gray-700 text-gray-500 rounded-lg font-medium cursor-not-allowed">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
              </svg>
              clicks.yml
            </span>
          )}
        </div>

        <div className="pt-4 border-t border-gray-700">
          <h3 className="text-gray-300 font-medium mb-3">Lyrics</h3>
          <div className="flex flex-wrap gap-2">
            {sections.length > 0 ? (
              sections.map((section) => {
                const color = getSectionColor(section.type)
                return (
                  <a
                    key={section.id}
                    href={`${ROUTE_PREFIX}/edit-lyrics/${id}/${encodeURIComponent(section.id)}`}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] ${color.bg} text-white rounded-lg text-sm ${color.hover} transition-colors`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    {section.id}
                  </a>
                )
              })
            ) : (
              <span className="text-gray-400 italic">No sections found in structure</span>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-700">
          <h3 className="text-gray-300 font-medium mb-3">TeX Files</h3>
          <div className="flex flex-wrap gap-2">
            <a
              href={`${ROUTE_PREFIX}/edit-tex/${id}/${encodeURIComponent('body.tex')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              body.tex
            </a>
            {files.tex && files.tex.length > 0 && (
              files.tex.map((file) => (
                <a
                  key={file}
                  href={`${ROUTE_PREFIX}/edit-tex/${id}/${encodeURIComponent(file)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {file}
                </a>
              ))
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-700">
          <h3 className="text-gray-300 font-medium mb-3">LilyPond Files</h3>
          <div className="flex flex-wrap gap-2">
            {files.lilypond && files.lilypond.length > 0 ? (
              files.lilypond.map((file) => (
                <div key={file} className="flex flex-col gap-1">
                  <a
                    href={`${ROUTE_PREFIX}/edit-lilypond/${id}/${encodeURIComponent(file)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] bg-purple-500 text-white rounded-lg text-sm hover:bg-purple-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    {file}
                  </a>
                  <button
                    onClick={() => handleListen(file, song.key)}
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] bg-purple-300 text-purple-900 rounded-lg text-sm hover:bg-purple-400 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                    {isLoading ? 'Loading...' : 'Listen'}
                  </button>
                </div>
              ))
            ) : (
              <span className="text-gray-400 italic">No LilyPond files</span>
            )}
          </div>
        </div>

        {files.drums && files.drums.length > 0 && (
          <div className="pt-4 border-t border-gray-700">
            <h3 className="text-gray-300 font-medium mb-3">Drum Structures</h3>
            <div className="flex flex-wrap gap-2">
              {files.drums.map((file) => (
                <a
                  key={file}
                  href={`${ROUTE_PREFIX}/edit-drums/${id}/${encodeURIComponent(file)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {file}
                </a>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
