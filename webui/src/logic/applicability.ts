import type { Applicability, ApplicabilityEntry, BenchmarkMembership } from '../types/library'
import { compareVersionsDescending } from './versions'

// A version key names one version of one target, e.g. "macOS 27.0". Two
// targets can share a version string, so a bare version is never an identity.
// Targets may contain spaces ("Microsoft 365"); versions never do, so the key
// splits at its last space.
export function versionKey(target: string, version: string): string {
  return `${target} ${version}`
}

// Stand-ins for "no target" and "no version" in filter state and scope keys.
// Version keys always contain a space and targets are display words, so
// neither can collide with a real value. Their label is applied in code, not
// from the vocabulary.
export const NO_TARGET_KEY = 'none'
export const NO_VERSION_KEY = 'none'
export const NONE_LABEL = 'None'

export function parseVersionKey(key: string): { target: string; version: string } {
  const separatorPosition = key.lastIndexOf(' ')
  if (separatorPosition === -1) return { target: '', version: key }
  return { target: key.slice(0, separatorPosition), version: key.slice(separatorPosition + 1) }
}

export function compareVersionKeys(left: string, right: string): number {
  const leftParts = parseVersionKey(left)
  const rightParts = parseVersionKey(right)
  return leftParts.target.localeCompare(rightParts.target, 'en') || compareVersionsDescending(leftParts.version, rightParts.version)
}

// Version keys in their usual order, then "none" last.
export function compareScopeKeys(left: string, right: string): number {
  if (left === NO_VERSION_KEY || right === NO_VERSION_KEY) return Number(left === NO_VERSION_KEY) - Number(right === NO_VERSION_KEY)
  return compareVersionKeys(left, right)
}

export function targetKeysOf(applicability: Applicability): string[] {
  return Array.from(new Set(applicability.map((entry) => entry.target ?? NO_TARGET_KEY)))
}

// The schema only allows a version beside a target, so a versioned entry
// always has one; the type does not know that.
function isVersioned(entry: ApplicabilityEntry): entry is ApplicabilityEntry & { target: string; version: string } {
  return entry.target !== null && entry.version !== null
}

// The scopes a rule's benchmarks are listed under: one key per versioned
// entry, newest first, and "none" for any entry without a version (an ASD
// ISM control, or an mSCP rule no release lists).
export function scopeKeysOf(applicability: Applicability): string[] {
  const versionKeys = applicability
    .filter(isVersioned)
    .map((entry) => versionKey(entry.target, entry.version))
    .sort(compareVersionKeys)
  return applicability.some((entry) => entry.version === null) ? [...versionKeys, NO_VERSION_KEY] : versionKeys
}

export function benchmarksAt(applicability: Applicability, key: string): BenchmarkMembership[] {
  if (key === NO_VERSION_KEY) return unversionedBenchmarks(applicability)
  const entry = applicability.filter(isVersioned).find((candidate) => versionKey(candidate.target, candidate.version) === key)
  return entry?.benchmarks ?? []
}

function unversionedBenchmarks(applicability: Applicability): BenchmarkMembership[] {
  const membershipsByIdentity = new Map<string, BenchmarkMembership>()
  for (const entry of applicability) {
    if (entry.version !== null) continue
    for (const membership of entry.benchmarks) {
      membershipsByIdentity.set(JSON.stringify([membership.name, membership.severity]), membership)
    }
  }
  return Array.from(membershipsByIdentity.values())
}

export function versionsForTarget(applicability: Applicability, target: string): string[] {
  return applicability.filter(isVersioned).filter((entry) => entry.target === target).map((entry) => entry.version)
}
