//! Scaling of the text run the lowering hands through unresolved: every CSS
//! pixel length becomes device pixels; colours and styles stay.

use super::super::commands::contract::{
    ReaderFontPaintV1, ReaderRectV1, ReaderRunBorderEdgeV1, ReaderRunBorderV1,
    ReaderRunDecorationV1, ReaderRunPaintV1, ReaderSpacingV1, ReaderTextCommandV1,
    ReaderTextShadowV1,
};

pub(super) fn text_command(text: &ReaderTextCommandV1, ratio: f64) -> ReaderTextCommandV1 {
    ReaderTextCommandV1 {
        text: text.text.clone(),
        rect: rect(&text.rect, ratio),
        paint: run_paint(&text.paint, ratio),
        line_height_px: text.line_height_px.map(|value| value * ratio),
        href: text.href.clone(),
        source_text: text.source_text.clone(),
        source_text_offset: text.source_text_offset,
        ruby_align: text.ruby_align.clone(),
    }
}

fn rect(rect: &ReaderRectV1, ratio: f64) -> ReaderRectV1 {
    ReaderRectV1 {
        x: rect.x * ratio,
        y: rect.y * ratio,
        width: rect.width * ratio,
        height: rect.height * ratio,
    }
}

fn run_paint(paint: &ReaderRunPaintV1, ratio: f64) -> ReaderRunPaintV1 {
    ReaderRunPaintV1 {
        font: ReaderFontPaintV1 {
            family: paint.font.family.clone(),
            size_px: paint.font.size_px * ratio,
            weight: paint.font.weight,
            style: paint.font.style,
        },
        color: paint.color,
        word_spacing_px: paint.word_spacing_px.map(|value| value * ratio),
        letter_spacing_px: paint.letter_spacing_px.map(|value| value * ratio),
        background_color: paint.background_color,
        background_radius: paint.background_radius.map(|value| value * ratio),
        text_shadows: paint
            .text_shadows
            .iter()
            .map(|shadow| ReaderTextShadowV1 {
                offset_x: shadow.offset_x * ratio,
                offset_y: shadow.offset_y * ratio,
                blur: shadow.blur * ratio,
                color: shadow.color,
            })
            .collect(),
        decoration: paint.decoration.map(|decoration| ReaderRunDecorationV1 {
            kind: decoration.kind,
            y: decoration.y * ratio,
            thickness: decoration.thickness * ratio,
            color: decoration.color,
        }),
        padding: paint.padding.map(|padding| spacing(padding, ratio)),
        border: paint.border.map(|border| run_border(border, ratio)),
        box_offsets: paint
            .box_offsets
            .map(|(top, bottom)| (top * ratio, bottom * ratio)),
        box_start: paint.box_start,
        box_end: paint.box_end,
    }
}

fn spacing(spacing: ReaderSpacingV1, ratio: f64) -> ReaderSpacingV1 {
    ReaderSpacingV1 {
        top: spacing.top * ratio,
        right: spacing.right * ratio,
        bottom: spacing.bottom * ratio,
        left: spacing.left * ratio,
    }
}

fn run_border(border: ReaderRunBorderV1, ratio: f64) -> ReaderRunBorderV1 {
    let edge = |edge: Option<ReaderRunBorderEdgeV1>| {
        edge.map(|edge| ReaderRunBorderEdgeV1 {
            width_px: edge.width_px * ratio,
            paint: edge.paint,
        })
    };
    ReaderRunBorderV1 {
        top: edge(border.top),
        bottom: edge(border.bottom),
        start: edge(border.start),
        end: edge(border.end),
    }
}
