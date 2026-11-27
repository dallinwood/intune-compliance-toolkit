"""Rendering shared by the NIST OSCAL catalog normalizers (SP 800-53, SP 800-171): parameters, links and statement lists."""

import re
from collections.abc import Callable

from tools.library_output import UnsupportedUpstreamData

LINK_PATTERN = re.compile(r"\[([^\]]*)\]\(#([^)\s]+)\)")
INSERT_PATTERN = re.compile(r"\{\{\s*insert:\s*param,\s*([^\s}]+)\s*\}\}")

MAXIMUM_ITEM_DEPTH = 3
PARAGRAPH_SEPARATOR = "\n\n"
LIST_INDENT = "  "
ORGANIZATION_DEFINED_PREFIX = "organization-defined"

KNOWN_PROPERTY_KEYS = {"name", "value", "class", "ns"}
ITEM_PART_NAME = "item"
KNOWN_ITEM_KEYS = {"id", "name", "prose", "props", "parts"}
KNOWN_GUIDANCE_KEYS = {"id", "name", "prose"}
KNOWN_SELECT_KEYS = {"how-many", "choice"}
ONE_OR_MORE = "one-or-more"

ItemLabelRenderer = Callable[[str, int, str], str]
"""(OSCAL item label, depth starting at 1, where) -> the label as printed in the list."""


def entry_id(entry) -> str:
    identifier = entry.get("id") if isinstance(entry, dict) else None
    if not isinstance(identifier, str):
        raise UnsupportedUpstreamData("catalog entry without a string id")
    return identifier


def properties(owner: dict, where: str, known_names: set[str]) -> list[dict]:
    owner_properties = owner.get("props", [])
    if not isinstance(owner_properties, list):
        raise UnsupportedUpstreamData(f"{where}: props must be a list")
    for prop in owner_properties:
        if not isinstance(prop, dict) or not isinstance(prop.get("name"), str):
            raise UnsupportedUpstreamData(f"{where}: property without a name")
        unknown_keys = sorted(set(prop) - KNOWN_PROPERTY_KEYS)
        if unknown_keys:
            raise UnsupportedUpstreamData(f"{where}: unsupported property key {unknown_keys[0]!r}")
        if prop["name"] not in known_names:
            raise UnsupportedUpstreamData(f"{where}: unsupported property {prop['name']!r}")
        if not isinstance(prop.get("value"), str):
            raise UnsupportedUpstreamData(f"{where}: property {prop['name']!r} needs a string value")
    return owner_properties


def single_property_value(owner_properties: list[dict], name: str, property_class: str | None, where: str) -> str:
    values = [
        prop["value"]
        for prop in owner_properties
        if prop["name"] == name and prop.get("class") == property_class
    ]
    if len(values) != 1:
        raise UnsupportedUpstreamData(
            f"{where}: needs exactly one {name!r} property of class {property_class!r}, found {len(values)}"
        )
    return values[0]


def check_keys(owner: dict, known_keys: set[str], where: str, what: str) -> None:
    unknown_keys = sorted(set(owner) - known_keys)
    if unknown_keys:
        raise UnsupportedUpstreamData(f"{where}: unsupported {what} key {unknown_keys[0]!r}")


