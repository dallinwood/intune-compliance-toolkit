from tools.registry_powershell import registry_check_powershell, registry_fix_powershell

KEY = "HKLM:\\SOFTWARE\\Policies\\Example"
FIX_HEADER = "$ErrorActionPreference = 'Stop'\ntrap { Write-Output $_.Exception.Message; exit 1 }\n\n"


def setting(**overrides) -> dict:
    registry_setting = {
        "hive": "HKLM",
        "path": "SOFTWARE\\Policies\\Example",
        "value_name": "Enabled",
        "type": "REG_DWORD",
        "data": 1,
        "state": "present",
    }
    registry_setting.update(overrides)
    return registry_setting


def test_check_for_a_dword_setting():
    assert registry_check_powershell([setting()]) == (
        "$mismatchCount = 0\n"
        "\n"
        f"$key = Get-Item -LiteralPath '{KEY}' -ErrorAction SilentlyContinue\n"
        "$current = $null\n"
        "if ($key) { $current = $key.GetValue('Enabled', $null, 'DoNotExpandEnvironmentNames') }\n"
        "if (-not ($current -is [int] -and [BitConverter]::ToUInt32([BitConverter]::GetBytes($current), 0) -eq [uint32]1)) {\n"
        f"    Write-Output 'Mismatch: {KEY} [Enabled]'\n"
        "    $mismatchCount++\n"
        "}\n"
        "\n"
        "if ($mismatchCount -gt 0) { exit 1 }\n"
        "exit 0\n"
    )


def check_condition(registry_setting: dict) -> str:
    lines = registry_check_powershell([registry_setting]).splitlines()
    return next(line for line in lines if line.startswith("if (-not ("))


def test_check_conditions_for_every_type():
    assert check_condition(setting(type="REG_QWORD", data=18446744073709551615)) == (
        "if (-not ($current -is [long] -and [BitConverter]::ToUInt64([BitConverter]::GetBytes($current), 0) "
        "-eq [uint64]18446744073709551615)) {"
    )
    assert check_condition(setting(type="REG_SZ", data="it's")) == (
        "if (-not ($current -is [string] -and $kind -ceq 'String' -and $current -ceq 'it''s')) {"
    )
    assert check_condition(setting(type="REG_MULTI_SZ", data=["a", "b"])) == (
        "if (-not ($current -is [string[]] -and $current.Length -eq 2 -and "
        "[string]::Join([string][char]0, $current) -ceq [string]::Join([string][char]0, @('a', 'b')))) {"
    )
    assert check_condition(setting(type="REG_BINARY", data="0aFf")) == (
        "if (-not ($current -is [byte[]] -and [BitConverter]::ToString($current) -ceq '0A-FF')) {"
    )


def test_check_of_an_expand_string_reads_the_value_unexpanded_and_checks_its_kind():
    lines = registry_check_powershell([setting(type="REG_EXPAND_SZ", data="%SystemRoot%\\x")]).splitlines()
    assert lines[2:7] == [
        f"$key = Get-Item -LiteralPath '{KEY}' -ErrorAction SilentlyContinue",
        "$current = $null",
        "if ($key) { $current = $key.GetValue('Enabled', $null, 'DoNotExpandEnvironmentNames') }",
        "$kind = $null",
        "if ($null -ne $current) { $kind = $key.GetValueKind('Enabled') }",
    ]
    assert lines[7] == (
        "if (-not ($current -is [string] -and $kind -ceq 'ExpandString' -and $current -ceq '%SystemRoot%\\x')) {"
    )


def test_every_read_resets_current_so_a_missing_key_cannot_reuse_the_previous_value():
    text = registry_check_powershell(
        [
            setting(type="REG_EXPAND_SZ", data="%A%"),
            setting(path="SOFTWARE\\Other", type="REG_EXPAND_SZ", data="%A%"),
        ]
    )
    assert text.count("$current = $null\n") == 2
    assert text.count("$kind = $null\n") == 2


def test_a_read_never_assigns_an_if_expression_which_would_flatten_an_array_value():
    text = registry_check_powershell([setting(type="REG_MULTI_SZ", data=["a"]), setting(type="REG_BINARY", data="00")])
    assert "= if (" not in text


def test_a_string_check_wants_its_own_kind():
    assert "$kind -ceq 'String'" in check_condition(setting(type="REG_SZ", data="x"))
    assert "$kind -ceq 'ExpandString'" in check_condition(setting(type="REG_EXPAND_SZ", data="x"))


