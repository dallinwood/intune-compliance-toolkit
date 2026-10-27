"""Validate the product and licence catalog under catalog/.

The catalog (docs/plans/2026-10-27-product-licence-catalog-design.md) lists
vendors, products (a feature is a product with a parent) and licences that
include them. The publish step builds an index from these files that only
checks their structure; this module is the CI gate. JSON Schema files check
each file's shape, and Python checks everything that spans files.
"""

import json
import sys
from pathlib import Path
from typing import NamedTuple

from jsonschema import Draft202012Validator

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.file_references import PATH_SEGMENT_PATTERN

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CATALOG_DIR = REPOSITORY_ROOT / "catalog"
VENDORS_FILE_NAME = "vendors.json"
PRODUCTS_FOLDER = "products"
LICENCES_FOLDER = "licences"


class Entry(NamedTuple):
    """A product or licence document and the path of its file relative to the catalog."""

    relative_path: str
    document: dict


def _load_schema(schema_name: str) -> dict:
    schema_path = DEFAULT_CATALOG_DIR / f"_{schema_name}.schema.json"
    return json.loads(schema_path.read_text(encoding="utf-8"))


def _read_json_document(path: Path) -> tuple[object, str | None]:
    """Read a hand-edited file as LF, UTF-8 JSON; returns (document, None) or (None, the problem)."""
    try:
        content = path.read_bytes()
    except FileNotFoundError:
        return None, "file not found"
    except OSError as problem:
        return None, f"cannot read the file ({problem})"
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return None, "the file is not UTF-8"
    if "\r" in text:
        return None, "the file must use LF line endings, not CRLF"
    try:
        return json.loads(text), None
    except ValueError as problem:
        return None, f"cannot read JSON ({problem})"


def _structure_problems(document: object, schema_name: str) -> list[str]:
    validator = Draft202012Validator(_load_schema(schema_name))
    errors = sorted(validator.iter_errors(document), key=lambda error: list(error.absolute_path))
    return [f"{error.json_path}: {error.message}" for error in errors]


def _read_vendors(catalog_dir: Path, errors: list[str]) -> list[dict] | None:
    """The vendors list, or None when vendors.json is unusable (the problem is already in errors)."""
    document, problem = _read_json_document(catalog_dir / VENDORS_FILE_NAME)
    if problem is not None:
        errors.append(f"{VENDORS_FILE_NAME}: {problem}")
        return None
    structure_problems = _structure_problems(document, "vendor")
    if structure_problems:
        errors.extend(f"{VENDORS_FILE_NAME}: {problem}" for problem in structure_problems)
        return None
    vendors = document["vendors"]
    seen_vendor_ids: set[str] = set()
    for vendor in vendors:
        if vendor["id"] in seen_vendor_ids:
            errors.append(f"{VENDORS_FILE_NAME}: vendor id {vendor['id']!r} is listed more than once")
        seen_vendor_ids.add(vendor["id"])
    return vendors


def _catalog_files(catalog_dir: Path, folder_name: str) -> list[Path]:
    """Every non-hidden .json file under a folder, in path order."""
    folder = catalog_dir / folder_name
    if not folder.is_dir():
        return []
    return sorted(
        path
        for path in folder.rglob("*.json")
        if path.is_file() and not any(part.startswith(".") for part in path.relative_to(folder).parts)
    )


def _location_problems(entry_id: str, file_path: Path, folder_name: str, catalog_dir: Path) -> list[str]:
    vendor_id, slug = entry_id.split(".", 1)
    expected_path = Path(folder_name) / vendor_id / f"{slug}.json"
    actual_path = file_path.relative_to(catalog_dir)
    if actual_path == expected_path:
        return []
    if actual_path.parent != expected_path.parent:
        return [f"must be in the folder {folder_name}/{vendor_id}/, named after the id's vendor"]
    return [f"the file name must be '{slug}.json', the id's slug"]


