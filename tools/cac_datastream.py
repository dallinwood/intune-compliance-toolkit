"""Read rules, values and audit text from a ComplianceAsCode SCAP datastream."""

import codecs
import re
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass

from tools.library_output import UnsupportedUpstreamData
from tools.odv_placeholders import placeholder

XCCDF_NAMESPACE = "http://checklists.nist.gov/xccdf/1.2"
OCIL_NAMESPACE = "http://scap.nist.gov/schema/ocil/2.0"
XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml"

RULE_ID_PREFIX = "xccdf_org.ssgproject.content_rule_"
VALUE_ID_PREFIX = "xccdf_org.ssgproject.content_value_"
PROFILE_ID_PREFIX = "xccdf_org.ssgproject.content_profile_"
SHELL_FIX_SYSTEM = "urn:xccdf:fix:script:sh"
CCE_IDENT_SYSTEM = "https://ncp.nist.gov/cce"
CIS_REFERENCE_HREF_PREFIX = "https://www.cisecurity.org/benchmark/"
VALUE_DATATYPES = ("number", "string")

# CaC's build leaves this as escaped text in OCIL questions; the idref is the short variable name.
ESCAPED_PLACEHOLDER_PATTERN = re.compile(r'<sub idref="([a-z][a-z0-9_]*)"\s*/>')
UNESCAPED_DOUBLE_QUOTE_PATTERN = re.compile(r'(?<!\\)"')
NEWLINE = "\n"
UTF8_ENCODING_NAMES = ("utf-8", "utf8")
# A UTF-16 or UTF-32 document can carry a DTD that a search of its bytes for ASCII text would miss.
NON_UTF8_BYTE_ORDER_MARKS = (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE, codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)
XML_DECLARATION_ENCODING_PATTERN = re.compile(r"""\A\ufeff?<\?xml[^>]*?\sencoding\s*=\s*["']([^"']*)["']""")


@dataclass(frozen=True)
class VariableUse:
    name: str
    quoting: str


@dataclass(frozen=True)
class DatastreamRule:
    rule_id: str
    title: str
    description_markdown: str
    rationale_markdown: str | None
    cce: str | None
    cis_references: tuple[str, ...]
    fix_shell: str | None
    ocil_text: str | None
    variables: tuple[VariableUse, ...]


@dataclass(frozen=True)
class ValueDefinition:
    name: str
    datatype: str
    title: str


def xccdf_tag(local_name: str) -> str:
    return f"{{{XCCDF_NAMESPACE}}}{local_name}"


def variable_name_from_idref(rule_id: str, idref: str | None) -> str:
    if idref is None or not idref.startswith(VALUE_ID_PREFIX):
        raise UnsupportedUpstreamData(f"{rule_id}: variable reference {idref!r} lacks the {VALUE_ID_PREFIX} prefix")
    return idref[len(VALUE_ID_PREFIX) :]


class MarkdownConverter:
    """Turns an XCCDF text element, whose markup is XHTML plus variable substitutions, into markdown."""

    def __init__(self, rule_id: str, variable_names: list[str]) -> None:
        self.rule_id = rule_id
        self.variable_names = variable_names

    def convert(self, element: ElementTree.Element) -> str:
        return self.convert_content(element, inside_preformatted=False).strip()

    def convert_content(self, element: ElementTree.Element, inside_preformatted: bool) -> str:
        pieces = [element.text or ""]
        for child in element:
            pieces.append(self.convert_child(child, inside_preformatted))
            pieces.append(child.tail or "")
        return "".join(pieces)

    def convert_child(self, child: ElementTree.Element, inside_preformatted: bool) -> str:
        if child.tag == xccdf_tag("sub"):
            name = variable_name_from_idref(self.rule_id, child.get("idref"))
            self.variable_names.append(name)
            return placeholder(name)
        if not child.tag.startswith(f"{{{XHTML_NAMESPACE}}}"):
            raise UnsupportedUpstreamData(f"{self.rule_id}: unsupported element {child.tag} in text")
        local_name = child.tag.rsplit("}", 1)[1]
        inner = self.convert_content(child, inside_preformatted or local_name == "pre")
        if local_name == "br":
            return NEWLINE
        if local_name in ("code", "tt"):
            return inner if inside_preformatted else f"`{inner.strip()}`"
        if local_name == "pre":
            return f"\n```\n{inner.strip(NEWLINE)}\n```\n"
        if local_name in ("i", "em"):
            return f"*{inner.strip()}*"
        if local_name in ("b", "strong"):
            return f"**{inner.strip()}**"
        if local_name == "a":
            href = child.get("href")
            if href is None:
                raise UnsupportedUpstreamData(f"{self.rule_id}: link without href in text")
            return f"[{inner.strip()}]({href})"
        if local_name in ("ul", "ol"):
            return f"\n{inner}\n"
        if local_name == "li":
            return f"\n- {inner.strip()}"
        if local_name == "p":
            return f"\n\n{inner.strip()}\n\n"
        raise UnsupportedUpstreamData(f"{self.rule_id}: unsupported element {child.tag} in text")


