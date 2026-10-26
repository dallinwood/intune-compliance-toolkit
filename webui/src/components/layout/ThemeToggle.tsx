import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'

// Names the theme it switches to, so the visible text and the accessible
// name both describe the action rather than a pressed state.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const Icon = nextTheme === 'dark' ? Moon : Sun
  const label = nextTheme === 'dark' ? 'Dark mode' : 'Light mode'

  return (
    <button
      type="button"
      aria-label={`Switch to ${label.toLowerCase()}`}
      onClick={() => setTheme(nextTheme)}
      className="-my-0.5 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  )
}
