"""Helpers shared by the ASD OSCAL importers (ISM and Essentials for enterprise IT)."""

import re

from tools.library_output import UnsupportedUpstreamData

ASD_LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "rights_holder": "Commonwealth of Australia (Australian Signals Directorate)",
    "modified": True,
}

RESOURCE_LINK_PATTERN = re.compile(r"\]\(#([^)\s]+)\)")
MONTH_ABBREVIATIONS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
TAG_YEAR_AND_MONTH_PATTERN = re.compile(r"^v(\d{4})\.(0[1-9]|1[0-2])\.")


def release_label(tag: str) -> str:
    match = TAG_YEAR_AND_MONTH_PATTERN.match(tag)
    if match is None:
        raise ValueError(f"cannot derive a release label from tag {tag!r}")
    year, month = match.groups()
    return f"{MONTH_ABBREVIATIONS[int(month) - 1]} {year}"


def rewrite_resource_links(prose: str, resource_hrefs: dict[str, str], where: str) -> str:
    def resolve(match: re.Match) -> str:
        uuid = match.group(1)
        if uuid not in resource_hrefs:
            raise UnsupportedUpstreamData(f"{where}: link to unknown back-matter resource {uuid!r}")
        return f"]({resource_hrefs[uuid]})"

    return RESOURCE_LINK_PATTERN.sub(resolve, prose)


def resource_hrefs(catalog: dict) -> dict[str, str]:
    back_matter = catalog.get("back-matter")
    if not isinstance(back_matter, dict) or not isinstance(back_matter.get("resources"), list):
        raise UnsupportedUpstreamData("catalog has no back-matter resources list")
    hrefs = {}
    for resource in back_matter["resources"]:
        uuid = resource.get("uuid") if isinstance(resource, dict) else None
        if not isinstance(uuid, str):
            raise UnsupportedUpstreamData("back-matter resource without a uuid")
        rlinks = resource.get("rlinks")
        first_link = rlinks[0] if isinstance(rlinks, list) and rlinks else None
        first_href = first_link.get("href") if isinstance(first_link, dict) else None
        if not isinstance(first_href, str) or not first_href:
            raise UnsupportedUpstreamData(f"back-matter resource {uuid!r} has no rlinks href")
        hrefs[uuid] = first_href
    return hrefs
