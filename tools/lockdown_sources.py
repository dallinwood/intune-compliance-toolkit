"""The ansible-lockdown Windows CIS benchmarks this project imports, one table entry per benchmark.

Each benchmark is joined from two MIT-licensed repositories: the Ansible role (fixes) and its
Audit repository (goss tests and clean titles). See docs/plans/2026-11-20-windows-cis-lockdown-design.md.
"""

from dataclasses import dataclass

REPOSITORY_OWNER = "ansible-lockdown"
LICENSE_NAME = "MIT"
LICENSE_URL = "https://opensource.org/license/mit"
RIGHTS_HOLDER = "MindPoint Group - A Quantum Sky Company / Ansible Lockdown"
TARGET = "Windows"


@dataclass(frozen=True)
class LockdownSpec:
    source_name: str
    display_name: str
    provenance: str
    role_repository: str
    role_tag: str
    audit_repository: str
    audit_branch: str
    benchmark_version: str
    variable_prefix: str
    target: str
    version: str

    @property
    def role_url(self) -> str:
        return f"https://github.com/{self.role_repository}"

    @property
    def audit_url(self) -> str:
        return f"https://github.com/{self.audit_repository}"

    @property
    def license(self) -> dict:
        return {"name": LICENSE_NAME, "url": LICENSE_URL, "rights_holder": RIGHTS_HOLDER, "modified": True}


def build_spec(
    source_name: str,
    display_name: str,
    repository_name: str,
    role_tag: str,
    audit_branch: str,
    benchmark_version: str,
    variable_prefix: str,
    version: str,
) -> LockdownSpec:
    return LockdownSpec(
        source_name=source_name,
        display_name=display_name,
        provenance="community",
        role_repository=f"{REPOSITORY_OWNER}/{repository_name}",
        role_tag=role_tag,
        audit_repository=f"{REPOSITORY_OWNER}/{repository_name}-Audit",
        audit_branch=audit_branch,
        benchmark_version=benchmark_version,
        variable_prefix=variable_prefix,
        target=TARGET,
        version=version,
    )


SOURCES: dict[str, LockdownSpec] = {
    spec.source_name: spec
    for spec in (
        build_spec(
            "cis_windows11", "CIS Windows 11 (ansible-lockdown)", "Windows-11-CIS", "3.0.3",
            "benchmark_v3.0.0", "v3.0.0", "win11cis", "11",
        ),
        build_spec(
            "cis_windows2025", "CIS Windows Server 2025 (ansible-lockdown)", "Windows-2025-CIS", "1.2.2",
            "benchmark_v1.0.0", "v1.0.0", "win25cis", "Server-2025",
        ),
        build_spec(
            "cis_windows2022", "CIS Windows Server 2022 (ansible-lockdown)", "Windows-2022-CIS", "4.2.0",
            "benchmark_v4.0.0", "v4.0.0", "win22cis", "Server-2022",
        ),
        build_spec(
            "cis_windows2019", "CIS Windows Server 2019 (ansible-lockdown)", "Windows-2019-CIS", "4.2.0",
            "latest", "v4.0.0", "win19cis", "Server-2019",
        ),
    )
}
