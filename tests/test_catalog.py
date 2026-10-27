import json
import shutil
from pathlib import Path

import pytest

from tools.catalog import DEFAULT_CATALOG_DIR, load_catalog, validate_catalog

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "catalog"
VALID_CATALOG_DIR = FIXTURES_DIR / "valid"

ENTRA_ID_PATH = "products/microsoft/entra-id.json"
ACCESS_REVIEWS_PATH = "products/microsoft/entra-id-access-reviews.json"
E3_PATH = "licences/microsoft/m365-e3.json"
ENTRA_SUITE_PATH = "licences/microsoft/entra-suite.json"


def read_json(catalog_dir: Path, relative_path: str) -> dict:
    return json.loads((catalog_dir / relative_path).read_text(encoding="utf-8"))


def write_json(catalog_dir: Path, relative_path: str, document: dict) -> None:
    path = catalog_dir / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(document, indent=2) + "\n").encode("utf-8"))


def edit_json(relative_path: str, change):
    def mutation(catalog_dir: Path) -> None:
        document = read_json(catalog_dir, relative_path)
        change(document)
        write_json(catalog_dir, relative_path, document)

    return mutation


def add_vendor(catalog_dir: Path, vendor_id: str = "acme") -> None:
    vendors = read_json(catalog_dir, "vendors.json")
    vendors["vendors"].append({"id": vendor_id, "title": vendor_id.title(), "url": f"https://{vendor_id}.example"})
    write_json(catalog_dir, "vendors.json", vendors)


def write_acme_product(catalog_dir: Path) -> None:
    add_vendor(catalog_dir)
    acme_product = read_json(catalog_dir, ACCESS_REVIEWS_PATH)
    acme_product.update({"id": "acme.widget", "vendor": "acme", "parent": None})
    write_json(catalog_dir, "products/acme/widget.json", acme_product)


def mutate_unknown_vendor_for_product(catalog_dir: Path) -> None:
    edit_json(ENTRA_ID_PATH, lambda product: product.update(vendor="ghost"))(catalog_dir)


def mutate_id_prefix_not_vendor(catalog_dir: Path) -> None:
    add_vendor(catalog_dir)
    edit_json(ENTRA_ID_PATH, lambda product: product.update(vendor="acme"))(catalog_dir)


def mutate_product_file_name_not_slug(catalog_dir: Path) -> None:
    (catalog_dir / ENTRA_ID_PATH).rename(catalog_dir / "products/microsoft/identity.json")


def mutate_licence_file_name_not_slug(catalog_dir: Path) -> None:
    (catalog_dir / E3_PATH).rename(catalog_dir / "licences/microsoft/e3.json")


def mutate_file_in_wrong_vendor_folder(catalog_dir: Path) -> None:
    add_vendor(catalog_dir)
    (catalog_dir / "products/acme").mkdir()
    (catalog_dir / ACCESS_REVIEWS_PATH).rename(catalog_dir / "products/acme/entra-id-access-reviews.json")


def mutate_duplicate_product_id(catalog_dir: Path) -> None:
    shutil.copy(catalog_dir / ENTRA_ID_PATH, catalog_dir / "products/microsoft/entra-id-copy.json")


def mutate_cross_vendor_parent(catalog_dir: Path) -> None:
    write_acme_product(catalog_dir)
    edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(parent="acme.widget"))(catalog_dir)


def mutate_parent_cycle(catalog_dir: Path) -> None:
    edit_json(ENTRA_ID_PATH, lambda product: product.update(parent="microsoft.entra-id-pim"))(catalog_dir)


def mutate_plan_feature_not_descendant(catalog_dir: Path) -> None:
    edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(parent=None))(catalog_dir)


def mutate_plan_feature_unknown(catalog_dir: Path) -> None:
    edit_json(ENTRA_ID_PATH, lambda product: product["plans"][0]["features"].append("microsoft.ghost"))(catalog_dir)


def mutate_inclusion_with_both_plan_and_custom_plan(catalog_dir: Path) -> None:
    def add_custom_plan(licence: dict) -> None:
        licence["includes"][0]["custom_plan"] = {"title": "Special", "description": None}

    edit_json(E3_PATH, add_custom_plan)(catalog_dir)


