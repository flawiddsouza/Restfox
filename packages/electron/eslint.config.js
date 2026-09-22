const js = require('@eslint/js')
const globals = require('globals')
const tseslint = require('typescript-eslint')
const stylistic = require('@stylistic/eslint-plugin')

module.exports = tseslint.config(
    {
        ignores: ['out/', 'dist/', 'ui/', 'node_modules/'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.{js,ts}'],
        plugins: {
            '@stylistic': stylistic,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            '@stylistic/indent': ['error', 4],
            '@stylistic/linebreak-style': ['error', 'unix'],
            '@stylistic/quotes': ['error', 'single'],
            '@stylistic/semi': ['error', 'never'],
        },
    },
    {
        // the main process is CommonJS, require() is the import there
        files: ['src/**/*.js'],
        ignores: ['src/**/*.spec.js'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        // vitest specs and TypeScript files use import syntax
        files: ['src/**/*.spec.js', 'src/**/*.ts'],
        languageOptions: {
            sourceType: 'module',
        },
    },
)
