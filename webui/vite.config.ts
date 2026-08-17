import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves this as a project site at /intune-compliance-toolkit/,
// but local dev needs the root so asset URLs resolve without a prefix.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/intune-compliance-toolkit/' : '/',
  plugins: [react(), tailwindcss()],
}))
