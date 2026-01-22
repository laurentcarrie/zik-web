import { Link } from 'react-router-dom'
import type { Song } from '../api/types'

interface SongCardProps {
  song: Song
  sortBy: 'title' | 'author'
  isOdd: boolean
}

export default function SongCard({ song, sortBy, isOdd }: SongCardProps) {
  return (
    <li
      className={`p-3 border-b border-gray-200 last:border-b-0 ${
        isOdd ? 'bg-pink-100' : 'bg-purple-100'
      }`}
    >
      <Link
        to={`/song/${song.id}`}
        className="block no-underline hover:opacity-80 transition-opacity"
      >
        {sortBy === 'author' ? (
          <>
            <span className="font-[Fontskrivan] font-black text-lg text-[#ea580c]">
              {song.author}
            </span>
            <span className="text-gray-400 text-sm mx-2">performs</span>
            <span className="font-[Fontskrivan] font-black text-lg text-[#2563eb]">
              {song.title}
            </span>
          </>
        ) : (
          <>
            <span className="font-[Fontskrivan] font-black text-lg text-[#2563eb]">
              {song.title}
            </span>
            <span className="text-gray-400 text-sm mx-2">by</span>
            <span className="font-[Fontskrivan] font-black text-lg text-[#ea580c]">
              {song.author}
            </span>
          </>
        )}
      </Link>
    </li>
  )
}
