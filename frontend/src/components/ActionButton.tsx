import type { ReactNode } from 'react'

interface ActionButtonProps {
  href?: string
  variant: 'pdf' | 'deezer' | 'deezer-app' | 'spotify' | 'spotify-app' | 'edit'
  target?: '_blank' | '_self'
  children: ReactNode
  disabled?: boolean
  title?: string
}

const variantStyles = {
  pdf: 'bg-[#dc2626] hover:bg-red-700',
  deezer: 'bg-[#191414] hover:bg-gray-800',
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
    <img src="/deezer-favicon.ico" alt="Deezer" className={className} />
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

function MakeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
    </svg>
  )
}

export { PdfIcon, DeezerIcon, SpotifyIcon, EditIcon, MakeIcon }

export default function ActionButton({ href, variant, target, children, disabled, title }: ActionButtonProps) {
  if (disabled || !href) {
    return (
      <div className="relative group self-center">
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-white no-underline rounded text-[10px] font-medium
                      h-[24px] w-16 justify-center bg-gray-400 cursor-not-allowed opacity-60 [&>svg]:w-3 [&>svg]:h-3"
        >
          {children}
        </span>
        {title && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            {title}
          </div>
        )}
      </div>
    )
  }
  return (
    <a
      href={href}
      target={target}
      rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      title={title}
      className={`inline-flex items-center gap-2 px-4 py-3 text-white no-underline rounded-lg text-base font-medium
                  h-[44px] min-w-24 justify-center self-center
                  transition-colors active:scale-95
                  ${variantStyles[variant]}`}
    >
      {children}
    </a>
  )
}
