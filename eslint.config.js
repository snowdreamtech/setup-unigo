/* eslint-disable @typescript-eslint/no-require-imports */
const eslint = require('@eslint/js')
const tseslint = require('typescript-eslint')
const jestPlugin = require('eslint-plugin-jest')
const globals = require('globals')

module.exports = tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js'],
    plugins: {
      jest: jestPlugin
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      ...jestPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn'
    }
  }
)
