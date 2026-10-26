// Hand-written shape checks for a rule or index entry after overlays are
// merged in. An overlay can now merge a partial object onto an empty field
// (check: null and so on), so these checks are what keep a half-filled
// check, remediation or applicability entry away from the table, the details
// and the generator. They follow baselines/_rule.schema.json for every field
// those read; CI still runs the full schema.

import { exactlyOneProblem, payloadFileProblem, scriptFileProblem } from './fileReferences'

type JsonObject = Record<string, unknown>
type Check = (value: unknown, path: string) => string | null

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isString = (value: unknown) => typeof value === 'string'
const isStringOrNull = (value: unknown) => value === null || typeof value === 'string'
const isNumberOrString = (value: unknown) => typeof value === 'number' || typeof value === 'string'

function expect(isValid: boolean, path: string, description: string): string | null {
  return isValid ? null : `${path} must be ${description}`
}

function firstProblem(...problems: (() => string | null)[]): string | null {
  for (const problem of problems) {
    const found = problem()
    if (found) return found
  }
  return null
}

function listOf(check: Check): Check {
  return (value, path) => {
    if (!Array.isArray(value)) return `${path} must be a list`
    for (const [position, item] of value.entries()) {
      const problem = check(item, `${path}[${position}]`)
      if (problem) return problem
    }
    return null
  }
}

function mapOf(check: Check): Check {
  return (value, path) => {
    if (!isObject(value)) return `${path} must be an object`
    for (const [key, item] of Object.entries(value)) {
      const problem = check(item, `${path}.${key}`)
      if (problem) return problem
    }
    return null
  }
}

function objectWith(properties: Record<string, Check>): Check {
  return (value, path) => {
    if (!isObject(value)) return `${path} must be an object`
    for (const [key, check] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) return `${path} is missing ${key}`
      const problem = check(value[key], `${path}.${key}`)
      if (problem) return problem
    }
    return null
  }
}

function orNull(check: Check): Check {
  return (value, path) => (value === null ? null : check(value, path))
}

const text: Check = (value, path) => expect(isString(value), path, 'a string')
const textOrNull: Check = (value, path) => expect(isStringOrNull(value), path, 'a string or null')
const oneOf =
  (...allowed: (string | null)[]): Check =>
  (value, path) =>
    expect(allowed.includes(value as string | null), path, `one of ${allowed.map(String).join(', ')}`)

const sectionPath: Check = (value, path) =>
  firstProblem(
    () => listOf(text)(value, path),
    () => expect((value as unknown[]).length > 0, path, 'a non-empty list'),
  )

const assessment = objectWith({
  status: oneOf('automated', 'manual'),
  manual_reason: oneOf('manual', 'inherent', 'permanent', 'n_a', 'supplemental', 'no_check', null),
})

const applicability = listOf(
  objectWith({
    target: textOrNull,
    version: textOrNull,
    benchmarks: listOf(objectWith({ name: text, severity: textOrNull })),
  }),
)

const checkResult = objectWith({
  type: oneOf('integer', 'string', 'base64'),
  value: (value, path) => expect(isNumberOrString(value), path, 'a number or a string'),
})
const anyValue: Check = () => null

// A script is inline (shell) or in a file (shell_file), a payload inline
// (data) or in a file (data_file): exactly one of each pair, checked by the
// rules in fileReferences.ts.
function exactlyOneOf(inlineKey: string, inlineCheck: Check, fileKey: string, fileCheck: Check): Check {
  return (value, path) => {
    if (!isObject(value)) return `${path} must be an object`
    const problem = exactlyOneProblem(value, inlineKey, fileKey)
    if (problem) return `${path} ${problem}`
    return Object.hasOwn(value, inlineKey)
      ? inlineCheck(value[inlineKey], `${path}.${inlineKey}`)
      : fileCheck(value[fileKey], `${path}.${fileKey}`)
  }
}

function scriptFileFor(scriptLanguage: unknown): Check {
  return (value, path) => {
    const problem = scriptFileProblem(value, scriptLanguage)
    return problem ? `${path} ${problem}` : null
  }
}

const payloadFile: Check = (value, path) => {
  const problem = payloadFileProblem(value)
  return problem ? `${path} ${problem}` : null
}

function checkEntryFor(scriptLanguage: unknown): Check {
  return (value, path) =>
    firstProblem(
      () => objectWith({ result: orNull(checkResult), additional_info: textOrNull })(value, path),
      () => exactlyOneOf('shell', textOrNull, 'shell_file', scriptFileFor(scriptLanguage))(value, path),
    )
}
const language = oneOf('bash', 'powershell', 'zsh', 'python')
const versions: Check = (value, path) =>
  value === null
    ? null
    : firstProblem(
        () => listOf(text)(value, path),
        () => expect((value as unknown[]).length > 0, path, 'a non-empty list or null'),
      )

