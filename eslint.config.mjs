import htmlPlugin from '@html-eslint/eslint-plugin';
import htmlParser from '@html-eslint/parser';

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Image: 'readonly',
        Date: 'readonly',
        gtag: 'readonly',
        dataLayer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error',
    },
  },
  {
    files: ['**/*.html'],
    plugins: {
      '@html-eslint': htmlPlugin,
    },
    languageOptions: {
      parser: htmlParser,
    },
    rules: {
      '@html-eslint/require-doctype': 'error',
      '@html-eslint/no-duplicate-id': 'error',
      '@html-eslint/require-lang': 'error',
      '@html-eslint/require-title': 'error',
      '@html-eslint/no-multiple-h1': 'warn',
      '@html-eslint/require-closing-tags': ['error', { selfClosing: 'always' }],
      '@html-eslint/require-meta-charset': 'error',
      '@html-eslint/require-meta-description': 'error',
      '@html-eslint/require-meta-viewport': 'error',
      '@html-eslint/no-duplicate-attrs': 'error',
      '@html-eslint/require-img-alt': 'error',
      '@html-eslint/require-button-type': 'error',
      '@html-eslint/no-script-style-type': 'error',
      '@html-eslint/no-target-blank': 'error',
      '@html-eslint/no-non-scalable-viewport': 'error',
      '@html-eslint/no-inline-styles': 'off',
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '.git/**'],
  },
];
