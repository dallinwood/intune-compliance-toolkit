// Rules for the files a rule may reference instead of inlining them: a
// check entry or remediation step names a script with `shell_file`, and a
// payload names its content with `data_file` (design 2026-10-26, section 7).
// tools/file_references.py and the rule schema carry the same path,
// extension and exactly-one rules; tests/fixtures/overlays/cases.json pins
// all three. Only CI can read the repository, so whether a file exists, its
// encoding, line endings and content are checked there; the UI reports a
// failed fetch.

import type { Rule, RuleCheck, ScriptLanguage, TargetCheck } from '../types/library'
import { GENERATED_TARGET } from './checkPlan'

const REFERENCE_PREFIX = 'baselines/'
// Every segment after baselines/ is plain: no percent-encoding, query or
// fragment characters a browser would reinterpret, no empty segment, and no
// leading dot (so no . or .. segment, and nothing the publish copy skips).
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/

const SCRIPT_EXTENSIONS_BY_LANGUAGE: Record<ScriptLanguage, readonly string[]> = {
  powershell: ['.ps1'],
  bash: ['.sh'],
  zsh: ['.sh'],
  python: ['.py'],
}
const TEXT_PAYLOAD_EXTENSIONS: readonly string[] = ['.mobileconfig', '.plist', '.json', '.xml', '.reg', '.admx', '.adml']
const BINARY_PAYLOAD_EXTENSIONS: readonly string[] = ['.pol', '.intunewin']
const PAYLOAD_EXTENSIONS: readonly string[] = [...TEXT_PAYLOAD_EXTENSIONS, ...BINARY_PAYLOAD_EXTENSIONS]

// Case-sensitive: extensions are lowercase, as in the schema.
function hasExtension(path: string, extensions: readonly string[]): boolean {
  return extensions.some((extension) => path.endsWith(extension))
}

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function pathProblem(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith(REFERENCE_PREFIX)) {
    return `must be a path starting with ${REFERENCE_PREFIX}, got ${JSON.stringify(path)}`
  }
  const segments = path.slice(REFERENCE_PREFIX.length).split('/')
  if (!segments.every((segment) => PATH_SEGMENT_PATTERN.test(segment))) {
    return `must have only plain path segments after ${REFERENCE_PREFIX} (letters, digits, ., _ and -, not starting with .), got ${JSON.stringify(path)}`
  }
  return null
}

export function exactlyOneProblem(entry: Record<string, unknown>, inlineKey: string, fileKey: string): string | null {
  const present = [inlineKey, fileKey].filter((key) => Object.hasOwn(entry, key))
  return present.length === 1 ? null : `needs exactly one of ${inlineKey} and ${fileKey}`
}

export function scriptFileProblem(path: unknown, language: unknown): string | null {
  const problem = pathProblem(path)
  if (problem) return problem
  const allowed = Object.hasOwn(SCRIPT_EXTENSIONS_BY_LANGUAGE, language as string)
    ? SCRIPT_EXTENSIONS_BY_LANGUAGE[language as ScriptLanguage]
    : null
  if (allowed === null) return `has no known script extension for language ${JSON.stringify(language)}`
  if (!hasExtension(path as string, allowed)) return `must end in ${allowed.join(' or ')} for ${String(language)}`
  return null
}

export function payloadFileProblem(path: unknown): string | null {
  const problem = pathProblem(path)
  if (problem) return problem
  if (!hasExtension(path as string, PAYLOAD_EXTENSIONS)) return `must end in one of ${PAYLOAD_EXTENSIONS.join(', ')}`
  return null
}

export function isBinaryPayloadFile(path: string): boolean {
  return hasExtension(path, BINARY_PAYLOAD_EXTENSIONS)
}

// Where the published site serves a referenced file (the repo's baselines/
// folder is copied to the site's baselines/ folder as is), as a same-origin
// path, or null when the reference would leave that folder. The shape checks
// already reject such paths; this is defence in depth before any fetch or
// link: each segment is encoded, and the URL as the browser resolves it must
// still be inside the published baselines/ folder.
export function publishedFileUrl(path: string, baseUrl: string, origin: string): string | null {
  if (pathProblem(path) !== null) return null
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const resolved = new URL(`${baseUrl}${encodedPath}`, origin)
  const publishedFolder = new URL(`${baseUrl}${REFERENCE_PREFIX}`, origin)
  if (resolved.origin !== publishedFolder.origin || !resolved.pathname.startsWith(publishedFolder.pathname)) return null
  if (resolved.search !== '' || resolved.hash !== '') return null
  return resolved.pathname
}

export interface PayloadFileDisplay {
  fileName: string
  // null when the reference is refused (see publishedFileUrl).
  url: string | null
  // Text files are shown in full as well as offered for download; binary
  // files (.pol, .intunewin) only as a download.
  showsContent: boolean
}

export function payloadFileDisplay(path: string, baseUrl: string, origin: string): PayloadFileDisplay {
  return { fileName: fileNameOf(path), url: publishedFileUrl(path, baseUrl, origin), showsContent: !isBinaryPayloadFile(path) }
}

export type LoadText = (path: string) => Promise<string>

async function resolvedEntry<Entry extends { shell?: string | null; shell_file?: string }>(entry: Entry, loadText: LoadText): Promise<Entry> {
  if (entry.shell_file === undefined) return entry
  const { shell_file: shellFile, ...rest } = entry
  return { ...rest, shell: await loadText(shellFile) } as Entry
}

async function resolvedTargetCheck(targetCheck: TargetCheck, loadText: LoadText): Promise<TargetCheck> {
  const byVersion = await Promise.all(
    Object.entries(targetCheck.by_version).map(async ([version, check]) => [version, await resolvedEntry<RuleCheck>(check, loadText)] as const),
  )
  return {
    ...targetCheck,
    default: targetCheck.default === null ? null : await resolvedEntry<RuleCheck>(targetCheck.default, loadText),
    by_version: Object.fromEntries(byVersion),
  }
}

// The rule with the shell_file of each check entry the generator bundles
// (the GENERATED_TARGET check) replaced by the file's text as shell, so the
// bundle holds exactly what an inline script would give. Nothing else is
// fetched: remediation steps, payloads and other targets' checks are never
// bundled, so a missing file there cannot block a bundle. The details fetch
// what they show themselves.
export async function resolveGeneratedCheckFiles(rule: Rule, loadText: LoadText): Promise<Rule> {
  const generatedCheck = rule.check?.[GENERATED_TARGET]
  if (rule.check === null || generatedCheck === undefined) return rule
  return { ...rule, check: { ...rule.check, [GENERATED_TARGET]: await resolvedTargetCheck(generatedCheck, loadText) } }
}
