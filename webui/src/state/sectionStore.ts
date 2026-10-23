import { create } from 'zustand'

// Which section headers are open. In memory only: the URL and storage leave
// it out, so every visit starts with all sections collapsed.
interface SectionState {
  expanded: ReadonlySet<string>
  setExpanded: (expanded: ReadonlySet<string>) => void
}

export const useSectionStore = create<SectionState>((set) => ({
  expanded: new Set(),
  setExpanded: (expanded) => set({ expanded }),
}))
