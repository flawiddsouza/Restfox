import { defineConfig } from 'vitepress'
import sidebar from './sidebar'

// https://vitepress.dev/reference/site-config
export default defineConfig({
    title: 'Restfox',
    description: 'A powerful minimalistic HTTP client',
    head: [
        ['link', { rel: 'icon', href: '/favicon.ico' }]
    ],
    themeConfig: {
        // https://vitepress.dev/reference/default-theme-config
        logo: '/images/logo-512x512.png',
        nav: [
            { text: 'Web App', link: 'https://restfox.dev' },
            { text: 'Download', link: 'https://github.com/flawiddsouza/Restfox/releases/latest' },
            { text: 'Support', link: '/support' },
        ],

        sidebar,

        socialLinks: [
            { icon: 'github', link: 'https://github.com/flawiddsouza/Restfox' }
        ]
    }
})
