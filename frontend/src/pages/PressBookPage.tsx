import { useNavigate } from 'react-router-dom'

export default function PressBookPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto bg-white/95 rounded-2xl p-4 md:p-8 shadow-2xl">
        <button
          onClick={() => navigate(-1)}
          className="inline-block mb-4 text-[#667eea] hover:underline bg-transparent border-none cursor-pointer text-base"
        >
          &larr; Back
        </button>

        <h1 className="text-gray-800 text-2xl md:text-3xl font-bold mb-6">Press Book</h1>

        <p className="text-gray-600">Press book content coming soon...</p>
      </div>
    </div>
  )
}
