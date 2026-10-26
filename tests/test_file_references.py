import json
from pathlib import Path

import pytest

from tools.file_references import (
    exactly_one_problem,
    file_reference_errors,
    payload_file_problem,
    script_file_problem,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
CASES = json.loads((REPO_ROOT / "tests" / "fixtures" / "overlays" / "cases.json").read_text(encoding="utf-8"))


def reference_problem(case: dict) -> str | None:
    entry = case["entry"]
    if case["kind"] == "script":
        problem = exactly_one_problem(entry, "shell", "shell_file")
        if problem is None and "shell_file" in entry:
            problem = script_file_problem(entry["shell_file"], case["language"])
        return problem
    problem = exactly_one_problem(entry, "data", "data_file")
    if problem is None and "data_file" in entry:
        problem = payload_file_problem(entry["data_file"])
    return problem


@pytest.mark.parametrize("case", CASES["file_reference_cases"], ids=lambda case: case["name"])
def test_shared_file_reference_case(case):
    problem = reference_problem(case)
    assert (problem is not None) == case["error"], problem


def write_file(root: Path, relative: str, content: bytes) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def rule_with_step(step: dict, payloads: list | None = None) -> dict:
    return {"check": None, "remediation": {"Windows": {"steps": [step], "payloads": payloads or []}}}


def powershell_step(**reference) -> dict:
    return {"name": "Script", "language": "powershell", "additional_info": None, "versions": None, **reference}


def test_an_existing_lf_script_is_valid(tmp_path):
    write_file(tmp_path, "baselines/_overlays/scripts/Fix.ps1", b"Write-Output 1\n")
    rule = rule_with_step(powershell_step(shell_file="baselines/_overlays/scripts/Fix.ps1"))
    assert file_reference_errors(rule, tmp_path) == []


def test_a_missing_script_is_an_error(tmp_path):
    rule = rule_with_step(powershell_step(shell_file="baselines/_overlays/scripts/Missing.ps1"))
    errors = file_reference_errors(rule, tmp_path)
    assert len(errors) == 1
    assert "remediation.Windows.steps[0]" in errors[0] and "does not exist" in errors[0]


def test_a_crlf_script_is_an_error(tmp_path):
    write_file(tmp_path, "baselines/_overlays/scripts/Fix.ps1", b"Write-Output 1\r\n")
    rule = rule_with_step(powershell_step(shell_file="baselines/_overlays/scripts/Fix.ps1"))
    assert any("LF" in error for error in file_reference_errors(rule, tmp_path))


def test_a_check_script_extension_follows_the_target_language(tmp_path):
    write_file(tmp_path, "baselines/_overlays/scripts/check.ps1", b"1\n")
    entry = {"shell_file": "baselines/_overlays/scripts/check.ps1", "result": None, "additional_info": None}
    rule = {"check": {"macOS": {"language": "bash", "default": entry, "by_version": {}}}, "remediation": None}
    errors = file_reference_errors(rule, tmp_path)
    assert len(errors) == 1 and "check.macOS.default" in errors[0] and ".sh" in errors[0]


def test_both_shell_and_shell_file_is_an_error(tmp_path):
    write_file(tmp_path, "baselines/_overlays/scripts/Fix.ps1", b"1\n")
    rule = rule_with_step(powershell_step(shell="1", shell_file="baselines/_overlays/scripts/Fix.ps1"))
    assert any("exactly one" in error for error in file_reference_errors(rule, tmp_path))


def test_a_payload_file_must_exist(tmp_path):
    payload = {"kind": "mobileconfig", "versions": None, "data_file": "baselines/_overlays/payloads/Missing.mobileconfig"}
    rule = rule_with_step(powershell_step(shell="1"), [payload])
    assert any("does not exist" in error for error in file_reference_errors(rule, tmp_path))


def test_a_json_payload_file_must_parse(tmp_path):
    write_file(tmp_path, "baselines/_overlays/payloads/Broken.json", b"{ not json\n")
    payload = {"kind": "settings", "versions": None, "data_file": "baselines/_overlays/payloads/Broken.json"}
    rule = rule_with_step(powershell_step(shell="1"), [payload])
    assert any("not valid JSON" in error for error in file_reference_errors(rule, tmp_path))


def test_a_valid_json_payload_file_is_accepted(tmp_path):
    write_file(tmp_path, "baselines/_overlays/payloads/Good.json", b'{"key": "value"}\n')
    payload = {"kind": "settings", "versions": None, "data_file": "baselines/_overlays/payloads/Good.json"}
    assert file_reference_errors(rule_with_step(powershell_step(shell="1"), [payload]), tmp_path) == []


def test_a_crlf_text_payload_is_an_error_but_a_binary_payload_is_exempt(tmp_path):
    write_file(tmp_path, "baselines/_overlays/payloads/Policy.reg", b"Windows Registry Editor Version 5.00\r\n")
    write_file(tmp_path, "baselines/_overlays/payloads/Registry.pol", b"PReg\x01\x00\x00\x00\r\n\x00")
    text_payload = {"kind": "registry", "versions": None, "data_file": "baselines/_overlays/payloads/Policy.reg"}
    binary_payload = {"kind": "registry", "versions": None, "data_file": "baselines/_overlays/payloads/Registry.pol"}
    errors = file_reference_errors(rule_with_step(powershell_step(shell="1"), [text_payload, binary_payload]), tmp_path)
    assert len(errors) == 1 and "payloads[0]" in errors[0]


def test_a_disallowed_payload_extension_is_an_error(tmp_path):
    write_file(tmp_path, "baselines/_overlays/payloads/Notes.txt", b"x\n")
    payload = {"kind": "notes", "versions": None, "data_file": "baselines/_overlays/payloads/Notes.txt"}
    assert file_reference_errors(rule_with_step(powershell_step(shell="1"), [payload]), tmp_path)