def classify_fix_quoting(rule_id: str, fix_text: str, placeholder_spans: list[tuple[int, int, str]]) -> dict[str, str]:
    quoting_by_name: dict[str, str] = {}
    for start, end, name in placeholder_spans:
        line_start = fix_text.rfind(NEWLINE, 0, start) + 1
        line_end = fix_text.find(NEWLINE, end)
        line_end = len(fix_text) if line_end == -1 else line_end
        before = fix_text[line_start:start]
        after = fix_text[end:line_end]
        if before.endswith("='") and after.startswith("'"):
            quoting = "single"
        elif len(UNESCAPED_DOUBLE_QUOTE_PATTERN.findall(before)) % 2 == 1 and '"' in after:
            quoting = "double"
        else:
            raise UnsupportedUpstreamData(
                f"{rule_id}: variable {name} sits outside single or double quotes in the fix: "
                f"{fix_text[line_start:line_end].strip()}"
            )
        if quoting_by_name.setdefault(name, quoting) != quoting:
            raise UnsupportedUpstreamData(f"{rule_id}: variable {name} is both single and double quoted in the fix")
    return quoting_by_name


def decode_utf8_document(xml_bytes: bytes) -> str:
    """The document's text, provided the XML parser will read it as UTF-8 too, so a search of the text sees every declaration."""
    if xml_bytes.startswith(NON_UTF8_BYTE_ORDER_MARKS):
        raise UnsupportedUpstreamData("datastream has a UTF-16 or UTF-32 byte order mark; only UTF-8 is supported")
    try:
        xml_text = xml_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise UnsupportedUpstreamData(f"datastream is not UTF-8: {error}") from error
    # XML never allows NUL, and ASCII text in UTF-16 or UTF-32 without a byte order mark is full of it.
    if "\0" in xml_text:
        raise UnsupportedUpstreamData("datastream contains NUL characters, so it is not UTF-8")
    declaration = XML_DECLARATION_ENCODING_PATTERN.match(xml_text)
    if declaration is not None and declaration.group(1).lower() not in UTF8_ENCODING_NAMES:
        raise UnsupportedUpstreamData(f"datastream declares encoding {declaration.group(1)!r}; only UTF-8 is supported")
    return xml_text


