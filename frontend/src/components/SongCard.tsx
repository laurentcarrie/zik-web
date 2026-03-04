import { Link } from 'react-router-dom'
import type { Song } from '../api/types'

interface SongCardProps {
  song: Song
  sortBy: 'title' | 'author'
  isOdd: boolean
}

function HeadsetIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z" />
    </svg>
  )
}

function MetronomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12,1.75L8.57,2.67L4.06,19.53C4.03,19.68 4,19.84 4,20C4,21.11 4.89,22 6,22H18C19.11,22 20,21.11 20,20C20,19.84 19.97,19.68 19.94,19.53L18.58,14.42L17,16L17.2,17H13.41L16.25,14.16L14.84,12.75L10.59,17H6.8L10.29,4H13.71L15.17,9.43L16.8,7.79L15.43,2.67L12,1.75M11.25,5V14.75L12.75,13.25V5H11.25M19.79,7.8L16.96,10.63L16.25,9.92L14.84,11.34L17.66,14.16L19.08,12.75L18.37,12.04L21.2,9.21L19.79,7.8Z" />
    </svg>
  )
}

export default function SongCard({ song, sortBy, isOdd }: SongCardProps) {
  if (song.error) {
    return (
      <li className="p-3 border-b border-gray-700 last:border-b-0 bg-red-950/50">
        <Link
          to={`/song/${song.id}`}
          className="block no-underline hover:opacity-80 transition-opacity"
        >
          <span className="text-red-400 text-sm font-mono">{song.key}</span>
        </Link>
      </li>
    )
  }

  const icons = (
    <span className="flex items-center gap-1.5 shrink-0">
      <HeadsetIcon className={`w-4 h-4 ${song.has_song ? 'text-purple-400' : 'text-gray-700'}`} />
      <MetronomeIcon className={`w-4 h-4 ${song.has_clicks ? 'text-green-400' : 'text-gray-700'}`} />
    </span>
  )

  return (
    <li
      className={`p-3 border-b border-gray-700 last:border-b-0 ${
        isOdd ? 'bg-green-950/40' : 'bg-purple-950/40'
      }`}
    >
      <Link
        to={`/song/${song.id}`}
        className="block no-underline hover:opacity-80 transition-opacity"
      >
        {sortBy === 'author' ? (
          <div className="flex items-center gap-2">
            {icons}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline gap-1 sm:gap-0">
              <span className="font-[Fontskrivan] font-black text-base sm:text-lg text-[#ea580c] break-words">
                {song.author}
              </span>
              <span className="text-gray-500 text-sm sm:mx-2 hidden sm:inline">performs</span>
              <span className="font-[Fontskrivan] font-black text-base sm:text-lg text-[#2563eb] break-words">
                {song.title}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {icons}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline gap-1 sm:gap-0">
              <span className="font-[Fontskrivan] font-black text-base sm:text-lg text-[#2563eb] break-words">
                {song.title}
              </span>
              <span className="text-gray-500 text-sm sm:mx-2 hidden sm:inline">by</span>
              <span className="font-[Fontskrivan] font-black text-base sm:text-lg text-[#ea580c] break-words">
                {song.author}
              </span>
            </div>
          </div>
        )}
      </Link>
    </li>
  )
}
