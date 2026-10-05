import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
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
          target: env.VITE_API_PROXY_TARGET || 'https://server.checktheplants.ru',
          changeOrigin: true,
          secure: true,
          cookieDomainRewrite: '',
          configure(proxy) {
            const origin = env.VITE_API_PROXY_ORIGIN || 'https://checktheplants.ru'
            proxy.on('proxyReq', proxyReq => {
              proxyReq.setHeader('origin', origin)
            })
            proxy.on('proxyRes', proxyRes => {
              const cookies = proxyRes.headers['set-cookie']
              if (!cookies) return

              proxyRes.headers['set-cookie'] = cookies.map(cookie =>
                cookie
                  .replace(/;\s*Secure(?=;|$)/i, '')
                  .replace(/SameSite=None/i, 'SameSite=Lax')
              )
            })
          },
        },
      },
    },
  }
})