import { defineConfig } from 'vitest/config';

// Behaviour + accessibility tests for the UI kit. jsdom gives us a DOM; there is no CSS, so
// tests assert roles, names and ARIA wiring rather than looks.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
