const COUNT_FORMAT = new Intl.NumberFormat('en-US')

export function formatCount(count: number): string {
  return COUNT_FORMAT.format(count)
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`
}
