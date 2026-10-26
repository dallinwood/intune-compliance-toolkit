// Rules for the files a rule may reference instead of inlining them: a
// check entry or remediation step names a script with `shell_file`, and a
// payload names its content with `data_file` (design 2026-10-26, section 7).
// tools/file_references.py carries the same path, extension and
// exactly-one rules for CI; tests/fixtures/overlays/cases.json pins both.
// Only CI can read the repository, so whether a file exists, its line
// endings and JSON parsing are checked there; the UI reports a failed fetch.

import type { RemediationStep, Rule, RuleCheck, ScriptLanguage, TargetCheck } from '../types/library'

const REFERENCE_PREFIX = 'baselines/'

const SCRIPT_EXTENSIONS_BY_LANGUAGE: Record<ScriptLanguage, readonly string[]> = {
  powershell: ['.ps1'],
  bash: ['.sh'],
  zsh: ['.sh'],
  python: ['.py'],
}
const TEXT_PAYLOAD_EXTENSIONS: readonly string[] = ['.mobileconfig', '.plist', '.json', '.xml', '.reg', '.admx', '.adml']
const BINARY_PAYLOAD_EXTENSIONS: readonly string[] = ['.pol', '.intunewin']
const PAYLOAD_EXTENSIONS: readonly string[] = [...TEXT_PAYLOAD_EXTENSIONS, ...BINARY_PAYLOAD_EXTENSIONS]

function extensionOf(path: string): string {
  const fileName = fileNameOf(path)
  const dot = fileName.lastIndexOf('.')
  return dot <= 0 ? '' : fileName.slice(dot).toLowerCase()
}

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function pathProblem(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith(REFERENCE_PREFIX)) {
    return `must be a path starting with ${REFERENCE_PREFIX}, got ${JSON.stringify(path)}`
  }
  if (path.includes('\\') || path.includes('\n') || path.includes(':')) return `must use forward slashes on one line, got ${JSON.stringify(path)}`
  if (path.split('/').includes('..')) return `must not contain a .. segment, got ${JSON.stringify(path)}`
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
  if (!allowed.includes(extensionOf(path as string))) return `must end in ${allowed.join(' or ')} for ${String(language)}`
  return null
}

export function payloadFileProblem(path: unknown): string | null {
  const problem = pathProblem(path)
  if (problem) return problem
  if (!PAYLOAD_EXTENSIONS.includes(extensionOf(path as string))) return `must end in one of ${PAYLOAD_EXTENSIONS.join(', ')}`
  return null
}

export function isBinaryPayloadFile(path: string): boolean {
  return BINARY_PAYLOAD_EXTENSIONS.includes(extensionOf(path))
}

// Where the published site serves a referenced file: the repo's baselines/
// folder is copied to the site's baselines/ folder as is.
export function publishedFileUrl(path: string, baseUrl: string): string {
  return `${baseUrl}${path}`
}

export interface PayloadFileDisplay {
  fileName: string
  url: string
  // Text files are shown in full as well as offered for download; binary
  // files (.pol, .intunewin) only as a download.
  showsContent: boolean
}

export function payloadFileDisplay(path: string, baseUrl: string): PayloadFileDisplay {
  return { fileName: fileNameOf(path), url: publishedFileUrl(path, baseUrl), showsContent: !isBinaryPayloadFile(path) }
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

// The rule with every shell_file replaced by the file's text as shell, so
// the generator (and anything else that reads shell) sees exactly what an
// inline script would give. Payload data_file is left alone: payloads are
// never bundled.
export async function resolveScriptFiles(rule: Rule, loadText: LoadText): Promise<Rule> {
  const check =
    rule.check === null
      ? null
      : Object.fromEntries(
          await Promise.all(
            Object.entries(rule.check).map(async ([target, targetCheck]) => [target, await resolvedTargetCheck(targetCheck, loadText)] as const),
          ),
        )
  const remediation =
    rule.remediation === null
      ? null
      : Object.fromEntries(
          await Promise.all(
            Object.entries(rule.remediation).map(
              async ([target, targetRemediation]) =>
                [
                  target,
                  {
                    ...targetRemediation,
                    steps: await Promise.all(targetRemediation.steps.map((step) => resolvedEntry<RemediationStep>(step, loadText))),
                  },
                ] as const,
            ),
          ),
        )
  return { ...rule, check, remediation }
}
