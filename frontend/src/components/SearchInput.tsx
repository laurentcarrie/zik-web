interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function SearchInput({ value, onChange, placeholder = 'Search...' }: SearchInputProps) {
  return (
    <div className="mb-4">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base
                   focus:outline-none focus:border-[--color-link]
                   transition-colors"
      />
    </div>
  )
}
