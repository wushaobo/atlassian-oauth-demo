import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

// Only log page-module requests under /src/pages/.
const ACCESS_LOG_FILTER = /^\/src\/pages\//

function accessLogPlugin(): Plugin {
  return {
    name: 'access-log',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const method = req.method ?? 'UNKNOWN'
        const url = req.url ?? '/'

        if (!ACCESS_LOG_FILTER.test(url)) {
          next()
          return
        }

        const startedAt = Date.now()
        res.on('finish', () => {
          const elapsed = Date.now() - startedAt
          console.log(
            `[access] ${new Date().toISOString()} ${method} ${url} -> ${res.statusCode} (${elapsed}ms)`,
          )
        })

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), accessLogPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Demo only: allows access through an arbitrary external IP or hostname.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
