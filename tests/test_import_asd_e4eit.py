import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from tools import import_asd_e4eit, import_asd_ism, import_mscp
from tools.asd_e4eit_normalize import MAPPING_FILE_ID
from tools.import_asd_e4eit import write_ism_mapping
from tools.release_import import generate_release
from tools.source_lock import SourceLock, write_source_lock

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "asd_e4eit"
ISM_FIXTURE_CATALOG_PATH = Path(__file__).parent / "fixtures" / "asd_ism" / "catalog.json"
MSCP_FIXTURE_UPSTREAM = Path(__file__).parent / "fixtures" / "mscp_upstream"
E4EIT_REPOSITORY_URL = "https://github.com/AustralianCyberSecurityCentre/e4eit-oscal"
CURRENT_LOCK = SourceLock(
    tag="v2026.10.15",
    commit_sha="c" * 40,
    retrieved_date="2026-11-11",
    repository_url=E4EIT_REPOSITORY_URL,
    published_date="2026-10-15",
    importer_format="asd-e4eit-oscal-1",
)
OLDER_LOCK = replace(
    CURRENT_LOCK,
    tag="v2026.09.1",
    commit_sha="a" * 40,
    retrieved_date="2026-10-01",
    published_date="2026-09-15",
)
ISM_LOCK = SourceLock(
    tag="v2026.09.4",
    commit_sha="b" * 40,
    retrieved_date="2026-10-23",
    repository_url="https://github.com/AustralianCyberSecurityCentre/ism-oscal",
    published_date="2026-09-03",
    importer_format="asd-ism-oscal-1",
)
MSCP_LOCK = SourceLock(
    tag="release_27.0",
    commit_sha="d" * 40,
    retrieved_date="2026-10-20",
    repository_url="https://github.com/usnistgov/macos_security",
    published_date="2026-09-11",
    importer_format="mscp-2",
)
ISM_RULE_IDS_IN_FIXTURE_MAPPING = [
    "asd_ism.ism-0974",
    "asd_ism.ism-1173",
    "asd_ism.ism-1504",
    "asd_ism.ism-1997",
    "asd_ism.ism-1998",
]
E4EIT_RULE_IDS_IN_FIXTURE = [
    "asd_e4eit.it.gov-01.1",
    "asd_e4eit.it.pro-01.1",
    "asd_e4eit.it.pro-13.1",
    "asd_e4eit.it.pro-13.2",
]
MAPPING_PATH = Path("_mappings") / "rules" / f"{MAPPING_FILE_ID}.json"
FIXTURE_FILE_NAMES = [path.name for path in FIXTURE_DIRECTORY.iterdir()]


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def populate_release(sources_dir: Path, lock: SourceLock) -> None:
    release_sources_dir = sources_dir / "releases" / lock.tag
    upstream_dir = release_sources_dir / "upstream"
    upstream_dir.mkdir(parents=True, exist_ok=True)
    for file_name in FIXTURE_FILE_NAMES:
        shutil.copyfile(FIXTURE_DIRECTORY / file_name, upstream_dir / file_name)
    write_source_lock(release_sources_dir / "source.json", lock)


def import_ism_release_with_rules(baselines_dir: Path, rule_ids: list[str]) -> None:
    ism_upstream_dir = baselines_dir.parent / "ism_upstream"
    ism_upstream_dir.mkdir()
    shutil.copyfile(ISM_FIXTURE_CATALOG_PATH, ism_upstream_dir / "ISM_catalog.json")
    generate_release(import_asd_ism.IMPORTER, ism_upstream_dir, ISM_LOCK, baselines_dir)
    index_path = baselines_dir / "asd_ism" / "releases" / ISM_LOCK.tag / "_index.json"
    index = read_json(index_path)
    template_entry = index["rules"][0]
    index["rules"] = [{**template_entry, "id": rule_id} for rule_id in rule_ids]
    index_path.write_text(json.dumps(index), encoding="utf-8")


def run_import(sources_dir, baselines_dir, *arguments):
    return import_asd_e4eit.main(
        [*arguments, "--sources-dir", str(sources_dir), "--baselines-dir", str(baselines_dir)]
    )


@pytest.fixture
def workspace(tmp_path):
    sources_dir = tmp_path / "sources" / "asd_e4eit"
    populate_release(sources_dir, CURRENT_LOCK)
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    import_ism_release_with_rules(baselines_dir, ISM_RULE_IDS_IN_FIXTURE_MAPPING)
    return sources_dir, baselines_dir


