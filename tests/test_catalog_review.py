import json
from pathlib import Path

import pytest

CATALOG = Path(__file__).resolve().parent.parent / "catalog"


def document(kind: str, slug: str) -> dict:
    return json.loads((CATALOG / kind / "microsoft" / f"{slug}.json").read_text(encoding="utf-8"))


def includes_licence_as_included(licence_slug: str, wanted_slug: str) -> bool:
    """True when a licence is, or includes through included edges, the wanted licence."""
    if licence_slug == wanted_slug:
        return True
    return any(
        inclusion["type"] == "licence"
        and inclusion["availability"] == "included"
        and includes_licence_as_included(inclusion["target"].split(".", 1)[1], wanted_slug)
        for inclusion in document("licences", licence_slug)["includes"]
    )


def included_targets(licence_slug: str) -> dict[str, str]:
    return {inclusion["target"]: inclusion["availability"] for inclusion in document("licences", licence_slug)["includes"]}


@pytest.mark.parametrize("slug", ["entra-private-access", "entra-internet-access", "entra-id-governance"])
def test_standalone_entra_capabilities_do_not_require_the_suite(slug):
    product = document("products", slug)
    assert product["parent"] is None
    assert product["requires"] == "microsoft.entra-id"
    assert document("licences", slug)["requires"] == "microsoft.entra-id-p1"


@pytest.mark.parametrize("slug", [
    "entra-suite", "intune-suite", "defender-suite", "purview-suite", "viva-suite",
    "viva-employee-communications-communities", "viva-workplace-analytics-employee-feedback",
])
def test_bundles_are_licences_not_parent_products(slug):
    assert not (CATALOG / "products" / "microsoft" / f"{slug}.json").exists()
    assert document("licences", slug)["kind"] == "add_on"


def test_governance_purchase_variants_include_the_same_capabilities():
    standard = document("licences", "entra-id-governance")
    step_up = document("licences", "entra-id-governance-step-up-for-entra-id-p2")
    assert standard["includes"] == step_up["includes"]
    assert standard["requires"] == "microsoft.entra-id-p1"
    assert step_up["requires"] == "microsoft.entra-id-p2"


@pytest.mark.parametrize("requirement_slug, suite_slugs", [
    ("entra-id-p1", ["entra-id-p2", "business-premium", "m365-e3", "m365-e5", "m365-e7", "defender-suite", "defender-purview-business-premium"]),
    ("entra-id-p2", ["m365-e5", "m365-e7", "defender-suite", "defender-purview-business-premium"]),
    ("intune-plan-1", ["business-premium", "m365-e3", "m365-e5", "m365-e7"]),
    ("defender-for-endpoint-plan-2", ["m365-e5", "m365-e7", "defender-suite", "defender-purview-business-premium"]),
])
def test_suites_satisfy_a_tier_requirement_through_their_included_licences(requirement_slug, suite_slugs):
    # Licence requirements name the tier only; any licence that includes that tier meets them.
    for suite_slug in suite_slugs:
        assert includes_licence_as_included(suite_slug, requirement_slug), suite_slug


def test_licensing_tiers_are_licences_that_nest():
    assert included_targets("entra-id-p2")["microsoft.entra-id-p1"] == "included"
    assert included_targets("m365-e3")["microsoft.entra-id-p1"] == "included"
    assert included_targets("m365-e5")["microsoft.entra-id-p2"] == "included"
    assert "microsoft.entra-id-p2" not in included_targets("m365-e3")
    assert included_targets("m365-e3")["microsoft.entra-id-p2-step-up"] == "add_on"
    assert included_targets("m365-e3")["microsoft.intune-plan-1"] == "included"


@pytest.mark.parametrize("slug", [
    "intune-cloud-pki", "intune-endpoint-privilege-management",
    "intune-enterprise-app-management", "intune-remote-help", "intune-advanced-analytics",
])
def test_intune_modules_are_available_without_the_suite(slug):
    product = document("products", slug)
    assert product["parent"] is None
    assert product["requires"] == "microsoft.intune"
    assert document("licences", slug)["requires"] == "microsoft.intune-plan-1"
    assert document("licences", slug)["includes"][0]["target"] == product["id"]


def test_sharepoint_copilot_entitlement_does_not_grant_standalone_only_features():
    feature = "microsoft.restricted-site-creation-by-apps"
    assert feature in included_targets("sharepoint-advanced-management")
    assert feature not in included_targets("microsoft-365-copilot")
    assert "microsoft.inactive-sites-policy" in included_targets("microsoft-365-copilot")
    assert document("products", "restricted-site-creation-by-apps")["parent"] == "microsoft.sharepoint-advanced-management"
    assert not (CATALOG / "products" / "microsoft" / "sharepoint-advanced-management-for-copilot.json").exists()
    e7 = included_targets("m365-e7")
    assert e7["microsoft.microsoft-365-copilot"] == "included"
    assert e7["microsoft.sharepoint-advanced-management"] == "add_on"


def test_free_identity_services_are_not_children_of_paid_editions():
    assert document("products", "entra-workload-id-free")["parent"] is None
    assert document("products", "entra-id-free")["parent"] == "microsoft.entra-id"
    assert document("products", "copilot-chat-basic")["parent"] is None


def test_step_up_sells_only_what_p2_adds_over_p1():
    step_up = set(included_targets("entra-id-p2-step-up"))
    p1 = set(included_targets("entra-id-p1"))
    assert step_up and not step_up & p1
    assert document("licences", "entra-id-p2-step-up")["requires"] == "microsoft.entra-id-p1"


def test_autopilot_is_not_an_entra_id_plan_feature():
    assert document("products", "windows-autopilot")["parent"] is None
    for slug in ["entra-id-p1", "entra-id-p2", "entra-id-p2-step-up"]:
        assert "microsoft.windows-autopilot" not in included_targets(slug)


def test_no_licence_offers_unsupported_windows_authenticated_scanning():
    for path in (CATALOG / "licences" / "microsoft").glob("*.json"):
        licence = json.loads(path.read_text(encoding="utf-8"))
        assert all(i["target"] != "microsoft.authenticated-scan-for-windows" for i in licence["includes"])


def test_shared_capabilities_are_not_exclusive_to_the_product_that_bundles_them():
    assert document("products", "config-manager")["parent"] is None
    assert document("products", "defender-vulnerability-management-core")["parent"] is None
    mde = document("licences", "defender-for-endpoint-plan-2")
    standalone = document("licences", "defender-vulnerability-management-standalone")
    core = "microsoft.defender-vulnerability-management-core"
    assert core in {i["target"] for i in mde["includes"]}
    assert core in {i["target"] for i in standalone["includes"]}
    assert standalone["requires"] is None
    addon = document("licences", "defender-vulnerability-management-add-on")
    assert addon["requires"] == "microsoft.defender-for-endpoint-plan-2"


def test_documented_copilot_experience_labels_are_preserved():
    assert document("products", "microsoft-365-copilot-basic")["title"] == "Microsoft 365 Copilot (Basic)"
    assert document("products", "microsoft-365-copilot-premium")["title"] == "Microsoft 365 Copilot (Premium)"
    assert document("products", "copilot-chat-work")["parent"] == "microsoft.microsoft-365-copilot-premium"
