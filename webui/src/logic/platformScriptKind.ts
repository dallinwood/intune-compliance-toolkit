export type ScriptKind = 'bash' | 'powershell'

// Only two platforms exist in the rule library today - if a future
// benchmark adds a third, this should fail loudly rather than silently
// guess which script language to generate.
export function scriptKindForPlatform(platform: string): ScriptKind {
  if (/macos/i.test(platform)) return 'bash'
  if (/windows/i.test(platform)) return 'powershell'
  throw new Error(`Don't know which script language to generate for platform "${platform}".`)
}

// A short, human-readable label for filenames - kept in sync with
// scriptKindForPlatform's classification above by using the same regexes,
// so the two can't silently drift apart.
export function platformLabel(platform: string): string {
  if (/macos/i.test(platform)) return 'macOS'
  if (/windows/i.test(platform)) return 'Windows'
  throw new Error(`Don't know a display label for platform "${platform}".`)
}
