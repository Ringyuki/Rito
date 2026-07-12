use serde_json::json;

use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    line::{AtomRunBox, LineBox, LineRun, TextRunBox},
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
    visual_geometry::VisualRect,
};

pub(super) fn block(
    tag: &str,
    x: f64,
    y: f64,
    children: Vec<RuntimeChild<LineBox>>,
) -> RuntimeBlock<LineBox> {
    RuntimeBlock {
        x,
        y,
        width: 180.0,
        height: 36.0,
        semantic_tag: Some(tag.to_owned()),
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children,
    }
}

pub(super) fn line(runs: Vec<LineRun>) -> RuntimeChild<LineBox> {
    line_at(0.0, 0.0, runs)
}

pub(super) fn line_at(x: f64, y: f64, runs: Vec<LineRun>) -> RuntimeChild<LineBox> {
    RuntimeChild::Line(LineBox {
        x,
        y,
        width: 160.0,
        height: 18.0,
        runs,
    })
}

pub(super) fn text(value: &str, href: Option<&str>) -> LineRun {
    let mut run = text_at(value, 0.0, 0.0, value.len() as f64 * 8.0);
    if let LineRun::Text(text) = &mut run {
        text.href = href.map(str::to_owned);
    }
    run
}

pub(super) fn text_at(value: &str, x: f64, y: f64, width: f64) -> LineRun {
    LineRun::Text(TextRunBox {
        text: value.to_owned(),
        text_mapping: RunTextMapping::synthetic(),
        x,
        y,
        width,
        height: 12.0,
        font_size: 12.0,
        paint: json!({}),
        line_height_px: None,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        inline_margin_right: None,
        ruby_annotation: None,
        shape: fixture_run_shape(width),
    })
}

pub(super) fn atom(image_src: Option<&str>, alt: Option<&str>, href: Option<&str>) -> LineRun {
    LineRun::Atom(AtomRunBox {
        x: 0.0,
        y: 0.0,
        width: 20.0,
        height: 20.0,
        image_src: image_src.map(str::to_owned),
        alt: alt.map(str::to_owned),
        href: href.map(str::to_owned),
    })
}

pub(super) fn assert_rect(rect: &VisualRect, x: f64, y: f64, width: f64, height: f64) {
    const EPSILON: f64 = 1e-9;
    assert!((rect.x - x).abs() < EPSILON);
    assert!((rect.y - y).abs() < EPSILON);
    assert!((rect.width - width).abs() < EPSILON);
    assert!((rect.height - height).abs() < EPSILON);
}
