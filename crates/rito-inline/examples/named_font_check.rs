//! Diagnostic: can the engine shape CJK with a named publication face?
use rito_fragment::{
    CancelFlag, ConstraintSpace, FormattingContext, FormattingNode, FormattingNodeContent,
    FormattingNodeId, FormattingTree, Fragment, InlineItem,
};
use rito_inline::{plain_paragraph_style, ParleyInlineContext};
use rito_style_contract::{
    FontFamilies, FontFamily, FontFamilyName, InlineStyleTableV1, LayoutStyleTableV1,
};

fn width(context: &ParleyInlineContext, family: &str) -> f64 {
    let mut inline = InlineStyleTableV1::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(family))]).unwrap(),
                16.0,
                0.0,
            ),
        )
        .unwrap();
    let nodes = vec![FormattingNode {
        style: rito_style_contract::LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: "在那座战场上".to_owned(),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            }],
        },
        children: Vec::new(),
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTableV1::new(0),
            inline,
        },
    )
    .unwrap();
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(10_000.0),
            None,
            &CancelFlag::new(),
        )
        .unwrap();
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!()
    };
    let Fragment::Line(line) = &root.children[0] else {
        panic!()
    };
    line.children.iter().map(|child| child.rect().width).sum()
}

fn main() {
    let kai = std::fs::read(std::env::args().nth(1).expect("font path")).expect("font reads");
    // Raw advance straight from the font tables.
    if let Some(font) = swash::FontRef::from_index(&kai, 0) {
        let upem = font.metrics(&[]).units_per_em as f64;
        let charmap = font.charmap();
        for ch in ['在', '战', '，'] {
            let gid = charmap.map(ch);
            let advance = font.glyph_metrics(&[]).advance_width(gid) as f64;
            println!(
                "raw '{ch}': gid {gid} advance {advance} units / upem {upem} = {:.4}px at 16px",
                advance / upem * 16.0
            );
        }
    } else {
        println!("swash could not read the font");
    }
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");

    let solo = ParleyInlineContext::new(vec![kai.clone()]).expect("solo context");
    println!("solo(kai pinned): width {}", width(&solo, "anything"));

    let mut named = ParleyInlineContext::new(vec![source_han]).expect("named context");
    named.register_named_font("FZWBKS", kai).expect("register");
    println!("named(FZWBKS):    width {}", width(&named, "FZWBKS"));
    println!("fallback:         width {}", width(&named, "NoSuchFace"));
}
