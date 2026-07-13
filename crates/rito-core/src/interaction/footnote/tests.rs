use crate::xhtml::{parse_xhtml, DocumentNode};

use super::*;

#[test]
fn footnote_filter_removes_only_referenced_same_chapter_notes() {
    let parsed = parse_xhtml(
        r##"
        <html xmlns:epub="http://www.idpf.org/2007/ops">
          <body>
            <p>Body<a epub:type="noteref" href="#fn1">1</a></p>
            <aside epub:type="footnote" id="fn1"><p>Referenced <a href="more.xhtml">note</a></p></aside>
            <aside epub:type="footnote" id="fn2"><p>Unreferenced note</p></aside>
          </body>
        </html>
        "##,
    )
    .expect("parse chapter");
    let extracted = extract_referenced_footnotes(&[FootnoteFilterChapter {
        idref: "ch1",
        href: "Text/ch1.xhtml",
        nodes: &parsed.nodes,
    }]);
    let nodes = extracted
        .filtered_chapters
        .get("ch1")
        .expect("filtered chapter");
    let footnote = extracted
        .footnotes
        .get("Text/ch1.xhtml#fn1")
        .expect("referenced footnote is extracted");

    assert!(!contains_element_id(nodes, "fn1"));
    assert!(contains_element_id(nodes, "fn2"));
    assert_eq!(footnote.kind, FootnoteKind::Footnote);
    assert_eq!(footnote.text, "Referenced note");
    assert_eq!(
        footnote.html,
        r#"<p>Referenced <a href="more.xhtml">note</a></p>"#
    );
}

