import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchSong } from '../api/songs'
import ActionButton from '../components/ActionButton'

export default function SongDetailPage() {
  const { id } = useParams<{ id: string }>()

  const { data: song, isLoading, error } = useQuery({
    queryKey: ['song', id],
    queryFn: () => fetchSong(id!),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || !song) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-red-600">Song not found</p>
          <Link
            to="/songs"
            className="inline-block mt-4 text-[#667eea] hover:underline"
          >
            &larr; Back to Songs
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <Link
          to="/songs"
          className="inline-block mb-4 text-[#667eea] no-underline hover:underline"
        >
          &larr; Back to Songs
        </Link>

        <h1 className="font-[Fontskrivan] font-black text-2xl md:text-3xl text-[#2563eb] mb-2">
          {song.title}
        </h1>
        <p className="font-[Fontskrivan] font-black text-xl md:text-2xl text-[#ea580c] mb-6">
          {song.author}
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <ActionButton
            href={song.pdf_url}
            variant="pdf"
            target="_blank"
          >
            PDF
          </ActionButton>
          <ActionButton
            href={song.deezer_url}
            variant="deezer"
            target="_blank"
          >
            Deezer (Web)
          </ActionButton>
          <ActionButton
            href={song.deezer_app_url}
            variant="deezer-app"
          >
            Deezer (App)
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