def test_check_of_an_absent_setting_wants_no_value():
    assert check_condition(setting(type=None, data=None, state="absent")) == "if (-not ($null -eq $current)) {"


def test_a_default_value_is_named_default():
    text = registry_check_powershell([setting(value_name="", type="REG_SZ", data="x")])
    assert "$key.GetValue('', $null," in text
    assert "[(Default)]" in text
    assert "-Name '(default)' -Value 'x'" in registry_fix_powershell([setting(value_name="", type="REG_SZ", data="x")])


def test_odv_placeholders_pass_through_as_powershell_variables():
    assert check_condition(setting(data="$ODV_max_age")) == (
        "if (-not ($current -is [int] -and [BitConverter]::ToUInt32([BitConverter]::GetBytes($current), 0) "
        "-eq [uint32]$ODV_max_age)) {"
    )
    assert check_condition(setting(type="REG_SZ", data="$ODV_banner")) == (
        "if (-not ($current -is [string] -and $kind -ceq 'String' -and $current -ceq '$ODV_banner')) {"
    )
    assert "-Value $ODV_max_age -PropertyType DWord" in registry_fix_powershell([setting(data="$ODV_max_age")])
    assert "-Value '$ODV_banner' -PropertyType String" in registry_fix_powershell(
        [setting(type="REG_SZ", data="$ODV_banner")]
    )


def test_a_quote_in_the_key_path_is_doubled():
    text = registry_check_powershell([setting(path="SOFTWARE\\O'Brien")])
    assert "'HKLM:\\SOFTWARE\\O''Brien'" in text
    assert "'Mismatch: HKLM:\\SOFTWARE\\O''Brien [Enabled]'" in text


def test_typographic_quotes_are_doubled_too():
    assert "'a’’b'" in registry_fix_powershell([setting(type="REG_SZ", data="a’b")])


def test_hives_use_provider_prefixes():
    prefixes = {"HKLM": "HKLM:\\", "HKCU": "HKCU:\\", "HKU": "Registry::HKEY_USERS\\", "HKCR": "Registry::HKEY_CLASSES_ROOT\\"}
    for hive, prefix in prefixes.items():
        assert f"-LiteralPath '{prefix}Key'" in registry_check_powershell([setting(hive=hive, path="Key")])


def test_check_reports_every_setting():
    text = registry_check_powershell([setting(), setting(value_name="Other")])
    assert text.count("$mismatchCount++") == 2
    assert text.count("Write-Output") == 2


def test_fix_for_every_type():
    expected = (
        FIX_HEADER
        + f"if (-not (Test-Path -LiteralPath '{KEY}')) {{\n"
        + f"    New-Item -Path '{KEY}' -Force | Out-Null\n"
        + "}\n"
        + f"New-ItemProperty -LiteralPath '{KEY}' -Name 'Enabled' -Value VALUE -PropertyType KIND -Force | Out-Null\n"
        + "exit 0\n"
    )
    cases = [
        ("REG_DWORD", 7, "7", "DWord"),
        ("REG_DWORD", 4294967295, "4294967295", "DWord"),
        ("REG_QWORD", 7, "7", "QWord"),
        ("REG_SZ", "it's", "'it''s'", "String"),
        ("REG_EXPAND_SZ", "%TEMP%", "'%TEMP%'", "ExpandString"),
        ("REG_MULTI_SZ", ["a", "b"], "@('a', 'b')", "MultiString"),
        ("REG_BINARY", "0aff", "([byte[]](0x0A, 0xFF))", "Binary"),
        ("REG_BINARY", "", "([byte[]]@())", "Binary"),
    ]
    for registry_type, data, value, kind in cases:
        actual = registry_fix_powershell([setting(type=registry_type, data=data)])
        assert actual == expected.replace("VALUE", value).replace("KIND", kind), registry_type


def test_fix_of_an_absent_setting_deletes_the_value_by_its_literal_name():
    absent = setting(type=None, data=None, state="absent", value_name="Star*[1]")
    assert registry_fix_powershell([absent]) == FIX_HEADER + (
        "$key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SOFTWARE\\Policies\\Example', $true)\n"
        "if ($key) {\n"
        "    $key.DeleteValue('Star*[1]', $false)\n"
        "    $key.Close()\n"
        "}\n"
        "exit 0\n"
    )


def test_fix_stops_and_exits_1_on_any_failure():
    text = registry_fix_powershell([setting()])
    assert text.startswith("$ErrorActionPreference = 'Stop'\ntrap { Write-Output $_.Exception.Message; exit 1 }\n")
