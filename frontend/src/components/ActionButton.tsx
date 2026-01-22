import type { ReactNode } from 'react'

interface ActionButtonProps {
  href: string
  variant: 'pdf' | 'deezer' | 'deezer-app' | 'spotify' | 'spotify-app'
  target?: '_blank' | '_self'
  children: ReactNode
}

const variantStyles = {
  pdf: 'bg-[#dc2626] hover:bg-red-700',
  deezer: 'bg-[#a238ff] hover:bg-purple-700',
  'deezer-app': 'bg-[#ff6b35] hover:bg-orange-600',
  spotify: 'bg-[#1DB954] hover:bg-green-600',
  'spotify-app': 'bg-[#191414] hover:bg-gray-800',
}

export default function ActionButton({ href, variant, target, children }: ActionButtonProps) {
  return (
    <a
      href={href}
      target={target}
      rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      className={`inline-block px-6 py-3 text-white no-underline rounded-lg text-base font-medium
                  min-h-[44px] min-w-[44px] text-center
                  transition-colors active:scale-95
                  ${variantStyles[variant]}`}
    >
      {children}
    </a>
  )
}
