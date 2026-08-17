import sys
from pathlib import Path

import pymupdf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

CODE_BLOCK_LINE = "example --check-status"
FOOTER_LINE = "Confidential Sample"


def build_sample_pdf(path):
    """Build a small synthetic PDF mimicking the benchmark PDF layout we convert.

    Includes a three-level TOC heading hierarchy, a footer repeated near the
    bottom margin, and a shaded/bordered box of monospace text - the same
    box styling that benchmark PDFs use for terminal commands and that
    pymupdf4llm's vector-graphics heuristic misclassifies as an image (see
    tools/pdf_to_markdown.py for the fix).
    """
    document = pymupdf.open()
    page = document.new_page(width=612, height=792)

    page.insert_text((72, 72), "Title", fontsize=18, fontname="helvetica-bold")
    page.insert_text((72, 110), "Section One", fontsize=14, fontname="helvetica-bold")
    page.insert_text((72, 130), "Subsection", fontsize=12, fontname="helvetica-bold")
    page.insert_text(
        (72, 150),
        "This is a body paragraph describing the section.",
        fontsize=11,
        fontname="helvetica",
    )

    box = pymupdf.Rect(72, 400, 500, 440)
    page.draw_rect(box, color=(0, 0, 0), width=1)
    page.draw_rect(
        pymupdf.Rect(73, 401, 499, 418),
        color=(0.87, 0.85, 0.76),
        fill=(0.87, 0.85, 0.76),
    )
    page.draw_rect(
        pymupdf.Rect(73, 418, 499, 439),
        color=(0.9, 0.9, 0.9),
        fill=(0.9, 0.9, 0.9),
    )
    page.insert_text((78, 413), CODE_BLOCK_LINE, fontsize=10, fontname="courier")
    page.insert_text((78, 431), "status: disabled", fontsize=10, fontname="courier")

    page.insert_text((72, 745), "Page 1", fontsize=9, fontname="helvetica")
    page.insert_text((72, 765), FOOTER_LINE, fontsize=9, fontname="helvetica")

    document.set_toc([[1, "Title", 1], [2, "Section One", 1], [3, "Subsection", 1]])
    document.save(path)
    return Path(path)


@pytest.fixture
def sample_pdf(tmp_path):
    return build_sample_pdf(tmp_path / "sample.pdf")