class OscalCatalog:
    """Everything the entries need to look each other up, collected before any entry is rendered.

    select_label is the one label a selection parameter may also carry (800-171 labels every
    selection "SELECTED PARAMETER VALUES"); None means a parameter has a label or a selection, never both.
    """

    def __init__(self, catalog: dict, known_param_keys: set[str], select_label: str | None = None):
        self.known_param_keys = known_param_keys
        self.select_label = select_label
        self.params: dict[str, dict] = {}
        self.link_target_ids: set[str] = set()
        self.control_ids: set[str] = set()
        self.resources: dict[str, tuple[str, str | None]] = {}
        self._collect_back_matter(catalog)
        for group in catalog["groups"]:
            self._collect_group(group)

    def _collect_back_matter(self, catalog: dict) -> None:
        back_matter = catalog.get("back-matter")
        if not isinstance(back_matter, dict) or not isinstance(back_matter.get("resources"), list):
            raise UnsupportedUpstreamData("catalog has no back-matter resources list")
        for resource in back_matter["resources"]:
            uuid = resource.get("uuid") if isinstance(resource, dict) else None
            if not isinstance(uuid, str):
                raise UnsupportedUpstreamData("back-matter resource without a uuid")
            title = resource.get("title")
            if not isinstance(title, str) or not title:
                raise UnsupportedUpstreamData(f"back-matter resource {uuid!r} has no title")
            rlinks = resource.get("rlinks")
            first_link = rlinks[0] if isinstance(rlinks, list) and rlinks else None
            first_href = first_link.get("href") if isinstance(first_link, dict) else None
            if "rlinks" not in resource:
                # oscal-content v1.0.0 has citation-only resources (old papers with no URL).
                self.resources[uuid] = (title, None)
                continue
            if not isinstance(first_href, str) or not first_href:
                raise UnsupportedUpstreamData(f"back-matter resource {uuid!r} has no rlinks href")
            self.resources[uuid] = (title, first_href)

    def _collect_group(self, group) -> None:
        if not isinstance(group, dict):
            raise UnsupportedUpstreamData("catalog group is not an object")
        group_id = entry_id(group)
        self.link_target_ids.add(group_id)
        for part in group.get("parts", []):
            self._collect_part_ids(part)
        for control in group.get("controls", []):
            self._collect_control(control)

    def _collect_control(self, control) -> None:
        control_id = entry_id(control)
        if control_id in self.control_ids:
            raise UnsupportedUpstreamData(f"{control_id}: duplicate id")
        self.control_ids.add(control_id)
        self.link_target_ids.add(control_id)
        for part in control.get("parts", []):
            self._collect_part_ids(part)
        for param in control.get("params", []):
            param_id = entry_id(param)
            if param_id in self.params or param_id in self.link_target_ids:
                raise UnsupportedUpstreamData(f"{param_id}: duplicate id")
            self.params[param_id] = param
            self.link_target_ids.add(param_id)
        for enhancement in control.get("controls", []):
            self._collect_control(enhancement)

    def _collect_part_ids(self, part) -> None:
        if isinstance(part, dict):
            if isinstance(part.get("id"), str):
                self.link_target_ids.add(part["id"])
            for child in part.get("parts", []):
                self._collect_part_ids(child)

    def render_inserts(self, text: str, where: str) -> str:
        return self._render_inserts(text, where, ())

    def _render_inserts(self, text: str, where: str, parameter_ids_being_rendered: tuple[str, ...]) -> str:
        def render(match: re.Match) -> str:
            return self._render_param(match.group(1), where, parameter_ids_being_rendered)

        rendered = INSERT_PATTERN.sub(render, text)
        if "{{" in rendered:
            raise UnsupportedUpstreamData(f"{where}: unsupported {{{{ ... }}}} expression")
        return rendered

    def _render_param(self, param_id: str, where: str, parameter_ids_being_rendered: tuple[str, ...]) -> str:
        if param_id in parameter_ids_being_rendered:
            raise UnsupportedUpstreamData(f"{where}: parameter {param_id!r} inserts itself")
        param = self.params.get(param_id)
        if param is None:
            raise UnsupportedUpstreamData(f"{where}: insert of unknown parameter {param_id!r}")
        check_keys(param, self.known_param_keys, param_id, "parameter")
        has_select = "select" in param
        if has_select and "label" in param:
            if self.select_label is None or param["label"] != self.select_label:
                raise UnsupportedUpstreamData(f"{param_id}: parameter needs exactly one of label and select")
        elif not has_select and "label" not in param:
            raise UnsupportedUpstreamData(f"{param_id}: parameter needs exactly one of label and select")
        if not has_select:
            label = param["label"]
            if not isinstance(label, str):
                raise UnsupportedUpstreamData(f"{param_id}: parameter label must be a string")
            if label.startswith(ORGANIZATION_DEFINED_PREFIX):
                return f"[Assignment: {label}]"
            return f"[Assignment: {ORGANIZATION_DEFINED_PREFIX} {label}]"
        select = param["select"]
        if not isinstance(select, dict) or not isinstance(select.get("choice"), list) or not select["choice"]:
            raise UnsupportedUpstreamData(f"{param_id}: select needs a non-empty choice list")
        check_keys(select, KNOWN_SELECT_KEYS, param_id, "select")
        how_many = select.get("how-many")
        if how_many not in (None, ONE_OR_MORE):
            raise UnsupportedUpstreamData(f"{param_id}: unsupported how-many {how_many!r}")
        stack = (*parameter_ids_being_rendered, param_id)
        choices = []
        for choice in select["choice"]:
            if not isinstance(choice, str):
                raise UnsupportedUpstreamData(f"{param_id}: select choice must be a string")
            choices.append(self._render_inserts(choice.strip(), where, stack))
        heading = "Selection (one or more)" if how_many == ONE_OR_MORE else "Selection"
        return f"[{heading}: {'; '.join(choices)}]"

    def rewrite_links(self, text: str, where: str) -> str:
        def rewrite(match: re.Match) -> str:
            link_text, target = match.groups()
            if target in self.resources:
                resource_href = self.resources[target][1]
                return link_text if resource_href is None else f"[{link_text}]({resource_href})"
            if target in self.link_target_ids:
                return link_text
            raise UnsupportedUpstreamData(f"{where}: link to unknown target {target!r}")

        rewritten = LINK_PATTERN.sub(rewrite, text)
        if "](#" in rewritten:
            raise UnsupportedUpstreamData(f"{where}: a link could not be rewritten")
        return rewritten


