import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

export interface ThirdPartyLicence {
  name: string
  version: string
  license: string
  licenseText: string
  repository?: string
}

const NODE_MODULES_MARKER = '/node_modules/'
const LICENCE_BASE_NAMES_BY_PREFERENCE = ['license', 'licence', 'copying']
const LICENCE_FILE_PATTERN = /^(license|licence|copying)(\.(md|txt))?$/i

// The innermost node_modules segment wins, so a nested copy
// (node_modules/a/node_modules/b) and a package-manager store layout
// (node_modules/.bun/b@1/node_modules/b) both resolve to the real package.
export function packageRootFromModuleId(moduleId: string): string | null {
  const cleanId = moduleId.replace(/^\0/, '').split('?')[0].replaceAll('\\', '/')
  const markerIndex = cleanId.lastIndexOf(NODE_MODULES_MARKER)
  if (markerIndex === -1) return null
  const afterMarkerIndex = markerIndex + NODE_MODULES_MARKER.length
  const segments = cleanId.slice(afterMarkerIndex).split('/')
  const nameSegmentCount = segments[0].startsWith('@') ? 2 : 1
  if (segments.length <= nameSegmentCount) return null
  return cleanId.slice(0, afterMarkerIndex) + segments.slice(0, nameSegmentCount).join('/')
}

export function packageNameFromSpecifier(specifier: string): string {
  const segments = specifier.split('/')
  return segments.slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
}

export function findLicenceFileName(fileNames: string[]): string | undefined {
  const rankOf = (fileName: string) => {
    const baseName = fileName.toLowerCase().split('.')[0]
    return LICENCE_BASE_NAMES_BY_PREFERENCE.indexOf(baseName) * 100 + fileName.length
  }
  return fileNames
    .filter((fileName) => LICENCE_FILE_PATTERN.test(fileName))
    .sort((first, second) => rankOf(first) - rankOf(second))[0]
}

export function licenceFieldOf(packageJson: { license?: unknown }): string | undefined {
  const field = packageJson.license
  if (typeof field === 'string' && field.trim() !== '') return field.trim()
  if (field && typeof field === 'object' && 'type' in field && typeof field.type === 'string' && field.type.trim() !== '') {
    return field.type.trim()
  }
  return undefined
}

// Only http(s) links are kept, so the UI can render them as plain anchors.
export function repositoryUrlOf(packageJson: { repository?: unknown }): string | undefined {
  const field = packageJson.repository
  const raw = typeof field === 'string' ? field : field && typeof field === 'object' && 'url' in field ? field.url : undefined
  if (typeof raw !== 'string') return undefined
  let url = raw.trim()
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(url)
  if (shorthand) url = `https://github.com/${shorthand[1]}`
  url = url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '')
  return /^https?:\/\//.test(url) ? url : undefined
}

export async function readPackageLicence(packageRoot: string): Promise<ThirdPartyLicence> {
  let packageJson: { name?: string; version?: string; license?: unknown; repository?: unknown }
  try {
    packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read package.json of the bundled package at ${packageRoot}: ${(error as Error).message}`)
  }
  const name = packageJson.name ?? packageRoot
  const license = licenceFieldOf(packageJson)
  if (!license) {
    throw new Error(`Bundled package "${name}" declares no "license" in its package.json (${packageRoot}).`)
  }
  const licenceFileName = findLicenceFileName(await readdir(packageRoot))
  if (!licenceFileName) {
    throw new Error(
      `Bundled package "${name}" has no licence file (looked for LICENSE, LICENCE, COPYING, with .md or .txt) in ${packageRoot}.`,
    )
  }
  const licenceText = await readFile(path.join(packageRoot, licenceFileName), 'utf8')
  const repository = repositoryUrlOf(packageJson)
  return {
    name,
    version: packageJson.version ?? '',
    license,
    licenseText: licenceText.replaceAll('\r\n', '\n'),
    ...(repository ? { repository } : {}),
  }
}

export async function readLicencesOfPackageRoots(packageRoots: Iterable<string>): Promise<ThirdPartyLicence[]> {
  const licencesByKey = new Map<string, ThirdPartyLicence>()
  for (const packageRoot of packageRoots) {
    const licence = await readPackageLicence(packageRoot)
    licencesByKey.set(`${licence.name}@${licence.version}`, licence)
  }
  return [...licencesByKey.values()].sort(
    (first, second) => first.name.localeCompare(second.name) || first.version.localeCompare(second.version),
  )
}

async function findInstalledPackageRoot(packageName: string, fromDirectory: string): Promise<string | null> {
  let directory = fromDirectory
  for (;;) {
    const candidate = path.join(directory, 'node_modules', packageName)
    try {
      await readFile(path.join(candidate, 'package.json'))
      return await realpath(candidate)
    } catch {
      const parent = path.dirname(directory)
      if (parent === directory) return null
      directory = parent
    }
  }
}

export async function installedPackageRoot(packageName: string, fromDirectory: string): Promise<string> {
  const packageRoot = await findInstalledPackageRoot(packageName, fromDirectory)
  if (!packageRoot) throw new Error(`Package "${packageName}" is not installed (looked from ${fromDirectory}).`)
  return packageRoot
}

// Walks `dependencies` (never dev or peer ones) from the project's own
// package.json, resolving each from the requiring package's real location so
// nested installs are found. Packages in `doNotDescendInto` are listed but
// their own dependencies are not followed.
export async function dependencyClosureRoots(projectRoot: string, doNotDescendInto: ReadonlySet<string>): Promise<string[]> {
  const projectPackageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const visitedRoots = new Set<string>()
  const pending: Array<{ name: string; fromDirectory: string }> = Object.keys(projectPackageJson.dependencies ?? {}).map(
    (name) => ({ name, fromDirectory: projectRoot }),
  )
  while (pending.length > 0) {
    const { name, fromDirectory } = pending.pop()!
    const packageRoot = await installedPackageRoot(name, fromDirectory)
    if (visitedRoots.has(packageRoot)) continue
    visitedRoots.add(packageRoot)
    if (doNotDescendInto.has(name)) continue
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
      pending.push({ name: dependencyName, fromDirectory: packageRoot })
    }
  }
  return [...visitedRoots]
}
