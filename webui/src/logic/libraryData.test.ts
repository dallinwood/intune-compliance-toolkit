import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Manifest, Rule, RuleIndex } from '../types/library'
import { odvShellContext, validateOdvValue, type OdvShellContext } from './odv'

const BASELINES_DIRECTORY = new URL('../../../baselines/', import.meta.url)

function readBaselinesJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, BASELINES_DIRECTORY), 'utf8')) as T
}

// Pinned on purpose: a context decides which characters may reach a script,
// so an upstream change to any rule's check shell must be reviewed here.
const EXPECTED_ODV_SHELL_CONTEXTS: Record<string, OdvShellContext> = {
  audit_configure_capacity_notify: 'none',
  audit_retention_configure: 'none',
  os_external_storage_access_defined: 'none',
  os_install_log_retention_configure: 'other',
  os_network_storage_restriction: 'none',
  os_policy_banner_loginwindow_enforce: 'none',
  os_policy_banner_ssh_configure: 'double_quoted',
  os_software_update_deferral: 'other',
  os_ssh_server_alive_count_max_configure: 'double_quoted',
  os_ssh_server_alive_interval_configure: 'double_quoted',
  os_sshd_channel_timeout_configure: 'none',
  os_sshd_client_alive_count_max_configure: 'none',
  os_sshd_client_alive_interval_configure: 'none',
  os_sshd_login_grace_time_configure: 'none',
  os_sshd_unused_connection_timeout_configure: 'none',
  os_sudo_timeout_configure: 'double_quoted',
  os_unlock_active_user_session_disable: 'other',
  pwpolicy_account_inactivity_enforce: 'none',
  pwpolicy_account_lockout_enforce: 'other',
  pwpolicy_account_lockout_timeout_enforce: 'other',
  pwpolicy_custom_regex_enforce: 'other',
  pwpolicy_history_enforce: 'other',
  pwpolicy_lower_case_character_enforce: 'other',
  pwpolicy_max_lifetime_enforce: 'other',
  pwpolicy_minimum_length_enforce: 'other',
  pwpolicy_minimum_lifetime_enforce: 'other',
  pwpolicy_special_character_enforce: 'other',
  pwpolicy_upper_case_character_enforce: 'other',
  system_settings_automatic_logout_enforce: 'none',
  system_settings_loginwindow_loginwindowtext_enable: 'none',
  system_settings_screensaver_ask_for_password_delay_enforce: 'other',
  system_settings_screensaver_timeout_enforce: 'other',
  system_settings_softwareupdate_current: 'other',
  system_settings_time_server_configure: 'none',
}

const manifest = readBaselinesJson<Manifest>('_manifest.json')

describe('committed library data', () => {
  for (const source of manifest.sources) {
    const index = readBaselinesJson<RuleIndex>(source.index_path)
    const indexDirectory = source.index_path.slice(0, source.index_path.lastIndexOf('/') + 1)
    const rulesWithOdv = index.rules
      .map((entry) => readBaselinesJson<Rule>(`${indexDirectory}${entry.file}`))
      .filter((rule) => rule.odv !== null)

    describe(source.name, () => {
      it('has a non-empty section on every index entry', () => {
        const entriesWithoutSection = index.rules.filter((entry) => !entry.section).map((entry) => entry.id)
        expect(entriesWithoutSection).toEqual([])
      })

      it('pins the shell context of every rule that has an ODV', () => {
        const actualContexts = Object.fromEntries(rulesWithOdv.map((rule) => [rule.id, odvShellContext(rule)]))
        const expectedContexts = Object.fromEntries(
          Object.entries(EXPECTED_ODV_SHELL_CONTEXTS).map(([upstreamId, context]) => [`mscp.${upstreamId}`, context]),
        )
        expect(actualContexts).toEqual(expectedContexts)
      })

      it('passes validateOdvValue for every recommended and by_benchmark value', () => {
        const failures: string[] = []
        for (const rule of rulesWithOdv) {
          const odv = rule.odv!
          const context = odvShellContext(rule)
          const candidates: [string, number | string][] = [
            ['recommended', odv.recommended],
            ...Object.entries(odv.by_benchmark).map(([benchmark, value]): [string, number | string] => [
              `by_benchmark.${benchmark}`,
              value,
            ]),
          ]
          for (const [location, value] of candidates) {
            const reason = validateOdvValue(odv, value, context)
            if (reason) failures.push(`${rule.id} ${location}=${JSON.stringify(value)}: ${reason}`)
          }
        }
        expect(failures).toEqual([])
      })
    })
  }
})