#[test]
fn footnote_html_preserves_allowlisted_structure_and_attributes() {
    let parsed = parse_xhtml(
        r##"
        <html xmlns:epub="http://www.idpf.org/2007/ops">
          <body>
            <p>Body<a epub:type="noteref" href="#fn1">1</a></p>
            <aside epub:type="footnote" id="fn1">
              <p class="note-text" lang="ja">注：<a href="#ref1">返回</a></p>
              <ol start="2"><li value="3"><strong>补充</strong></li></ol>
              <table><tr><th scope="row">Key</th><td colspan="2">Value</td></tr></table>
              <img src="images/note.png" alt="diagram" width="40" height="20"/>
            </aside>
          </body>
        </html>
        "##,
    )
    .expect("parse chapter");
    let extracted = extract_referenced_footnotes(&[FootnoteFilterChapter {
        idref: "ch1",
        href: "Text/ch1.xhtml",
        nodes: &parsed.nodes,
    }]);
    let html = &extracted
        .footnotes
        .get("Text/ch1.xhtml#fn1")
        .expect("footnote")
        .html;

    assert!(html.contains(r#"<p lang="ja">"#));
    assert!(html.contains(r##"<a href="#ref1">返回</a>"##));
    assert!(html.contains(r#"<ol start="2"><li value="3"><strong>补充</strong></li></ol>"#));
    assert!(html.contains(r#"<th scope="row">Key</th><td colspan="2">Value</td>"#));
    assert!(html.contains(r#"<img alt="diagram" height="20" width="40">"#));
}

#[test]
fn footnote_html_removes_active_content_attributes_and_urls() {
    let parsed = parse_xhtml(
        r##"
        <html xmlns:epub="http://www.idpf.org/2007/ops">
          <body>
            <p>Body<a epub:type="noteref" href="#fn1">1</a></p>
            <aside epub:type="footnote" id="fn1">
              <form action="javascript:alert(1)">
                <p class="note" style="color:red" onclick="alert(2)" data-secret="x">
                  Safe <span onmouseover="alert(3)">content</span>
                  <a href="java&#x9;script:alert(4)">script</a>
                  <a href="JaVaScRiPt:alert(4)">mixed-script</a>
                  <a href="data:text/html,bad">data</a>
                  <a href="https://example.com/note" target="_blank">web</a>
                  <a href="HTTPS://example.com/upper">upper-web</a>
                  <img src="javascript:alert(5)" alt="bad-script" onerror="alert(6)"/>
                  <img src="data:image/svg+xml,bad" alt="bad-data"/>
                  <img src="images/safe.png" alt="safe-image" onload="alert(7)"/>
                  <img src="https://example.com/tracker.png" alt="remote-image"/>
                </p>
              </form>
              <script>alert(8)</script><style>body { display: none }</style>
              <iframe src="https://example.com"></iframe><object></object><embed/>
            </aside>
          </body>
        </html>
        "##,
    )
    .expect("parse chapter");
    let extracted = extract_referenced_footnotes(&[FootnoteFilterChapter {
        idref: "ch1",
        href: "Text/ch1.xhtml",
        nodes: &parsed.nodes,
    }]);
    let html = &extracted
        .footnotes
        .get("Text/ch1.xhtml#fn1")
        .expect("footnote")
        .html;

    for unsafe_value in [
        "<form",
        "<script",
        "<style",
        "<iframe",
        "<object",
        "<embed",
        "action=",
        "style=",
        "onclick=",
        "onmouseover=",
        "onerror=",
        "onload=",
        "data-secret=",
        "class=",
        "javascript:",
        "data:",
        "src=",
        "target=",
    ] {
        assert!(!html.to_ascii_lowercase().contains(unsafe_value));
    }
    assert!(html.contains("<p>"));
    assert!(html.contains("<span>content</span>"));
    assert!(html.contains("<a>script</a>"));
    assert!(html.contains("<a>mixed-script</a>"));
    assert!(html.contains("<a>data</a>"));
    assert!(html.contains(r#"<a href="https://example.com/note">web</a>"#));
    assert!(html.contains(r#"<a href="HTTPS://example.com/upper">upper-web</a>"#));
    assert!(html.contains(r#"<img alt="safe-image">"#));
    assert!(html.contains(r#"<img alt="remote-image">"#));
}

#[test]
fn external_target_set_filters_forward_and_backward_chapters() {
    let body = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <aside epub:type="footnote" id="back"><p>Back</p></aside>
        <a epub:type="noteref" href="notes.xhtml#forward">forward</a>
        </body></html>"##,
    )
    .expect("parse body");
    let notes = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <aside epub:type="footnote" id="forward"><p>Forward</p></aside>
        <a epub:type="noteref" href="body.xhtml#back">back</a>
        </body></html>"##,
    )
    .expect("parse notes");
    let chapters = [
        FootnoteFilterChapter {
            idref: "body",
            href: "Text/body.xhtml",
            nodes: &body.nodes,
        },
        FootnoteFilterChapter {
            idref: "notes",
            href: "Text/notes.xhtml",
            nodes: &notes.nodes,
        },
    ];
    let targets = discover_footnote_targets(&chapters);
    let body_only = extract_footnotes_for_targets(&chapters[..1], &targets);
    let notes_only = extract_footnotes_for_targets(&chapters[1..], &targets);

    assert!(!contains_element_id(
        body_only.filtered_chapters.get("body").unwrap(),
        "back"
    ));
    assert!(!contains_element_id(
        notes_only.filtered_chapters.get("notes").unwrap(),
        "forward"
    ));
    assert!(body_only.footnotes.contains_key("Text/body.xhtml#back"));
    assert!(notes_only
        .footnotes
        .contains_key("Text/notes.xhtml#forward"));
}

#[test]
fn footnote_filter_resolves_parent_relative_noterefs() {
    let body = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <p><a epub:type="noteref" href="../Text/notes.xhtml#fn1">1</a></p>
        </body></html>"##,
    )
    .expect("parse body chapter");
    let notes = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <aside epub:type="footnote" id="fn1"><p>Cross note</p></aside>
        </body></html>"##,
    )
    .expect("parse notes chapter");
    let filtered = filter_referenced_footnotes(&[
        FootnoteFilterChapter {
            idref: "body",
            href: "Text/body.xhtml",
            nodes: &body.nodes,
        },
        FootnoteFilterChapter {
            idref: "notes",
            href: "Text/notes.xhtml",
            nodes: &notes.nodes,
        },
    ]);

    assert!(!contains_element_id(filtered.get("notes").unwrap(), "fn1"));
}

#[test]
fn canonicalizes_source_relative_paths_and_percent_encoded_fragments() {
    let body = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <a epub:type="noteref" href="notes.xhtml#%E6%B3%A8">note</a>
        </body></html>"##,
    )
    .expect("parse body");
    let local_notes = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <aside epub:type="footnote" id="注"><p>Local note</p></aside>
        </body></html>"##,
    )
    .expect("parse local notes");
    let other_notes = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <aside epub:type="footnote" id="注"><p>Other note</p></aside>
        </body></html>"##,
    )
    .expect("parse other notes");
    let chapters = [
        FootnoteFilterChapter {
            idref: "body",
            href: "A/body.xhtml",
            nodes: &body.nodes,
        },
        FootnoteFilterChapter {
            idref: "local-notes",
            href: "A/notes.xhtml",
            nodes: &local_notes.nodes,
        },
        FootnoteFilterChapter {
            idref: "other-notes",
            href: "B/notes.xhtml",
            nodes: &other_notes.nodes,
        },
    ];
    let targets = discover_footnote_targets(&chapters);
    let extracted = extract_footnotes_for_targets(&chapters, &targets);
    let mut single_pass =
        FootnoteIndexBuilder::new(chapters.iter().map(|chapter| chapter.href.to_owned()));
    for chapter in &chapters {
        single_pass.discover(chapter.href, chapter.nodes);
    }
    let (single_pass_targets, single_pass_footnotes) = single_pass.finish();

    assert_eq!(single_pass_targets, targets);
    assert_eq!(single_pass_footnotes, extracted.footnotes);
    assert!(extracted.footnotes.contains_key("A/notes.xhtml#注"));
    assert!(!extracted.footnotes.contains_key("B/notes.xhtml#注"));
    assert!(!contains_element_id(
        extracted.filtered_chapters.get("local-notes").unwrap(),
        "注"
    ));
    assert!(contains_element_id(
        extracted.filtered_chapters.get("other-notes").unwrap(),
        "注"
    ));
}

#[test]
fn single_pass_duplicate_keys_keep_the_last_definition_like_two_pass_collection() {
    let chapter = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <a epub:type="noteref" href="#same">note</a>
        <aside epub:type="footnote" id="same"><p>First definition</p></aside>
        <aside epub:type="endnote" id="same"><p>Second definition</p></aside>
        </body></html>"##,
    )
    .expect("parse duplicate definitions");
    let chapters = [FootnoteFilterChapter {
        idref: "chapter",
        href: "Text/chapter.xhtml",
        nodes: &chapter.nodes,
    }];
    let expected = extract_referenced_footnotes(&chapters).footnotes;
    let mut single_pass = FootnoteIndexBuilder::new(["Text/chapter.xhtml".to_owned()]);
    single_pass.discover("Text/chapter.xhtml", &chapter.nodes);
    let (_, actual) = single_pass.finish();

    assert_eq!(actual, expected);
    assert_eq!(actual["Text/chapter.xhtml#same"].text, "Second definition");
    assert_eq!(
        actual["Text/chapter.xhtml#same"].kind,
        FootnoteKind::Endnote
    );
}

#[test]
fn single_pass_index_matches_two_pass_cross_chapter_and_nested_semantics() {
    let body = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <a epub:type="noteref" href="notes.xhtml#forward">forward</a>
        <a epub:type="noteref" href="#outer">outer</a>
        <a epub:type="noteref" href="#hidden-inner">hidden inner</a>
        <a epub:type="noteref" href="#visible-inner">visible inner</a>
        <aside epub:type="footnote" id="back"><p>Backward</p></aside>
        <aside epub:type="footnote" id="outer"><p>Outer</p>
          <aside epub:type="footnote" id="hidden-inner"><p>Hidden inner</p></aside>
        </aside>
        <aside epub:type="note" id="unused-outer"><p>Unused outer remains body</p>
          <aside epub:type="endnote" id="visible-inner"><p>Visible inner</p></aside>
        </aside>
        </body></html>"##,
    )
    .expect("parse body");
    let notes = parse_xhtml(
        r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <a epub:type="noteref" href="body.xhtml#back">backward</a>
        <aside epub:type="rearnote" id="forward"><p onclick="bad()">Forward
          <a href="javascript:bad()">unsafe</a><script>bad()</script>
        </p></aside>
        <aside epub:type="footnote" id="unused"><p>Unused definition</p></aside>
        </body></html>"##,
    )
    .expect("parse notes");
    let chapters = [
        FootnoteFilterChapter {
            idref: "body",
            href: "Text/body.xhtml",
            nodes: &body.nodes,
        },
        FootnoteFilterChapter {
            idref: "notes",
            href: "Text/notes.xhtml",
            nodes: &notes.nodes,
        },
    ];
    let two_pass = extract_referenced_footnotes(&chapters);
    let mut single_pass =
        FootnoteIndexBuilder::new(chapters.iter().map(|chapter| chapter.href.to_owned()));
    for chapter in &chapters {
        single_pass.discover(chapter.href, chapter.nodes);
    }
    let (targets, footnotes) = single_pass.finish();

    assert_eq!(targets, discover_footnote_targets(&chapters));
    assert_eq!(footnotes, two_pass.footnotes);
    assert!(footnotes.contains_key("Text/body.xhtml#back"));
    assert!(footnotes.contains_key("Text/notes.xhtml#forward"));
    assert!(footnotes.contains_key("Text/body.xhtml#outer"));
    assert!(footnotes.contains_key("Text/body.xhtml#visible-inner"));
    assert!(!footnotes.contains_key("Text/body.xhtml#hidden-inner"));
    assert!(!footnotes.contains_key("Text/body.xhtml#unused-outer"));
    assert!(!footnotes.contains_key("Text/notes.xhtml#unused"));
    let forward_html = &footnotes["Text/notes.xhtml#forward"].html;
    assert!(forward_html.contains("<p>"));
    assert!(forward_html.contains("<a>unsafe</a>"));
    assert!(!forward_html.contains("onclick"));
    assert!(!forward_html.contains("javascript"));
    assert!(!forward_html.contains("<script"));
    assert!(contains_element_id(
        two_pass.filtered_chapters.get("body").unwrap(),
        "unused-outer"
    ));
    assert!(!contains_element_id(
        two_pass.filtered_chapters.get("body").unwrap(),
        "visible-inner"
    ));
}

fn contains_element_id(nodes: &[DocumentNode], id: &str) -> bool {
    nodes.iter().any(|node| {
        element_attributes(node).and_then(|attributes| attributes.id.as_deref()) == Some(id)
            || children(node).is_some_and(|children| contains_element_id(children, id))
    })
}