def test_offline_import_writes_library_index_manifest_and_mapping(workspace):
    sources_dir, baselines_dir = workspace

    assert run_import(sources_dir, baselines_dir, "--offline") == 0

    release_dir = baselines_dir / "asd_e4eit" / "releases" / CURRENT_LOCK.tag
    index = read_json(release_dir / "_index.json")
    assert index["source"] == "asd_e4eit"
    assert [entry["id"] for entry in index["rules"]] == E4EIT_RULE_IDS_IN_FIXTURE
    assert [entry["file"] for entry in index["rules"]] == [
        f"rules/{rule_id.removeprefix('asd_e4eit.')}.json" for rule_id in E4EIT_RULE_IDS_IN_FIXTURE
    ]
    manifest = read_json(baselines_dir / "_manifest.json")
    e4eit_entry = next(source for source in manifest["sources"] if source["name"] == "asd_e4eit")
    assert e4eit_entry["display_name"] == "ASD Essentials for enterprise IT"
    assert e4eit_entry["rule_count"] == 4
    assert e4eit_entry["releases"][0]["label"] == "Oct 2026"
    assert e4eit_entry["releases"][0]["importer_format"] == "asd-e4eit-oscal-1"
    mapping = read_json(baselines_dir / MAPPING_PATH)
    assert mapping["id"] == MAPPING_FILE_ID
    assert {link["relation"] for link in mapping["links"]} == {"related"}
    assert {link["from"][0]["release"] for link in mapping["links"]} == {CURRENT_LOCK.tag}
    assert {target["release"] for link in mapping["links"] for target in link["to"]} == {ISM_LOCK.tag}


def test_other_manifest_entries_are_kept(workspace):
    sources_dir, baselines_dir = workspace
    mscp_upstream_dir = baselines_dir.parent / "mscp_upstream"
    shutil.copytree(MSCP_FIXTURE_UPSTREAM, mscp_upstream_dir)
    generate_release(import_mscp.IMPORTER, mscp_upstream_dir, MSCP_LOCK, baselines_dir)

    assert run_import(sources_dir, baselines_dir, "--offline") == 0

    manifest = read_json(baselines_dir / "_manifest.json")
    assert sorted(source["name"] for source in manifest["sources"]) == [
        "asd_e4eit",
        "asd_ism",
        "mscp",
    ]


def test_second_offline_run_is_byte_stable(workspace):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    first_run = snapshot(baselines_dir)

    assert run_import(sources_dir, baselines_dir, "--offline") == 0

    assert snapshot(baselines_dir) == first_run


def test_failed_normalization_leaves_the_library_untouched(workspace):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    before = snapshot(baselines_dir)
    catalog_path = sources_dir / "releases" / CURRENT_LOCK.tag / "upstream" / "E4EIT_catalog.json"
    catalog_text = catalog_path.read_text(encoding="utf-8")
    assert '"essentials-action"' in catalog_text
    catalog_path.write_text(catalog_text.replace('"essentials-action"', '"renamed-part"'), encoding="utf-8")

    assert run_import(sources_dir, baselines_dir, "--offline") == 1

    assert snapshot(baselines_dir) == before


def test_write_ism_mapping_fails_naming_ism_ids_missing_from_the_release(workspace):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    ism_index_path = baselines_dir / "asd_ism" / "releases" / ISM_LOCK.tag / "_index.json"
    index = read_json(ism_index_path)
    index["rules"] = [rule for rule in index["rules"] if rule["id"] not in ("asd_ism.ism-1173", "asd_ism.ism-1998")]
    ism_index_path.write_text(json.dumps(index), encoding="utf-8")

    with pytest.raises(ValueError, match=r"asd_ism\.ism-1173, asd_ism\.ism-1998"):
        write_ism_mapping(sources_dir, baselines_dir)


def test_write_ism_mapping_fails_when_the_named_ism_release_is_not_imported(tmp_path):
    sources_dir = tmp_path / "sources" / "asd_e4eit"
    populate_release(sources_dir, CURRENT_LOCK)
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    import_ism_release_with_rules(baselines_dir, ISM_RULE_IDS_IN_FIXTURE_MAPPING)
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    manifest_path = baselines_dir / "_manifest.json"
    manifest = read_json(manifest_path)
    ism_entry = next(source for source in manifest["sources"] if source["name"] == "asd_ism")
    ism_entry["releases"][0]["tag"] = "v2026.01.1"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="ISM release v2026.09.4, which is not imported"):
        write_ism_mapping(sources_dir, baselines_dir)


def test_offline_import_of_an_older_release_writes_the_mapping_from_the_current_release(workspace):
    sources_dir, baselines_dir = workspace
    populate_release(sources_dir, OLDER_LOCK)
    older_mapping_path = sources_dir / "releases" / OLDER_LOCK.tag / "upstream" / "E4EIT_mapping-collection.json"
    older_collection = read_json(older_mapping_path)
    ism_maps = older_collection["mapping-collection"]["mappings"][0]["maps"]
    ism_maps[:] = [mapped for mapped in ism_maps if mapped["targets"][0]["id-ref"] != "ism-1997"]
    older_mapping_path.write_text(json.dumps(older_collection), encoding="utf-8")
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    (baselines_dir / MAPPING_PATH).unlink()

    assert run_import(sources_dir, baselines_dir, "--offline", "--release", OLDER_LOCK.tag) == 0

    mapping = read_json(baselines_dir / MAPPING_PATH)
    assert {link["from"][0]["release"] for link in mapping["links"]} == {CURRENT_LOCK.tag}
    assert "asd_ism.ism-1997" in {target["id"] for link in mapping["links"] for target in link["to"]}
