//! Line edges decided one line at a time: a paragraph is built (shaped)
//! at most twice however many of its lines take a line-end trim, a pair
//! trim a break separates or a ruby spread, and the lines are pinned
//! against pinned Chromium (Source Han Serif at 16px).

use super::*;

fn source_han_context() -> ParleyInlineContext {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    ParleyInlineContext::new(vec![source_han]).expect("context builds")
}

fn serif_paragraph(text: &str) -> FormattingTree {
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds")
}

fn lay(context: &ParleyInlineContext, tree: &FormattingTree, width: f64) -> LayoutOutcome {
    context
        .layout(
            tree,
            FormattingNodeId(0),
            &ConstraintSpace::continuous(width),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds")
}

#[test]
fn trims_and_separated_pairs_interleaved_lay_out_as_chromium_does_in_two_builds() {
    let context = source_han_context();
    let ten = "永".repeat(10);
    let text = format!(
        "{}{}」{}{}{}」",
        "永".repeat(9),
        format!("」「{}", "永".repeat(8)).repeat(6),
        format!("{ten}」").repeat(3),
        "永".repeat(9),
        format!("」「{}", "永".repeat(8)).repeat(3),
    );
    let outcome = lay(&context, &serif_paragraph(&text), 160.0);
    let lines = line_texts(&outcome, &text);
    let opened = format!("「{}」", "永".repeat(8));
    let mut expected = vec![format!("{}」", "永".repeat(9))];
    expected.extend(std::iter::repeat_n(opened, 6));
    expected.push("永".repeat(9));
    expected.push(format!("永」{}", "永".repeat(8)));
    expected.push(format!("永永」{}", "永".repeat(7)));
    expected.push(format!("永永永」{}", "永".repeat(6)));
    expected.extend(std::iter::repeat_n(
        format!("永永永」「{}", "永".repeat(5)),
        3,
    ));
    expected.push("永永永」".to_owned());
    assert_eq!(lines, expected);
    assert!(
        context.counts.builds.get() <= 2,
        "built {} times",
        context.counts.builds.get()
    );
}
