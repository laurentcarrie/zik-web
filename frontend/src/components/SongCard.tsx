import { Link } from 'react-router-dom'
import type { Song } from '../api/types'

interface SongCardProps {
  song: Song
  sortBy: 'title' | 'author'
  isOdd: boolean
}

export default function SongCard({ song, sortBy, isOdd }: SongCardProps) {
  if (song.error) {
    return (
      <li className="p-3 border-b border-gray-200 last:border-b-0 bg-red-50">
        <Link
          to={`/song/${song.id}`}
          className="block no-underline hover:opacity-80 transition-opacity"
        >
          <span className="text-red-600 text-sm font-mono">{song.key}</span>
        </Link>
      </li>
    )
  }

  return (
    <li
      className={`p-3 border-b border-gray-200 last:border-b-0 ${
        isOdd ? 'bg-green-100' : 'bg-purple-100'
      }`}
    >
      <Link
        to={`/song/${song.id}`}
        className="block no-underline hover:opacity-80 transition-opacity"
      >
        {sortBy === 'author' ? (
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline gap-1 sm:gap-0">
            <span className="font-[Fontskrivan] font-black text-base sm:text-lg text-[#ea580c] break-words">
              {song.author}
            </span>
            <span className="text-gray-400 text-sm sm:mx-2 hidden sm:inline">performs</span>
            <span className="font-[Fontskrivan] font-black text-base sm:text-lg text-[#2563eb] break-words">
              {song.title}
            </span>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline gap-1 sm:gap-0">
            <span className="font-[Fontskrivan] font-black text-base sm:text-lg text-[#2563eb] break-words">
              {song.title}
            </span>
            <span className="text-gray-400 text-sm sm:mx-2 hidden sm:inline">by</span>
            <span className="font-[Fontskrivan] font-black text-base sm:text-lg text-[#ea580c] break-words">
              {song.author}
            </span>
          </div>
        )}
      </Link>
    </li>
  )
}
