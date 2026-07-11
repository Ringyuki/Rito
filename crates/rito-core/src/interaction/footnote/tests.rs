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

fn contains_element_id(nodes: &[DocumentNode], id: &str) -> bool {
    nodes.iter().any(|node| {
        element_attributes(node).and_then(|attributes| attributes.id.as_deref()) == Some(id)
            || children(node).is_some_and(|children| contains_element_id(children, id))
    })
}