def _read_entries(catalog_dir: Path, folder_name: str, schema_name: str, errors: list[str]) -> dict[str, Entry]:
    """Every structurally valid product or licence file, keyed by id; the first file to use an id wins."""
    entries: dict[str, Entry] = {}
    for file_path in _catalog_files(catalog_dir, folder_name):
        relative_path = file_path.relative_to(catalog_dir).as_posix()
        if not PATH_SEGMENT_PATTERN.fullmatch(file_path.name):
            errors.append(f"{relative_path}: the file name must use only letters, digits, '.', '_' and '-'")
            continue
        document, problem = _read_json_document(file_path)
        if problem is not None:
            errors.append(f"{relative_path}: {problem}")
            continue
        structure_problems = _structure_problems(document, schema_name)
        if structure_problems:
            errors.extend(f"{relative_path}: {problem}" for problem in structure_problems)
            continue
        entry_id = document["id"]
        if entry_id in entries:
            errors.append(f"{relative_path}: id {entry_id!r} is already used by {entries[entry_id].relative_path}")
            continue
        errors.extend(
            f"{relative_path}: {problem}" for problem in _location_problems(entry_id, file_path, folder_name, catalog_dir)
        )
        entries[entry_id] = Entry(relative_path, document)
    return entries


def _vendor_problems(entry_id: str, vendor_id: str, known_vendor_ids: set[str] | None) -> list[str]:
    problems: list[str] = []
    if known_vendor_ids is not None and vendor_id not in known_vendor_ids:
        problems.append(f"unknown vendor {vendor_id!r} (not listed in {VENDORS_FILE_NAME})")
    if not entry_id.startswith(f"{vendor_id}."):
        problems.append(f"id {entry_id!r} must start with its vendor '{vendor_id}.'")
    return problems


def _ancestor_ids(product_id: str, products: dict[str, Entry]) -> set[str]:
    """The ids on a product's parent chain; stops at a missing parent or a repeat, so cycles end."""
    ancestor_ids: set[str] = set()
    current_id = products[product_id].document["parent"]
    while current_id is not None and current_id in products and current_id not in ancestor_ids:
        ancestor_ids.add(current_id)
        current_id = products[current_id].document["parent"]
    return ancestor_ids


def _parent_problems(product_id: str, products: dict[str, Entry]) -> list[str]:
    product = products[product_id].document
    parent_id = product["parent"]
    if parent_id is None:
        return []
    if parent_id not in products:
        return [f"parent {parent_id} does not exist"]
    problems: list[str] = []
    if products[parent_id].document["vendor"] != product["vendor"]:
        problems.append(f"parent {parent_id} belongs to another vendor")
    if product_id in _ancestor_ids(product_id, products):
        problems.append("the parent chain forms a cycle")
    return problems


def _plan_problems(product_id: str, products: dict[str, Entry]) -> list[str]:
    problems: list[str] = []
    seen_plan_ids: set[str] = set()
    for plan_position, plan in enumerate(products[product_id].document["plans"]):
        where = f"plans[{plan_position}]"
        if plan["id"] in seen_plan_ids:
            problems.append(f"{where}: plan id {plan['id']!r} is used more than once")
        seen_plan_ids.add(plan["id"])
        for feature_position, feature_id in enumerate(plan["features"]):
            feature_where = f"{where}.features[{feature_position}]"
            if feature_id not in products:
                problems.append(f"{feature_where}: feature {feature_id} does not exist")
            elif product_id not in _ancestor_ids(feature_id, products):
                problems.append(f"{feature_where}: feature {feature_id} is not a descendant of {product_id}")
    return problems


def _inclusion_key(inclusion: dict) -> tuple:
    custom_plan = inclusion.get("custom_plan")
    return inclusion["product"], inclusion.get("plan"), custom_plan["title"] if custom_plan else None


def _package_problems(inclusion: dict, products: dict[str, Entry], add_on_product_ids: set[str]) -> list[str]:
    package_id = inclusion.get("package")
    if package_id is None:
        return []
    if inclusion["availability"] != "add_on":
        return [f"sets package {package_id} but is not an add_on"]
    if package_id not in products:
        return [f"package {package_id} does not exist"]
    if package_id not in _ancestor_ids(inclusion["product"], products):
        return [f"package {package_id} is not an ancestor of {inclusion['product']}"]
    if package_id not in add_on_product_ids:
        return [f"package {package_id} is not listed as an add_on by this licence"]
    return []


