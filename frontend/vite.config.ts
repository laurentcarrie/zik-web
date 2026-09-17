import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Ports mirror the Makefile's BACKEND_PORT/FRONTEND_PORT, which it exports into
// the recipe environment; the defaults are the historical 8080/3000.
const backendPort = process.env.BACKEND_PORT ?? '8080'
const frontendPort = Number(process.env.FRONTEND_PORT ?? 3000)

const backendPaths = ['/api', '/static', '/pdf', '/save-yml', '/save-lyrics', '/update']
const bands = ['/mtl', '/sunny-bd', '/dadrock']

function buildProxy() {
  const proxy: Record<string, { target: string; changeOrigin: boolean; ws?: boolean }> = {}
  const target = { target: `http://localhost:${backendPort}`, changeOrigin: true }
  const wsTarget = { target: `http://localhost:${backendPort}`, changeOrigin: true, ws: true }

  // WebSocket proxy for click-sync (must be before /api to take priority)
  proxy['/api/click-sync'] = wsTarget
  for (const band of bands) {
    proxy[`${band}/api/click-sync`] = wsTarget
  }

  // Proxy backend paths at root and under each band prefix
  for (const path of backendPaths) {
    proxy[path] = target
    for (const band of bands) {
      proxy[`${band}${path}`] = target
    }
  }
  return proxy
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: frontendPort,
    proxy: buildProxy(),
  },
})
