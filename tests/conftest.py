import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def pytest_addoption(parser):
    parser.addoption(
        "--all-releases",
        action="store_true",
        help="regenerate every stored release in test_committed_library, not only each source's current one",
    )


def pytest_collection_modifyitems(config, items):
    if config.getoption("--all-releases"):
        return
    skip_older_release = pytest.mark.skip(reason="older release; run with --all-releases to regenerate it")
    for item in items:
        if "older_release" in item.keywords:
            item.add_marker(skip_older_release)


def pytest_configure(config):
    config.addinivalue_line("markers", "older_release: a stored release that is not its source's current one")
