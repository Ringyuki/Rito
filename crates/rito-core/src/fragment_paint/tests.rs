//! Paint-walk tests: the shared fixtures (a two-item flow, a boxed line,
//! plain text runs) and one module per painted feature.

mod boxes;
mod fail_closed;
mod family_policy;
mod images;
mod ruby;
mod rules;
mod text_runs;
mod vertical_columns;

use super::*;
use crate::render::contract::{
    ReaderBlockPaint, ReaderBorderStyle, ReaderPoint, ReaderRect, ReaderTransform,
};
use crate::render::test_support::css_color;
use crate::render::{display_number, display_rect, DisplayTextCommand};

use rito_fragment::{
    BoxFragment, FormattingNode, FormattingNodeId, FormattingTreeStyles, FragmentRect,
};
use rito_fragment::{FormattingNodeContent, ImageFragment, InlineItem, LineFragment, TextFragment};
use rito_inline::plain_paragraph_style;
use rito_style_contract::{AbsoluteColor, InlineFormattingStyle, LengthPercentage};
use rito_style_contract::{
    AbsoluteColorSpace, ColorNoneFlags, FontFamilies, FontFamily, FontFamilyName, InlineStyleTable,
    LayoutStyleId, LayoutStyleTable, StyleId, UnitInterval,
};

fn srgb(red: f32, green: f32, blue: f32, alpha: f32) -> AbsoluteColor {
    AbsoluteColor::new(
        AbsoluteColorSpace::Srgb,
        [red, green, blue],
        alpha,
        ColorNoneFlags::new(false, false, false, false),
    )
    .expect("test color is finite")
}

fn body_style(foreground: AbsoluteColor) -> InlineFormattingStyle {
    let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
        .expect("family list is non-empty");
    let mut style = plain_paragraph_style(families, 16.0, 0.0);
    style.paint.foreground = foreground;
    style.paint.background = srgb(0.0, 0.0, 0.0, 0.0).into();
    style
}

struct FlowFixture {
    tree: FormattingTree,
}

/// Two-item flow — "Red " in red then "black." in black — so tests can
/// exercise per-item paint boundaries inside one line.
fn two_color_flow(build: impl FnOnce(StyleId, StyleId) -> Vec<InlineItem>) -> FlowFixture {
    let mut inline = InlineStyleTable::new(2);
    let red = inline
        .intern_for_node(0, body_style(srgb(1.0, 0.0, 0.0, 1.0)))
        .expect("red style interns");
    let black = inline
        .intern_for_node(1, body_style(srgb(0.0, 0.0, 0.0, 1.0)))
        .expect("black style interns");
    let items = build(red, black);
    let nodes = vec![FormattingNode {
        style: LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow { items },
        children: Vec::new(),
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("tree builds");
    FlowFixture { tree }
}

fn text_item(text: &str, style: StyleId, shift: f64) -> InlineItem {
    InlineItem::Text {
        text: text.to_owned(),
        style,
        baseline_shift_px: shift,
        ruby_annotation: None,
    }
}

fn text_run(x: f64, width: f64, start: u32, end: u32) -> Fragment {
    Fragment::Text(TextFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x,
            y: 0.0,
            width,
            height: 0.0,
        },
        text_start: start,
        text_end: end,
        box_snap: None,
        font_grid: None,
        ruby_center_shift_px: 0.0,
        justify_px: 0.0,
        ruby_gap_px: 0.0,
        opener_trim_px: 0.0,
        ruby_overhang_px: 0.0,
        ruby_overhang_right_px: 0.0,
        clusters: Vec::new(),
        cluster_grid: false,
    })
}

fn boxed_line(children: Vec<Fragment>) -> Fragment {
    Fragment::Box(BoxFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 20.0,
        },
        children: vec![Fragment::Line(LineFragment {
            source: FormattingNodeId(0),
            marker: None,
            rect: FragmentRect {
                x: 4.0,
                y: 6.0,
                width: 70.0,
                height: 20.0,
            },
            baseline: 13.0,
            trailing_whitespace: 0.0,
            ruby_growth: 0.0,
            children,
        })],
    })
}

fn paint(tree: &FormattingTree, root: &Fragment) -> Vec<DisplayCommand> {
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        tree,
        root,
        0.0,
        0.0,
        FragmentPaintContext::default(),
    )
    .expect("fragments paint");
    commands
}
