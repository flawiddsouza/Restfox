// https://vitepress.dev/guide/custom-theme
import { h, watch, nextTick } from 'vue'
import { inBrowser, useRoute } from 'vitepress'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import mediumZoom from 'medium-zoom'
import RegisterSW from './components/RegisterSW.vue'
import './style.css'

export default {
    extends: DefaultTheme,
    Layout: () => {
        return h(DefaultTheme.Layout, null, {
            // https://vitepress.dev/guide/extending-default-theme#layout-slots
            'layout-bottom': () => h(RegisterSW),
        })
    },
    enhanceApp({ app, router, siteData }) {
        // ...
    },
    // image zoom code for vitepress from: https://github.com/francoischalifour/medium-zoom/issues/184#issuecomment-1335555738
    setup() {
        const route = useRoute()
        watch(
            () => route.path,
            () => nextTick(() => {
                if (inBrowser)
                mediumZoom('[data-zoomable]')
            }),
            { immediate: true },
        )
    }
} satisfies Theme
