import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist', 'dist-electron', '.claude'],
    coverage: {
      provider: 'v8',
      // text: human-readable table in CI logs; json-summary: machine-readable for badge tools
      reporter: ['text', 'text-summary', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'dist-electron/',
        'src/renderer/',
        'src/tests/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
      ],
      // Starting thresholds — intentionally low to avoid blocking CI on day one.
      // Raise these incrementally as test coverage improves.
      thresholds: {
        lines: 10,
        functions: 10,
        branches: 10,
        statements: 10,
      },
    },
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
