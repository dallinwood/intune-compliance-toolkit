export type Theme = 'light' | 'dark'

// index.html's inline script reads this same key to set the class before
// first paint; theme.test.ts checks the two stay in step.
export const THEME_STORAGE_KEY = 'intune-toolkit:theme'
export const DARK_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'
export const DARK_THEME_CLASS = 'dark'

interface ColorSchemeQuery {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
}

interface ThemeEnvironment {
  // A function rather than the Storage object because merely reading
  // window.localStorage can throw (blocked site data).
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'>
  colorSchemeQuery: ColorSchemeQuery
  rootClassList: Pick<DOMTokenList, 'toggle'>
}

export interface ThemeController {
  getTheme: () => Theme
  setTheme: (theme: Theme) => void
  subscribe: (listener: () => void) => () => void
}

export function parseTheme(value: string | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null
}

// Storage can be missing or throw (private windows, blocked site data); the
// remembered theme is a convenience, so any failure just means no memory.
function readStoredTheme(getStorage: ThemeEnvironment['getStorage']): Theme | null {
  try {
    return parseTheme(getStorage().getItem(THEME_STORAGE_KEY))
  } catch {
    return null
  }
}

function storeTheme(getStorage: ThemeEnvironment['getStorage'], theme: Theme) {
  try {
    getStorage().setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Not remembered for the next visit; the choice still holds for this one.
  }
}

// The stored choice wins; without one the theme follows the OS preference,
// live, until the user picks one.
export function createThemeController(environment: ThemeEnvironment): ThemeController {
  let explicitChoice = readStoredTheme(environment.getStorage)
  const listeners = new Set<() => void>()

  const currentTheme = (): Theme => explicitChoice ?? (environment.colorSchemeQuery.matches ? 'dark' : 'light')

  const applyAndNotify = () => {
    environment.rootClassList.toggle(DARK_THEME_CLASS, currentTheme() === 'dark')
    listeners.forEach((listener) => listener())
  }

  environment.colorSchemeQuery.addEventListener('change', () => {
    if (explicitChoice === null) applyAndNotify()
  })
  applyAndNotify()

  return {
    getTheme: currentTheme,
    setTheme: (theme) => {
      explicitChoice = theme
      storeTheme(environment.getStorage, theme)
      applyAndNotify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

let browserController: ThemeController | null = null

export function browserThemeController(): ThemeController {
  browserController ??= createThemeController({
    getStorage: () => window.localStorage,
    colorSchemeQuery: window.matchMedia(DARK_COLOR_SCHEME_QUERY),
    rootClassList: document.documentElement.classList,
  })
  return browserController
}
