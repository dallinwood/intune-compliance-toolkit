import json

import pytest

from tools.generate_metadata import build_metadata, write_metadata

SAMPLE_DOCUMENT = """\
CIS Example
Benchmark


v2.0.0 - 06-25-2026


## **1 Above Lock**

This section contains recommendations for Above Lock.

### _1.1 Ensure Something_

_(Automated)_

**Profile Applicability:**


- Level 1 (L1)
"""


def test_build_metadata_from_front_page_and_sections():
    metadata = build_metadata(SAMPLE_DOCUMENT.splitlines())

    assert metadata == {
        "schemaVersion": 1,
        "benchmark": {"name": "CIS Example Benchmark", "version": "2.0.0", "release_date": "25-06-2026"},
        "sections": [
            {
                "id": "1",
                "title": "Above Lock",
                "description": "This section contains recommendations for Above Lock.",
            }
        ],
    }


def test_build_metadata_honors_name_and_version_overrides():
    metadata = build_metadata(SAMPLE_DOCUMENT.splitlines(), name_override="Override Name", version_override="9.9.9")

    assert metadata["benchmark"]["name"] == "Override Name"
    assert metadata["benchmark"]["version"] == "9.9.9"
    # An overridden version isn't the document's own version, so its front-page
    # date doesn't apply and there's no matching change-history row either.
    assert metadata["benchmark"]["release_date"] is None


def test_build_metadata_raises_when_name_and_version_cannot_be_determined():
    lines = ["Some document with no recognizable front page"]

    with pytest.raises(ValueError, match="could not detect"):
        build_metadata(lines)


def test_write_metadata_is_deterministic(tmp_path):
    markdown_path = tmp_path / "doc.md"
    markdown_path.write_text(SAMPLE_DOCUMENT, encoding="utf-8")

    first_pass = write_metadata(markdown_path, tmp_path).read_text(encoding="utf-8")
    second_pass = write_metadata(markdown_path, tmp_path).read_text(encoding="utf-8")

    assert first_pass == second_pass
    assert json.loads(first_pass)["benchmark"]["name"] == "CIS Example Benchmark"
