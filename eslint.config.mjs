import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['main.js', 'styles.css', 'node_modules/**', 'e2e/harness/dist/**', '**/*.mjs'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'test/**/*.ts', 'test/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'child_process', 'os', 'electron'] }],
    },
  },
  {
    files: ['test/**/*.ts', 'test/**/*.tsx', 'e2e/**/*.ts', 'e2e/**/*.tsx'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
