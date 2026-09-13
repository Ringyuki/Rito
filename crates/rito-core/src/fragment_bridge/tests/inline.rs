//! Inline flow tests: white-space collapsing and preservation, forced
//! breaks, the text style bare text borrows from its block, ruby
//! base/annotation pairing and its degradations, inline image sizing, and
//! line alignment.

use super::*;

#[test]
fn an_inline_image_em_width_resolves_against_its_own_font_size() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head>
<body><div class="article"><p>字<a class="duokan-footnote" href="f7"><img class="w09" src="zhu.png"/></a>字</p></div></body></html>"#,
        ".article { font-size: 0.95em; } .w09 { width: 0.9em; }",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let styles = built.tree.styles().expect("tree carries styles");
    let mut width: Option<f64> = None;
    let mut stack = vec![built.tree.root()];
    while let Some(id) = stack.pop() {
        let node = built.tree.node(id);
        stack.extend(node.children.iter().copied());
        if let FormattingNodeContent::InlineFlow { items } = &node.content {
            for item in items {
                if let InlineItem::Image { layout_style, .. } = item {
                    let resolved = styles
                        .layout
                        .style(*layout_style)
                        .expect("image layout style resolves");
                    if let rito_style_contract::PreferredSize::Value(value) = &resolved.width {
                        let LengthPercentage::Length(px) = value.value() else {
                            panic!("unexpected width form");
                        };
                        width = Some(f64::from(px.get()));
                    }
                }
            }
        }
    }
    // body 16px -> .article 0.95em = 15.2px -> the img inherits 15.2,
    // and `width: 0.9em` resolves against the img's OWN font size:
    // 0.9 * 15.2 = 13.68 (the used size then truncates to 13.671875
    // on the LayoutUnit grid downstream).
    let width = width.expect("the image carries a preferred width");
    assert!(
        (width - 13.68).abs() < 1e-3,
        "img em width resolves at 13.68, got {width}"
    );
}

