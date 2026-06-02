import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
// @ts-ignore
import jestPlugin from 'eslint-plugin-jest'
import globals from 'globals'

export default tseslint.config(
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
