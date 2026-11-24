"""PowerShell for the ansible-lockdown rules that are not plain registry settings.

`tools/registry_powershell.py` covers registry values. This module covers the three other
modules whose arguments become a script: security policy (`win_security_policy`), user
rights (`win_user_right`) and services (`win_service`). Every script follows the same
conventions as the registry ones: a check prints each mismatch and exits 1, or exits 0; a
fix stops on any error with a trap that exits 1. Security policy and user rights go through
`secedit` with a temporary directory that is always removed in a `finally` block. A number
ODV (`$ODV_<name>`) stays bare in the text and a string ODV is single quoted.
"""

from tools.registry_powershell import is_odv, single_quoted

SCRIPT_HEADER = ["$ErrorActionPreference = 'Stop'", "trap { Write-Output $_.Exception.Message; exit 1 }", ""]
CHECK_COUNTER = ["$mismatchCount = 0"]
CHECK_FOOTER = ["if ($mismatchCount -gt 0) { exit 1 }", "exit 0"]
WORK_DIRECTORY = "$workDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())"
CREATE_WORK_DIRECTORY = "New-Item -ItemType Directory -Path $workDirectory | Out-Null"
REMOVE_WORK_DIRECTORY = ["finally {", "    Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue", "}"]
EXPORT_PATH = "$exportPath = Join-Path $workDirectory 'export.inf'"
INF_FOOTER = ["'[Version]'", "'signature=\"$CHICAGO$\"'", "'Revision=1'"]
QUOTED_TEXT_KEYS = ("newadministratorname", "newguestname")

CONVERT_TO_SID_FUNCTION = [
    "function ConvertTo-AccountSid {",
    "    param([string]$Account)",
    "    if ($Account -match '^\\*?(S-1-[0-9-]+)$') { return $Matches[1] }",
    "    return ([System.Security.Principal.NTAccount]$Account).Translate([System.Security.Principal.SecurityIdentifier]).Value",
    "}",
    "",
]


def indented(lines: list[str], levels: int = 1) -> list[str]:
    return [("    " * levels + line) if line else line for line in lines]


def secedit_export(area: str) -> list[str]:
    return [
        EXPORT_PATH,
        f"secedit /export /cfg $exportPath /areas {area} | Out-Null",
        "if ($LASTEXITCODE -ne 0) { throw 'secedit /export failed' }",
    ]


def secedit_script(body: list[str]) -> list[str]:
    """The shared frame: a temporary directory, the body inside try, removal in finally."""
    return [WORK_DIRECTORY, "try {", *indented([CREATE_WORK_DIRECTORY, *body]), "}", *REMOVE_WORK_DIRECTORY]


def script_text(lines: list[str]) -> str:
    return "\n".join(lines) + "\n"


def string_expression(text: str) -> str:
    """A string ODV stays a single quoted placeholder; any other text is quoted with its quotes doubled."""
    return f"'{text}'" if is_odv(text) else single_quoted(text)


def number_expression(value) -> str:
    return value if is_odv(value) else str(value)


def policy_label(setting: dict) -> str:
    return f"[{setting['section']}] {setting['key']}"


def policy_lookup_key(setting: dict) -> str:
    return single_quoted(f"{setting['section']}|{setting['key']}")


def policy_current_value(setting: dict) -> list[str]:
    lines = [f"$current = $exported[{policy_lookup_key(setting)}]"]
    if setting["kind"] == "text":
        lines.append("if ($null -ne $current) { $current = $current.Trim('\"') }")
    return lines


def policy_mismatch_test(setting: dict) -> str:
    if setting["kind"] == "text":
        return f"$current -cne {string_expression(setting['value'])}"
    return f"$current -ne [string]{number_expression(setting['value'])}"


def security_policy_check_powershell(settings: list[dict]) -> str:
    """A script that exports the local security policy and prints each setting that differs."""
    parse_export = [
        "$exported = @{}",
        "$section = ''",
        "foreach ($line in Get-Content -LiteralPath $exportPath) {",
        "    if ($line -match '^\\[(.+)\\]\\s*$') { $section = $Matches[1] }",
        "    elseif ($line -match '^\\s*([^=]+?)\\s*=\\s*(.*?)\\s*$') { $exported[$section + '|' + $Matches[1]] = $Matches[2] }",
        "}",
    ]
    comparisons: list[str] = []
    for setting in settings:
        comparisons += [
            *policy_current_value(setting),
            f"if ({policy_mismatch_test(setting)}) {{",
            f"    Write-Output {single_quoted('Mismatch: ' + policy_label(setting))}",
            "    $mismatchCount++",
            "}",
        ]
    body = [*secedit_export("SECURITYPOLICY"), *parse_export, *comparisons]
    lines = [*SCRIPT_HEADER, *CHECK_COUNTER, *secedit_script(body), *CHECK_FOOTER]
    return script_text(lines)


