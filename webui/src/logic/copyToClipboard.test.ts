import { describe, expect, it } from 'vitest'
import { copyTextToClipboard } from './copyToClipboard'

describe('copyTextToClipboard', () => {
  it('writes exactly the text it is given, markup characters and newlines included', async () => {
    const written: string[] = []
    const text = '<b>$ODV</b> && echo "a"\n\tsecond line\n'
    const outcome = await copyTextToClipboard(text, { writeText: async (value) => void written.push(value) })
    expect(outcome).toBe('copied')
    expect(written).toEqual([text])
  })

  it('reports an unavailable clipboard API', async () => {
    expect(await copyTextToClipboard('text', undefined)).toBe('unavailable')
  })

  it('reports a rejected write instead of throwing', async () => {
    const outcome = await copyTextToClipboard('text', { writeText: () => Promise.reject(new Error('denied')) })
    expect(outcome).toBe('rejected')
  })
})
