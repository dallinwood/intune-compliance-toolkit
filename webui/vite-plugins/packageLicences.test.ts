import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findLicenceFileName,
  licenceFieldOf,
  packageNameFromSpecifier,
  packageRootFromModuleId,
  readPackageLicence,
  repositoryUrlOf,
} from './packageLicences.ts'

describe('packageRootFromModuleId', () => {
  it('resolves a plain package', () => {
    expect(packageRootFromModuleId('/app/node_modules/react/index.js')).toBe('/app/node_modules/react')
  })

  it('keeps the scope of a scoped package', () => {
    expect(packageRootFromModuleId('/app/node_modules/@base-ui/react/dialog/index.mjs')).toBe(
      '/app/node_modules/@base-ui/react',
    )
  })

  it('uses the innermost node_modules for nested and store layouts', () => {
    expect(packageRootFromModuleId('/app/node_modules/a/node_modules/b/lib/x.js')).toBe('/app/node_modules/a/node_modules/b')
    expect(packageRootFromModuleId('/app/node_modules/.bun/c@1.0.0/node_modules/c/x.js')).toBe(
      '/app/node_modules/.bun/c@1.0.0/node_modules/c',
    )
  })

  it('handles Windows separators, query strings and virtual prefixes', () => {
    expect(packageRootFromModuleId('C:\\app\\node_modules\\highlight.js\\lib\\core.js?commonjs-es-import')).toBe(
      'C:/app/node_modules/highlight.js',
    )
    expect(packageRootFromModuleId('\0/app/node_modules/zustand/esm/index.mjs')).toBe('/app/node_modules/zustand')
  })

  it('returns null for source files and virtual modules', () => {
    expect(packageRootFromModuleId('/app/src/main.tsx')).toBeNull()
    expect(packageRootFromModuleId('\0vite/preload-helper.js')).toBeNull()
    expect(packageRootFromModuleId('/app/node_modules/react')).toBeNull()
  })
})

describe('packageNameFromSpecifier', () => {
  it('drops subpaths', () => {
    expect(packageNameFromSpecifier('shadcn/tailwind.css')).toBe('shadcn')
    expect(packageNameFromSpecifier('@fontsource-variable/geist')).toBe('@fontsource-variable/geist')
    expect(packageNameFromSpecifier('@scope/pkg/sub/file.css')).toBe('@scope/pkg')
  })
})

describe('findLicenceFileName', () => {
  it('matches the known names case-insensitively', () => {
    for (const name of ['LICENSE', 'license.md', 'LICENCE', 'License.txt', 'COPYING', 'LICENSE.MD']) {
      expect(findLicenceFileName(['package.json', 'README.md', name])).toBe(name)
    }
  })

  it('ignores lookalikes', () => {
    expect(findLicenceFileName(['LICENSE-MIT.md', 'license.js', 'licenses', 'README.md'])).toBeUndefined()
  })

  it('prefers LICENSE over COPYING and the bare name over an extension', () => {
    expect(findLicenceFileName(['COPYING', 'LICENSE.md', 'LICENSE'])).toBe('LICENSE')
    expect(findLicenceFileName(['COPYING', 'LICENSE.md'])).toBe('LICENSE.md')
  })
})

describe('licenceFieldOf', () => {
  it('reads strings and legacy objects, and rejects the rest', () => {
    expect(licenceFieldOf({ license: 'MIT' })).toBe('MIT')
    expect(licenceFieldOf({ license: { type: 'ISC' } })).toBe('ISC')
    expect(licenceFieldOf({ license: '' })).toBeUndefined()
    expect(licenceFieldOf({})).toBeUndefined()
  })
})

describe('repositoryUrlOf', () => {
  it('normalizes common repository forms to https links', () => {
    expect(repositoryUrlOf({ repository: 'git+https://github.com/a/b.git' })).toBe('https://github.com/a/b')
    expect(repositoryUrlOf({ repository: { type: 'git', url: 'git://github.com/a/b.git' } })).toBe('https://github.com/a/b')
    expect(repositoryUrlOf({ repository: 'a/b' })).toBe('https://github.com/a/b')
    expect(repositoryUrlOf({ repository: 'git@github.com:a/b.git' })).toBe('https://github.com/a/b')
    expect(repositoryUrlOf({})).toBeUndefined()
    expect(repositoryUrlOf({ repository: 'javascript:alert(1)' })).toBeUndefined()
  })
})

describe('readPackageLicence', () => {
  async function withPackage(files: Record<string, string>, run: (root: string) => Promise<void>) {
    const root = await mkdtemp(path.join(tmpdir(), 'licence-test-'))
    try {
      for (const [fileName, content] of Object.entries(files)) await writeFile(path.join(root, fileName), content)
      await run(root)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }

  it('reads the licence file, normalizing line endings', async () => {
    await withPackage(
      { 'package.json': '{"name":"x","version":"1.2.3","license":"MIT"}', LICENSE: 'a\r\nb' },
      async (root) => {
        expect(await readPackageLicence(root)).toEqual({ name: 'x', version: '1.2.3', license: 'MIT', licenseText: 'a\nb' })
      },
    )
  })

  it('names the package when the licence file is missing', async () => {
    await withPackage({ 'package.json': '{"name":"nolicence","version":"1.0.0","license":"MIT"}' }, async (root) => {
      await expect(readPackageLicence(root)).rejects.toThrow(/"nolicence" has no licence file/)
    })
  })

  it('names the package when no licence is declared', async () => {
    await withPackage({ 'package.json': '{"name":"undeclared","version":"1.0.0"}', LICENSE: 'text' }, async (root) => {
      await expect(readPackageLicence(root)).rejects.toThrow(/"undeclared" declares no "license"/)
    })
  })
})
