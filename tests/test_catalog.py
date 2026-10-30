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


def add_colliding_licence_id(catalog_dir: Path) -> None:
    collision = read_json(catalog_dir, E3_PATH)
    collision.update(id="microsoft.entra-id", requires=None)
    write_json(catalog_dir, "licences/microsoft/entra-id.json", collision)


def mutate_missing_licence_inclusion_target(catalog_dir: Path) -> None:
    edit_json(ENTRA_SUITE_PATH, lambda licence: licence["includes"].append(
        {"type": "licence", "target": "microsoft.ghost", "availability": "included", "note": None}
    ))(catalog_dir)


def mutate_self_licence_inclusion(catalog_dir: Path) -> None:
    edit_json(ENTRA_SUITE_PATH, lambda licence: licence["includes"].append(
        {"type": "licence", "target": "microsoft.entra-suite", "availability": "add_on", "note": None}
    ))(catalog_dir)


def mutate_licence_inclusion_cycle(catalog_dir: Path) -> None:
    edit_json(E3_PATH, lambda licence: licence["includes"].append(
        {"type": "licence", "target": "microsoft.entra-suite", "availability": "add_on", "note": None}
    ))(catalog_dir)


def mutate_duplicate_product_inclusion(catalog_dir: Path) -> None:
    edit_json(E3_PATH, lambda licence: licence["includes"].append(dict(licence["includes"][0])))(catalog_dir)


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
    "product-plans-are-rejected": (edit_json(ENTRA_ID_PATH, lambda product: product.update(plans=[])), "Additional properties are not allowed ('plans'"),
    "inclusion-of-unknown-product": (edit_json(E3_PATH, lambda licence: licence["includes"][0].update(target="microsoft.ghost")), "product microsoft.ghost does not exist"),
    "inclusion-plan-is-rejected": (edit_json(E3_PATH, lambda licence: licence["includes"][0].update(plan="plan_1")), "is not valid under any of the given schemas"),
    "inclusion-custom-plan-is-rejected": (
        edit_json(E3_PATH, lambda licence: licence["includes"][0].update(custom_plan={"title": "Special", "description": None})),
        "is not valid under any of the given schemas",
    ),
    "licence-with-no-includes-grants-no-product": (edit_json(E3_PATH, lambda licence: licence.update(includes=[])), "grants no product"),
    "licence-with-only-add-ons-grants-no-product": (
        edit_json(E3_PATH, lambda licence: licence.update(includes=licence["includes"][1:])),
        "grants no product",
    ),
    "unknown-availability": (
        edit_json(E3_PATH, lambda licence: licence["includes"][0].update(availability="sometimes")),
        "is not valid under any of the given schemas",
    ),
    "package-field-is-rejected": (
        edit_json(E3_PATH, lambda licence: licence["includes"][0].update(package="microsoft.entra-id")),
        "is not valid under any of the given schemas",
    ),
    "legacy-product-field-is-rejected": (
        edit_json(E3_PATH, lambda licence: licence["includes"][0].update(product="microsoft.entra-id")),
        "is not valid under any of the given schemas",
    ),
    "missing-capacity": (edit_json(E3_PATH, lambda licence: licence["includes"][0].pop("capacity")), "is not valid under any of the given schemas"),
    "empty-capacity": (edit_json(E3_PATH, lambda licence: licence["includes"][0].update(capacity="")), "is not valid under any of the given schemas"),
    "capacity-on-a-licence-inclusion": (
        edit_json(ENTRA_SUITE_PATH, lambda licence: licence["includes"][2].update(capacity="100 GB")),
        "is not valid under any of the given schemas",
    ),
    "unknown-licence-kind": (edit_json(E3_PATH, lambda licence: licence.update(kind="bundle")), "'bundle' is not one of"),
    "same-product-twice": (mutate_duplicate_product_inclusion, "lists product microsoft.entra-id more than once"),
    "missing-included-licence": (mutate_missing_licence_inclusion_target, "licence microsoft.ghost does not exist"),
    "self-included-licence": (mutate_self_licence_inclusion, "licence microsoft.entra-suite cannot include itself"),
    "inclusion-cycle": (mutate_licence_inclusion_cycle, "licence inclusion graph forms a cycle"),
    "requires-unknown-licence": (edit_json(ENTRA_SUITE_PATH, lambda licence: licence.update(requires="microsoft.ghost")), "requires microsoft.ghost, which does not exist"),
    "requires-itself": (edit_json(ENTRA_SUITE_PATH, lambda licence: licence.update(requires="microsoft.entra-suite")), "cannot require itself"),
    "requires-unknown-licence-in-a-group": (
        edit_json(ENTRA_SUITE_PATH, lambda licence: licence.update(requires={"any_of": ["microsoft.m365-e3", "microsoft.ghost"]})),
        "requires.any_of[1]: requires microsoft.ghost, which does not exist",
    ),
    "licence-requires-as-a-list": (edit_json(ENTRA_SUITE_PATH, lambda licence: licence.update(requires=["microsoft.m365-e3"])), "is not valid under any of the given schemas"),
    "licence-requires-product-id": (
        edit_json(ENTRA_SUITE_PATH, lambda licence: licence.update(requires="microsoft.entra-id")),
        "requires microsoft.entra-id, which does not exist",
    ),
    "product-requires-unknown-product": (
        edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(requires="microsoft.ghost")),
        "requires: requires microsoft.ghost, which does not exist",
    ),
    "product-requires-a-plan-id": (
        edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(requires="microsoft.entra-id.plan_1")),
        "is not valid under any of the given schemas",
    ),
    "product-requires-itself": (edit_json(ENTRA_ID_PATH, lambda product: product.update(requires="microsoft.entra-id")), "a product cannot require itself"),
    "requirement-group-of-one": (edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(requires={"all_of": ["microsoft.entra-id-pim"]})), "is not valid under any of the given schemas"),
    "requirement-empty-group": (
        edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(requires={"all_of": []})),
        "is not valid under any of the given schemas",
    ),
    "requirement-duplicate-member": (
        edit_json(
            ACCESS_REVIEWS_PATH,
            lambda product: product.update(requires={"all_of": ["microsoft.entra-id-pim", "microsoft.entra-id-pim"]}),
        ),
        "is not valid under any of the given schemas",
    ),
    "requirement-both-operators": (
        edit_json(
            ACCESS_REVIEWS_PATH,
            lambda product: product.update(
                requires={"all_of": ["microsoft.entra-id-pim", "microsoft.entra-id"], "any_of": ["microsoft.entra-id"]}
            ),
        ),
        "is not valid under any of the given schemas",
    ),
    "requirement-unknown-operator": (
        edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(requires={"none_of": ["microsoft.entra-id-pim", "microsoft.entra-id"]})),
        "is not valid under any of the given schemas",
    ),
    "requirement-same-operator-nested": (
        edit_json(
            ACCESS_REVIEWS_PATH,
            lambda product: product.update(
                requires={"any_of": ["microsoft.entra-id-pim", {"any_of": ["microsoft.entra-id", "microsoft.entra-id-access-reviews"]}]}
            ),
        ),
        "requires.any_of[1]: an any_of directly inside an any_of must be merged into it",
    ),
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


