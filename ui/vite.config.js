import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import copy from 'rollup-plugin-copy'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        vue(),
        copy({
            targets: [
                { src: 'dist/*', dest: '../electron/ui' }
            ],
            hook: 'writeBundle'
        }),
        VitePWA({
            includeAssets: ['favicon.png', 'favicon.ico', 'robots.txt', 'apple-touch-icon.png', 'css/fontawesome-free-5.15.4-web/webfonts/fa-solid-900.woff2'],
            manifest: {
                name: 'Restfox',
                short_name: 'Restfox',
                description: 'A REST Client for the Web',
                theme_color: '#ffffff',
                icons: [
                    {
                      src: 'pwa-192x192.png',
                      sizes: '192x192',
                      type: 'image/png',
                    },
                    {
                      src: 'pwa-512x512.png',
                      sizes: '512x512',
                      type: 'image/png',
                    },
                    {
                      src: 'pwa-512x512.png',
                      sizes: '512x512',
                      type: 'image/png',
                      purpose: 'any maskable',
                    }
                ]
            }
        })
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    },
    define: {
        'process.env': {}
    },
    base: ''
})
