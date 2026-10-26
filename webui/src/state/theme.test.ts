import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DARK_COLOR_SCHEME_QUERY, THEME_STORAGE_KEY, createThemeController, parseTheme } from './theme'

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

function fakeColorSchemeQuery(prefersDark: boolean) {
  const listeners: Array<() => void> = []
  return {
    matches: prefersDark,
    addEventListener: (_type: 'change', listener: () => void) => {
      listeners.push(listener)
    },
    changeTo(nowPrefersDark: boolean) {
      this.matches = nowPrefersDark
      listeners.forEach((listener) => listener())
    },
  }
}

function fakeClassList() {
  const classes = new Set<string>()
  return {
    classes,
    toggle: (name: string, force?: boolean) => {
      if (force ?? !classes.has(name)) classes.add(name)
      else classes.delete(name)
      return classes.has(name)
    },
  }
}

function setUp({ stored, prefersDark }: { stored?: string; prefersDark: boolean }) {
  const storage = fakeStorage(stored === undefined ? {} : { [THEME_STORAGE_KEY]: stored })
  const colorSchemeQuery = fakeColorSchemeQuery(prefersDark)
  const rootClassList = fakeClassList()
  const controller = createThemeController({ getStorage: () => storage, colorSchemeQuery, rootClassList })
  return { storage, colorSchemeQuery, rootClassList, controller }
}

describe('parseTheme', () => {
  it('accepts only light and dark', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('Dark')).toBeNull()
    expect(parseTheme('')).toBeNull()
    expect(parseTheme(null)).toBeNull()
  })
})

describe('createThemeController', () => {
  it('starts from the stored choice over the OS preference', () => {
    const { controller, rootClassList } = setUp({ stored: 'dark', prefersDark: false })
    expect(controller.getTheme()).toBe('dark')
    expect(rootClassList.classes.has('dark')).toBe(true)

    expect(setUp({ stored: 'light', prefersDark: true }).controller.getTheme()).toBe('light')
  })

  it('starts from the OS preference when nothing usable is stored', () => {
    const dark = setUp({ prefersDark: true })
    expect(dark.controller.getTheme()).toBe('dark')
    expect(dark.rootClassList.classes.has('dark')).toBe(true)

    const light = setUp({ prefersDark: false })
    expect(light.controller.getTheme()).toBe('light')
    expect(light.rootClassList.classes.has('dark')).toBe(false)

    expect(setUp({ stored: 'sepia', prefersDark: true }).controller.getTheme()).toBe('dark')
  })

  it('follows live OS changes while no choice is stored', () => {
    const { controller, colorSchemeQuery, rootClassList } = setUp({ prefersDark: false })
    let notifications = 0
    controller.subscribe(() => notifications++)

    colorSchemeQuery.changeTo(true)
    expect(controller.getTheme()).toBe('dark')
    expect(rootClassList.classes.has('dark')).toBe(true)
    expect(notifications).toBe(1)

    colorSchemeQuery.changeTo(false)
    expect(controller.getTheme()).toBe('light')
    expect(rootClassList.classes.has('dark')).toBe(false)
  })

  it('persists an explicit choice and stops following the OS', () => {
    const { controller, colorSchemeQuery, rootClassList, storage } = setUp({ prefersDark: false })
    let notifications = 0
    controller.subscribe(() => notifications++)

    controller.setTheme('dark')
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(rootClassList.classes.has('dark')).toBe(true)
    expect(notifications).toBe(1)

    colorSchemeQuery.changeTo(true)
    colorSchemeQuery.changeTo(false)
    expect(controller.getTheme()).toBe('dark')
    expect(rootClassList.classes.has('dark')).toBe(true)
    expect(notifications).toBe(1)
  })

  it('stops notifying a listener once it unsubscribes', () => {
    const { controller } = setUp({ prefersDark: false })
    let notifications = 0
    const unsubscribe = controller.subscribe(() => notifications++)
    unsubscribe()
    controller.setTheme('dark')
    expect(notifications).toBe(0)
  })

  it('falls back to the OS preference and still applies a choice when storage throws', () => {
    const throwingStorage = () => {
      throw new Error('blocked')
    }
    const colorSchemeQuery = fakeColorSchemeQuery(true)
    const rootClassList = fakeClassList()
    const controller = createThemeController({ getStorage: throwingStorage, colorSchemeQuery, rootClassList })
    expect(controller.getTheme()).toBe('dark')

    expect(() => controller.setTheme('light')).not.toThrow()
    expect(controller.getTheme()).toBe('light')
    expect(rootClassList.classes.has('dark')).toBe(false)
    colorSchemeQuery.changeTo(true)
    expect(controller.getTheme()).toBe('light')
  })

  it('handles getItem and setItem throwing on a storage object that exists', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    const controller = createThemeController({ getStorage: () => storage, colorSchemeQuery: fakeColorSchemeQuery(false), rootClassList: fakeClassList() })
    expect(controller.getTheme()).toBe('light')
    expect(() => controller.setTheme('dark')).not.toThrow()
    expect(controller.getTheme()).toBe('dark')
  })
})

describe('the pre-paint script in index.html', () => {
  const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

  it('reads the same storage key and media query as the theme module', () => {
    expect(indexHtml).toContain(`'${THEME_STORAGE_KEY}'`)
    expect(indexHtml).toContain(`'${DARK_COLOR_SCHEME_QUERY}'`)
  })
})
