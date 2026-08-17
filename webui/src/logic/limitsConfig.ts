// Intune's own hard limits per custom-compliance policy, as documented by
// Microsoft (create-custom-json / discovery-script docs, retrieved
// 2026-08-17). `maxScriptOutputBytes` is listed for completeness but is
// NOT turned into a generation limit below - the JSON a script prints is
// built from values captured live on a real device, so its byte size
// isn't knowable at generation time, only at runtime. The same is true of
// the 5/10-minute execution-time limits, which aren't represented here at
// all since there's nothing byte-countable to derive a limit from.
export const INTUNE_HARD_LIMITS = {
  maxRulesPerPolicy: 100,
  maxRulesJsonBytes: 100 * 1024,
  maxScriptBytes: 1024 * 1024,
  maxScriptOutputBytes: 1024 * 1024,
}

// Margin kept below each hard limit above. Adjust this (or the derived
// values below directly) to change how much headroom generated bundles
// leave - this is a build-time config, not a user-facing setting.
export const HEADROOM_FACTOR = 0.95

export const GENERATION_LIMITS = {
  maxRulesPerChunk: Math.floor(INTUNE_HARD_LIMITS.maxRulesPerPolicy * HEADROOM_FACTOR),
  maxRulesJsonBytesPerChunk: Math.floor(INTUNE_HARD_LIMITS.maxRulesJsonBytes * HEADROOM_FACTOR),
  maxScriptBytesPerChunk: Math.floor(INTUNE_HARD_LIMITS.maxScriptBytes * HEADROOM_FACTOR),
}
