export default function LandingPage() {
  return (
    <div style={{
      margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#1a1a2e', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <a href="/mtl" style={{
          display: 'block', padding: '1.5rem 3rem', borderRadius: 12,
          textDecoration: 'none', color: 'white', fontSize: '1.5rem',
          fontWeight: 600, textAlign: 'center',
          background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
        }}>Move The Line</a>
        <a href="/sunny-bd" style={{
          display: 'block', padding: '1.5rem 3rem', borderRadius: 12,
          textDecoration: 'none', color: 'white', fontSize: '1.5rem',
          fontWeight: 600, textAlign: 'center',
          background: 'linear-gradient(135deg, #ea580c, #eab308)',
        }}>Sunny Bd</a>
        <a href="/dadrock" style={{
          display: 'block', padding: '1.5rem 3rem', borderRadius: 12,
          textDecoration: 'none', color: 'white', fontSize: '1.5rem',
          fontWeight: 600, textAlign: 'center',
          background: 'linear-gradient(135deg, #dc2626, #4b5563)',
        }}>Dadrock</a>
      </div>
    </div>
  )
}