/// An annotation collapses only CSS white space: runs of spaces and
/// line breaks become one space and the edges trim, while a Unicode
/// space separator (an en space between a Latin annotation's words)
/// stays the glyph it is — the browser shapes it at its own advance.
#[test]
fn ruby_annotations_collapse_css_white_space_and_keep_space_separators() {
    let chapter = resolved_chapter_from(
        "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>t</title></head><body>
  <p><ruby><rb>鲜血的女王</rb><rt>Bloody\u{2002}Regina</rt></ruby>和<ruby><rb>辛</rb><rt>  Call \n sign  </rt></ruby></p>
</body></html>",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let root = built.tree.node(built.tree.root());
    let FormattingNodeContent::InlineFlow { items } = &built.tree.node(root.children[0]).content
    else {
        panic!("the paragraph is an inline flow");
    };
    let annotations: Vec<Option<&str>> = items
        .iter()
        .map(|item| match item {
            InlineItem::Text {
                ruby_annotation, ..
            } => ruby_annotation.as_ref().map(|a| a.text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        annotations,
        vec![Some("Bloody\u{2002}Regina"), None, Some("Call sign")],
    );
}

#[test]
fn ruby_bases_carry_annotations_and_never_merge_with_neighbours() {
    let chapter = resolved_chapter_from(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p>これは<ruby>漢字<rt>かんじ</rt></ruby>です。</p>
  <p><ruby><rb>東京</rb><rp>（</rp><rt>とうきょう</rt><rp>）</rp></ruby></p>
</body></html>"#,
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let root = built.tree.node(built.tree.root());
    let FormattingNodeContent::InlineFlow { items } = &built.tree.node(root.children[0]).content
    else {
        panic!("first paragraph is an inline flow");
    };
    let runs: Vec<(&str, Option<&str>)> = items
        .iter()
        .map(|item| match item {
            InlineItem::Text {
                text,
                ruby_annotation,
                ..
            } => (
                text.as_str(),
                ruby_annotation.as_ref().map(|a| a.text.as_str()),
            ),
            InlineItem::Image { .. }
            | InlineItem::InlineBlock { .. }
            | InlineItem::EmptyBox { .. } => {
                panic!("no atomic items here")
            }
        })
        .collect();
    assert_eq!(
        runs,
        vec![("これは", None), ("漢字", Some("かんじ")), ("です。", None),],
    );
    let FormattingNodeContent::InlineFlow { items } = &built.tree.node(root.children[1]).content
    else {
        panic!("second paragraph is an inline flow");
    };
    let InlineItem::Text {
        text,
        ruby_annotation,
        ..
    } = &items[0]
    else {
        panic!("ruby base is a text item");
    };
    assert_eq!(text, "東京");
    assert_eq!(
        ruby_annotation.as_ref().map(|a| a.text.as_str()),
        Some("とうきょう")
    );
}

#[test]
fn bare_text_borrows_its_block_style_without_the_block_background() {
    // The paragraph paints its own background once; the runs inside
    // it carry no band. A span keeps its background: that is what
    // makes it an inline box.
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p class="band">bare <span class="box">boxed</span></p>
</body></html>"#,
        "p.band { background: #eeeeee; } span.box { background: #dddddd; }",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let root = built.tree.node(built.tree.root());
    let FormattingNodeContent::InlineFlow { items } = &built.tree.node(root.children[0]).content
    else {
        panic!("the paragraph is an inline flow");
    };
    let styles = built.tree.styles().expect("style tables");
    let band_alpha = |text: &str| {
        items
            .iter()
            .find_map(|item| match item {
                InlineItem::Text {
                    text: run, style, ..
                } if run.trim() == text => {
                    let style = styles.inline.style(*style).expect("style resolves");
                    Some(
                        style
                            .paint
                            .background
                            .resolve(style.paint.foreground)
                            .alpha()
                            .get(),
                    )
                }
                _ => None,
            })
            .unwrap_or_else(|| panic!("run {text:?} present"))
    };
    assert_eq!(band_alpha("bare"), 0.0);
    assert_eq!(band_alpha("boxed"), 1.0);
}

#[test]
fn collapsible_space_after_a_forced_break_is_removed_at_the_line_start() {
    // CSS Text §4.1.3: collapsible spaces at the start of a line are
    // removed. Source indentation after `<br/>` is exactly that.
    let chapter = resolved_chapter_from(
        "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>t</title></head><body>\n  <p>lead<br />\n    <span>tail</span></p>\n</body></html>",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let root = built.tree.node(built.tree.root());
    let FormattingNodeContent::InlineFlow { items } = &built.tree.node(root.children[0]).content
    else {
        panic!("paragraph is an inline flow");
    };
    let flow: String = items
        .iter()
        .map(|item| match item {
            InlineItem::Text { text, .. } => text.as_str(),
            InlineItem::Image { .. }
            | InlineItem::InlineBlock { .. }
            | InlineItem::EmptyBox { .. } => {
                panic!("no atomic items here")
            }
        })
        .collect();
    assert_eq!(flow, "lead\ntail", "no space survives the forced break");
}

#[test]
fn pre_wrap_keeps_spaces_and_segment_breaks_verbatim() {
    // white-space: pre-wrap — Blink keeps a calibre story's
    // four-space paragraph indents and its interior space runs; a
    // preserved newline is a forced break like <br/>.
    let chapter = resolved_chapter_with(
        "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>t</title></head><body><p class=\"pre\">    lead  in\nnext</p></body></html>",
        "p.pre { white-space: pre-wrap; }",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let root = built.tree.node(built.tree.root());
    let FormattingNodeContent::InlineFlow { items } = &built.tree.node(root.children[0]).content
    else {
        panic!("paragraph is an inline flow");
    };
    let flow: String = items
        .iter()
        .map(|item| match item {
            InlineItem::Text { text, .. } => text.as_str(),
            InlineItem::Image { .. }
            | InlineItem::InlineBlock { .. }
            | InlineItem::EmptyBox { .. } => {
                panic!("no atomic items here")
            }
        })
        .collect();
    assert_eq!(
        flow, "    lead  in\nnext",
        "spaces and the segment break survive verbatim"
    );
    assert!(
        built.degradations.is_empty(),
        "pre-wrap is implemented, not degraded: {:?}",
        built.degradations
    );
}

#[test]
fn mono_ruby_pairs_each_annotation_with_its_base_segment() {
    let chapter = resolved_chapter_from(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby></p>
</body></html>"#,
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("mono ruby builds");
    let root = built.tree.node(built.tree.root());
    let FormattingNodeContent::InlineFlow { items } = &built.tree.node(root.children[0]).content
    else {
        panic!("paragraph is an inline flow");
    };
    let runs: Vec<(&str, Option<&str>)> = items
        .iter()
        .map(|item| match item {
            InlineItem::Text {
                text,
                ruby_annotation,
                ..
            } => (
                text.as_str(),
                ruby_annotation.as_ref().map(|a| a.text.as_str()),
            ),
            InlineItem::Image { .. }
            | InlineItem::InlineBlock { .. }
            | InlineItem::EmptyBox { .. } => {
                panic!("no atomic items here")
            }
        })
        .collect();
    assert_eq!(runs, vec![("漢", Some("かん")), ("字", Some("じ"))],);
}

#[test]
fn malformed_ruby_structures_degrade_to_plain_text() {
    let stray_rt = resolved_chapter_from(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p>text<rt>leak</rt></p>
</body></html>"#,
    );
    let built = build_chapter_formatting_tree(
        &stray_rt.nodes,
        stray_rt.body_index,
        &stray_rt.layout,
        &stray_rt.inline,
        &no_images(),
    )
    .expect("a stray <rt> renders as plain text");
    assert!(
        built
            .degradations
            .iter()
            .any(|reason| reason.contains("outside <ruby>")),
        "the malformed markup is recorded: {:?}",
        built.degradations
    );
}

/// The 1/64 line-fit tolerance must not leak into alignment: a
/// right-aligned line starts at exactly the container width minus
/// its advance, unquantized (the browser's Range keeps the
/// fractional start).
#[test]
fn right_aligned_line_starts_at_width_minus_advance() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<p>『和你恋爱什么，应该是不可能的』完</p>
</body></html>"#,
        "body { margin: 0; padding: 0; }              p { margin: 0; text-align: right; font-weight: bold; font-size: 16px; }
",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes(), source_han_test_bytes()])
            .expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(627.21875),
            None,
            &cancel,
        )
        .expect("lays out");
    fn walk_lines(fragment: &Fragment, off: f64, out: &mut Vec<(f64, f64)>) {
        match fragment {
            Fragment::Box(node) => {
                for child in &node.children {
                    walk_lines(child, off + node.rect.x, out);
                }
            }
            Fragment::Line(line) => {
                out.push((off + line.rect.x, line.rect.width));
            }
            _ => {}
        }
    }
    let mut lines = Vec::new();
    walk_lines(&outcome.fragments.root, 0.0, &mut lines);
    let (line_x, _) = lines[0];
    assert!(
        (line_x - (627.21875 - 272.0)).abs() < 1e-6,
        "right-aligned start is exact: {line_x}"
    );
}
