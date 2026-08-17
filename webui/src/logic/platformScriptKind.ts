export type ScriptKind = 'bash' | 'powershell'

// Only two platforms exist in the rule library today - if a future
// benchmark adds a third, this should fail loudly rather than silently
// guess which script language to generate.
export function scriptKindForPlatform(platform: string): ScriptKind {
  if (/macos/i.test(platform)) return 'bash'
  if (/windows/i.test(platform)) return 'powershell'
  throw new Error(`Don't know which script language to generate for platform "${platform}".`)
}

export function slugifyPlatform(platform: string): string {
  return platform
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
