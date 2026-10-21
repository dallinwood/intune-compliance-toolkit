# webui

The browser app that browses the mSCP rule library and generates Intune
macOS compliance bundles. See the [root README](../README.md) for what it
does, licensing, deployment and known limitations.

Requires [Bun](https://bun.sh). From this directory:

- `bun install` installs dependencies.
- `bun run dev` starts the dev server on http://localhost:5173.
- `bun run build` type-checks and builds the static site into `dist/`.
- `bun run test` runs the Vitest unit tests.
- `bun run lint` runs oxlint.
- `bun run test:e2e` runs the Playwright tests against an already running
  `bun run dev` (set `PLAYWRIGHT_BASE_URL` for another port).
