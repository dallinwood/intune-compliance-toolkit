"""Regression checks for the reviewed Microsoft 365 workload taxonomy.

Sources and the treatment of products outside the comparison are documented in
docs/catalog-grouping.md. These checks cover source data, not licensing rights.
"""

import json
from pathlib import Path

import pytest

PRODUCTS = Path(__file__).resolve().parent.parent / "catalog" / "products" / "microsoft"

COMPARISON_GROUPS = {
    "Analytics",
    "Automation, app building, and chatbots",
    "Cloud access security broker",
    "Content services",
    "Copilot",
    "Data lifecycle management",
    "Data loss prevention (DLP)",
    "Email, calendar, and scheduling",
    "Endpoint and app management",
    "Identity and access management",
    "Information protection",
    "Insider risk management",
    "Intranet and storage",
    "Meetings, calling, and chat",
    "Microsoft 365 apps",
    "Microsoft Viva",
    "Places",
    "Project and task management",
    "Threat protection",
    "Windows",
    "eDiscovery and auditing",
}
SUPPLEMENTARY_FAMILIES = {
    "LinkedIn Learning",
    "Microsoft 365",
    "Microsoft Agent 365",
    "Microsoft Azure",
    "Microsoft Dynamics 365",
    "Microsoft Priva",
    "Microsoft Purview",
    "Microsoft Support",
}


@pytest.fixture(scope="module")
def products():
    return {
        product["id"]: product
        for path in PRODUCTS.glob("*.json")
        if (product := json.loads(path.read_text(encoding="utf-8")))
    }


def test_root_categories_use_documented_workloads_or_product_families(products):
    categories = {p["category"] for p in products.values() if p["parent"] is None}
    assert categories <= COMPARISON_GROUPS | SUPPLEMENTARY_FAMILIES
    assert all(category and category == category.strip() for category in categories)
    assert len(categories) == len({category.casefold() for category in categories})


def test_every_product_has_exactly_one_root_category(products):
    for product in products.values():
        visited = set()
        current = product
        while current["parent"] is not None:
            assert current["id"] not in visited, product["id"]
            visited.add(current["id"])
            assert current["category"] is None, product["id"]
            current = products[current["parent"]]
        assert current["category"] in COMPARISON_GROUPS | SUPPLEMENTARY_FAMILIES


@pytest.mark.parametrize(("slug", "category"), [
    ("entra-id", "Identity and access management"),
    ("entra-id-governance", "Identity and access management"),
    ("entra-internet-access", "Identity and access management"),
    ("entra-private-access", "Identity and access management"),
    ("entra-verified-id", "Identity and access management"),
    ("entra-workload-id-free", "Identity and access management"),
    ("entra-workload-id-premium", "Identity and access management"),
    ("entra-external-id", "Identity and access management"),
    ("entra-domain-services", "Identity and access management"),
    ("intune", "Endpoint and app management"),
    ("intune-cloud-pki", "Endpoint and app management"),
    ("config-manager", "Endpoint and app management"),
    ("windows-autopilot", "Endpoint and app management"),
    ("defender-for-endpoint", "Threat protection"),
    ("defender-for-identity", "Threat protection"),
    ("defender-for-office-365", "Threat protection"),
    ("defender-vulnerability-management-core", "Threat protection"),
    ("defender-vulnerability-management-premium", "Threat protection"),
    ("bitlocker", "Threat protection"),
    ("defender-for-cloud-apps", "Cloud access security broker"),
    ("office-365-cloud-app-security", "Cloud access security broker"),
    ("copilot-chat-basic", "Copilot"),
    ("microsoft-365-copilot-basic", "Copilot"),
    ("microsoft-365-copilot-premium", "Copilot"),
    ("security-copilot", "Copilot"),
    ("viva-learning-basic", "Microsoft Viva"),
    ("viva-learning-premium", "Microsoft Viva"),
    ("viva-engage", "Microsoft Viva"),
    ("viva-engage-premium", "Microsoft Viva"),
    ("sharepoint-online", "Intranet and storage"),
    ("sharepoint-advanced-management", "Intranet and storage"),
    ("sharepoint-storage", "Intranet and storage"),
    ("ai-builder", "Automation, app building, and chatbots"),
    ("ai-builder-capacity", "Automation, app building, and chatbots"),
    ("power-bi-pro", "Analytics"),
    ("power-bi-premium", "Analytics"),
    ("data-loss-prevention", "Data loss prevention (DLP)"),
    ("endpoint-dlp", "Data loss prevention (DLP)"),
    ("audit-premium", "eDiscovery and auditing"),
    ("audit-standard", "eDiscovery and auditing"),
    ("azure-rms", "Information protection"),
    ("customer-key", "Information protection"),
    ("communication-compliance", "Insider risk management"),
    ("azure-virtual-desktop", "Windows"),
    ("universal-print-jobs", "Windows"),
    ("azure-backup", "Microsoft Azure"),
    ("data-map", "Microsoft Purview"),
    ("privacy-risk-management", "Microsoft Priva"),
    ("agent-365", "Microsoft Agent 365"),
    ("dynamics-365-customer-voice", "Microsoft Dynamics 365"),
    ("prodirect-support-for-azure", "Microsoft Support"),
    ("linkedin-learning", "LinkedIn Learning"),
])
def test_product_families_are_not_split_across_legacy_bundle_buckets(products, slug, category):
    assert products[f"microsoft.{slug}"]["category"] == category


def test_entra_features_inherit_the_identity_workload_not_an_ems_subscription(products):
    current = products["microsoft.conditional-access"]
    while current["parent"] is not None:
        current = products[current["parent"]]
    assert current["id"] == "microsoft.entra-id"
    assert current["category"] == "Identity and access management"
