import textwrap

import pytest
import yaml

from tools.mscp_normalize import (
    UnsupportedUpstreamData,
    index_entry,
    load_mscp_yaml,
    normalize_rule,
)
from tools.mscp_source_lock import SourceLock
from tools.validate_library import schema_errors

COMMIT_SHA = "b" * 40
LOCK = SourceLock(
    tag="release_27.0",
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-10-20",
    repository_url="https://github.com/usnistgov/macos_security",
)

GATEKEEPER_YAML = """
id: os_gatekeeper_enable
title: Enable Gatekeeper
discussion: |
  Gatekeeper _MUST_ be enabled.
references:
  nist:
    800-53r5:
      - CM-14
platforms:
  macOS:
    '27.0':
      benchmarks:
        - name: disa_stig
          severity: high
        - name: cis_lvl1
    '26.0':
      benchmarks:
        - name: cis_lvl1
    enforcement_info:
      check:
        shell: /usr/sbin/spctl --status
        result:
          string: PASS
      fix:
        shell: /usr/sbin/spctl --global-enable
    introduced: '10.7'
tags:
  - cisv8
  - 800-53r5_low
"""


def normalize(yaml_text, path="rules/os/example.yaml"):
    return normalize_rule(load_mscp_yaml(textwrap.dedent(yaml_text)), path, LOCK)


def rule_with(platform_block, extra=""):
    return (
        "id: some_rule\ntitle: T\ndiscussion: D\nreferences: {}\n"
        + extra
        + "platforms:\n  macOS:\n"
        + textwrap.indent(textwrap.dedent(platform_block), "    ")
    )


def test_float_like_reference_survives():
    loaded = load_mscp_yaml("bio: [8.10, 8.19.01]\ncount: 3\nflag: true\n")
    assert loaded == {"bio": ["8.10", "8.19.01"], "count": 3, "flag": True}


def test_ios_only_rule_returns_none():
    text = "id: x\ntitle: T\ndiscussion: D\nplatforms:\n  iOS:\n    '26.0':\n      supervised: false\n"
    assert normalize(text) is None


def test_gatekeeper_like_rule_normalizes():
    result = normalize(GATEKEEPER_YAML, "rules/os/os_gatekeeper_enable.yaml")
    assert result["id"] == "mscp.os_gatekeeper_enable"
    assert result["assessment"] == {"status": "automated", "manual_reason": None}
    assert {"name": "disa_stig", "severity": "high"} in result["applicability"]["27.0"]
    assert {"name": "cis_lvl1", "severity": None} in result["applicability"]["27.0"]
    assert result["tags"] == ["800-53r5_low", "cisv8"]
    assert result["remediation"]["default"] == {
        "shell": "/usr/sbin/spctl --global-enable",
        "additional_info": None,
    }
    assert schema_errors(result) == []


def test_version_override_result_type_kept():
    result = normalize(
        rule_with(
            """
            '15.0':
              benchmarks: []
              enforcement_info:
                check:
                  shell: defaults read x
                  result:
                    integer: 1
            enforcement_info:
              check:
                shell: echo PASS
                result:
                  string: PASS
            """,
            "tags: [a]\n",
        )
    )
    assert result["check"]["default"]["result"] == {"type": "string", "value": "PASS"}
    assert result["check"]["by_version"]["15.0"]["result"] == {"type": "integer", "value": 1}
    assert schema_errors(result) == []


def test_version_only_check_has_null_default():
    result = normalize(
        rule_with(
            """
            '15.0':
              enforcement_info:
                check:
                  shell: defaults read x
                  result:
                    integer: 1
            """,
        )
    )
    assert result["check"]["default"] is None
    assert result["check"]["by_version"]["15.0"]["shell"] == "defaults read x"
    assert result["assessment"]["status"] == "automated"
    assert result["tags"] == []
    assert schema_errors(result) == []


def test_check_additional_info_is_carried():
    result = normalize(
        rule_with(
            """
            enforcement_info:
              check:
                shell: echo 1
                additional_info: Run as root.
                result:
                  integer: 1
            """,
        )
    )
    assert result["check"]["default"]["additional_info"] == "Run as root."
    assert schema_errors(result) == []


def test_fix_result_is_dropped():
    result = normalize(
        rule_with(
            """
            enforcement_info:
              check:
                shell: echo 1
                result:
                  integer: 1
              fix:
                shell: do_it
                result:
                  integer: 1
            """,
        )
    )
    assert result["remediation"]["default"] == {"shell": "do_it", "additional_info": None}


def test_manual_tag_wins_over_existing_check():
    result = normalize(
        rule_with(
            """
            enforcement_info:
              check:
                shell: echo 1
                result:
                  integer: 1
            """,
            "tags: [inherent, manual]\n",
        )
    )
    assert result["assessment"] == {"status": "manual", "manual_reason": "manual"}
    assert result["check"]["default"] is not None


def test_no_check_is_manual_no_check():
    result = normalize(rule_with("'27.0':\n  benchmarks: []\n"))
    assert result["check"] is None
    assert result["assessment"] == {"status": "manual", "manual_reason": "no_check"}
    assert schema_errors(result) == []


