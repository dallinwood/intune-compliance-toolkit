// Copies webui/dist/index.html to dist/<view>/index.html for every view, so
// GitHub Pages answers a refresh or a link straight to /<base>licences with
// the app (status 200) instead of its 404 page; a static host has no
// rewrite rule to do it. Keep the list in step with VIEWS in
// webui/src/views/viewRegistry.tsx.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VIEW_IDS = ['rules', 'licences', 'products']
const distDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'webui', 'dist')

for (const viewId of VIEW_IDS) {
  mkdirSync(join(distDirectory, viewId), { recursive: true })
  copyFileSync(join(distDirectory, 'index.html'), join(distDirectory, viewId, 'index.html'))
}
