import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the site: pure helpers in src/lib and the Cloudflare Pages Functions.
export default defineConfig({
  resolve: {
    // Same `@/` path alias as tsconfig, so helpers that import app modules can be tested.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'functions/**/*.test.ts'],
    environment: 'node',
  },
});