def inf_line_expression(setting: dict) -> str:
    key, value = setting["key"], setting["value"]
    if setting["kind"] == "text":
        if is_odv(value):
            return f"('{key} = \"' + '{value}' + '\"')"
        return single_quoted(f'{key} = "{value}"')
    if is_odv(value):
        return f"('{key} = ' + {value})"
    return single_quoted(f"{key} = {value}")


def security_policy_fix_powershell(settings: list[dict]) -> str:
    """A script that writes the settings to an INF file and applies it with `secedit /configure`."""
    sections: dict[str, list[dict]] = {}
    for setting in settings:
        sections.setdefault(setting["section"], []).append(setting)
    inf_elements = ["'[Unicode]'", "'Unicode=yes'"]
    for section, section_settings in sections.items():
        inf_elements.append(single_quoted(f"[{section}]"))
        inf_elements += [inf_line_expression(setting) for setting in section_settings]
    inf_elements += INF_FOOTER
    body = [
        "$infLines = @(",
        *indented([element + "," for element in inf_elements[:-1]] + [inf_elements[-1]]),
        ")",
        "$infPath = Join-Path $workDirectory 'policy.inf'",
        "Set-Content -LiteralPath $infPath -Value $infLines -Encoding Unicode",
        "secedit /configure /db (Join-Path $workDirectory 'policy.sdb') /cfg $infPath /areas SECURITYPOLICY | Out-Null",
        "if ($LASTEXITCODE -ne 0) { throw 'secedit /configure failed' }",
    ]
    return script_text([*SCRIPT_HEADER, *secedit_script(body), "exit 0"])


def accounts_expression(accounts: list[str]) -> str:
    if not accounts:
        return "@()"
    if not any(is_odv(account) for account in accounts):
        quoted = ", ".join(string_expression(account) for account in accounts)
        return f"@({quoted} | ForEach-Object {{ ConvertTo-AccountSid $_ }})"
    # Ansible splits a string given as `users` on commas, so a variable holding "A, B" is two accounts.
    parts = [
        f"@('{account}' -split ',' | ForEach-Object {{ $_.Trim() }} | Where-Object {{ $_ }})"
        if is_odv(account)
        else f"@({string_expression(account)})"
        for account in accounts
    ]
    return f"@({' + '.join(parts)} | ForEach-Object {{ ConvertTo-AccountSid $_ }})"


PARSE_RIGHT_HOLDERS = [
    "$holdersByRight = @{}",
    "foreach ($line in Get-Content -LiteralPath $exportPath) {",
    "    if ($line -match '^(Se\\w+)\\s*=\\s*(.*)$') {",
    "        $holdersByRight[$Matches[1]] = @($Matches[2].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } | ForEach-Object { ConvertTo-AccountSid $_ })",
    "    }",
    "}",
]


def current_holders(right: dict) -> list[str]:
    name = single_quoted(right["name"])
    return ["$holders = @()", f"if ($holdersByRight.ContainsKey({name})) {{ $holders = $holdersByRight[{name}] }}"]


def user_rights_check_powershell(rights: list[dict]) -> str:
    """A script that exports the user rights and prints each right whose holders differ from the rule."""
    comparisons: list[str] = []
    for right in rights:
        expected = accounts_expression(right["accounts"])
        if right["action"] == "set":
            differs = "(($expected | Sort-Object -Unique) -join ',') -ne (($holders | Sort-Object -Unique) -join ',')"
        elif right["action"] == "add":
            differs = "@($expected | Where-Object { $holders -notcontains $_ }).Count -gt 0"
        else:
            differs = "@($expected | Where-Object { $holders -contains $_ }).Count -gt 0"
        comparisons += [
            *current_holders(right),
            f"$expected = {expected}",
            f"if ({differs}) {{",
            f"    Write-Output {single_quoted('Mismatch: ' + right['name'])}",
            "    $mismatchCount++",
            "}",
        ]
    body = [*secedit_export("USER_RIGHTS"), *PARSE_RIGHT_HOLDERS, *comparisons]
    lines = [*SCRIPT_HEADER, *CONVERT_TO_SID_FUNCTION, *CHECK_COUNTER, *secedit_script(body), *CHECK_FOOTER]
    return script_text(lines)


