import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: 'router',
              test: /node_modules[\\/](react-router|react-router-dom|@remix-run)[\\/]/,
            },
            {
              name: 'vendor',
              test: /node_modules/,
            },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://server.checktheplants.ru',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})