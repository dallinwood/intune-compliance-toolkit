from tools.rule_extraction import (
    extract_cis_controls,
    extract_prose_field,
    extract_references_and_extras,
    split_into_labeled_sections,
    strip_markdown_artifacts,
)


def sections_for(body_text):
    return split_into_labeled_sections(body_text.splitlines())


def test_blank_line_separates_paragraphs():
    sections = sections_for(
        """\
**Rationale:**


First paragraph line one
first paragraph line two.


Second paragraph, on its own.
"""
    )

    assert extract_prose_field(sections, "Rationale") == (
        "First paragraph line one first paragraph line two.\n\nSecond paragraph, on its own."
    )


def test_inline_bold_label_starts_a_new_paragraph_without_a_blank_line():
    sections = sections_for(
        """\
**Description:**


Some setting does a thing.
**Note:** Old events may or may not be retained.
"""
    )

    assert extract_prose_field(sections, "Description") == (
        "Some setting does a thing.\n\nNote: Old events may or may not be retained."
    )


def test_bullet_list_renders_as_dash_prefixed_lines():
    sections = sections_for(
        """\
**Impact:**


Some intro text:


  - First bullet wraps across
two lines.

  - Second bullet.
"""
    )

    assert extract_prose_field(sections, "Impact") == (
        "Some intro text:\n\n- First bullet wraps across two lines.\n- Second bullet."
    )


def test_nested_label_inside_audit_does_not_end_the_section_early():
    sections = sections_for(
        """\
**Audit:**


**Graphical Method:**


Do the thing.


**Remediation:**


Fix it.
"""
    )

    # Audit/remediation method-splitting is out of Phase 1's scope (see the
    # module docstring) - the assertion that matters here is that the nested
    # "**Graphical Method:**" label didn't cut the Audit section short before
    # "**Remediation:**" actually appears.
    assert "Do the thing." in extract_prose_field(sections, "Audit")
    assert extract_prose_field(sections, "Remediation") == "Fix it."


def test_strip_markdown_artifacts_removes_backtick_and_trailing_space_before_punctuation():
    assert strip_markdown_artifacts("is: `Block` .") == "is: Block."


def test_strip_markdown_artifacts_converts_inline_hyperlink_to_text_colon_url():
    text = "will be removed in a future OS [release/update. Some Doc](https://example.com/doc)"

    assert strip_markdown_artifacts(text) == "will be removed in a future OS release/update. Some Doc: https://example.com/doc"


def test_extract_references_keeps_underscore_in_bare_url_but_strips_u_tags():
    sections = sections_for(
        """\
**References:**


1. <u>https://example.com/Security_Key_Apple_ID.pdf</u>
2. GRID: MS-00000510
3. Minimum OS CSP: Windows 10, Version 1607 and later
"""
    )

    references, grid_id, minimum_os_csp = extract_references_and_extras(sections)

    assert references == ["https://example.com/Security_Key_Apple_ID.pdf"]
    assert grid_id == "MS-00000510"
    assert minimum_os_csp == "Windows 10, Version 1607 and later"


def test_extract_references_prefers_markdown_link_href_over_link_text():
    sections = sections_for(
        """\
**References:**


1. <u>[https://learn.microsoft.com/policy-csp-](https://learn.microsoft.com/policy-csp-eventlogservice)</u>
<u>[eventlogservice](https://learn.microsoft.com/policy-csp-eventlogservice)</u>
"""
    )

    references, _, _ = extract_references_and_extras(sections)

    assert references == ["https://learn.microsoft.com/policy-csp-eventlogservice"]


def test_extract_cis_controls_dewraps_title_with_space_and_keeps_slash_compounds_joined():
    sections = sections_for(
        """\
**CIS Controls:**


|Controls<br>Version|Control|IG 1|IG 2|IG 3|
|---|---|---|---|---|
|v8|7.3Perform Automated Operating System Patch<br>Management<br> <br>Perform updates.|●|●|●|
|v7|8.3Enable Operating System Anti-Exploitation Features/<br>Deploy Anti-Exploit Technologies<br> <br>Detail.||●|●|
"""
    )

    controls = extract_cis_controls(sections)

    assert controls == [
        {
            "version": "v8",
            "control_id": "7.3",
            "control_title": "Perform Automated Operating System Patch Management",
            "implementation_groups": ["IG1", "IG2", "IG3"],
        },
        {
            "version": "v7",
            "control_id": "8.3",
            "control_title": "Enable Operating System Anti-Exploitation Features/Deploy Anti-Exploit Technologies",
            "implementation_groups": ["IG2", "IG3"],
        },
    ]
