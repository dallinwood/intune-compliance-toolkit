import { defineConfig } from '@playwright/test'

// e2e/ sits outside src/ so Playwright specs never collide with Vitest's
// src/**/*.test.ts glob - the two runners cover different layers (logic
// unit tests vs a real rendered page) and are invoked separately.
// No webServer block: assumes `bun run dev` is already running (this
// machine may have more than one dev server up across sessions/ports), so
// Playwright never starts or kills a server it doesn't own. Override with
// PLAYWRIGHT_BASE_URL if the dev server isn't on the default port.
export default defineConfig({
  testDir: './e2e',
  // Against the dev server the first paint of the 1493-row table is CPU
  // bound (about 2s alone), so parallel workers slow each other past the
  // specs' 10s waits. Measured over repeated full runs: 6 workers (the
  // default here) and 4 workers failed 2-3 specs every run, 3 workers
  // failed 1 run in 3, and 2 workers passed every run.
  workers: 2,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
  },
})