def test_supplemental_id_without_tag():
    text = rule_with("'27.0':\n  benchmarks: []\n").replace("id: some_rule", "id: supplemental_thing")
    result = normalize(text)
    assert result["assessment"]["manual_reason"] == "supplemental"


def test_not_applicable_maps_to_n_a():
    result = normalize(rule_with("'27.0':\n  benchmarks: []\n", "tags: [not_applicable]\n"))
    assert result["assessment"] == {"status": "manual", "manual_reason": "n_a"}
    assert schema_errors(result) == []


ODV_PLATFORM = """
'27.0':
  benchmarks:
    - name: cis_lvl1
    - name: disa_stig
      severity: medium
enforcement_info:
  check:
    shell: test $ODV
    result:
      integer: $ODV
"""

ODV_BLOCK = """odv:
  hint:
    datatype: number
    description: Minimum length
    validation:
      min: 1
  recommended: 6
  cis_lvl1: 15
  disa_stig: 14
  ios_stig: 6
"""


def test_odv_by_benchmark_filtered_to_macos_benchmarks():
    result = normalize(rule_with(ODV_PLATFORM, ODV_BLOCK))
    assert result["odv"] == {
        "datatype": "number",
        "description": "Minimum length",
        "validation": {"min": 1},
        "recommended": 6,
        "by_benchmark": {"cis_lvl1": 15, "disa_stig": 14},
    }
    assert result["check"]["default"]["result"] == {"type": "integer", "value": "$ODV"}
    assert schema_errors(result) == []


def test_odv_validation_absent_is_null():
    block = ODV_BLOCK.replace("    validation:\n      min: 1\n", "")
    assert normalize(rule_with(ODV_PLATFORM, block))["odv"]["validation"] is None


def test_odv_unknown_datatype_raises():
    block = ODV_BLOCK.replace("number", "float")
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(ODV_PLATFORM, block))


def test_odv_placeholder_without_odv_raises():
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(ODV_PLATFORM))


def test_unknown_result_type_raises():
    platform = "enforcement_info:\n  check:\n    shell: x\n    result:\n      float: 1\n"
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(platform))


def test_integer_result_string_other_than_odv_raises():
    platform = "enforcement_info:\n  check:\n    shell: x\n    result:\n      integer: '7'\n"
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(platform))


def test_vendor_description_raises():
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with("'27.0':\n  benchmarks: []\n", "tags: [Vendor Description foo]\n"))


def test_odv_placeholder_only_in_title_raises():
    text = rule_with("'27.0':\n  benchmarks: []\n").replace("title: T", "title: Uses $ODV here")
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(text)


def test_duplicate_mapping_key_raises():
    with pytest.raises(yaml.YAMLError, match="duplicate mapping key 'references'"):
        load_mscp_yaml("id: a\nreferences: {}\nreferences:\n  x: [1]\n")


def test_empty_result_in_version_check_on_automated_rule_raises():
    platform = """\
    '27.0':
      benchmarks: []
      enforcement_info:
        check:
          shell: read this
          result: {}
    """
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(platform))


def test_both_architectures_raise():
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with("'27.0':\n  benchmarks: []\n", "tags: [arm64, i386]\n"))


def test_single_architecture_is_recorded():
    result = normalize(rule_with("'27.0':\n  benchmarks: []\n", "tags: [i386]\n"))
    assert result["architecture"] == "i386"


def test_unknown_platform_key_raises():
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with("'27.0':\n  benchmarks: []\nsurprise: 1\n"))


def test_unknown_version_entry_key_raises():
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with("'27.0':\n  benchmarks: []\n  surprise: 1\n"))


def test_unknown_top_level_key_raises():
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with("'27.0':\n  benchmarks: []\n", "surprise: 1\n"))


def test_unknown_check_key_raises():
    platform = "enforcement_info:\n  check:\n    shell: x\n    surprise: 1\n    result:\n      integer: 1\n"
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(platform))


def test_mobileconfig_by_version_and_ddm_copied():
    result = normalize(
        rule_with(
            """
            '27.0':
              mobileconfig_info:
                - PayloadType: a.b
            """,
            "mobileconfig_info:\n  - PayloadType: c.d\nddm_info:\n  ddm_key: K\n",
        )
    )
    assert result["remediation"]["mobileconfig_info"] == [{"PayloadType": "c.d"}]
    assert result["remediation"]["mobileconfig_by_version"] == {"27.0": [{"PayloadType": "a.b"}]}
    assert result["remediation"]["ddm_info"] == {"ddm_key": "K"}
    assert schema_errors(result) == []


def test_upstream_url_uses_commit_sha():
    result = normalize(GATEKEEPER_YAML, "rules/os/os_gatekeeper_enable.yaml")
    source = result["source"]
    assert source["upstream_url"] == (
        "https://github.com/usnistgov/macos_security/blob/"
        + COMMIT_SHA
        + "/src/mscp/data/rules/os/os_gatekeeper_enable.yaml"
    )
    assert source["commit_sha"] == COMMIT_SHA
    assert source["release_tag"] == "release_27.0"
    assert source["upstream_rule_id"] == "os_gatekeeper_enable"
    assert source["upstream_path"] == "rules/os/os_gatekeeper_enable.yaml"
    assert source["license"]["modified"] is True


