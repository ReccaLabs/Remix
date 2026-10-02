import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Nest classes are configured through decorators; empty module classes are idiomatic.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
      // CORS is off by design (ADR 0003) — make turning it on a deliberate, reviewed change.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='enableCors']",
          message: 'No CORS: the API is same-origin only (ADR 0003).',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'test/**/*.ts'],
    rules: {
      // supertest bodies and test doubles are loosely typed by nature.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['*.config.ts', '*.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  globalIgnores(['dist/**', 'coverage/**']),
]);
