import { defineConfig } from 'vitest/config';

// Unit tests for the site: pure helpers in src/lib and the Cloudflare Pages Functions.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'functions/**/*.test.ts'],
    environment: 'node',
  },
});