def test_product_and_licence_targets_with_same_id_are_distinct(catalog_copy):
    add_colliding_licence_id(catalog_copy)

    def include_each_namespace(licence: dict) -> None:
        licence["includes"] = [
            {"type": "product", "target": "microsoft.entra-id", "availability": "included", "note": None, "capacity": None},
            {"type": "licence", "target": "microsoft.entra-id", "availability": "add_on", "note": None},
        ]

    edit_json(E3_PATH, include_each_namespace)(catalog_copy)
    assert validate_catalog(catalog_copy) == ([], [])


def test_inclusion_edges_do_not_create_requirement_cycles(catalog_copy):
    edit_json(E3_PATH, lambda licence: licence["includes"].append(
        {"type": "licence", "target": "microsoft.entra-suite", "availability": "add_on", "note": None}
    ))(catalog_copy)
    errors, warnings = validate_catalog(catalog_copy)
    assert any("licence inclusion graph forms a cycle" in error for error in errors)
    assert not any("requirements form a cycle" in warning for warning in warnings)


def add_licence_granting_entra_id(catalog_dir: Path, capacity: str) -> None:
    second_licence = read_json(catalog_dir, E3_PATH)
    second_licence.update(id="microsoft.entra-id-standalone", requires=None, includes=[
        {"type": "product", "target": "microsoft.entra-id", "availability": "included", "note": None, "capacity": capacity}
    ])
    write_json(catalog_dir, "licences/microsoft/entra-id-standalone.json", second_licence)
    edit_json(ENTRA_SUITE_PATH, lambda licence: licence["includes"].append(
        {"type": "licence", "target": "microsoft.entra-id-standalone", "availability": "included", "note": None}
    ))(catalog_dir)


