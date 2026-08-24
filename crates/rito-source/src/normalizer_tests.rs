use super::normalize_xhtml_source;

#[test]
fn self_closes_unpaired_legacy_void_elements() {
    let source =
        r#"<head><meta charset="utf-8"></head><body><p>one<br>two</p><hr><img src="x"></body>"#;
    assert_eq!(
        normalize_xhtml_source(source),
        r#"<head><meta charset="utf-8"/></head><body><p>one<br/>two</p><hr/><img src="x"/></body>"#
    );
}

#[test]
fn self_closes_void_elements_before_parent_closing_tags() {
    let source = "<p><span><br></span></p>";
    assert_eq!(normalize_xhtml_source(source), "<p><span><br/></span></p>");
}

#[test]
fn preserves_xml_tag_name_case_like_the_existing_normalizer() {
    let source = r#"<BR><SCRIPT>const sample = "<br>";</SCRIPT>"#;
    assert_eq!(
        normalize_xhtml_source(source),
        r#"<BR><SCRIPT>const sample = "<br/>";</SCRIPT>"#
    );
}

#[test]
fn preserves_self_closed_and_explicitly_closed_void_elements() {
    let source = "<p>one<br/>two<br />three<br></br></p>";
    assert_eq!(normalize_xhtml_source(source), source);
}

#[test]
fn ignores_markup_in_protected_and_raw_text_sections() {
    let source = concat!(
        "<!DOCTYPE html [<!ENTITY sample \"<br>\">]>",
        "<?sample <br>?>",
        "<!-- <br> -->",
        "<![CDATA[<br>]]>",
        "<script>const sample = '<br>';</script>",
        "<style>x::after { content: '<br>'; }</style>",
        "<p title=\"<br>\">actual<br>break</p>"
    );
    assert_eq!(
        normalize_xhtml_source(source),
        source
            .replacen("<!DOCTYPE html [<!ENTITY sample \"<br>\">]>", "", 1)
            .replace("actual<br>break", "actual<br/>break")
    );
}

#[test]
fn strips_document_types_without_touching_comment_or_cdata_literals() {
    let source = concat!(
        "<!-- <!DOCTYPE preserved> -->",
        "<![CDATA[<!DOCTYPE preserved>]]>",
        "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"xhtml11.dtd\">",
        "<html/>"
    );
    assert_eq!(
        normalize_xhtml_source(source),
        "<!-- <!DOCTYPE preserved> --><![CDATA[<!DOCTYPE preserved>]]><html/>"
    );
}

#[test]
fn preserves_malformed_non_void_markup_for_strict_parser_errors() {
    let source = "<html><body><p><strong>text</p></body></html>";
    assert_eq!(normalize_xhtml_source(source), source);
}

#[test]
fn normalizes_single_quoted_xml_declarations_and_nbsp() {
    let source = "<?xml version='1.0'?><html>&nbsp;</html>";
    assert_eq!(
        normalize_xhtml_source(source),
        "<?xml version=\"1.0\"?><html>&#160;</html>"
    );
}

#[test]
fn repairs_an_unclosed_element_at_its_ancestors_close() {
    let source = "<html><body><div><p>a</p></body></html>";
    let repaired = super::repair_mismatched_tags(source).expect("repair applies");
    assert_eq!(repaired, "<html><body><div><p>a</p></div></body></html>");
}

#[test]
fn drops_an_orphan_close_tag() {
    let source = "<html><body><p>a</p></div></body></html>";
    let repaired = super::repair_mismatched_tags(source).expect("repair applies");
    assert_eq!(repaired, "<html><body><p>a</p></body></html>");
}

#[test]
fn closes_everything_left_open_at_the_end() {
    let source = "<html><body><p>a";
    let repaired = super::repair_mismatched_tags(source).expect("repair applies");
    assert_eq!(repaired, "<html><body><p>a</p></body></html>");
}

#[test]
fn well_formed_markup_needs_no_repair() {
    let source = "<html><body><p>a</p><br/><img src=\"x\"/></body></html>";
    assert!(super::repair_mismatched_tags(source).is_none());
}

#[test]
fn a_repaired_source_parses_into_a_full_tree() {
    // The b39 calibre shape: an unclosed div empties the whole chapter
    // under strict parsing; the recovery attempt must lay the story.
    let source = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><div class=\"a\"><p>story</p></body></html>";
    let arena = crate::SourceArena::from_xhtml(source).expect("recovers");
    let text: String = arena
        .descendants(arena.root())
        .filter_map(|(_, node)| node.as_text().map(str::to_owned))
        .collect();
    assert_eq!(text, "story");
}