def _inclusion_problems(inclusion: dict, products: dict[str, Entry], add_on_product_ids: set[str]) -> list[str]:
    problems: list[str] = []
    product_id = inclusion["product"]
    if "plan" in inclusion and "custom_plan" in inclusion:
        problems.append("sets both plan and custom_plan; an inclusion can set at most one")
    if product_id not in products:
        return [*problems, f"product {product_id} does not exist"]
    problems.extend(_package_problems(inclusion, products, add_on_product_ids))
    defined_plan_ids = {plan["id"] for plan in products[product_id].document["plans"]}
    if "plan" in inclusion and inclusion["plan"] not in defined_plan_ids:
        problems.append(f"plan {inclusion['plan']} is not defined on {product_id}")
    return problems


def _licence_problems(licence_id: str, licences: dict[str, Entry], products: dict[str, Entry]) -> list[str]:
    licence = licences[licence_id].document
    problems: list[str] = []
    seen_inclusion_keys: set[tuple] = set()
    add_on_product_ids = {inclusion["product"] for inclusion in licence["includes"] if inclusion["availability"] == "add_on"}
    for position, inclusion in enumerate(licence["includes"]):
        inclusion_problems = _inclusion_problems(inclusion, products, add_on_product_ids)
        problems.extend(f"includes[{position}]: {problem}" for problem in inclusion_problems)
        key = _inclusion_key(inclusion)
        if key in seen_inclusion_keys:
            plan_label = key[1] or key[2] or "without a plan"
            problems.append(f"includes[{position}]: lists {key[0]} {plan_label} more than once")
        seen_inclusion_keys.add(key)
    for position, required_id in enumerate(licence["requires"]):
        if required_id == licence_id:
            problems.append(f"requires[{position}]: a licence cannot require itself")
        elif required_id not in licences:
            problems.append(f"requires[{position}]: requires {required_id}, which does not exist")
    return problems


def _read_catalog(catalog_dir: Path, errors: list[str]) -> tuple[list[dict] | None, dict[str, Entry], dict[str, Entry]]:
    vendors = _read_vendors(catalog_dir, errors)
    products = _read_entries(catalog_dir, PRODUCTS_FOLDER, "product", errors)
    licences = _read_entries(catalog_dir, LICENCES_FOLDER, "licence", errors)
    return vendors, products, licences


def load_catalog(catalog_dir: Path) -> dict:
    """The usable catalog content: {"vendors": [...], "products": {id: product}, "licences": {id: licence}}.

    Files that fail structural checks are left out; validate_catalog reports them.
    """
    vendors, products, licences = _read_catalog(catalog_dir, [])
    return {
        "vendors": vendors or [],
        "products": {product_id: entry.document for product_id, entry in products.items()},
        "licences": {licence_id: entry.document for licence_id, entry in licences.items()},
    }


def validate_catalog(catalog_dir: Path) -> tuple[list[str], list[str]]:
    """Check every catalog file; returns (errors, warnings), each a list of messages naming the file."""
    errors: list[str] = []
    catalog_warnings: list[str] = []
    vendors, products, licences = _read_catalog(catalog_dir, errors)
    known_vendor_ids = None if vendors is None else {vendor["id"] for vendor in vendors}

    for product_id, entry in products.items():
        problems = _vendor_problems(product_id, entry.document["vendor"], known_vendor_ids)
        problems += _parent_problems(product_id, products)
        problems += _plan_problems(product_id, products)
        errors.extend(f"{entry.relative_path}: {problem}" for problem in problems)

    for licence_id, entry in licences.items():
        problems = _vendor_problems(licence_id, entry.document["vendor"], known_vendor_ids)
        problems += _licence_problems(licence_id, licences, products)
        errors.extend(f"{entry.relative_path}: {problem}" for problem in problems)
        review_notes = entry.document["review"]
        if review_notes:
            catalog_warnings.append(f"{entry.relative_path}: {len(review_notes)} review note(s) still to resolve")
    return errors, catalog_warnings


def main(arguments: list[str]) -> int:
    catalog_dir = Path(arguments[0]) if arguments else DEFAULT_CATALOG_DIR
    errors, catalog_warnings = validate_catalog(catalog_dir)
    for warning in catalog_warnings:
        print(f"warning: {warning}", file=sys.stderr)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
