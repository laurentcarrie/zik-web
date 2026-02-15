import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendPaths = ['/api', '/static', '/pdf', '/version', '/save-yml', '/save-lyrics', '/update']
const bands = ['/mtl', '/sunny-bd']

function buildProxy() {
  const proxy: Record<string, { target: string; changeOrigin: boolean }> = {}
  const target = { target: 'http://localhost:8080', changeOrigin: true }

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
    port: 3000,
    proxy: buildProxy(),
  },
})
