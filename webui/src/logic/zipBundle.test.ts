import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildZip } from './zipBundle'

describe('buildZip', () => {
  it('round-trips file contents through a real zip/unzip', () => {
    const zipped = buildZip([
      { path: 'a.txt', content: 'hello' },
      { path: 'nested/b.json', content: '{"x":1}' },
    ])

    const unzipped = unzipSync(zipped)

    expect(strFromU8(unzipped['a.txt'])).toBe('hello')
    expect(strFromU8(unzipped['nested/b.json'])).toBe('{"x":1}')
  })
})
