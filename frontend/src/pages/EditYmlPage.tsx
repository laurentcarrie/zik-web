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
}

interface SongFiles {
  lilypond?: string[]
  tex?: string[]
}

interface SongInfo {
  tempo?: number
}

interface ParsedYaml {
  structure?: StructureItem[]
  files?: SongFiles
  info?: SongInfo
}

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function EditYmlPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [sections, setSections] = useState<string[]>([])
  const [files, setFiles] = useState<SongFiles>({ lilypond: [], tex: [] })
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
      const ids = structure
        .filter((item): item is StructureItem & { id: string } => !!item?.id)
        .map(item => item.id)
      setSections(ids)
      setFiles({
        lilypond: parsed?.files?.lilypond || [],
        tex: parsed?.files?.tex || [],
      })
      setTempo(parsed?.info?.tempo)
    } catch {
      setSections([])
      setFiles({ lilypond: [], tex: [] })
      setTempo(undefined)
    }
  }

  if (songLoading || ymlLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (!song) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-red-600">Song not found</p>
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
      <div className="max-w-4xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
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
            href={`/master/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Master
          </a>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-gray-700 font-medium mb-3">Lyrics</h3>
          <div className="flex flex-wrap gap-2">
            {sections.length > 0 ? (
              sections.map((sectionId) => (
                <a
                  key={sectionId}
                  href={`/edit-lyrics/${id}/${encodeURIComponent(sectionId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-[140px] bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {sectionId}
                </a>
              ))
            ) : (
              <span className="text-gray-500 italic">No sections found in structure</span>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-gray-700 font-medium mb-3">TeX Files</h3>
          <div className="flex flex-wrap gap-2">
            {files.tex && files.tex.length > 0 ? (
              files.tex.map((file) => (
                <a
                  key={file}
                  href={`/edit-tex/${id}/${encodeURIComponent(file)}`}
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
            ) : (
              <span className="text-gray-500 italic">No TeX files</span>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-gray-700 font-medium mb-3">LilyPond Files</h3>
          <div className="flex flex-wrap gap-2">
            {files.lilypond && files.lilypond.length > 0 ? (
              files.lilypond.map((file) => (
                <div key={file} className="flex flex-col gap-1">
                  <a
                    href={`/edit-lilypond/${id}/${encodeURIComponent(file)}`}
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
              <span className="text-gray-500 italic">No LilyPond files</span>
            )}
          </div>
        </div>


      </div>
    </div>
  )
}