def _item_lines(
    item: dict, depth: int, catalog: OscalCatalog, where: str, render_label: ItemLabelRenderer
) -> list[str]:
    if depth > MAXIMUM_ITEM_DEPTH:
        raise UnsupportedUpstreamData(f"{where}: statement items nested deeper than {MAXIMUM_ITEM_DEPTH} levels")
    if not isinstance(item, dict) or item.get("name") != ITEM_PART_NAME:
        part_name = item.get("name") if isinstance(item, dict) else item
        raise UnsupportedUpstreamData(f"{where}: unsupported statement part {part_name!r}")
    check_keys(item, KNOWN_ITEM_KEYS, where, "item")
    label = single_property_value(properties(item, where, {"label"}), "label", None, where)
    prose = item.get("prose")
    if not isinstance(prose, str):
        raise UnsupportedUpstreamData(f"{where}: item {label!r} has no prose")
    indentation = LIST_INDENT * (depth - 1)
    lines = [f"{indentation}- {render_label(label, depth, where)} {catalog.render_inserts(prose, where)}"]
    for child in item.get("parts", []):
        lines.extend(_item_lines(child, depth + 1, catalog, where, render_label))
    return lines


def render_statement(
    statement: dict,
    catalog: OscalCatalog,
    where: str,
    known_statement_keys: set[str],
    render_label: ItemLabelRenderer,
) -> str:
    check_keys(statement, known_statement_keys, where, "statement part")
    blocks = []
    prose = statement.get("prose")
    if prose is not None:
        if not isinstance(prose, str):
            raise UnsupportedUpstreamData(f"{where}: statement prose must be a string")
        blocks.append(catalog.render_inserts(prose, where))
    item_lines = []
    for item in statement.get("parts", []):
        item_lines.extend(_item_lines(item, 1, catalog, where, render_label))
    if item_lines:
        blocks.append("\n".join(item_lines))
    if not blocks:
        raise UnsupportedUpstreamData(f"{where}: statement has neither prose nor items")
    return catalog.rewrite_links(PARAGRAPH_SEPARATOR.join(blocks), where).strip()


def render_guidance(guidance: dict, catalog: OscalCatalog, where: str) -> str:
    check_keys(guidance, KNOWN_GUIDANCE_KEYS, where, "guidance part")
    prose = guidance.get("prose")
    if not isinstance(prose, str):
        raise UnsupportedUpstreamData(f"{where}: guidance has no prose")
    return catalog.rewrite_links(catalog.render_inserts(prose, where), where).strip()
