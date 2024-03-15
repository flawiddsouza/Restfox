module.exports = {
    'env': {
        'browser': true,
        'es2021': true
    },
    'extends': [
        'eslint:recommended',
        'plugin:vue/vue3-recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    'overrides': [
    ],
    'parser': 'vue-eslint-parser',
    'parserOptions': {
        'ecmaVersion': 'latest',
        'parser': '@typescript-eslint/parser',
        'sourceType': 'module'
    },
    'plugins': [
        'vue',
        '@typescript-eslint'
    ],
    'rules': {
        'indent': [
            'error',
            4,
            { 'SwitchCase': 1 }
        ],
        'linebreak-style': [
            'error',
            'unix'
        ],
        'quotes': [
            'error',
            'single',
            { 'allowTemplateLiterals': true }
        ],
        'semi': [
            'error',
            'never'
        ],
        'no-empty': [
            'error',
            {
                'allowEmptyCatch': true
            }
        ],
        'curly': 'error',
        'brace-style': 'error',
        'space-before-function-paren': [
            'error',
            'never'
        ],
        'space-in-parens': [
            'error',
            'never'
        ],
        'space-infix-ops': 'error',
        '@typescript-eslint/no-unused-vars': 'error',
        'vue/require-v-for-key': 'off',
        'vue/multi-word-component-names': 'off',
        'vue/no-mutating-props': 'warn', // this is a valid issue, so fix and change this from warn to on when you can,
        'vue/html-indent': [
            'error',
            4
        ],
        'vue/html-self-closing': 'off',
        'vue/max-attributes-per-line': 'off',
        'vue/attributes-order': 'off',
        'vue/singleline-html-element-content-newline': 'off',
        'vue/order-in-components': 'off',
        'vue/require-explicit-emits': 'off',
    }
}
