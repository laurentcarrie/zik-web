import type { ReactNode } from 'react'

interface ActionButtonProps {
  href: string
  variant: 'pdf' | 'deezer' | 'deezer-app' | 'spotify' | 'spotify-app' | 'edit'
  target?: '_blank' | '_self'
  children: ReactNode
}

const variantStyles = {
  pdf: 'bg-[#dc2626] hover:bg-red-700',
  deezer: 'bg-[#a238ff] hover:bg-purple-700',
  'deezer-app': 'bg-[#ff6b35] hover:bg-orange-600',
  spotify: 'bg-[#1DB954] hover:bg-green-600',
  'spotify-app': 'bg-[#191414] hover:bg-gray-800',
  edit: 'bg-[#6b7280] hover:bg-gray-600',
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8.5 13H10c.83 0 1.5.67 1.5 1.5S10.83 16 10 16H9v1.5H8.5V13zM9 15h1c.28 0 .5-.22.5-.5s-.22-.5-.5-.5H9v1zm3.5-2h1.75c.83 0 1.5.67 1.5 1.5v2c0 .83-.67 1.5-1.5 1.5H12.5V13zm1 4h.75c.28 0 .5-.22.5-.5v-2c0-.28-.22-.5-.5-.5h-.75v3zm3-4H18v.5h-1v1h1v.5h-1v1.5h-.5V13z"/>
    </svg>
  )
}

function DeezerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.81 4.16v3.03H24V4.16h-5.19zM6.27 8.38v3.027h5.189V8.38h-5.19zm12.54 0v3.027H24V8.38h-5.19zM6.27 12.594v3.027h5.189v-3.027h-5.19zm6.27 0v3.027h5.19v-3.027h-5.19zm6.27 0v3.027H24v-3.027h-5.19zM0 16.81v3.029h5.19v-3.03H0zm6.27 0v3.029h5.189v-3.03h-5.19zm6.27 0v3.029h5.19v-3.03h-5.19zm6.27 0v3.029H24v-3.03h-5.19z"/>
    </svg>
  )
}

function SpotifyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  )
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>
  )
}

export { PdfIcon, DeezerIcon, SpotifyIcon, EditIcon }

export default function ActionButton({ href, variant, target, children }: ActionButtonProps) {
  return (
    <a
      href={href}
      target={target}
      rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      className={`inline-flex items-center gap-2 px-4 py-3 text-white no-underline rounded-lg text-base font-medium
                  h-[44px] w-24 justify-center
                  transition-colors active:scale-95
                  ${variantStyles[variant]}`}
    >
      {children}
    </a>
  )
}
