import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Hex colours belong in packages/ui/src/theme.css only.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{6}\\b/]',
          message: 'No hex colours in components — use a theme token from @remix/ui/theme.css.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/test/mock-api*'],
              message: 'The mock API is a dev-only stand-in; app code talks to the real API.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests and the mock API use literal brand colours as fixture data (valid and hostile).
    files: ['**/*.test.ts', '**/*.test.tsx', 'test/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  globalIgnores(['.next/**', 'next-env.d.ts']),
]);
