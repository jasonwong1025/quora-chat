import { defineConfig, type Plugin } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// In dev, Nitro treats any request the browser makes for an image (e.g. <img>)
// as a static file and never reaches our API, so /api/products/:id/image 404s.
// Marking /api requests as plain fetches sends them to the API as usual.
const apiNotAsset: Plugin = {
  name: 'api-not-asset',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/api/')) req.headers['sec-fetch-dest'] = 'empty'
      next()
    })
  },
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // Replit serves the dev server through its own preview domain.
  server: { host: '0.0.0.0', allowedHosts: true },
  plugins: [
    apiNotAsset, // must run before nitro's dev middleware
    nitro(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
