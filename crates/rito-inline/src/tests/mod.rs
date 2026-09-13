//! Layout behaviour pinned against the browser oracle, by theme.

use super::*;
use rito_fragment::{BreakToken, BreakTokenStage, FormattingNode, FragmentCache};
use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, AlignmentBaseline, BaselineShift, BaselineSource,
    BorderEdge, BorderEdges, BorderRadii, BorderStyle, ColorNoneFlags, CornerRadius, CssPx,
    FontFamilies, FontFamilyName, FontStyle, FontWeight, InlineBidi, InlineFragmentStyle,
    InlinePaintStyle, InlineStyleTable, InlineTextFlow, LayoutStyleTable, LengthPercentageOrAuto,
    NonNegativeCssPx, NonNegativeLengthPercentage, PhysicalSides, RubyAlign, TextAlign,
    TextDecoration, TextDecorationLines, TextDecorationStyle, TextIndent, TextJustify,
    TextTransform, TextTransformCase, TextWrapMode, TransformList, UnitInterval,
    WhiteSpaceCollapse, WordBreak,
};
use rito_style_contract::{Direction, LineBreak, OverflowWrap, UnicodeBidi, WritingMode};
use std::sync::Arc;

const FONT_SIZE: f32 = 16.0;

mod atoms_and_grid;
mod breaks_and_spacing;
mod clusters;
mod envelopes_and_ruby;
mod punctuation_and_contract;

fn tinos_bytes() -> Vec<u8> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
    );
    std::fs::read(path).expect("pinned Tinos test font reads")
}

fn px(value: f32) -> NonNegativeCssPx {
    NonNegativeCssPx::new(value).expect("test length is non-negative")
}

fn transparent() -> AbsoluteColor {
    AbsoluteColor::new(
        AbsoluteColorSpace::Srgb,
        [0.0, 0.0, 0.0],
        1.0,
        ColorNoneFlags::new(false, false, false, false),
    )
    .expect("test color is finite")
}

fn sides<T: Copy>(value: T) -> PhysicalSides<T> {
    PhysicalSides {
        top: value,
        right: value,
        bottom: value,
        left: value,
    }
}

fn tinos_style(indent_px: f32) -> InlineFormattingStyle {
    let border = BorderEdge {
        resolved_width: px(0.0),
        style: BorderStyle::None,
        color: transparent().into(),
    };
    let radius = CornerRadius {
        horizontal: NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero radius"),
        )),
        vertical: NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero radius"),
        )),
    };
    InlineFormattingStyle {
        font: FontStyle {
            families: FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
                .expect("family list is non-empty"),
            is_system_font: false,
            is_initial: false,
            size: px(FONT_SIZE),
            weight: FontWeight::new(400.0).expect("valid weight"),
            slant: FontSlant::Normal,
            line_height: LineHeight::Normal,
            line_height_is_declared: false,
        },
        text_flow: InlineTextFlow {
            text_align: TextAlign::Start,
            text_justify: TextJustify::Auto,
            text_transform: TextTransform {
                case: TextTransformCase::None,
                full_width: false,
                full_size_kana: false,
            },
            white_space_collapse: WhiteSpaceCollapse::Collapse,
            text_wrap_mode: TextWrapMode::Wrap,
            word_break: WordBreak::Normal,
            line_break: LineBreak::Auto,
            overflow_wrap: OverflowWrap::Normal,
            letter_spacing: LengthPercentage::Length(CssPx::new(0.0).expect("zero spacing")),
            word_spacing: LengthPercentage::Length(CssPx::new(0.0).expect("zero spacing")),
            text_indent: TextIndent {
                value: LengthPercentage::Length(CssPx::new(indent_px).expect("finite indent")),
                hanging: false,
                each_line: false,
            },
            ruby_align: RubyAlign::SpaceAround,
            language: None,
        },
        bidi: InlineBidi {
            direction: Direction::LeftToRight,
            unicode_bidi: UnicodeBidi::Normal,
            writing_mode: WritingMode::HorizontalTopToBottom,
        },
        fragment: InlineFragmentStyle {
            margin: sides(LengthPercentageOrAuto::Value(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero margin"),
            ))),
            padding: sides(NonNegativeLengthPercentage::new(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero padding"),
            ))),
            border: BorderEdges {
                top: border,
                right: border,
                bottom: border,
                left: border,
            },
            border_radii: BorderRadii {
                top_left: radius,
                top_right: radius,
                bottom_right: radius,
                bottom_left: radius,
            },
            alignment_baseline: AlignmentBaseline::Baseline,
            baseline_source: BaselineSource::Auto,
            baseline_shift: BaselineShift::Offset(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero shift"),
            )),
        },
        paint: InlinePaintStyle {
            foreground: transparent(),
            opacity: UnitInterval::new(1.0).expect("opacity is bounded"),
            background: transparent().into(),
            background_image: None,
            transform: TransformList::none(),
            text_decoration: TextDecoration {
                lines: TextDecorationLines::new(false, false, false, false),
                style: TextDecorationStyle::Solid,
                color: transparent().into(),
            },
            text_shadows: Arc::from(Vec::new()),
            box_shadows: Arc::from(Vec::new()),
        },
    }
}

fn paragraph_tree(text: &str, indent_px: f32) -> (FormattingTree, String) {
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(0, tinos_style(indent_px))
        .expect("style interns");
    let nodes = vec![FormattingNode {
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
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds");
    (tree, text.to_owned())
}

fn line_texts(outcome: &LayoutOutcome, text: &str) -> Vec<String> {
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("inline outcome root is a box fragment");
    };
    root.children
        .iter()
        .map(|line| {
            let Fragment::Line(line) = line else {
                panic!("inline children are line fragments");
            };
            let mut cursor: Option<u32> = None;
            let mut start = u32::MAX;
            let mut end = 0_u32;
            for run in &line.children {
                let Fragment::Text(run) = run else {
                    panic!("line children are text fragments");
                };
                if let Some(previous_end) = cursor {
                    assert_eq!(
                        previous_end, run.text_start,
                        "run text ranges must tile the line without gaps"
                    );
                }
                cursor = Some(run.text_end);
                start = start.min(run.text_start);
                end = end.max(run.text_end);
            }
            assert!(start <= end, "lines carry at least one text fragment");
            text[start as usize..end as usize].to_owned()
        })
        .collect()
}

const SAMPLE: &str = "The quick brown fox jumps over the lazy dog and keeps \
running through the quiet forest until the morning light returns.";
