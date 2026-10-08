import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
    },
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
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:5000',
          changeOrigin: true,
          secure: true,
          cookieDomainRewrite: '',
          configure(proxy) {
            const origin = env.VITE_API_PROXY_ORIGIN || 'http://localhost:5173'
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