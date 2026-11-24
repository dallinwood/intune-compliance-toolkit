import re
from pathlib import Path

import pytest

from tools.lockdown_sources import SOURCES

ROLE_REPOSITORIES = {
    "lockdown_cis_windows11": ("Windows-11-CIS", "3.0.3", "benchmark_v3.0.0", "v3.0.0", "win11cis", "11"),
    "lockdown_cis_windows2025": ("Windows-2025-CIS", "1.2.2", "benchmark_v1.0.0", "v1.0.0", "win25cis", "Server-2025"),
    "lockdown_cis_windows2022": ("Windows-2022-CIS", "4.2.0", "benchmark_v4.0.0", "v4.0.0", "win22cis", "Server-2022"),
    "lockdown_cis_windows2019": ("Windows-2019-CIS", "4.2.0", "latest", "v4.0.0", "win19cis", "Server-2019"),
}


def test_there_are_exactly_the_four_sources():
    assert sorted(SOURCES) == sorted(ROLE_REPOSITORIES)


@pytest.mark.parametrize("source_name", sorted(ROLE_REPOSITORIES))
def test_each_source_has_the_planned_pins(source_name):
    repository, role_tag, audit_branch, benchmark_version, prefix, version = ROLE_REPOSITORIES[source_name]
    spec = SOURCES[source_name]
    assert spec.source_name == source_name
    assert spec.role_repository == f"ansible-lockdown/{repository}"
    assert spec.audit_repository == f"ansible-lockdown/{repository}-Audit"
    assert (spec.role_tag, spec.audit_branch, spec.benchmark_version) == (role_tag, audit_branch, benchmark_version)
    assert (spec.variable_prefix, spec.version) == (prefix, version)
    assert spec.target == "Windows"
    assert spec.provenance == "community"
    assert spec.license["name"] == "MIT" and spec.license["modified"] is True


def test_display_names_say_where_the_benchmark_comes_from():
    assert SOURCES["lockdown_cis_windows11"].display_name == "CIS Windows 11 (ansible-lockdown)"
    assert SOURCES["lockdown_cis_windows2025"].display_name == "CIS Windows Server 2025 (ansible-lockdown)"
    assert SOURCES["lockdown_cis_windows2022"].display_name == "CIS Windows Server 2022 (ansible-lockdown)"
    assert SOURCES["lockdown_cis_windows2019"].display_name == "CIS Windows Server 2019 (ansible-lockdown)"


def test_the_rights_holder_is_the_one_in_the_license_files():
    license_text = (Path(__file__).parent / "fixtures" / "lockdown" / "role" / "LICENSE").read_text(encoding="utf-8")
    copyright_line = re.search(r"Copyright \(c\) \d+ (.+)", license_text)[1]
    assert SOURCES["lockdown_cis_windows2022"].license["rights_holder"] == copyright_line.strip()
