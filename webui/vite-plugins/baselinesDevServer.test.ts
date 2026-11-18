import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentTypeFor, resolveServedFile } from './baselinesDevServer.ts'

let temporaryRoot: string
let roots: { generatedRoot: string; repositoryRoot: string }

beforeAll(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'baselines-dev-server-'))
  roots = { generatedRoot: join(temporaryRoot, 'generated'), repositoryRoot: join(temporaryRoot, 'repo') }
  for (const folder of ['generated/baselines/_history', 'repo/baselines/_history', 'repo/baselines/mscp', 'repo/catalog']) {
    mkdirSync(join(temporaryRoot, folder), { recursive: true })
  }
  writeFileSync(join(temporaryRoot, 'repo/baselines/mscp/rule.json'), '{}')
  writeFileSync(join(temporaryRoot, 'repo/baselines/_history/mscp.json'), 'from repo')
  writeFileSync(join(temporaryRoot, 'generated/baselines/_history/mscp.json'), 'generated')
  writeFileSync(join(temporaryRoot, 'repo/catalog/vendors.json'), '{}')
  writeFileSync(join(temporaryRoot, 'repo/secret.json'), '{}')
})

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})

describe('resolveServedFile', () => {
  it('serves a normal file from the repository', () => {
    expect(resolveServedFile('baselines/mscp/rule.json', roots)).toBe(join(roots.repositoryRoot, 'baselines/mscp/rule.json'))
    expect(resolveServedFile('catalog/vendors.json', roots)).toBe(join(roots.repositoryRoot, 'catalog/vendors.json'))
  })

  it('prefers the generated file over the repository file', () => {
    expect(resolveServedFile('baselines/_history/mscp.json', roots)).toBe(join(roots.generatedRoot, 'baselines/_history/mscp.json'))
  })

  it('rejects path traversal, plain and encoded', () => {
    expect(resolveServedFile('baselines/../secret.json', roots)).toBeNull()
    expect(resolveServedFile('baselines/%2e%2e/secret.json', roots)).toBeNull()
    expect(resolveServedFile('catalog/../baselines/mscp/rule.json', roots)).toBeNull()
  })

  it('returns null for an unknown prefix or a missing file', () => {
    expect(resolveServedFile('secret.json', roots)).toBeNull()
    expect(resolveServedFile('src/main.tsx', roots)).toBeNull()
    expect(resolveServedFile('baselines/missing.json', roots)).toBeNull()
  })
})

describe('contentTypeFor', () => {
  it('uses application/json for json and a generic type for the unknown', () => {
    expect(contentTypeFor('a/b.json')).toBe('application/json')
    expect(contentTypeFor('a/b.bin')).toBe('application/octet-stream')
  })
})
