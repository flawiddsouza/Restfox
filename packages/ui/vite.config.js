import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import copy from 'rollup-plugin-copy'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const config = {
        plugins: [
            vue({
                template: {
                    compilerOptions: {
                        isCustomElement: (tag) => ['alert-confirm-prompt'].includes(tag)
                    }
                }
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
                },
                workbox: {
                    // default limit is 2 MB (https://vite-plugin-pwa.netlify.app/guide/faq.html#missing-assets-from-sw-precache-manifest)
                    maximumFileSizeToCacheInBytes: 4000000 // increase to 4 MB
                }
            })
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src')
            }
        },
        define: process.env.VITEST ? {
            'window': {},
        } : {
            'process.env': {}
        },
        base: '',
        test: {
            reporters: 'verbose'
        }
    }

    if(mode === 'desktop') {
        config.plugins.push(
            copy({
                targets: [
                    { src: 'dist/*', dest: '../electron/ui' },
                    { src: 'dist/*', dest: '../tauri/ui' },
                    { src: 'dist/*', dest: '../browser-extension/v3-app/src/ui' }
                ],
                hook: 'writeBundle'
            })
        )
    }

    if(mode === 'desktop-electron') {
        config.plugins.push(
            copy({
                targets: [
                    { src: 'dist/*', dest: '../electron/ui' },
                ],
                hook: 'writeBundle'
            })
        )
    }

    if(mode === 'web-standalone') {
        config.plugins.push(
            copy({
                targets: [
                    { src: 'dist/*', dest: '../web-standalone/public' },
                ],
                hook: 'buildEnd'
            })
        )
    }

    return config
})
