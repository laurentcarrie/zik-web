import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchSong, fetchSongYml, saveSongYml } from '../api/songs'
import yaml from 'js-yaml'
import CodeMirror from '@uiw/react-codemirror'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { useAuth } from '../context/AuthContext'
import PasswordModal from '../components/PasswordModal'

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

export default function MasterPage() {
  const { id } = useParams<{ id: string }>()
  const [content, setContent] = useState('')
  const [isValid, setIsValid] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const { t } = useTranslation()
  const { isAuthenticated } = useAuth()

  const handleEditorChange = useCallback((value: string) => {
    setContent(value)
  }, [])

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

  const saveMutation = useMutation({
    mutationFn: (newContent: string) => saveSongYml(id!, newContent),
    onSuccess: () => {
      alert('Saved successfully!')
    },
    onError: (error: Error) => {
      if (error.message === 'Unauthorized') {
        setShowPasswordModal(true)
      } else {
        alert(error.message)
      }
    },
  })

  useEffect(() => {
    if (ymlData?.content) {
      setContent(ymlData.content)
    }
  }, [ymlData])

  useEffect(() => {
    validateYaml(content)
  }, [content])

  function validateYaml(text: string) {
    try {
      yaml.load(text, { schema: CUSTOM_SCHEMA })
      setIsValid(true)
      setErrorMessage('')
    } catch (e) {
      const error = e as Error
      if (error.message?.includes('unknown tag')) {
        setIsValid(true)
        setErrorMessage('')
      } else {
        setIsValid(false)
        setErrorMessage(error.message || 'Invalid YAML')
      }
    }
  }

  function handleSave() {
    if (!isValid) return
    if (!isAuthenticated) {
      setShowPasswordModal(true)
      return
    }
    saveMutation.mutate(content)
  }

  function handlePasswordSuccess() {
    setShowPasswordModal(false)
    saveMutation.mutate(content)
  }

  function handleClose() {
    window.close()
  }

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
            onClick={handleClose}
            className="inline-block mt-4 text-[#667eea] hover:underline"
          >
            &larr; Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-4xl mx-auto bg-gray-900/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <button
          onClick={handleClose}
          className="text-[#667eea] no-underline hover:underline mb-4 inline-block"
        >
          &larr; Close
        </button>

        <h1 className="font-[Fontskrivan] font-black text-2xl md:text-3xl text-[#2563eb] mb-1">
          Master: {song.title}
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-6">
          {song.author}
        </p>

        <CodeMirror
          value={content}
          height="500px"
          theme={oneDark}
          extensions={[yamlLang()]}
          onChange={handleEditorChange}
          className="border border-gray-700 rounded-lg overflow-hidden"
        />

        {!isValid && errorMessage && (
          <div className="mt-2 p-3 bg-red-900/50 text-red-300 rounded-lg text-sm font-mono">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center gap-4 mt-4">
          <button
            onClick={handleSave}
            disabled={!isValid || saveMutation.isPending}
            className="px-6 py-3 bg-[#667eea] text-white rounded-lg font-medium hover:bg-[#5a67d8] disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>

          <button
            onClick={() => setShowHelp(true)}
            className="px-4 py-3 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-500 transition-colors"
          >
            {t('songYml.button')}
          </button>

          <span className={`text-sm px-3 py-1 rounded ${isValid ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
            {isValid ? 'Valid YAML' : 'Invalid YAML'}
          </span>
        </div>

        {showHelp && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowHelp(false)}>
            <div className="bg-gray-900/95 rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-gray-200 text-xl font-bold">{t('songYml.title')}</h2>
                <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-200 text-2xl leading-none">&times;</button>
              </div>

              <div className="space-y-4 text-sm">
                <div>
                  <h3 className="text-blue-300 font-bold mb-1">{t('songYml.sectionInfo')}</h3>
                  <p className="text-gray-400 mb-2">{t('songYml.infoDesc')}</p>
                  <ul className="text-gray-300 space-y-1 ml-4 list-disc">
                    <li><code className="text-blue-200">{t('songYml.fieldTitle')}</code></li>
                    <li><code className="text-blue-200">{t('songYml.fieldAuthor')}</code></li>
                    <li><code className="text-blue-200">{t('songYml.fieldTempo')}</code></li>
                    <li><code className="text-blue-200">{t('songYml.fieldTimeSig')}</code></li>
                    <li><code className="text-blue-200">{t('songYml.fieldTags')}</code></li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-blue-300 font-bold mb-1">{t('songYml.sectionFiles')}</h3>
                  <p className="text-gray-400 mb-2">{t('songYml.filesDesc')}</p>
                  <ul className="text-gray-300 space-y-1 ml-4 list-disc">
                    <li><code className="text-blue-200">{t('songYml.fieldLilypond')}</code></li>
                    <li><code className="text-blue-200">{t('songYml.fieldTex')}</code></li>
                    <li><code className="text-blue-200">{t('songYml.fieldWav')}</code></li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-blue-300 font-bold mb-1">{t('songYml.sectionMeta')}</h3>
                  <p className="text-gray-400 mb-2">{t('songYml.metaDesc')}</p>
                  <ul className="text-gray-300 space-y-1 ml-4 list-disc">
                    <li><code className="text-blue-200">{t('songYml.fieldDate')}</code></li>
                    <li><code className="text-blue-200">{t('songYml.fieldDigest')}</code></li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-blue-300 font-bold mb-1">{t('songYml.sectionStructure')}</h3>
                  <p className="text-gray-400 mb-2">{t('songYml.structureDesc')}</p>
                  <ul className="text-gray-300 space-y-2 ml-4 list-disc">
                    <li><code className="text-yellow-300">!Chords</code> — {t('songYml.tagChords')}</li>
                    <li><code className="text-yellow-300">!Ref</code> — {t('songYml.tagRef')}</li>
                    <li><code className="text-yellow-300">!NewColumn</code> — {t('songYml.tagNewColumn')}</li>
                    <li><code className="text-yellow-300">!HRule</code> — {t('songYml.tagHRule')}</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-blue-300 font-bold mb-1">{t('songYml.sectionChordFormat')}</h3>
                  <p className="text-gray-400">{t('songYml.chordFormatDesc')}</p>
                </div>

                <div>
                  <h3 className="text-blue-300 font-bold mb-1">{t('songYml.sectionColors')}</h3>
                  <p className="text-gray-400">{t('songYml.colorsDesc')}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <PasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={handlePasswordSuccess}
      />
    </div>
  )
}
