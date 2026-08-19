//! Compatibility adapter from the current JSON-shaped display provider.
//!
//! CSS-shaped strings and `serde_json::Value` are quarantined in this module;
//! neither appears in the owned V1 contract or its encoder.

use super::super::{DisplayCommand, DisplayTextCommandInput};
use super::{
    contract::{ReaderDisplayCommandV1, ReaderDisplayListV1, ReaderTextCommandV1},
    ReaderDisplayListWireError,
};

mod color;
mod paint;
mod value;

use paint::{
    adapt_block_paint, adapt_border_box, adapt_horizontal_rule_paint, adapt_page_paint,
    adapt_run_paint,
};
use value::{
    adapt_corner_radius, adapt_point, adapt_rect, adapt_size, adapt_transforms, finite_number,
    string,
};

pub(super) fn adapt(
    commands: &[DisplayCommand],
) -> Result<ReaderDisplayListV1, ReaderDisplayListWireError> {
    let commands = commands
        .iter()
        .map(adapt_command)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ReaderDisplayListV1 { commands })
}

fn adapt_command(
    command: &DisplayCommand,
) -> Result<ReaderDisplayCommandV1, ReaderDisplayListWireError> {
    Ok(match command {
        DisplayCommand::PushState => ReaderDisplayCommandV1::PushState,
        DisplayCommand::PopState => ReaderDisplayCommandV1::PopState,
        DisplayCommand::Translate { dx, dy } => ReaderDisplayCommandV1::Translate {
            dx: finite_number(dx, "translate.dx")?,
            dy: finite_number(dy, "translate.dy")?,
        },
        DisplayCommand::Opacity { value } => ReaderDisplayCommandV1::Opacity {
            value: finite(*value)?,
        },
        DisplayCommand::Transform {
            origin,
            box_value,
            transforms,
        } => ReaderDisplayCommandV1::Transform {
            origin: adapt_point(origin, "transform.origin")?,
            box_size: adapt_size(box_value, "transform.box")?,
            transforms: adapt_transforms(transforms)?,
        },
        DisplayCommand::ClipRect { rect, radius } => ReaderDisplayCommandV1::ClipRect {
            rect: adapt_rect(rect, "clipRect.rect")?,
            radius: radius
                .as_ref()
                .map(|value| adapt_corner_radius(value, "clipRect.radius"))
                .transpose()?,
        },
        DisplayCommand::PaintPage { rect, paint } => ReaderDisplayCommandV1::PaintPage {
            rect: adapt_rect(rect, "paintPage.rect")?,
            paint: adapt_page_paint(paint)?,
        },
        DisplayCommand::PaintBlock {
            rect,
            paint,
            border_box,
        } => ReaderDisplayCommandV1::PaintBlock {
            rect: adapt_rect(rect, "paintBlock.rect")?,
            paint: adapt_block_paint(paint)?,
            border_box: border_box.as_ref().map(adapt_border_box).transpose()?,
        },
        DisplayCommand::PaintText(input) => ReaderDisplayCommandV1::PaintText(adapt_text(input)?),
        DisplayCommand::PaintRuby(input) => ReaderDisplayCommandV1::PaintRuby(adapt_text(input)?),
        DisplayCommand::PaintImage {
            src,
            rect,
            alt,
            href,
            source_rect,
        } => ReaderDisplayCommandV1::PaintImage {
            src: src.clone(),
            rect: adapt_rect(rect, "paintImage.rect")?,
            alt: alt.clone(),
            href: href.clone(),
            source_rect: source_rect
                .as_ref()
                .map(|value| adapt_rect(value, "paintImage.sourceRect"))
                .transpose()?,
        },
        DisplayCommand::PaintHorizontalRule { rect, paint } => {
            ReaderDisplayCommandV1::PaintHorizontalRule {
                rect: adapt_rect(rect, "paintHorizontalRule.rect")?,
                paint: adapt_horizontal_rule_paint(paint)?,
            }
        }
    })
}

fn adapt_text(
    input: &DisplayTextCommandInput,
) -> Result<ReaderTextCommandV1, ReaderDisplayListWireError> {
    let source_text_offset = input
        .source_text_offset
        .map(u64::try_from)
        .transpose()
        .map_err(|_| ReaderDisplayListWireError::SourceTextOffsetOverflow)?;
    Ok(ReaderTextCommandV1 {
        text: string(&input.text, "text.text")?.to_owned(),
        rect: adapt_rect(&input.rect, "text.rect")?,
        paint: adapt_run_paint(&input.paint)?,
        line_height_px: input
            .line_height_px
            .as_ref()
            .map(|value| finite_number(value, "text.lineHeightPx"))
            .transpose()?,
        href: input.href.clone(),
        source_text: input
            .source_text
            .as_ref()
            .map(|value| string(value, "text.sourceText").map(str::to_owned))
            .transpose()?,
        source_text_offset,
        ruby_align: input
            .ruby_align
            .map(|align| align.as_str().to_owned()),
    })
}

fn finite(value: f64) -> Result<f64, ReaderDisplayListWireError> {
    value
        .is_finite()
        .then_some(value)
        .ok_or(ReaderDisplayListWireError::NonFiniteNumber)
}
