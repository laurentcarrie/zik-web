import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchSongs } from '../api/songs'
import SearchInput from '../components/SearchInput'
import SongCard from '../components/SongCard'

type SortBy = 'title' | 'author'

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
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-red-600">Failed to load songs</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <Link
          to="/"
          className="inline-block mb-4 text-[#667eea] no-underline hover:underline"
        >
          &larr; Back
        </Link>

        <h1 className="text-gray-800 text-2xl md:text-3xl font-bold mb-6">Songs</h1>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setSortBy('title')}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              sortBy === 'title'
                ? 'bg-[#667eea] text-white'
                : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
            }`}
          >
            By Title
          </button>
          <button
            onClick={() => setSortBy('author')}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              sortBy === 'author'
                ? 'bg-[#667eea] text-white'
                : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
            }`}
          >
            By Author
          </button>
        </div>

        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search..."
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