def mutate_duplicate_inclusion(catalog_dir: Path) -> None:
    edit_json(E3_PATH, lambda licence: licence["includes"].append(dict(licence["includes"][0])))(catalog_dir)


def set_pim_package(package: str | None, availability: str = "add_on"):
    def change(licence: dict) -> None:
        pim_inclusion = licence["includes"][1]
        pim_inclusion["availability"] = availability
        pim_inclusion["package"] = package

    return edit_json(ENTRA_SUITE_PATH, change)


def mutate_package_on_included_inclusion(catalog_dir: Path) -> None:
    edit_json(ENTRA_SUITE_PATH, lambda licence: licence["includes"][0].update(availability="add_on"))(catalog_dir)
    set_pim_package("microsoft.entra-id", availability="included")(catalog_dir)


def mutate_crlf(catalog_dir: Path) -> None:
    path = catalog_dir / ENTRA_ID_PATH
    path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))


def mutate_not_utf8(catalog_dir: Path) -> None:
    (catalog_dir / ENTRA_ID_PATH).write_bytes(b"\xff\xfe{}")


def mutate_missing_vendors_file(catalog_dir: Path) -> None:
    (catalog_dir / "vendors.json").unlink()


def mutate_duplicate_vendor_id(catalog_dir: Path) -> None:
    add_vendor(catalog_dir, "microsoft")


# Each case applies one mutation to a copy of the valid fixture and names the
# message that must appear, so a case cannot pass by failing for another reason.
INVALID_CASES = {
    "unknown-key": (edit_json(ENTRA_ID_PATH, lambda product: product.update(colour="blue")), "Additional properties are not allowed"),
    "missing-required-key": (edit_json(ENTRA_ID_PATH, lambda product: product.pop("title")), "'title' is a required property"),
    "wrong-type": (edit_json(ENTRA_ID_PATH, lambda product: product.update(title=5)), "5 is not of type 'string'"),
    "bad-product-id": (edit_json(ENTRA_ID_PATH, lambda product: product.update(id="Entra ID")), "does not match"),
    "bad-plan-id": (edit_json(ENTRA_ID_PATH, lambda product: product["plans"][0].update(id="Plan 1")), "does not match"),
    "duplicate-product-id-across-files": (mutate_duplicate_product_id, "is already used by products/microsoft/entra-id-copy.json"),
    "id-prefix-not-vendor": (mutate_id_prefix_not_vendor, "must start with its vendor 'acme.'"),
    "product-file-name-not-slug": (mutate_product_file_name_not_slug, "the file name must be 'entra-id.json'"),
    "licence-file-name-not-slug": (mutate_licence_file_name_not_slug, "the file name must be 'm365-e3.json'"),
    "file-in-wrong-vendor-folder": (mutate_file_in_wrong_vendor_folder, "must be in the folder products/microsoft/"),
    "unknown-vendor": (mutate_unknown_vendor_for_product, "unknown vendor 'ghost'"),
    "duplicate-vendor-id": (mutate_duplicate_vendor_id, "vendor id 'microsoft' is listed more than once"),
    "missing-vendors-file": (mutate_missing_vendors_file, "vendors.json: file not found"),
    "missing-parent": (edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(parent="microsoft.ghost")), "parent microsoft.ghost does not exist"),
    "cross-vendor-parent": (mutate_cross_vendor_parent, "belongs to another vendor"),
    "parent-cycle": (mutate_parent_cycle, "parent chain forms a cycle"),
    "duplicate-plan-id": (edit_json(ENTRA_ID_PATH, lambda product: product["plans"][1].update(id="plan_1")), "plan id 'plan_1' is used more than once"),
    "plan-feature-not-descendant": (mutate_plan_feature_not_descendant, "is not a descendant of microsoft.entra-id"),
    "plan-feature-unknown": (mutate_plan_feature_unknown, "feature microsoft.ghost does not exist"),
    "inclusion-of-unknown-product": (edit_json(E3_PATH, lambda licence: licence["includes"][0].update(product="microsoft.ghost")), "product microsoft.ghost does not exist"),
    "plan-not-defined-on-product": (edit_json(E3_PATH, lambda licence: licence["includes"][0].update(plan="plan_9")), "plan plan_9 is not defined on microsoft.entra-id"),
    "plan-and-custom-plan": (mutate_inclusion_with_both_plan_and_custom_plan, "sets both plan and custom_plan"),
    "unknown-availability": (edit_json(E3_PATH, lambda licence: licence["includes"][0].update(availability="sometimes")), "'sometimes' is not one of"),
    "package_feature-is-gone": (edit_json(E3_PATH, lambda licence: licence["includes"][0].update(availability="package_feature")), "'package_feature' is not one of"),
    "package-is-not-a-product": (set_pim_package("microsoft.ghost"), "package microsoft.ghost does not exist"),
    "package-is-not-an-ancestor": (set_pim_package("microsoft.entra-id-access-reviews"), "package microsoft.entra-id-access-reviews is not an ancestor of microsoft.entra-id-pim"),
    "package-with-included-availability": (mutate_package_on_included_inclusion, "but is not an add_on"),
    "package-not-listed-as-add-on-by-the-licence": (set_pim_package("microsoft.entra-id"), "microsoft.entra-id is not listed as an add_on by this licence"),
    "unknown-licence-kind": (edit_json(E3_PATH, lambda licence: licence.update(kind="bundle")), "'bundle' is not one of"),
    "same-product-and-plan-twice": (mutate_duplicate_inclusion, "lists microsoft.entra-id plan_1 more than once"),
    "requires-unknown-licence": (edit_json(ENTRA_SUITE_PATH, lambda licence: licence.update(requires=["microsoft.ghost"])), "requires microsoft.ghost, which does not exist"),
    "requires-itself": (edit_json(ENTRA_SUITE_PATH, lambda licence: licence.update(requires=["microsoft.entra-suite"])), "cannot require itself"),
    "crlf-file": (mutate_crlf, "the file must use LF line endings, not CRLF"),
    "non-utf8-file": (mutate_not_utf8, "the file is not UTF-8"),
}