def test_capacity_is_recorded_on_a_product_inclusion(catalog_copy):
    edit_json(E3_PATH, lambda licence: licence["includes"][0].update(capacity="50,000 objects"))(catalog_copy)
    assert validate_catalog(catalog_copy) == ([], [])


def test_nested_licences_granting_one_product_with_different_capacities_warn(catalog_copy):
    edit_json(E3_PATH, lambda licence: licence["includes"][0].update(capacity="50,000 objects"))(catalog_copy)
    add_licence_granting_entra_id(catalog_copy, "Unlimited objects")
    errors, warnings = validate_catalog(catalog_copy)
    assert errors == []
    assert warnings == [
        f"{ENTRA_SUITE_PATH}: receives microsoft.entra-id with different capacities through its included licences "
        "(50,000 objects, Unlimited objects); list the product directly with the capacity that applies"
    ]


def test_a_direct_entry_settles_a_capacity_conflict(catalog_copy):
    edit_json(E3_PATH, lambda licence: licence["includes"][0].update(capacity="50,000 objects"))(catalog_copy)
    add_licence_granting_entra_id(catalog_copy, "Unlimited objects")
    edit_json(ENTRA_SUITE_PATH, lambda licence: licence["includes"].append(
        {"type": "product", "target": "microsoft.entra-id", "availability": "included", "note": None, "capacity": "Unlimited objects"}
    ))(catalog_copy)
    assert validate_catalog(catalog_copy) == ([], [])


def test_nested_licences_agreeing_on_capacity_do_not_warn(catalog_copy):
    edit_json(E3_PATH, lambda licence: licence["includes"][0].update(capacity="50,000 objects"))(catalog_copy)
    add_licence_granting_entra_id(catalog_copy, "50,000 objects")
    assert validate_catalog(catalog_copy) == ([], [])


def test_review_notes_are_allowed(catalog_copy):
    edit_json(E3_PATH, lambda licence: licence.update(review=["Check whether Access Reviews is an add-on here."]))(catalog_copy)
    errors, warnings = validate_catalog(catalog_copy)
    assert errors == []
    assert any("review" in warning and E3_PATH in warning for warning in warnings)


def test_nested_and_or_requirements_are_valid(catalog_copy):
    nested = {"all_of": ["microsoft.entra-id", {"any_of": ["microsoft.entra-id-pim", "microsoft.entra-id"]}]}
    edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(requires=nested))(catalog_copy)
    edit_json(ENTRA_SUITE_PATH, lambda licence: licence.update(requires={"any_of": ["microsoft.m365-e3", {"all_of": ["microsoft.m365-e3", "microsoft.m365-e3x"]}]}))(
        catalog_copy
    )
    licence_e3x = read_json(catalog_copy, E3_PATH)
    licence_e3x["id"] = "microsoft.m365-e3x"
    write_json(catalog_copy, "licences/microsoft/m365-e3x.json", licence_e3x)
    assert validate_catalog(catalog_copy) == ([], [])


def test_a_requirement_cycle_is_a_warning(catalog_copy):
    edit_json(ACCESS_REVIEWS_PATH, lambda product: product.update(requires="microsoft.entra-id-pim"))(catalog_copy)
    edit_json("products/microsoft/entra-id-pim.json", lambda product: product.update(requires="microsoft.entra-id-access-reviews"))(catalog_copy)
    errors, warnings = validate_catalog(catalog_copy)
    assert errors == []
    assert any(ACCESS_REVIEWS_PATH in warning and "cycle" in warning for warning in warnings)
