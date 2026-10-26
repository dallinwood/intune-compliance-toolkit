import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { thirdPartyLicences } from './vite-plugins/thirdPartyLicences.ts'

// GitHub Pages serves this as a project site at /intune-compliance-toolkit/,
// but local dev needs the root so asset URLs resolve without a prefix.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/intune-compliance-toolkit/' : '/',
  plugins: [react(), tailwindcss(), thirdPartyLicences()],
  resolve: {
    // Mirrors tsconfig.app.json's "@/*" -> "./src/*" - tsc and Vite each
    // resolve imports independently, so the alias must be declared to both.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