// check and remediation are keyed by target name, which the details show as
// a heading. As in the schema, a map needs at least one target (no target is
// written null) and an empty or multi-line name is rejected.
function targetMapOf(check: Check): Check {
  return (value, path) =>
    firstProblem(
      () => mapOf(check)(value, path),
      () => expect(Object.keys(value as JsonObject).length > 0, path, 'an object with at least one target, or null'),
      () => {
        const badName = Object.keys(value as JsonObject).find((name) => name === '' || name.includes('\n'))
        return badName === undefined ? null : `${path} has a target name that is empty or spans lines`
      },
    )
}

// A check entry's script file extension follows its target's language.
const targetCheck: Check = (value, path) =>
  firstProblem(
    () => objectWith({ language, default: anyValue, by_version: mapOf(anyValue) })(value, path),
    () => {
      const { language: scriptLanguage, default: defaultCheck, by_version: byVersion } = value as JsonObject
      const checkEntry = checkEntryFor(scriptLanguage)
      return firstProblem(
        () => orNull(checkEntry)(defaultCheck, `${path}.default`),
        () => mapOf(checkEntry)(byVersion, `${path}.by_version`),
      )
    },
  )
const check = orNull(targetMapOf(targetCheck))

// Every key is optional, and the schema closes the object, so an unknown
// key is rejected; logic/odv.ts reads each one with these types.
const ODV_VALIDATION_KEYS: Record<string, Check> = {
  min: (value, path) => expect(typeof value === 'number', path, 'a number'),
  max: (value, path) => expect(typeof value === 'number', path, 'a number'),
  regex: text,
  enumValues: listOf(text),
}
const odvValidation: Check = (value, path) => {
  if (value === null) return null
  if (!isObject(value)) return `${path} must be an object or null`
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(ODV_VALIDATION_KEYS, key)) return `${path} has unknown key ${key}`
    const keyCheck = ODV_VALIDATION_KEYS[key]
    const problem = keyCheck(item, `${path}.${key}`)
    if (problem) return problem
  }
  return null
}

const odv = orNull(
  objectWith({
    datatype: oneOf('number', 'string', 'enum', 'regex'),
    description: text,
    validation: odvValidation,
    recommended: (value, path) => expect(isNumberOrString(value), path, 'a number or a string'),
    by_benchmark: mapOf((value, path) => expect(isNumberOrString(value), path, 'a number or a string')),
  }),
)

const remediationStep: Check = (value, path) =>
  firstProblem(
    () => objectWith({ name: textOrNull, language, additional_info: textOrNull, versions })(value, path),
    () => exactlyOneOf('shell', textOrNull, 'shell_file', scriptFileFor((value as JsonObject).language))(value, path),
  )
// Inline payload data is only ever shown through JSON.stringify, so any JSON
// object or list is safe.
const remediationPayload: Check = (value, path) =>
  firstProblem(
    () => objectWith({ kind: text, versions })(value, path),
    () =>
      exactlyOneOf(
        'data',
        (data, dataPath) => expect(data !== null && typeof data === 'object', dataPath, 'an object or a list'),
        'data_file',
        payloadFile,
      )(value, path),
  )
const remediation = orNull(targetMapOf(objectWith({ steps: listOf(remediationStep), payloads: listOf(remediationPayload) })))

const indexFields: Record<string, Check> = {
  title: text,
  section_path: sectionPath,
  assessment,
  architecture: oneOf('arm64', 'i386', null),
  applicability,
  tags: listOf(text),
}

const ruleFields: Record<string, Check> = {
  ...indexFields,
  discussion: text,
  discussion_format: oneOf('asciidoc', 'markdown'),
  references: (value, path) => expect(isObject(value), path, 'an object'),
  check,
  odv,
  remediation,
}

function shapeProblem(value: unknown, fields: Record<string, Check>): string | null {
  if (!isObject(value)) return 'the rule must be an object'
  for (const [field, fieldCheck] of Object.entries(fields)) {
    const problem = fieldCheck(value[field], field)
    if (problem) return problem
  }
  return null
}

export function ruleShapeProblem(rule: unknown): string | null {
  return shapeProblem(rule, ruleFields)
}

export function indexEntryShapeProblem(entry: unknown): string | null {
  return shapeProblem(entry, indexFields)
}