@pytest.fixture
def catalog_copy(tmp_path) -> Path:
    destination = tmp_path / "catalog"
    shutil.copytree(VALID_CATALOG_DIR, destination)
    return destination


def test_committed_catalog_is_valid():
    errors, _warnings = validate_catalog(DEFAULT_CATALOG_DIR)
    assert errors == []


def test_valid_fixture_has_no_errors_or_warnings():
    assert validate_catalog(VALID_CATALOG_DIR) == ([], [])


def test_load_catalog_returns_vendors_products_and_licences():
    catalog = load_catalog(VALID_CATALOG_DIR)
    assert [vendor["id"] for vendor in catalog["vendors"]] == ["microsoft"]
    assert sorted(catalog["products"]) == ["microsoft.entra-id", "microsoft.entra-id-access-reviews", "microsoft.entra-id-pim"]
    assert sorted(catalog["licences"]) == ["microsoft.entra-suite", "microsoft.m365-e3"]
    assert catalog["products"]["microsoft.entra-id"]["title"] == "Microsoft Entra ID"


@pytest.mark.parametrize("case_name", sorted(INVALID_CASES))
def test_invalid_case_is_an_error(case_name, catalog_copy):
    mutation, expected_fragment = INVALID_CASES[case_name]
    mutation(catalog_copy)
    errors, _warnings = validate_catalog(catalog_copy)
    assert any(expected_fragment in error for error in errors), errors


def test_errors_start_with_the_file_path_relative_to_the_catalog(catalog_copy):
    edit_json(E3_PATH, lambda licence: licence.update(kind="bundle"))(catalog_copy)
    errors, _warnings = validate_catalog(catalog_copy)
    assert errors[0].startswith(f"{E3_PATH}: ")


def test_package_listed_as_add_on_by_the_licence_is_valid(catalog_copy):
    def list_entra_id_as_add_on(licence: dict) -> None:
        licence["includes"][0]["availability"] = "add_on"

    edit_json(ENTRA_SUITE_PATH, list_entra_id_as_add_on)(catalog_copy)
    set_pim_package("microsoft.entra-id")(catalog_copy)
    assert validate_catalog(catalog_copy) == ([], [])


def test_review_notes_are_allowed(catalog_copy):
    edit_json(E3_PATH, lambda licence: licence.update(review=["Check whether Access Reviews is an add-on here."]))(catalog_copy)
    errors, warnings = validate_catalog(catalog_copy)
    assert errors == []
    assert any("review" in warning and E3_PATH in warning for warning in warnings)
