/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // MapLibre 6 parses GeoJSON in a worker. Vite must BUNDLE that worker (see scene.ts)
  // and emit it as an ES module, or its sibling imports resolve to nothing at runtime.
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
  },
  plugins: [
    {
      // Vite/rolldown only treat `.json` as data. Our baked campus geometry in
      // src/data/generated/ uses the `.geojson` extension, so teach the pipeline
      // to import it as a module. Types come from the sibling `*.geojson.d.ts`.
      name: 'geojson-as-json',
      transform(code: string, id: string) {
        if (!id.split('?')[0]!.endsWith('.geojson')) return null
        return { code: `export default ${code}`, map: null }
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,geojson,woff2,png,svg}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: 'UVic Tour',
        short_name: 'UVic Tour',
        description: 'Your Fall 2026 campus map — classes, routes, and the good spots.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#05070E',
        theme_color: '#FFB627',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
