import type { RegistrySetting } from '../types/library'
import { registryOdvName, resolveRegistrySetting } from './odv'
import { LONG_HIVE_NAMES } from './registryFile'
import type { OdvValues } from './selectionEntry'

export interface RegistryRow {
  hive: string
  path: string
  // Pasteable into regedit's address bar.
  fullPath: string
  valueName: string
  // '' for a setting that deletes the value.
  type: string
  // Display text: a MULTI_SZ joined with newlines, a BINARY as spaced byte pairs.
  data: string
  odvName: string | null
  action: 'Set' | 'Delete'
}

const DEFAULT_VALUE_LABEL = '(Default)'

function dataDisplay(setting: RegistrySetting): string {
  const { data } = setting
  if (data === null) return ''
  if (Array.isArray(data)) return data.join('\n')
  if (setting.type === 'REG_BINARY') return (data as string).replace(/(..)(?=.)/g, '$1 ')
  return String(data)
}

export function registryRows(settings: RegistrySetting[], odvValues: Partial<OdvValues>): RegistryRow[] {
  return settings.map((declared) => {
    const setting = resolveRegistrySetting(declared, odvValues)
    return {
      hive: setting.hive,
      path: setting.path,
      fullPath: `${LONG_HIVE_NAMES[setting.hive]}\\${setting.path}`,
      valueName: setting.value_name === '' ? DEFAULT_VALUE_LABEL : setting.value_name,
      type: setting.type ?? '',
      data: dataDisplay(setting),
      odvName: registryOdvName(declared.data),
      action: setting.state === 'absent' ? 'Delete' : 'Set',
    }
  })
}
