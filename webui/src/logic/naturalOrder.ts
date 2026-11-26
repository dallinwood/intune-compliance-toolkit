// Compares text with runs of digits taken as numbers, so "2" sorts before
// "19" and "1.9" before "1.10". One collator is shared because building one
// per comparison is slow on large lists.
const numericCollator = new Intl.Collator('en', { numeric: true })

export function compareNatural(left: string, right: string): number {
  return numericCollator.compare(left, right)
}
