import { create } from 'zustand'

// Which section headers the user has closed; every other section is open.
// In memory only: the URL and storage leave it out, so every visit starts
// with all sections open.
interface SectionState {
  collapsed: ReadonlySet<string>
  setCollapsed: (collapsed: ReadonlySet<string>) => void
}

export const useSectionStore = create<SectionState>((set) => ({
  collapsed: new Set(),
  setCollapsed: (collapsed) => set({ collapsed }),
}))
