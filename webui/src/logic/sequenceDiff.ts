export type DiffOperation<T> = { type: 'same' | 'removed' | 'added'; items: T[] }

// Above this many cells in the table (after the shared start and end are
// trimmed), the diff gives up on finding a minimal change and replaces the
// whole middle, so a huge value cannot freeze the browser.
const MAXIMUM_TABLE_CELLS = 4_000_000

function appendOperation<T>(operations: DiffOperation<T>[], type: DiffOperation<T>['type'], item: T): void {
  const last = operations[operations.length - 1]
  if (last !== undefined && last.type === type) last.items.push(item)
  else operations.push({ type, items: [item] })
}

function appendAll<T>(operations: DiffOperation<T>[], type: DiffOperation<T>['type'], items: T[]): void {
  if (items.length > 0) operations.push({ type, items })
}

export function diffSequences<T>(
  before: T[],
  after: T[],
  equals: (left: T, right: T) => boolean = (left, right) => left === right,
): DiffOperation<T>[] {
  let sharedStart = 0
  while (sharedStart < before.length && sharedStart < after.length && equals(before[sharedStart], after[sharedStart])) sharedStart += 1
  let sharedEnd = 0
  while (
    sharedEnd < before.length - sharedStart &&
    sharedEnd < after.length - sharedStart &&
    equals(before[before.length - 1 - sharedEnd], after[after.length - 1 - sharedEnd])
  ) {
    sharedEnd += 1
  }

  const middleBefore = before.slice(sharedStart, before.length - sharedEnd)
  const middleAfter = after.slice(sharedStart, after.length - sharedEnd)

  const operations: DiffOperation<T>[] = []
  appendAll(operations, 'same', before.slice(0, sharedStart))

  if (middleBefore.length === 0 || middleAfter.length === 0 || (middleBefore.length + 1) * (middleAfter.length + 1) > MAXIMUM_TABLE_CELLS) {
    appendAll(operations, 'removed', middleBefore)
    appendAll(operations, 'added', middleAfter)
  } else {
    for (const operation of diffMiddle(middleBefore, middleAfter, equals)) operations.push(operation)
  }

  appendAll(operations, 'same', before.slice(before.length - sharedEnd))
  return operations
}

// Longest common subsequence over the suffixes, walked from the front so the
// operations come out in reading order, removals before additions.
function diffMiddle<T>(before: T[], after: T[], equals: (left: T, right: T) => boolean): DiffOperation<T>[] {
  const width = after.length + 1
  const commonLength = new Uint32Array((before.length + 1) * width)
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      commonLength[beforeIndex * width + afterIndex] = equals(before[beforeIndex], after[afterIndex])
        ? commonLength[(beforeIndex + 1) * width + afterIndex + 1] + 1
        : Math.max(commonLength[(beforeIndex + 1) * width + afterIndex], commonLength[beforeIndex * width + afterIndex + 1])
    }
  }

  const operations: DiffOperation<T>[] = []
  let beforeIndex = 0
  let afterIndex = 0
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (equals(before[beforeIndex], after[afterIndex])) {
      appendOperation(operations, 'same', before[beforeIndex])
      beforeIndex += 1
      afterIndex += 1
    } else if (commonLength[(beforeIndex + 1) * width + afterIndex] >= commonLength[beforeIndex * width + afterIndex + 1]) {
      appendOperation(operations, 'removed', before[beforeIndex])
      beforeIndex += 1
    } else {
      appendOperation(operations, 'added', after[afterIndex])
      afterIndex += 1
    }
  }
  while (beforeIndex < before.length) {
    appendOperation(operations, 'removed', before[beforeIndex])
    beforeIndex += 1
  }
  while (afterIndex < after.length) {
    appendOperation(operations, 'added', after[afterIndex])
    afterIndex += 1
  }
  return operations
}

// Whitespace runs are tokens of their own, so joining every token of the
// "same" and "removed" operations gives back the old text, and of the "same"
// and "added" operations the new text.
function tokenise(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== '')
}

export function diffWords(before: string, after: string): DiffOperation<string>[] {
  return diffSequences(tokenise(before), tokenise(after))
}

export function diffLines(before: string, after: string): DiffOperation<string>[] {
  return diffSequences(before === '' ? [] : before.split('\n'), after === '' ? [] : after.split('\n'))
}
