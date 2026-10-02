import { defineConfig } from 'tsdown';

/**
 * Bundles the API with rolldown (oxc transformer):
 * - legacy decorators + `emitDecoratorMetadata`, which Nest's DI reads at runtime;
 * - workspace packages (`@remix/*`) export raw `.ts`, so they are bundled in; every other
 *   dependency stays external and is installed in the image (`pnpm deploy --prod`).
 * Output: `dist/main.js` (HTTP API) and `dist/worker.js` (queue worker), run with plain `node`.
 */
export default defineConfig({
  entry: { main: 'src/main.ts', worker: 'src/worker.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: true,
  fixedExtension: false,
  deps: { alwaysBundle: [/^@remix\//] },
  // Decorator settings come from tsconfig.json (`experimentalDecorators`,
  // `emitDecoratorMetadata`), which rolldown and Vitest both read — one source for build,
  // dev and tests. test/decorator-metadata.test.ts fails if that ever stops working.
});
