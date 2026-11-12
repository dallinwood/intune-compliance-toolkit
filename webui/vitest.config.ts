import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors vite.config.ts and tsconfig.app.json's "@/*" -> "./src/*" so component
    // modules that use the alias can be imported by tests.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'vite-plugins/**/*.test.ts'],
  },
})
