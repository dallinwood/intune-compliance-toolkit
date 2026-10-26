import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'
import {
  dependencyClosureRoots,
  installedPackageRoot,
  packageNameFromSpecifier,
  packageRootFromModuleId,
  readLicencesOfPackageRoots,
  type ThirdPartyLicence,
} from './packageLicences.ts'

const LICENCES_FILE_NAME = 'third-party-licences.json'

// shadcn is imported only for its stylesheet; the rest of its dependency tree
// is CLI tooling that never reaches the site.
const STYLESHEET_ONLY_PACKAGES: ReadonlySet<string> = new Set(['shadcn'])

async function stylesheetFilesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return stylesheetFilesUnder(entryPath)
      return entry.name.endsWith('.css') ? [entryPath] : []
    }),
  )
  return nested.flat()
}

// Tailwind inlines @import-ed package stylesheets itself, so they never show
// up as module ids in the bundle; the site's own stylesheets are scanned instead.
async function packageRootsImportedByStylesheets(projectRoot: string): Promise<string[]> {
  const specifiers = new Set<string>()
  for (const stylesheet of await stylesheetFilesUnder(path.join(projectRoot, 'src'))) {
    const source = await readFile(stylesheet, 'utf8')
    for (const match of source.matchAll(/@import\s+["']([^"']+)["']/g)) {
      if (!match[1].startsWith('.') && !match[1].startsWith('/') && !match[1].includes(':')) specifiers.add(match[1])
    }
  }
  return Promise.all([...specifiers].map((specifier) => installedPackageRoot(packageNameFromSpecifier(specifier), projectRoot)))
}

// Build: the exact set of node_modules packages whose modules are in the
// client bundle, plus the packages whose stylesheets are inlined. Dev: the
// declared production dependency closure, which is a superset (nothing is
// tree-shaken in dev) but needs no bundle to exist.
export function thirdPartyLicences(): Plugin {
  let projectRoot = ''
  return {
    name: 'third-party-licences',
    configResolved(config) {
      projectRoot = config.root
    },
    configureServer(server) {
      let licencesJson: Promise<string> | null = null
      server.middlewares.use(`/${LICENCES_FILE_NAME}`, (_request, response, next) => {
        licencesJson ??= dependencyClosureRoots(projectRoot, STYLESHEET_ONLY_PACKAGES)
          .then(readLicencesOfPackageRoots)
          .then((licences) => JSON.stringify(licences, null, 2))
        licencesJson.then(
          (body) => {
            response.setHeader('Content-Type', 'application/json')
            response.end(body)
          },
          (error) => {
            licencesJson = null
            next(error)
          },
        )
      })
    },
    async generateBundle(_options, bundle) {
      const packageRoots = new Set<string>(await packageRootsImportedByStylesheets(projectRoot))
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const moduleId of Object.keys(output.modules)) {
          const packageRoot = packageRootFromModuleId(moduleId)
          if (packageRoot) packageRoots.add(packageRoot)
        }
      }
      let licences: ThirdPartyLicence[] = []
      try {
        licences = await readLicencesOfPackageRoots(packageRoots)
      } catch (error) {
        this.error((error as Error).message)
      }
      this.emitFile({ type: 'asset', fileName: LICENCES_FILE_NAME, source: JSON.stringify(licences, null, 2) })
    },
  }
}
