import json
from pathlib import Path

import pytest

CATALOG = Path(__file__).resolve().parent.parent / "catalog"


def document(kind: str, slug: str) -> dict:
    return json.loads((CATALOG / kind / "microsoft" / f"{slug}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("slug", ["entra-private-access", "entra-internet-access", "entra-id-governance"])
def test_standalone_entra_capabilities_do_not_require_the_suite(slug):
    product = document("products", slug)
    assert product["parent"] is None
    assert product["requires"] == {
        "any_of": ["microsoft.entra-id.plan_1", "microsoft.entra-id.plan_2"]
    }


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
    assert "microsoft.entra-id-p1" in standard["requires"]["any_of"]
    assert "microsoft.entra-id-p1" not in step_up["requires"]["any_of"]
    assert "microsoft.entra-id-p2" in step_up["requires"]["any_of"]


@pytest.mark.parametrize("slug", [
    "intune-cloud-pki", "intune-endpoint-privilege-management",
    "intune-enterprise-app-management", "intune-remote-help", "intune-advanced-analytics",
])
def test_intune_modules_are_available_without_the_suite(slug):
    product = document("products", slug)
    assert product["parent"] is None
    assert product["requires"] == "microsoft.intune.plan_1"
    assert document("licences", slug)["includes"][0]["target"] == product["id"]


def test_sharepoint_copilot_entitlement_does_not_grant_standalone_only_features():
    product = document("products", "sharepoint-advanced-management")
    plans = {p["id"]: p for p in product["plans"]}
    feature = "microsoft.restricted-site-creation-by-apps"
    assert feature in plans["plan_1"]["features"]
    assert feature not in plans["copilot"]["features"]
    assert document("products", "restricted-site-creation-by-apps")["parent"] == product["id"]
    assert not (CATALOG / "products" / "microsoft" / "sharepoint-advanced-management-for-copilot.json").exists()
    e7 = document("licences", "m365-e7")
    assert next(i for i in e7["includes"] if i["target"] == feature)["availability"] == "add_on"


def test_free_identity_services_are_not_children_of_paid_editions():
    assert document("products", "entra-workload-id-free")["parent"] is None
    assert document("products", "entra-id-free")["parent"] == "microsoft.entra-id"
    assert document("products", "copilot-chat-basic")["parent"] is None


def test_product_plans_do_not_model_purchase_step_ups():
    assert "plan_2_step_up" not in {p["id"] for p in document("products", "entra-id")["plans"]}
    assert document("licences", "entra-id-p2-step-up")["includes"][0]["plan"] == "plan_2"


def test_autopilot_is_not_an_entra_id_plan_feature():
    assert document("products", "windows-autopilot")["parent"] is None
    for plan in document("products", "entra-id")["plans"]:
        assert "microsoft.windows-autopilot" not in plan["features"]


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
    assert "microsoft.defender-for-endpoint-plan-2" in addon["requires"]["any_of"]


def test_documented_copilot_experience_labels_are_preserved():
    assert document("products", "microsoft-365-copilot-basic")["title"] == "Microsoft 365 Copilot (Basic)"
    assert document("products", "microsoft-365-copilot-premium")["title"] == "Microsoft 365 Copilot (Premium)"
    assert document("products", "copilot-chat-work")["parent"] == "microsoft.microsoft-365-copilot-premium"
