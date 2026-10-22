import { describe, expect, it } from 'vitest'
import { compareVersionsDescending } from './versions'

describe('compareVersionsDescending', () => {
  it('sorts versions numerically, newest first', () => {
    expect(['9.0', '15.0', '27.0', '26.1', '26.0'].sort(compareVersionsDescending)).toEqual(['27.0', '26.1', '26.0', '15.0', '9.0'])
  })
})
