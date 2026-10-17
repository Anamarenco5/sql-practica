import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En desarrollo, Vite redirige /api al backend (puerto 3001).
// Así el navegador nunca conoce credenciales ni habla con MySQL directamente.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
