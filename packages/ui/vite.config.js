import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import fs from 'fs'
import copy from 'rollup-plugin-copy'
import { VitePWA } from 'vite-plugin-pwa'
import { ViteRevisionPlugin } from './vite-plugin-revision'
import checker from 'vite-plugin-checker'

// Copies the build into another package's folder, emptied first so files of
// earlier builds do not pile up there
function copyBuildTo(...destinations) {
    return [
        {
            name: 'empty-copy-destinations',
            apply: 'build',
            buildStart() {
                for(const destination of destinations) {
                    fs.rmSync(path.resolve(__dirname, destination), { recursive: true, force: true })
                }
            },
        },
        copy({
            targets: destinations.map(dest => ({ src: 'dist/*', dest })),
            hook: 'writeBundle'
        }),
    ]
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // The offline cache and its update prompt are for the web build. The other
    // builds carry their files with them and update through their own channel,
    // and Electron's file:// pages cannot register a service worker at all
    const usesOfflineCache = !['web-standalone', 'desktop', 'desktop-electron'].includes(mode)

    const config = {
        plugins: [
            process.env.VITEST ? null : ViteRevisionPlugin(mode),
            vue({
                template: {
                    compilerOptions: {
                        isCustomElement: (tag) => ['alert-confirm-prompt'].includes(tag)
                    }
                }
            }),
            usesOfflineCache ? VitePWA({
                includeAssets: [
                    'favicon.png',
                    'favicon.ico',
                    'robots.txt',
                    'apple-touch-icon.png',
                    'css/fontawesome-free-6.6.0-web/webfonts/fa-solid-900.woff2',
                    'images/*',
                ],
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
            }) : {
                // Stub for virtual:pwa-register/vue so ReloadPrompt.vue compiles
                // in the builds without the offline cache
                name: 'pwa-stub',
                resolveId(id) {
                    if (id === 'virtual:pwa-register/vue') return id
                },
                load(id) {
                    if (id === 'virtual:pwa-register/vue') {
                        return `
                            import { ref } from 'vue'
                            export function useRegisterSW() {
                                return {
                                    offlineReady: ref(false),
                                    needRefresh: ref(false),
                                    updateServiceWorker: () => {},
                                }
                            }
                        `
                    }
                }
            },
            process.env.VITEST ? null : checker({
                typescript: true
            }),
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
            reporters: 'verbose',
            exclude: [
                'node_modules',
                'tests',
            ],
        },
        build: {
            target: 'es2022',
        },
        esbuild: {
            target: 'es2022',
            minifyIdentifiers: false,
        },
    }

    if(mode === 'desktop') {
        config.plugins.push(...copyBuildTo('../electron/ui', '../tauri/ui', '../browser-extension/v3-app/src/ui'))
    }

    if(mode === 'desktop-electron') {
        config.plugins.push(...copyBuildTo('../electron/ui'))
    }

    if(mode === 'web-standalone') {
        config.plugins.push(...copyBuildTo('../web-standalone/public'))
    }

    return config
})
