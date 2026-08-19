"""Convert benchmark and guideline PDFs to markdown, deterministically and locally.

pymupdf4llm defaults to running an ML layout model plus OCR on every page
(`use_layout(True)`), which is far too slow for documents with hundreds to
thousands of pages and pulls in non-deterministic model inference. This
module forces the legacy heuristic converter instead.

pymupdf4llm's own vector-graphics "significance" heuristic (`is_significant`)
misclassifies shaded/bordered snippet boxes - used for terminal commands and
config keys - as images, and its force-text fallback for those regions
returns nothing, silently dropping the boxed text. We patch it to always
report "not significant" so boxed text is treated as ordinary text instead.
Table detection is unaffected: it runs through a separate `find_tables()`
code path that this patch does not touch.
"""

import argparse
from pathlib import Path

import pymupdf
import pymupdf4llm
import pymupdf4llm.helpers.pymupdf_rag as pymupdf_rag

pymupdf4llm.use_layout(False)
pymupdf_rag.is_significant = lambda box, paths: False

FOOTER_MARGIN_POINTS = 60


def convert_to_markdown(pdf_path, pages=None):
    document = pymupdf.open(pdf_path)
    toc_headers = pymupdf4llm.TocHeaders(document)
    return pymupdf4llm.to_markdown(
        document,
        hdr_info=toc_headers,
        margins=(0, 0, 0, FOOTER_MARGIN_POINTS),
        pages=pages,
    )


def convert_file(pdf_path, output_dir, pages=None):
    pdf_path = Path(pdf_path)
    markdown_text = convert_to_markdown(pdf_path, pages=pages)
    output_path = Path(output_dir) / f"{pdf_path.stem}.md"
    output_path.write_text(markdown_text, encoding="utf-8")
    return output_path


def find_pdfs(root_dir):
    return sorted(p for p in Path(root_dir).rglob("*") if p.suffix.lower() == ".pdf")


DEFAULT_SOURCE_DIR = Path(__file__).resolve().parent.parent / "baseline-references" / "cis-benchmarks"


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=DEFAULT_SOURCE_DIR,
        help=f"Directory to search for PDFs (recursively). Default: {DEFAULT_SOURCE_DIR}",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory to write .md files into. Default: next to each source PDF.",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    pdf_paths = find_pdfs(args.source_dir)
    if not pdf_paths:
        print(f"No PDFs found under {args.source_dir}")
        return 1

    for pdf_path in pdf_paths:
        output_dir = args.output_dir if args.output_dir is not None else pdf_path.parent
        output_path = convert_file(pdf_path, output_dir)
        print(f"{pdf_path} -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
