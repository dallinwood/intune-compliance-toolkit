from conftest import CODE_BLOCK_LINE, FOOTER_LINE, build_sample_pdf

from tools.pdf_to_markdown import convert_file, convert_to_markdown, find_pdfs


def test_convert_strips_repeating_page_footer(sample_pdf):
    markdown = convert_to_markdown(sample_pdf)

    assert FOOTER_LINE not in markdown


def test_convert_uses_toc_heading_hierarchy(sample_pdf):
    markdown = convert_to_markdown(sample_pdf)

    assert "# **Title**" in markdown
    assert "## **Section One**" in markdown
    assert "### **Subsection**" in markdown


def test_convert_preserves_text_boxed_in_shaded_borders(sample_pdf):
    markdown = convert_to_markdown(sample_pdf)

    assert CODE_BLOCK_LINE in markdown


def test_convert_is_deterministic(sample_pdf):
    first_pass = convert_to_markdown(sample_pdf)
    second_pass = convert_to_markdown(sample_pdf)

    assert first_pass == second_pass


def test_convert_file_writes_markdown_with_matching_stem(sample_pdf, tmp_path):
    output_path = convert_file(sample_pdf, tmp_path)

    assert output_path == tmp_path / "sample.md"
    assert output_path.read_text(encoding="utf-8") == convert_to_markdown(sample_pdf)


def test_find_pdfs_recurses_into_subfolders(tmp_path):
    nested_dir = tmp_path / "vendor-a" / "v1"
    nested_dir.mkdir(parents=True)
    pdf_path = build_sample_pdf(nested_dir / "guideline.pdf")
    (tmp_path / "not_a_pdf.txt").write_text("ignore me")

    found = find_pdfs(tmp_path)

    assert found == [pdf_path]
