import pytest

from tools.asd_oscal import release_label, resource_hrefs, rewrite_resource_links
from tools.library_output import UnsupportedUpstreamData


def test_release_label_is_month_and_year_from_the_tag():
    assert release_label("v2026.10.15") == "Oct 2026"


def test_release_label_rejects_a_tag_without_a_year_and_month():
    with pytest.raises(ValueError, match="cannot derive a release label"):
        release_label("latest")


def test_rewrite_resource_links_replaces_a_known_uuid():
    rewritten = rewrite_resource_links("see [guide](#aaa) now", {"aaa": "https://a.example"}, "it.pro-1")
    assert rewritten == "see [guide](https://a.example) now"


def test_rewrite_resource_links_rejects_an_unknown_uuid():
    with pytest.raises(UnsupportedUpstreamData, match="it.pro-1.*missing-uuid"):
        rewrite_resource_links("[x](#missing-uuid)", {}, "it.pro-1")


def test_resource_hrefs_maps_each_uuid_to_its_first_link():
    catalog = {"back-matter": {"resources": [{"uuid": "aaa", "rlinks": [{"href": "https://a.example"}]}]}}
    assert resource_hrefs(catalog) == {"aaa": "https://a.example"}


def test_resource_hrefs_rejects_a_resource_with_no_rlinks():
    catalog = {"back-matter": {"resources": [{"uuid": "aaa"}]}}
    with pytest.raises(UnsupportedUpstreamData, match="no rlinks href"):
        resource_hrefs(catalog)
