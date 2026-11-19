from pathlib import Path

import pytest
import yaml

from tools.cac_datastream import Datastream
from tools.library_output import UnsupportedUpstreamData

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "cis_cac"
VALUE_PREFIX = "xccdf_org.ssgproject.content_value_"


@pytest.fixture(scope="module")
def datastream() -> Datastream:
    return Datastream((FIXTURE_DIRECTORY / "ssg-fixture-ds.xml").read_bytes())


def datastream_with_rule(description: str = "Text.", fix: str | None = None) -> Datastream:
    fix_element = (
        f'<xccdf-1.2:fix system="urn:xccdf:fix:script:sh">{fix}</xccdf-1.2:fix>' if fix is not None else ""
    )
    return Datastream(
        f"""<ds:data-stream-collection
            xmlns:ds="http://scap.nist.gov/schema/scap/source/1.2"
            xmlns:html="http://www.w3.org/1999/xhtml"
            xmlns:xccdf-1.2="http://checklists.nist.gov/xccdf/1.2">
          <xccdf-1.2:Rule id="xccdf_org.ssgproject.content_rule_generated">
            <xccdf-1.2:title>Generated</xccdf-1.2:title>
            <xccdf-1.2:description>{description}</xccdf-1.2:description>
            {fix_element}
          </xccdf-1.2:Rule>
        </ds:data-stream-collection>""".encode()
    )


def test_rejects_doctype_and_entity():
    for declaration in (b'<!DOCTYPE x [<!ENTITY a "b">]>', b'<!ENTITY a "b">'):
        with pytest.raises(UnsupportedUpstreamData, match="DOCTYPE or ENTITY"):
            Datastream(declaration + b"<root/>")


def test_fixture_covers_every_rule_in_the_control_fixture(datastream):
    controls = yaml.safe_load((FIXTURE_DIRECTORY / "controls.yml").read_text(encoding="utf-8"))
    rule_ids = {
        rule_id
        for control in controls["controls"]
        for rule_id in [*control.get("rules", []), *control.get("related_rules", [])]
        if "=" not in rule_id
    }
    assert rule_ids
    for rule_id in rule_ids:
        datastream.rule(rule_id)


def test_rule_fields(datastream):
    rule = datastream.rule("accounts_password_pam_minlen")
    assert rule.title == "Ensure PAM Enforces Password Requirements - Minimum Length"
    assert rule.cce == "CCE-00000-1"
    assert rule.cis_references == ("1.2.1",)
    assert rule.rationale_markdown == "Longer passwords resist guessing."
    assert datastream.rule("kernel_module_cramfs_disabled").cis_references == ("1.1.1", "1.2.2")


def test_fix_and_text_get_placeholders(datastream):
    rule = datastream.rule("accounts_password_pam_minlen")
    assert "var_password_pam_minlen='$ODV_var_password_pam_minlen'" in rule.fix_shell
    assert "$ODV_var_password_pam_minlen" in rule.description_markdown
    assert '"$ODV_var_password_pam_minlen"' in rule.ocil_text
    assert '"$ODV_var_ocil_only"' in rule.ocil_text
    for text in (rule.fix_shell, rule.description_markdown, rule.ocil_text):
        assert "<sub" not in text
        assert "&lt;sub" not in text


def test_fix_text_is_unescaped_shell(datastream):
    assert ">> /etc/security/pwquality.conf" in datastream.rule("accounts_password_pam_minlen").fix_shell


def test_variable_quoting(datastream):
    minlen_variables = datastream.rule("accounts_password_pam_minlen").variables
    assert [(variable.name, variable.quoting) for variable in minlen_variables] == [
        ("var_password_pam_minlen", "single"),
        ("var_ocil_only", "unquoted"),
    ]
    banner_variables = datastream.rule("banner_etc_issue").variables
    assert [(variable.name, variable.quoting) for variable in banner_variables] == [("login_banner_text", "double")]
    assert (
        "login_banner_text=$(echo \"$ODV_login_banner_text\" | sed 's/x/y/')"
        in datastream.rule("banner_etc_issue").fix_shell
    )


def sub_element(name: str) -> str:
    return f'<xccdf-1.2:sub idref="{VALUE_PREFIX}{name}"/>'


def test_unquoted_variable_in_fix_fails():
    datastream = datastream_with_rule(fix=f"echo {sub_element('var_x')}\n")
    with pytest.raises(UnsupportedUpstreamData, match="generated.*var_x"):
        datastream.rule("generated")


def test_variable_in_single_and_double_quotes_fails():
    fix = f"a='{sub_element('var_x')}'\nb=\"{sub_element('var_x')}\"\n"
    with pytest.raises(UnsupportedUpstreamData, match="both single and double"):
        datastream_with_rule(fix=fix).rule("generated")


def test_variable_inside_a_longer_double_quoted_string_is_double():
    fix = f'echo "value is {sub_element("var_x")} today"\n'
    variables = datastream_with_rule(fix=fix).rule("generated").variables
    assert [(variable.name, variable.quoting) for variable in variables] == [("var_x", "double")]


def test_description_to_markdown():
    description = (
        "Use <html:code>x</html:code><html:br/>then <html:a href=\"u\">t</html:a> and <html:i>i</html:i> "
        "and <html:b>b</html:b>.<html:pre>line1\nline2</html:pre>"
        "<html:ul><html:li>one</html:li><html:li>two</html:li></html:ul>end"
    )
    markdown = datastream_with_rule(description).rule("generated").description_markdown
    assert "`x`\nthen [t](u) and *i* and **b**." in markdown
    assert "\n```\nline1\nline2\n```\n" in markdown
    assert "\n- one\n- two\n" in markdown


def test_unknown_description_element_fails():
    with pytest.raises(UnsupportedUpstreamData, match="generated.*marquee"):
        datastream_with_rule("<html:marquee>x</html:marquee>").rule("generated")


def test_value_for_profile(datastream):
    assert datastream.value_for_profile("var_password_pam_minlen", "p_l1s") == "14"
    assert datastream.value_for_profile("var_password_pam_minlen", "p_no_refine") == "12"
    assert datastream.value_for_profile("login_banner_text", "p_l1s") == "Authorized use only"


def test_unknown_profile_fails(datastream):
    with pytest.raises(UnsupportedUpstreamData, match="no_such_profile"):
        datastream.value_for_profile("var_password_pam_minlen", "no_such_profile")


def test_value_definition(datastream):
    definition = datastream.value_definition("var_password_pam_minlen")
    assert (definition.name, definition.datatype, definition.title) == ("var_password_pam_minlen", "number", "minlen")


def test_missing_value_fails(datastream):
    with pytest.raises(UnsupportedUpstreamData, match="var_missing"):
        datastream.value_definition("var_missing")
    with pytest.raises(UnsupportedUpstreamData, match="var_missing"):
        datastream.value_for_profile("var_missing", "p_l1s")


def test_unknown_value_type_fails(datastream):
    with pytest.raises(UnsupportedUpstreamData, match="var_boolean_flag.*boolean"):
        datastream.value_definition("var_boolean_flag")


def test_missing_rule_fails(datastream):
    with pytest.raises(UnsupportedUpstreamData, match="no_such_rule"):
        datastream.rule("no_such_rule")


def test_rule_without_fix_or_ocil(datastream):
    rule = datastream.rule("rule_without_fix_or_ocil")
    assert rule.fix_shell is None
    assert rule.ocil_text is None
    assert rule.cce is None
    assert rule.variables == ()
