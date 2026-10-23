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
  // Rendering the 1493-row table is CPU bound in the browser: one page
  // shows "N of 1493 rules" in about 2s alone, but 6 parallel workers slow
  // each other to 12s+, past the specs' 10s waits. The serial run takes
  // about as long overall, so parallelism bought nothing.
  workers: 1,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
  },
})
