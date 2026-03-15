import html from 'eslint-plugin-html';

export default [
  {
    plugins: {
      html,
    },
    files: ['**/*.html', '**/*.js'],
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
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error',
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '.git/**'],
  },
];