class Datastream:
    def __init__(self, xml_bytes: bytes) -> None:
        xml_text = decode_utf8_document(xml_bytes)
        if "<!DOCTYPE" in xml_text or "<!ENTITY" in xml_text:
            raise UnsupportedUpstreamData("datastream declares a DOCTYPE or ENTITY, which is not allowed")
        try:
            root = ElementTree.fromstring(xml_bytes)
        except ElementTree.ParseError as error:
            raise UnsupportedUpstreamData(f"datastream is not well-formed XML: {error}") from error
        self.rule_elements: dict[str, ElementTree.Element] = {}
        self.value_elements: dict[str, ElementTree.Element] = {}
        self.profile_elements: dict[str, ElementTree.Element] = {}
        self.question_elements: dict[str, ElementTree.Element] = {}
        for element in root.iter():
            element_id = element.get("id") or ""
            if element.tag == xccdf_tag("Rule") and element_id.startswith(RULE_ID_PREFIX):
                self.rule_elements[element_id[len(RULE_ID_PREFIX) :]] = element
            elif element.tag == xccdf_tag("Value") and element_id.startswith(VALUE_ID_PREFIX):
                self.value_elements[element_id[len(VALUE_ID_PREFIX) :]] = element
            elif element.tag == xccdf_tag("Profile") and element_id.startswith(PROFILE_ID_PREFIX):
                self.profile_elements[element_id[len(PROFILE_ID_PREFIX) :]] = element
            elif element.tag == f"{{{OCIL_NAMESPACE}}}boolean_question":
                self.question_elements[element_id] = element

    def rule(self, rule_id: str) -> DatastreamRule:
        rule_element = self.rule_elements.get(rule_id)
        if rule_element is None:
            raise UnsupportedUpstreamData(f"{rule_id}: rule is not in the datastream")
        variable_names: list[str] = []
        converter = MarkdownConverter(rule_id, variable_names)

        title_element = rule_element.find(xccdf_tag("title"))
        description_element = rule_element.find(xccdf_tag("description"))
        if title_element is None or description_element is None:
            raise UnsupportedUpstreamData(f"{rule_id}: rule has no title or description")
        rationale_element = rule_element.find(xccdf_tag("rationale"))
        description_markdown = converter.convert(description_element)
        rationale_markdown = converter.convert(rationale_element) if rationale_element is not None else None

        fix_shell, quoting_by_name = self.read_shell_fix(rule_id, rule_element)
        variable_names.extend(quoting_by_name)
        ocil_text = self.read_ocil_text(rule_id, variable_names)

        variables = tuple(
            VariableUse(name, quoting_by_name.get(name, "unquoted")) for name in dict.fromkeys(variable_names)
        )
        return DatastreamRule(
            rule_id=rule_id,
            title=self.read_title(rule_id, title_element),
            description_markdown=description_markdown,
            rationale_markdown=rationale_markdown,
            cce=self.read_cce(rule_id, rule_element),
            cis_references=tuple(
                (reference.text or "").strip()
                for reference in rule_element.findall(xccdf_tag("reference"))
                if (reference.get("href") or "").startswith(CIS_REFERENCE_HREF_PREFIX)
            ),
            fix_shell=fix_shell,
            ocil_text=ocil_text,
            variables=variables,
        )

    def read_title(self, rule_id: str, title_element: ElementTree.Element) -> str:
        for child in title_element.iter():
            if child is not title_element and not child.tag.startswith(f"{{{XHTML_NAMESPACE}}}"):
                raise UnsupportedUpstreamData(f"{rule_id}: unsupported element {child.tag} in the title")
        return "".join(title_element.itertext()).strip()

    def read_cce(self, rule_id: str, rule_element: ElementTree.Element) -> str | None:
        cce_ids = [
            (ident.text or "").strip()
            for ident in rule_element.findall(xccdf_tag("ident"))
            if ident.get("system") == CCE_IDENT_SYSTEM
        ]
        if len(cce_ids) > 1:
            raise UnsupportedUpstreamData(f"{rule_id}: more than one CCE id {cce_ids}")
        return cce_ids[0] if cce_ids else None

    def read_shell_fix(self, rule_id: str, rule_element: ElementTree.Element) -> tuple[str | None, dict[str, str]]:
        fix_elements = [fix for fix in rule_element.findall(xccdf_tag("fix")) if fix.get("system") == SHELL_FIX_SYSTEM]
        if not fix_elements:
            return None, {}
        if len(fix_elements) > 1:
            raise UnsupportedUpstreamData(f"{rule_id}: more than one sh fix")
        fix_element = fix_elements[0]
        fix_text = fix_element.text or ""
        placeholder_spans: list[tuple[int, int, str]] = []
        for child in fix_element:
            if child.tag != xccdf_tag("sub"):
                raise UnsupportedUpstreamData(f"{rule_id}: unsupported element {child.tag} in the sh fix")
            name = variable_name_from_idref(rule_id, child.get("idref"))
            start = len(fix_text)
            fix_text += placeholder(name)
            placeholder_spans.append((start, len(fix_text), name))
            fix_text += child.tail or ""
        quoting_by_name = classify_fix_quoting(rule_id, fix_text, placeholder_spans)
        return fix_text.strip(), quoting_by_name

    def read_ocil_text(self, rule_id: str, variable_names: list[str]) -> str | None:
        question = self.question_elements.get(f"ocil:ssg-{rule_id}_question:question:1")
        if question is None:
            return None
        text_element = question.find(f"{{{OCIL_NAMESPACE}}}question_text")
        if text_element is None:
            raise UnsupportedUpstreamData(f"{rule_id}: OCIL question has no text")

        def replace_escaped_placeholder(match: re.Match) -> str:
            variable_names.append(match.group(1))
            return placeholder(match.group(1))

        return ESCAPED_PLACEHOLDER_PATTERN.sub(replace_escaped_placeholder, "".join(text_element.itertext())).strip()

    def value_definition(self, name: str) -> ValueDefinition:
        value_element = self.require_value(name)
        datatype = value_element.get("type")
        if datatype not in VALUE_DATATYPES:
            raise UnsupportedUpstreamData(f"variable {name}: unsupported type {datatype!r}")
        title_element = value_element.find(xccdf_tag("title"))
        title = (title_element.text or "").strip() if title_element is not None else ""
        return ValueDefinition(name=name, datatype=datatype, title=title)

    def require_value(self, name: str) -> ElementTree.Element:
        value_element = self.value_elements.get(name)
        if value_element is None:
            raise UnsupportedUpstreamData(f"variable {name}: not in the datastream")
        return value_element

    def value_for_profile(self, name: str, profile_id: str) -> str:
        value_element = self.require_value(name)
        profile_element = self.profile_elements.get(profile_id)
        if profile_element is None:
            raise UnsupportedUpstreamData(f"variable {name}: profile {profile_id} is not in the datastream")
        selector = None
        for refinement in profile_element.findall(xccdf_tag("refine-value")):
            if refinement.get("idref") == VALUE_ID_PREFIX + name:
                selector = refinement.get("selector")
        for candidate in value_element.findall(xccdf_tag("value")):
            if candidate.get("selector") == selector:
                return (candidate.text or "").strip()
        wanted = f"selector {selector!r}" if selector is not None else "a default value"
        raise UnsupportedUpstreamData(f"variable {name}: profile {profile_id} needs {wanted}, which it lacks")
