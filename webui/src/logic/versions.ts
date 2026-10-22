// Numeric, newest first - a plain string sort would put "9.0" after "27.0".
// This is data order, not a display choice, so it stays in code while the
// version labels come from the vocabulary file.
export function compareVersionsDescending(left: string, right: string): number {
  const [leftMajor, leftMinor = 0] = left.split('.').map(Number)
  const [rightMajor, rightMinor = 0] = right.split('.').map(Number)
  return rightMajor - leftMajor || rightMinor - leftMinor
}
