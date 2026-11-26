import { create } from 'zustand'
import type { SectionState } from '../logic/sectionTree'

// Which section headers are open. In memory only: the URL and storage leave
// it out, so every visit starts with all sections open.
interface SectionStore {
  sections: SectionState
  setSections: (sections: SectionState) => void
}

export const useSectionStore = create<SectionStore>((set) => ({
  sections: { openByDefault: true, exceptions: new Set() },
  setSections: (sections) => set({ sections }),
}))
