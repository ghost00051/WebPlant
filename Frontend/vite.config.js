// vite.config.js
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://server.checktheplants.ru',
        changeOrigin: true,
        secure: true,
        // cookieDomainRewrite НЕ нужен — сервер не ставит Domain
      }
    }
  }
})