def test_index_entry_fields():
    rule = normalize(GATEKEEPER_YAML, "rules/os/os_gatekeeper_enable.yaml")
    entry = index_entry(rule, "rules/os_gatekeeper_enable.json")
    assert set(entry) == {
        "id", "title", "file", "section", "assessment", "architecture",
        "applicability", "tags", "has_odv",
    }
    assert entry["has_odv"] is False
    wrapped = {"schema_version": 3, "source": "mscp", "rules": [entry]}
    assert schema_errors(wrapped, "index") == []


def test_index_entry_section_from_upstream_path():
    rule = normalize(GATEKEEPER_YAML, "rules/system_settings/x.yaml")
    assert index_entry(rule, "rules/x.json")["section"] == "system_settings"


@pytest.mark.parametrize("bad_path", ["os/x.yaml", "rules/x.yaml", "rules/os/sub/x.yaml", "other/os/x.yaml"])
def test_index_entry_rejects_unexpected_upstream_path(bad_path):
    rule = normalize(GATEKEEPER_YAML, "rules/os/os_gatekeeper_enable.yaml")
    rule["source"]["upstream_path"] = bad_path
    with pytest.raises(UnsupportedUpstreamData, match="mscp.os_gatekeeper_enable"):
        index_entry(rule, "rules/x.json")


def test_empty_result_on_manual_rule_normalizes_to_null():
    result = normalize(
        rule_with(
            "enforcement_info:\n  check:\n    shell: read this\n    result: {}\n",
            "tags: [manual]\n",
        )
    )
    assert result["check"]["default"]["result"] is None
    assert result["assessment"]["manual_reason"] == "manual"
    assert schema_errors(result) == []


def test_empty_result_on_automated_rule_raises():
    platform = "enforcement_info:\n  check:\n    shell: read this\n    result: {}\n"
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(platform))


def test_regex_odv_datatype_is_accepted():
    block = ODV_BLOCK.replace("datatype: number", "datatype: regex").replace("recommended: 6", "recommended: ^a$")
    result = normalize(rule_with(ODV_PLATFORM, block))
    assert result["odv"]["datatype"] == "regex"
    assert schema_errors(result) == []


NESTED_FIX_PLATFORM = """
'26.0':
  enforcement_info:
    check:
      shell: echo true
      result:
        string: 'true'
      fix:
        additional_info: Implemented by DDM.
        result:
          integer: 1
"""


def test_fix_nested_in_version_check_becomes_version_fix():
    result = normalize(rule_with(NESTED_FIX_PLATFORM))
    assert result["remediation"]["by_version"]["26.0"] == {
        "shell": None,
        "additional_info": "Implemented by DDM.",
    }
    assert "fix" not in result["check"]["by_version"]["26.0"]
    assert schema_errors(result) == []


def test_nested_and_sibling_version_fix_raise():
    platform = NESTED_FIX_PLATFORM + "    fix:\n      shell: do_it\n"
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(platform))


def test_fix_nested_in_default_check_raises():
    platform = "enforcement_info:\n  check:\n    shell: x\n    result:\n      integer: 1\n    fix:\n      shell: y\n"
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(platform))


@pytest.mark.parametrize("bad_tags", ["tags: manual\n", "tags: [1, 2]\n", "tags:\n"])
def test_non_list_of_strings_tags_raise(bad_tags):
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with("'27.0':\n  benchmarks: []\n", bad_tags))


@pytest.mark.parametrize(
    "platform_block",
    [
        "'27.0':\n  benchmarks:\n    - severity: high\n",
        "'27.0':\n  benchmarks:\n    - name: 5\n",
        "'27.0':\n  benchmarks: cis_lvl1\n",
        "'27.0':\n  enforcement_info: []\n",
        "'27.0':\n  enforcement_info:\n    check: text\n",
        "enforcement_info:\n  check:\n    shell: x\n    result: 5\n",
        "enforcement_info:\n  check:\n    shell: x\n    result:\n      integer: 1\n  fix: text\n",
    ],
)
def test_malformed_shapes_raise_with_rule_id(platform_block):
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(rule_with(platform_block))


def test_non_mapping_platforms_raises():
    text = "id: some_rule\ntitle: T\ndiscussion: D\nplatforms: [macOS]\n"
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(text)


@pytest.mark.parametrize("macos_value", ["null", "[]", "text"])
def test_present_but_non_mapping_macos_raises(macos_value):
    text = f"id: some_rule\ntitle: T\ndiscussion: D\nplatforms:\n  macOS: {macos_value}\n"
    with pytest.raises(UnsupportedUpstreamData, match="some_rule"):
        normalize(text)


def test_missing_macos_key_still_returns_none():
    assert normalize("id: some_rule\ntitle: T\ndiscussion: D\nplatforms:\n  iOS: {}\n") is None
