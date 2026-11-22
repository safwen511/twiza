import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'logo-96.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'TWIZA — تويزة',
        short_name: 'TWIZA',
        description: "Tour d'eau de l'oasis de Souk Lahad",
        start_url: '/farmer',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ar',
        dir: 'rtl',
        background_color: '#F7F6F3',
        theme_color: '#B5121B',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // the farmer's phone does not need the desktop dashboard (map + charts)
        globIgnores: ['**/Dashboard-*.js', '**/MapView-*.js', '**/MapView-*.css', '**/pages-*.js', 'data/**', 'og.png'],
        navigateFallbackDenylist: [/^\/api/],
        // the farmer keeps his last known turn when the network drops
        runtimeCaching: [{ urlPattern: /\/api\/farmer\//, handler: 'NetworkFirst', options: { cacheName: 'twiza-farmer', networkTimeoutSeconds: 4 } }],
      },
    }),
  ],
  server: { port: Number(process.env.VITE_PORT || 5173), host: true, proxy: { '/api': `http://localhost:${process.env.PORT || 8787}` } },
  preview: { port: Number(process.env.VITE_PORT || 5173), proxy: { '/api': `http://localhost:${process.env.PORT || 8787}` } },
})
