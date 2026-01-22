import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/pdf': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/version': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/save-yml': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/save-lyrics': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/update': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
