import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { baselinesDevServer } from './vite-plugins/baselinesDevServer.ts'
import { thirdPartyLicences } from './vite-plugins/thirdPartyLicences.ts'

// GitHub Pages serves this as a project site at /intune-compliance-toolkit/,
// but local dev needs the root so asset URLs resolve without a prefix.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/intune-compliance-toolkit/' : '/',
  plugins: [
    // Dev serves baselines/ and catalog/ from the repo instead of a copy in public/.
    baselinesDevServer({
      generatedRoot: fileURLToPath(new URL('./.generated', import.meta.url)),
      repositoryRoot: fileURLToPath(new URL('..', import.meta.url)),
    }),
    react(),
    tailwindcss(),
    thirdPartyLicences(),
  ],
  resolve: {
    // Mirrors tsconfig.app.json's "@/*" -> "./src/*" - tsc and Vite each
    // resolve imports independently, so the alias must be declared to both.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
