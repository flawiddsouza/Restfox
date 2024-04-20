import { defineConfig } from 'vitepress'

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

        sidebar: [
            {
                text: 'Plugins',
                collapsed: false,
                items: [
                    { text: 'Introduction', link: '/plugins/introduction' },
                    { text: 'Setting Environment Variables Using Response Data', link: '/plugins/setting-environment-variables-using-response-data' },
                    { text: 'Testing Response Data', link: '/plugins/testing-response-data' },
                    { text: 'Decoding a JWT Token', link: '/plugins/decoding-a-jwt-token' },
                    { text: 'Using crypto-js', link: '/plugins/using-crypto-js' },
                    { text: 'GZIP Compressing & Decompressing text', link: '/plugins/gzip-compressing-&-decompressing-text' },
                    { text: 'Making HTTP Requests', link: '/plugins/making-http-requests' },
                ]
            }
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/flawiddsouza/Restfox' }
        ]
    }
})
