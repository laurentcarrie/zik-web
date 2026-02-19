import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { API_BASE } from '../config'

async function fetchPhotos(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/press-book/photos`)
  if (!response.ok) {
    throw new Error('Failed to fetch photos')
  }
  return response.json()
}

async function fetchVideos(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/press-book/videos`)
  if (!response.ok) {
    throw new Error('Failed to fetch videos')
  }
  return response.json()
}

function getVideoName(path: string): string {
  const filename = path.split('/').pop() || path
  // Remove extension
  return filename.replace(/\.(mp4|mov|webm|avi)$/i, '')
}

function getVideoThumbnail(videoUrl: string): string {
  // Assumes thumbnail is stored as video.mp4.thumb.jpg
  return videoUrl + '.thumb.jpg'
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M7.72 12.53a.75.75 0 0 1 0-1.06l7.5-7.5a.75.75 0 1 1 1.06 1.06L9.31 12l6.97 6.97a.75.75 0 1 1-1.06 1.06l-7.5-7.5Z" clipRule="evenodd" />
    </svg>
  )
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M16.28 11.47a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 0 1-1.06-1.06L14.69 12 7.72 5.03a.75.75 0 0 1 1.06-1.06l7.5 7.5Z" clipRule="evenodd" />
    </svg>
  )
}

export default function PressBookPage() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)

  const { data: photos = [], isLoading: photosLoading } = useQuery({
    queryKey: ['press-book-photos'],
    queryFn: fetchPhotos,
  })

  const { data: videos = [], isLoading: videosLoading } = useQuery({
    queryKey: ['press-book-videos'],
    queryFn: fetchVideos,
  })

  // Auto-advance slideshow
  useEffect(() => {
    if (!isPlaying || photos.length === 0) return

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % photos.length)
    }, 4000)

    return () => clearInterval(interval)
  }, [isPlaying, photos.length])

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length)
  }

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % photos.length)
  }

  const togglePlay = () => {
    setIsPlaying(!isPlaying)
  }

  const isLoading = photosLoading || videosLoading

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen p-4 md:p-8">
        <div className="max-w-4xl mx-auto bg-gray-900/95 rounded-2xl p-4 md:p-8 shadow-2xl">
          <button
            onClick={() => navigate(-1)}
            className="inline-block mb-4 text-[#667eea] hover:underline bg-transparent border-none cursor-pointer text-base"
          >
            &larr; Back
          </button>
          <h1 className="text-gray-100 text-2xl md:text-3xl font-bold mb-6">Press Book</h1>
          <p className="text-gray-300 leading-relaxed">
            Photos and videos are hosted on CloudFront and currently under review by the editorial team. Check back soon!
          </p>
          <p className="text-gray-400 mt-4 italic">
            Les photos et vidéos sont sur CloudFront, et en cours de revue par l'équipe éditoriale. Revenez bientôt pour les consulter !
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-gray-900/95 rounded-2xl p-8 shadow-2xl">
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-4xl mx-auto bg-gray-900/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <button
          onClick={() => navigate(-1)}
          className="inline-block mb-4 text-[#667eea] hover:underline bg-transparent border-none cursor-pointer text-base"
        >
          &larr; Back
        </button>

        <h1 className="text-gray-100 text-2xl md:text-3xl font-bold mb-6">Press Book</h1>

        {/* Photos Slideshow */}
        {photos.length > 0 && (
          <div className="mb-8">
            <h2 className="text-gray-300 text-xl font-semibold mb-4">Photos</h2>
            <div className="relative">
              {/* Main image */}
              <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden">
                <img
                  src={photos[currentIndex]}
                  alt={`Photo ${currentIndex + 1}`}
                  className="w-full h-full object-contain"
                />

                {/* Navigation arrows */}
                <button
                  onClick={goToPrevious}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
                >
                  <ChevronLeftIcon className="w-6 h-6" />
                </button>
                <button
                  onClick={goToNext}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition-colors"
                >
                  <ChevronRightIcon className="w-6 h-6" />
                </button>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-4 mt-4">
                <button
                  onClick={togglePlay}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    isPlaying
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-green-500 hover:bg-green-600 text-white'
                  }`}
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <span className="text-gray-400">
                  {currentIndex + 1} / {photos.length}
                </span>
              </div>

              {/* Thumbnail strip */}
              <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
                {photos.map((photo, index) => (
                  <button
                    key={photo}
                    onClick={() => setCurrentIndex(index)}
                    className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      index === currentIndex
                        ? 'border-[#667eea]'
                        : 'border-transparent hover:border-gray-300'
                    }`}
                  >
                    <img
                      src={photo}
                      alt={`Thumbnail ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Videos Grid */}
        {videos.length > 0 && (
          <div>
            <h2 className="text-gray-300 text-xl font-semibold mb-4">Videos</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {videos.map((video) => (
                <div key={video} className="rounded-lg overflow-hidden bg-black">
                  <video
                    controls
                    preload="metadata"
                    poster={getVideoThumbnail(video)}
                    className="w-full aspect-video"
                  >
                    <source src={video} type={video.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'} />
                    Your browser does not support the video tag.
                  </video>
                  <div className="bg-gray-800 px-3 py-2">
                    <span className="text-white text-sm truncate block">{getVideoName(video)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {photos.length === 0 && videos.length === 0 && (
          <p className="text-gray-400">No media available.</p>
        )}
      </div>
    </div>
  )
}
