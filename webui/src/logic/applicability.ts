import type { Applicability, ApplicabilityEntry, BenchmarkMembership } from '../types/library'
import { compareVersionsDescending } from './versions'

// A version key names one version of one target, e.g. "macOS 27.0". Two
// targets can share a version string, so a bare version is never an identity.
// Targets may contain spaces ("Microsoft 365"); versions never do, so the key
// splits at its last space.
export function versionKey(target: string, version: string): string {
  return `${target} ${version}`
}

export function parseVersionKey(key: string): { target: string; version: string } {
  const separatorPosition = key.lastIndexOf(' ')
  return { target: key.slice(0, separatorPosition), version: key.slice(separatorPosition + 1) }
}

export function compareVersionKeys(left: string, right: string): number {
  const leftParts = parseVersionKey(left)
  const rightParts = parseVersionKey(right)
  return leftParts.target.localeCompare(rightParts.target, 'en') || compareVersionsDescending(leftParts.version, rightParts.version)
}

export function targetsOf(applicability: Applicability): (string | null)[] {
  return Array.from(new Set(applicability.map((entry) => entry.target)))
}

// The schema only allows a version beside a target, so a versioned entry
// always has one; the type does not know that.
function isVersioned(entry: ApplicabilityEntry): entry is ApplicabilityEntry & { target: string; version: string } {
  return entry.target !== null && entry.version !== null
}

export function versionKeysOf(applicability: Applicability): string[] {
  return applicability
    .filter(isVersioned)
    .map((entry) => versionKey(entry.target, entry.version))
    .sort(compareVersionKeys)
}

export function benchmarksAt(applicability: Applicability, key: string): BenchmarkMembership[] {
  const entry = applicability.filter(isVersioned).find((candidate) => versionKey(candidate.target, candidate.version) === key)
  return entry?.benchmarks ?? []
}

export function versionsForTarget(applicability: Applicability, target: string): string[] {
  return applicability.filter(isVersioned).filter((entry) => entry.target === target).map((entry) => entry.version)
}
