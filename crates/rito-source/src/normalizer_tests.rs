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
