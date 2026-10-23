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
  // First paint of the 1493-row table against the dev server is CPU bound
  // (layout and paint of the large DOM, even after the checkbox label fix),
  // so parallel workers slow each other past the specs' 5s and 10s waits.
  // Measured over repeated full runs: 6 workers (the default here) failed 2
  // or more specs every run, 4 workers failed 1-3 specs per run, 3 workers
  // failed 2 of 6 runs, and 2 workers failed 1 of 10 runs. Run serially
  // until the table renders fewer rows.
  workers: 1,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
  },
})
