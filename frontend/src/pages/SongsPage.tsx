import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchSongs } from '../api/songs'
import SearchInput from '../components/SearchInput'
import SongCard from '../components/SongCard'

type SortBy = 'title' | 'author'

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let ti = 0
  for (let qi = 0; qi < lowerQuery.length; qi++) {
    const char = lowerQuery[qi]
    while (ti < lowerText.length && lowerText[ti] !== char) ti++
    if (ti >= lowerText.length) return false
    ti++
  }
  return true
}

function exactMatch(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase())
}

export default function SongsPage() {
  const { t } = useTranslation()
  const [sortBy, setSortBy] = useState<SortBy>('title')
  const [searchQuery, setSearchQuery] = useState('')
  const [useFuzzy, setUseFuzzy] = useState(true)

  const { data: songs = [], isLoading, error } = useQuery({
    queryKey: ['songs'],
    queryFn: fetchSongs,
  })

  const filteredAndSortedSongs = useMemo(() => {
    let filtered = songs

    if (searchQuery) {
      const matchFn = useFuzzy ? fuzzyMatch : exactMatch
      filtered = songs.filter(song =>
        matchFn(`${song.title} ${song.author}`, searchQuery)
      )
    }

    return [...filtered].sort((a, b) => {
      if (sortBy === 'author') {
        return a.author.toLowerCase().localeCompare(b.author.toLowerCase()) ||
               a.title.toLowerCase().localeCompare(b.title.toLowerCase())
      }
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase()) ||
             a.author.toLowerCase().localeCompare(b.author.toLowerCase())
    })
  }, [songs, sortBy, searchQuery, useFuzzy])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl max-w-lg">
          <h2 className="text-red-600 text-xl font-bold mb-2">Failed to load songs</h2>
          <p className="text-gray-600 text-sm break-words">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <Link
            to="/"
            className="text-[#667eea] no-underline hover:underline"
          >
            &larr; {t('nav.back')}
          </Link>
          <Link
            to="/settings"
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            title={t('settings.title')}
          >
            <GearIcon className="w-5 h-5" />
          </Link>
        </div>

        <h1 className="text-gray-800 text-2xl md:text-3xl font-bold mb-6">{t('songs.title')}</h1>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setSortBy('title')}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              sortBy === 'title'
                ? 'bg-[#667eea] text-white'
                : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
            }`}
          >
            {t('songs.sortByTitle')}
          </button>
          <button
            onClick={() => setSortBy('author')}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              sortBy === 'author'
                ? 'bg-[#667eea] text-white'
                : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
            }`}
          >
            {t('songs.sortByAuthor')}
          </button>
        </div>

        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('songs.searchPlaceholder')}
        />

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <span className={`text-sm ${!useFuzzy ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>Exact</span>
          <button
            onClick={() => setUseFuzzy(!useFuzzy)}
            className={`relative w-10 h-6 rounded-full transition-colors ${
              useFuzzy ? 'bg-[#667eea]' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                useFuzzy ? 'left-5' : 'left-1'
              }`}
            />
          </button>
          <span className={`text-sm ${useFuzzy ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>Fuzzy</span>
        </label>

        <p className="text-gray-500 text-sm mb-4">
          {filteredAndSortedSongs.length} songs
        </p>

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : (
          <ul className="list-none">
            {filteredAndSortedSongs.map((song, index) => (
              <SongCard
                key={song.id}
                song={song}
                sortBy={sortBy}
                isOdd={index % 2 === 0}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
