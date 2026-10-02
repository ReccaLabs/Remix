import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for pure helpers (host routing, CSP, env, brand colours, session refresh) and the
// server API layer run in Node. Component tests (`*.test.tsx`) opt into jsdom with a
// `// @vitest-environment jsdom` docblock.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws outside a React Server environment; tests import server code directly.
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Component tests type into jsdom forms; give them headroom on a busy CI runner.
    testTimeout: 15_000,
  },
});
