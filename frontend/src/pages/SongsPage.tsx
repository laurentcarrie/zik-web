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

export default function SongsPage() {
  const [sortBy, setSortBy] = useState<SortBy>('title')
  const [searchQuery, setSearchQuery] = useState('')

  const { data: songs = [], isLoading, error } = useQuery({
    queryKey: ['songs'],
    queryFn: fetchSongs,
  })

  const filteredAndSortedSongs = useMemo(() => {
    let filtered = songs

    if (searchQuery) {
      filtered = songs.filter(song =>
        fuzzyMatch(`${song.title} ${song.author}`, searchQuery)
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
  }, [songs, sortBy, searchQuery])

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
          className="inline-block mb-4 text-[--color-link] no-underline hover:underline"
        >
          &larr; Back
        </Link>

        <h1 className="text-gray-800 text-2xl md:text-3xl font-bold mb-6">Songs</h1>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setSortBy('title')}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              sortBy === 'title'
                ? 'bg-[--color-link] text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Sort by Title
          </button>
          <button
            onClick={() => setSortBy('author')}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              sortBy === 'author'
                ? 'bg-[--color-link] text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Sort by Author
          </button>
        </div>

        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search..."
        />

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
