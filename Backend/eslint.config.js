import globals from 'globals'

export default [
    {
        ignores: [
            'node_modules/**',
            'backups/**',
            'uploads/**',
            'coverage/**',
            'k8s/**',
            'nginx/**',
            'certbot/**'
        ]
    },
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node
            }
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', {
                args: 'none',
                caughtErrors: 'none',
                ignoreRestSiblings: true
            }]
        }
    },
    {
        files: ['**/*.k6.js'],
        languageOptions: {
            globals: {
                __ENV: 'readonly',
                __VU: 'readonly',
                __ITER: 'readonly',
                open: 'readonly'
            }
        }
    }
]
