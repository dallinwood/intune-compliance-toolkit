"""PowerShell generated from a rule's registry settings.

A `registry` check entry or remediation step lists settings (design
2026-11-20-windows-cis-lockdown-design.md, section 1). Importers emit that
list together with the PowerShell built here, so the table the web UI shows
and the script cannot disagree. An `$ODV_<name>` in a setting's data stays in
the text as a PowerShell variable, the same as a placeholder in any script.
"""

from tools.odv_placeholders import TYPOGRAPHIC_SINGLE_QUOTES

PROVIDER_PREFIX_BY_HIVE = {
    "HKLM": "HKLM:",
    "HKCU": "HKCU:",
    "HKU": "Registry::HKEY_USERS",
    "HKCR": "Registry::HKEY_CLASSES_ROOT",
}
PROPERTY_TYPE_BY_REGISTRY_TYPE = {
    "REG_DWORD": "DWord",
    "REG_QWORD": "QWord",
    "REG_SZ": "String",
    "REG_EXPAND_SZ": "ExpandString",
    "REG_MULTI_SZ": "MultiString",
    "REG_BINARY": "Binary",
}
DEFAULT_VALUE_NAME = "(default)"
ODV_PREFIX = "$ODV_"
JOIN_WITH_NULL_CHARACTER = "[string]::Join([string][char]0, {})"


def single_quoted(text: str) -> str:
    """PowerShell also closes a string at a typographic single quote, so each kind is doubled."""
    for quote in "'" + TYPOGRAPHIC_SINGLE_QUOTES:
        text = text.replace(quote, quote + quote)
    return f"'{text}'"


def provider_path(setting: dict) -> str:
    return f"{PROVIDER_PREFIX_BY_HIVE[setting['hive']]}\\{setting['path']}"


def powershell_value_name(setting: dict) -> str:
    return setting["value_name"] or DEFAULT_VALUE_NAME


def is_odv(data) -> bool:
    return isinstance(data, str) and data.startswith(ODV_PREFIX)


def bytes_from_hex(hex_text: str) -> list[str]:
    return [hex_text[position : position + 2].upper() for position in range(0, len(hex_text), 2)]


def number_literal(data) -> str:
    return data if is_odv(data) else str(data)


def value_expression(setting: dict) -> str:
    registry_type, data = setting["type"], setting["data"]
    if registry_type in ("REG_DWORD", "REG_QWORD"):
        return number_literal(data)
    if registry_type == "REG_MULTI_SZ":
        return "@(" + ", ".join(single_quoted(item) for item in data) + ")"
    if registry_type == "REG_BINARY":
        byte_literals = ", ".join("0x" + pair for pair in bytes_from_hex(data))
        return f"([byte[]]({byte_literals}))" if byte_literals else "([byte[]]@())"
    return data if is_odv(data) else single_quoted(data)


def match_expression(setting: dict) -> str:
    if setting["state"] == "absent":
        return "$null -eq $current"
    registry_type, data = setting["type"], setting["data"]
    if registry_type == "REG_DWORD":
        return (
            "$current -is [int] -and [BitConverter]::ToUInt32([BitConverter]::GetBytes($current), 0) "
            f"-eq [uint32]{number_literal(data)}"
        )
    if registry_type == "REG_QWORD":
        return (
            "$current -is [long] -and [BitConverter]::ToUInt64([BitConverter]::GetBytes($current), 0) "
            f"-eq [uint64]{number_literal(data)}"
        )
    if registry_type in ("REG_SZ", "REG_EXPAND_SZ"):
        return f"$current -is [string] -and $current -ceq {value_expression(setting)}"
    if registry_type == "REG_MULTI_SZ":
        return (
            f"$current -is [string[]] -and $current.Length -eq {len(data)} -and "
            f"{JOIN_WITH_NULL_CHARACTER.format('$current')} -ceq "
            f"{JOIN_WITH_NULL_CHARACTER.format(value_expression(setting))}"
        )
    expected_bytes = single_quoted("-".join(bytes_from_hex(data)))
    return f"$current -is [byte[]] -and [BitConverter]::ToString($current) -ceq {expected_bytes}"


def read_current_value(setting: dict) -> str:
    path = single_quoted(provider_path(setting))
    if setting["type"] == "REG_EXPAND_SZ":
        # Get-ItemProperty expands %VARIABLE% references, which would never equal the stored text.
        return (
            f"$current = (Get-Item -LiteralPath {path} -ErrorAction SilentlyContinue)"
            f".GetValue({single_quoted(setting['value_name'])}, $null, 'DoNotExpandEnvironmentNames')"
        )
    name = single_quoted(powershell_value_name(setting))
    return f"$current = (Get-ItemProperty -LiteralPath {path} -Name {name} -ErrorAction SilentlyContinue).{name}"


def registry_check_powershell(settings: list[dict]) -> str:
    """A script that prints each setting that does not match and exits 1, or exits 0 when all match."""
    lines = ["$mismatchCount = 0", ""]
    for setting in settings:
        label = f"Mismatch: {provider_path(setting)} [{setting['value_name'] or '(Default)'}]"
        lines += [
            read_current_value(setting),
            f"if (-not ({match_expression(setting)})) {{",
            f"    Write-Output {single_quoted(label)}",
            "    $mismatchCount++",
            "}",
            "",
        ]
    lines += ["if ($mismatchCount -gt 0) { exit 1 }", "exit 0"]
    return "\n".join(lines) + "\n"


def registry_fix_powershell(settings: list[dict]) -> str:
    """A script that sets every present setting, creating its key, and removes every absent one."""
    lines = []
    for setting in settings:
        path = single_quoted(provider_path(setting))
        name = single_quoted(powershell_value_name(setting))
        if setting["state"] == "absent":
            lines.append(f"Remove-ItemProperty -LiteralPath {path} -Name {name} -ErrorAction SilentlyContinue")
            continue
        property_type = PROPERTY_TYPE_BY_REGISTRY_TYPE[setting["type"]]
        lines += [
            f"if (-not (Test-Path -LiteralPath {path})) {{",
            f"    New-Item -Path {path} -Force | Out-Null",
            "}",
            f"New-ItemProperty -LiteralPath {path} -Name {name} -Value {value_expression(setting)} "
            f"-PropertyType {property_type} -Force | Out-Null",
        ]
    return "\n".join(lines) + "\n"
