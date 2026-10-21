import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Manifest, Rule, RuleIndex } from '../types/library'
import { odvSubstitutionMode, validateOdvValue, type OdvSubstitutionMode } from './odv'

const BASELINES_DIRECTORY = new URL('../../../baselines/', import.meta.url)

function readBaselinesJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, BASELINES_DIRECTORY), 'utf8')) as T
}

// Pinned on purpose: a mode decides which characters may reach a script,
// so an upstream change to any rule's check shell must be reviewed here.
const EXPECTED_ODV_SUBSTITUTION_MODES: Record<string, OdvSubstitutionMode> = {
  audit_configure_capacity_notify: 'none',
  audit_retention_configure: 'none',
  os_external_storage_access_defined: 'none',
  os_install_log_retention_configure: 'text',
  os_network_storage_restriction: 'none',
  os_policy_banner_loginwindow_enforce: 'none',
  os_policy_banner_ssh_configure: 'variable',
  os_software_update_deferral: 'text',
  os_ssh_server_alive_count_max_configure: 'text',
  os_ssh_server_alive_interval_configure: 'text',
  os_sshd_channel_timeout_configure: 'none',
  os_sshd_client_alive_count_max_configure: 'none',
  os_sshd_client_alive_interval_configure: 'none',
  os_sshd_login_grace_time_configure: 'none',
  os_sshd_unused_connection_timeout_configure: 'none',
  os_sudo_timeout_configure: 'text',
  os_unlock_active_user_session_disable: 'text',
  pwpolicy_account_inactivity_enforce: 'none',
  pwpolicy_account_lockout_enforce: 'text',
  pwpolicy_account_lockout_timeout_enforce: 'text',
  pwpolicy_custom_regex_enforce: 'text',
  pwpolicy_history_enforce: 'text',
  pwpolicy_lower_case_character_enforce: 'text',
  pwpolicy_max_lifetime_enforce: 'text',
  pwpolicy_minimum_length_enforce: 'text',
  pwpolicy_minimum_lifetime_enforce: 'text',
  pwpolicy_special_character_enforce: 'text',
  pwpolicy_upper_case_character_enforce: 'text',
  system_settings_automatic_logout_enforce: 'none',
  system_settings_loginwindow_loginwindowtext_enable: 'none',
  system_settings_screensaver_ask_for_password_delay_enforce: 'text',
  system_settings_screensaver_timeout_enforce: 'text',
  system_settings_softwareupdate_current: 'text',
  system_settings_time_server_configure: 'none',
}

// Pinned on purpose: these text-mode rules have string or regex ODVs, whose
// safety depends on exactly where $ODV sits in the shell (ruling 6 of Plan 2
// Task 4). The loginwindow text rule is pinned because the generator assumes
// osascript's trailing newline is piped into base64 (see checkPlan.ts).
const PINNED_CHECK_SHELLS: Record<string, Record<string, string>> = {
  pwpolicy_custom_regex_enforce: {
    "default": "/usr/bin/pwpolicy -getaccountpolicies 2> /dev/null | /usr/bin/tail +2 | /usr/bin/xmllint --xpath 'boolean(//*[contains(text(),\"policyAttributePassword matches '\\''$ODV'\\''\")])' -",
  },
  system_settings_softwareupdate_current: {
    "default": "softwareupdate_date_epoch=$(/bin/date -j -f \"%Y-%m-%d\" \"$(/usr/bin/defaults read /Library/Preferences/com.apple.SoftwareUpdate.plist LastFullSuccessfulDate | /usr/bin/awk '{print $1}')\" \"+%s\")\nthirty_days_epoch=$(/bin/date -v -$ODV \"+%s\")\nif [[ $softwareupdate_date_epoch -lt $thirty_days_epoch ]]; then\n  /bin/echo \"0\"\nelse\n  /bin/echo \"1\"\nfi",
    "15.0": "softwareupdate_date_epoch=$(/bin/date -j -f \"%Y-%m-%d\" \"$(/usr/bin/defaults read /Library/Preferences/com.apple.SoftwareUpdate.plist LastFullSuccessfulDate | /usr/bin/awk '{print $1}')\" \"+%s\")\nthirty_days_epoch=$(/bin/date -v -30d \"+%s\")\nif [[ $softwareupdate_date_epoch -lt $thirty_days_epoch ]]; then\n  /bin/echo \"0\"\nelse\n  /bin/echo \"1\"\nfi",
  },
  system_settings_loginwindow_loginwindowtext_enable: {
    "default": "/usr/bin/osascript -l JavaScript << EOS | /usr/bin/base64\n$.NSUserDefaults.alloc.initWithSuiteName('com.apple.loginwindow')\\\n.objectForKey('LoginwindowText').js\nEOS",
  },
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

      it('pins the substitution mode of every rule that has an ODV', () => {
        const actualModes = Object.fromEntries(rulesWithOdv.map((rule) => [rule.id, odvSubstitutionMode(rule)]))
        const expectedModes = Object.fromEntries(
          Object.entries(EXPECTED_ODV_SUBSTITUTION_MODES).map(([upstreamId, mode]) => [`mscp.${upstreamId}`, mode]),
        )
        expect(actualModes).toEqual(expectedModes)
      })

      it('pins the exact check shells whose ODV placement or output format the generator depends on', () => {
        const rulesById = new Map(rulesWithOdv.map((rule) => [rule.source.upstream_rule_id, rule]))
        const actualShells = Object.fromEntries(
          Object.keys(PINNED_CHECK_SHELLS).map((upstreamId) => {
            const check = rulesById.get(upstreamId)?.check
            const shells: Record<string, string | null | undefined> = { default: check?.default?.shell }
            for (const [version, versionCheck] of Object.entries(check?.by_version ?? {})) shells[version] = versionCheck.shell
            return [upstreamId, shells]
          }),
        )
        expect(actualShells).toEqual(PINNED_CHECK_SHELLS)
      })

      it('passes validateOdvValue for every recommended and by_benchmark value', () => {
        const failures: string[] = []
        for (const rule of rulesWithOdv) {
          const odv = rule.odv!
          const mode = odvSubstitutionMode(rule)
          const candidates: [string, number | string][] = [
            ['recommended', odv.recommended],
            ...Object.entries(odv.by_benchmark).map(([benchmark, value]): [string, number | string] => [
              `by_benchmark.${benchmark}`,
              value,
            ]),
          ]
          for (const [location, value] of candidates) {
            const reason = validateOdvValue(odv, value, mode, rule.id)
            if (reason) failures.push(`${rule.id} ${location}=${JSON.stringify(value)}: ${reason}`)
          }
        }
        expect(failures).toEqual([])
      })
    })
  }
})
