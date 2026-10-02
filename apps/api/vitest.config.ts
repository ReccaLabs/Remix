import { defineConfig } from 'vitest/config';

// Unit tests next to the code (src/**/*.test.ts) and e2e tests against the real Nest app
// (test/**/*.e2e.test.ts). Vite's oxc transform takes the decorator settings from tsconfig.json,
// exactly like the tsdown build.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['reflect-metadata'],
  },
});
