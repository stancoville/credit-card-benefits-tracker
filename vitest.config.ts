import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Tests must never depend on the real clock (CLAUDE.md testing rules).
    // `asOf` is injected everywhere, so there is deliberately no fake-timer setup.
  },
})
