import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        // packaged builds under out/ carry copies of the specs
        exclude: [...configDefaults.exclude, 'out/**'],
    }
})
