import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

const SERVED_FOLDERS = ['baselines', 'catalog']

export interface DevServerRoots {
  generatedRoot: string
  repositoryRoot: string
}

function isInside(folderRoot: string, candidate: string): boolean {
  const relativePath = relative(folderRoot, candidate)
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && resolve(folderRoot, relativePath) === candidate
}

// Maps a request path (already stripped of the app base, e.g.
// "baselines/_history/mscp.json") to the file that should answer it: the
// generated copy first, then the repo's own folder. Returns null for an
// unknown prefix, a path that escapes its folder, or a file that does not exist.
export function resolveServedFile(requestPath: string, roots: DevServerRoots): string | null {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  const [topFolder] = decodedPath.split('/')
  if (!SERVED_FOLDERS.includes(topFolder)) return null

  for (const root of [roots.generatedRoot, roots.repositoryRoot]) {
    const folderRoot = resolve(root, topFolder)
    const candidate = resolve(root, decodedPath)
    if (!isInside(folderRoot, candidate)) return null
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
}

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

// Dev only: serves baselines/ and catalog/ straight from the repo (plus the
// generated indexes from webui/.generated) so starting the dev server does not
// copy ~24,000 files into public/. enforce: 'pre' puts it ahead of Vite's
// public-dir serving, so a stale webui/public/baselines left by an older run
// never wins.
export function baselinesDevServer(roots: DevServerRoots): Plugin {
  return {
    name: 'baselines-dev-server',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      const base = server.config.base
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0]
        if (!pathname.startsWith(base)) return next()
        const requestPath = pathname.slice(base.length)
        if (!SERVED_FOLDERS.includes(requestPath.split('/')[0])) return next()

        const filePath = resolveServedFile(requestPath, roots)
        if (filePath === null) {
          response.statusCode = 404
          response.end('Not found')
          return
        }
        response.setHeader('Content-Type', contentTypeFor(filePath))
        createReadStream(filePath).pipe(response)
      })
    },
  }
}
