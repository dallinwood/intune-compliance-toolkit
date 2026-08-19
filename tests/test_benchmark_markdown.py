from tools.benchmark_markdown import (
    find_change_history_date,
    iter_rule_headings,
    iter_section_headings,
    parse_front_page,
)

# Fixtures below reproduce the exact wrapping shapes observed in the real CIS
# benchmark markdown - see tools/benchmark_markdown.py's module docstring.

SINGLE_LINE_RULE = "### _1.2 Ensure 'Allow Toasts' is set to 'Block' (Automated)_"

TAG_ON_SEPARATE_LINE_RULE = """\
### _1.1 Ensure 'Allow Cortana Above Lock' is set to 'Block'_

_(Automated)_

**Profile Applicability:**
"""

TITLE_WRAPPED_MID_SENTENCE_RULE = """\
###### _4.11.15.3.1 Ensure 'Control Event Log behavior when the log file_

_reaches its maximum size' is set to 'Disabled' (Automated)_

**Profile Applicability:**
"""

MANUAL_RULE_NO_TAG_ON_FIRST_LINE = "### _2.1.1.1 Audit iCloud Passwords & Keychain (Manual)_"


def test_single_line_rule_heading():
    (rule_id, title, status, _), = list(iter_rule_headings(SINGLE_LINE_RULE.splitlines()))

    assert rule_id == "1.2"
    assert title == "Ensure 'Allow Toasts' is set to 'Block'"
    assert status == "Automated"


def test_assessment_tag_on_its_own_wrapped_line():
    (rule_id, title, status, _), = list(iter_rule_headings(TAG_ON_SEPARATE_LINE_RULE.splitlines()))

    assert rule_id == "1.1"
    assert title == "Ensure 'Allow Cortana Above Lock' is set to 'Block'"
    assert status == "Automated"


def test_title_wrapped_mid_sentence():
    (rule_id, title, status, _), = list(iter_rule_headings(TITLE_WRAPPED_MID_SENTENCE_RULE.splitlines()))

    assert rule_id == "4.11.15.3.1"
    assert title == "Ensure 'Control Event Log behavior when the log file reaches its maximum size' is set to 'Disabled'"
    assert status == "Automated"


def test_manual_rule_with_no_wrapping():
    (rule_id, title, status, _), = list(iter_rule_headings(MANUAL_RULE_NO_TAG_ON_FIRST_LINE.splitlines()))

    assert rule_id == "2.1.1.1"
    assert title == "Audit iCloud Passwords & Keychain"
    assert status == "Manual"


def test_rule_heading_with_no_assessment_tag_at_all():
    lines = "### _9.9 Ensure Something Untagged_".splitlines()

    (rule_id, title, status, _), = list(iter_rule_headings(lines))

    assert rule_id == "9.9"
    assert title == "Ensure Something Untagged"
    assert status is None


SECTION_WITH_BOILERPLATE = """\
### **4.1 Control Panel**

This section contains recommendations for Control Panel.

#### **4.1.2 Display**

This section contains recommendations for Display.
"""

SECTION_WITHOUT_BOILERPLATE = """\
## **2 Account Management**

### _2.1 Ensure some rule_
"""


def test_section_heading_captures_verbatim_boilerplate_description():
    sections = list(iter_section_headings(SECTION_WITH_BOILERPLATE.splitlines()))

    assert sections == [
        ("4.1", "Control Panel", "This section contains recommendations for Control Panel."),
        ("4.1.2", "Display", "This section contains recommendations for Display."),
    ]


def test_section_heading_without_boilerplate_gets_null_description():
    sections = list(iter_section_headings(SECTION_WITHOUT_BOILERPLATE.splitlines()))

    assert sections == [("2", "Account Management", None)]


FRONT_PAGE = """\
CIS Microsoft Intune for
Windows 11 Benchmark


v5.0.0 - 06-25-2026


# **Terms of Use**
"""


def test_parse_front_page_extracts_name_version_and_reorders_date():
    name, version, release_date = parse_front_page(FRONT_PAGE.splitlines())

    assert name == "CIS Microsoft Intune for Windows 11 Benchmark"
    assert version == "5.0.0"
    assert release_date == "25-06-2026"  # source is MM-DD-YYYY; stored as DD-MM-YYYY


def test_parse_front_page_returns_none_when_pattern_absent():
    name, version, release_date = parse_front_page(["Some Other Document", "No version line here"])

    assert (name, version, release_date) == (None, None, None)


CHANGE_HISTORY = """\
# **Appendix: Change History**

**Date: 06/25/2026 Version: 5.0.0**

REMOVE - 25 Ensure 'Something' is set to 'X'

**Date: 04/25/2025 Version: 4.0.0**
"""


def test_find_change_history_date_matches_by_version():
    lines = CHANGE_HISTORY.splitlines()

    assert find_change_history_date(lines, "5.0.0") == "25-06-2026"
    assert find_change_history_date(lines, "4.0.0") == "25-04-2025"
    assert find_change_history_date(lines, "9.9.9") is None
