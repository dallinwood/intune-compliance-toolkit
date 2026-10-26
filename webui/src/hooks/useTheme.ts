import { useSyncExternalStore } from 'react'
import { browserThemeController, type Theme } from '../state/theme'

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const controller = browserThemeController()
  const theme = useSyncExternalStore(controller.subscribe, controller.getTheme)
  return { theme, setTheme: controller.setTheme }
}
