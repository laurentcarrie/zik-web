import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="min-h-screen flex justify-center items-center p-8">
      <div className="text-center">
        <nav className="flex flex-col gap-4">
          <Link
            to="/songs"
            className="block px-12 py-6 bg-black/50 text-white no-underline rounded-xl
                       font-[Fontskrivan] text-4xl font-black
                       transition-all duration-300 backdrop-blur-sm
                       hover:bg-black/70 hover:-translate-y-0.5
                       active:scale-95"
          >
            Songs
          </Link>
        </nav>
      </div>
    </div>
  )
}
