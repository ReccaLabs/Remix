import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig } from 'eslint/config';

// Mirrors apps/site/eslint.config.mjs so shared components follow the same rules
// (react, react-hooks, jsx-a11y, typescript) — including the no-hex rule.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: { next: { rootDir: '.' } },
    rules: {
      // Hex colours belong in src/theme.css only.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{6}\\b/]',
          message: 'No hex colours in components — use a theme token from src/theme.css.',
        },
      ],
      // Not a Next.js app: plain <a> is the default link and there is no pages/ directory.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]);