def user_rights_fix_powershell(rights: list[dict]) -> str:
    """A script that applies each user right through an INF file and `secedit /configure`."""
    needs_current_holders = any(right["action"] != "set" for right in rights)
    body: list[str] = []
    if needs_current_holders:
        body += [*secedit_export("USER_RIGHTS"), *PARSE_RIGHT_HOLDERS]
    body.append("$desiredByRight = [ordered]@{}")
    for right in rights:
        name = single_quoted(right["name"])
        expected = accounts_expression(right["accounts"])
        if right["action"] == "set":
            body.append(f"$desiredByRight[{name}] = {expected}")
        elif right["action"] == "add":
            body += [*current_holders(right), f"$desiredByRight[{name}] = @($holders + {expected} | Sort-Object -Unique)"]
        else:
            body += [
                *current_holders(right),
                f"$removed = {expected}",
                f"$desiredByRight[{name}] = @($holders | Where-Object {{ $removed -notcontains $_ }})",
            ]
    body += [
        "$infLines = @('[Unicode]', 'Unicode=yes', '[Privilege Rights]')",
        "foreach ($right in $desiredByRight.Keys) {",
        "    $infLines += ($right + ' = ' + (@($desiredByRight[$right] | ForEach-Object { '*' + $_ }) -join ','))",
        "}",
        "$infLines += @('[Version]', 'signature=\"$CHICAGO$\"', 'Revision=1')",
        "$infPath = Join-Path $workDirectory 'rights.inf'",
        "Set-Content -LiteralPath $infPath -Value $infLines -Encoding Unicode",
        "secedit /configure /db (Join-Path $workDirectory 'rights.sdb') /cfg $infPath /areas USER_RIGHTS | Out-Null",
        "if ($LASTEXITCODE -ne 0) { throw 'secedit /configure failed' }",
    ]
    lines = [*SCRIPT_HEADER, *CONVERT_TO_SID_FUNCTION, *secedit_script(body), "exit 0"]
    return script_text(lines)


START_TYPE_BY_START_MODE = {"auto": "Automatic", "manual": "Manual", "disabled": "Disabled"}
STATUS_BY_STATE = {"started": "Running", "stopped": "Stopped"}


def message_expression(service_name: str, verb: str, actual_expression: str, expected: str) -> str:
    before = single_quoted(f"Mismatch: service {service_name} {verb} ")
    after = single_quoted(f", expected {expected}")
    return f"({before} + {actual_expression} + {after})"


def services_check_powershell(services: list[dict]) -> str:
    """A script that prints each service whose start type or state differs; a service that is not installed passes."""
    lines = [*CHECK_COUNTER, ""]
    for service in services:
        name = single_quoted(service["name"])
        mismatches: list[str] = []
        if service["start_mode"]:
            expected = START_TYPE_BY_START_MODE[service["start_mode"]]
            mismatches += [
                f"if ($service.StartType -ne '{expected}') {{",
                f"    Write-Output {message_expression(service['name'], 'start type is', '$service.StartType', expected)}",
                "    $mismatchCount++",
                "}",
            ]
        if service["state"]:
            expected = STATUS_BY_STATE[service["state"]]
            mismatches += [
                f"if ($service.Status -ne '{expected}') {{",
                f"    Write-Output {message_expression(service['name'], 'is', '$service.Status', expected)}",
                "    $mismatchCount++",
                "}",
            ]
        lines += [f"$service = Get-Service -Name {name} -ErrorAction SilentlyContinue", "if ($service) {", *indented(mismatches), "}", ""]
    return script_text([*lines, *CHECK_FOOTER])


def services_fix_powershell(services: list[dict]) -> str:
    """A script that sets each installed service's start type and state; a service that is not installed is skipped."""
    lines = list(SCRIPT_HEADER)
    for service in services:
        name = single_quoted(service["name"])
        actions: list[str] = []
        if service["start_mode"]:
            actions.append(f"Set-Service -Name {name} -StartupType {START_TYPE_BY_START_MODE[service['start_mode']]}")
        if service["state"] == "stopped":
            force = " -Force" if service["force_dependent_services"] else ""
            actions += ["if ($service.Status -ne 'Stopped') {", f"    Stop-Service -Name {name}{force}", "}"]
        elif service["state"] == "started":
            actions += ["if ($service.Status -ne 'Running') {", f"    Start-Service -Name {name}", "}"]
        lines += [f"$service = Get-Service -Name {name} -ErrorAction SilentlyContinue", "if ($service) {", *indented(actions), "}", ""]
    return script_text([*lines, "exit 0"])
