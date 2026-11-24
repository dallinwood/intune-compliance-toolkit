"""The ComplianceAsCode CIS benchmarks this project imports, one table entry per benchmark."""

from collections.abc import Mapping
from dataclasses import dataclass

LEVELS = ("l1_server", "l2_server", "l1_workstation", "l2_workstation")
LEVEL_INHERITANCE = {"l2_server": "l1_server", "l2_workstation": "l1_workstation"}

REPOSITORY_URL = "https://github.com/ComplianceAsCode/content"
LICENSE = {
    "name": "BSD-3-Clause",
    "url": "https://opensource.org/license/bsd-3-clause",
    "rights_holder": "Red Hat, Inc.",
    "modified": True,
}


@dataclass(frozen=True)
class BenchmarkSpec:
    source_name: str
    display_name: str
    provenance: str
    product: str
    controls_path: str
    level_profiles: Mapping[str, str]
    target: str
    version: str
    helper_control_ids: frozenset[str]


BENCHMARKS: dict[str, BenchmarkSpec] = {
    "cac_cis_rhel9": BenchmarkSpec(
        source_name="cac_cis_rhel9",
        display_name="CIS Red Hat Enterprise Linux 9 (ComplianceAsCode)",
        provenance="community",
        product="rhel9",
        controls_path="products/rhel9/controls/cis_rhel9.yml",
        level_profiles={
            "l1_server": "cis_server_l1",
            "l2_server": "cis",
            "l1_workstation": "cis_workstation_l1",
            "l2_workstation": "cis_workstation_l2",
        },
        target="Linux",
        version="RHEL-9",
        helper_control_ids=frozenset({"reload_dconf_db", "enable_authselect"}),
    ),
    "cac_cis_ubuntu2404": BenchmarkSpec(
        source_name="cac_cis_ubuntu2404",
        display_name="CIS Ubuntu 24.04 LTS (ComplianceAsCode)",
        provenance="community",
        product="ubuntu2404",
        controls_path="controls/cis_ubuntu2404.yml",
        level_profiles={
            "l1_server": "cis_level1_server",
            "l2_server": "cis_level2_server",
            "l1_workstation": "cis_level1_workstation",
            "l2_workstation": "cis_level2_workstation",
        },
        target="Linux",
        version="Ubuntu-24.04",
        helper_control_ids=frozenset(),
    ),
}
