import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC en vez de esbuild/oxc: Nest necesita emitDecoratorMetadata para la inyección de dependencias.
export default defineConfig({
  plugins: [swc.vite({ swcrc: true })],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
