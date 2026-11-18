export const VISIBLE_RELEASE_COUNT = 4

// Releases are listed oldest first, so the newest ones are the tail. The
// older ones keep their order and fold into a menu on the card.
export function splitReleases<Release>(releases: readonly Release[], visibleCount: number = VISIBLE_RELEASE_COUNT): { older: Release[]; visible: Release[] } {
  const firstVisiblePosition = Math.max(0, releases.length - visibleCount)
  return { older: releases.slice(0, firstVisiblePosition), visible: releases.slice(firstVisiblePosition) }
}
