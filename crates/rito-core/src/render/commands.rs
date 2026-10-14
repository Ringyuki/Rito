use super::RunPaint;

mod reader_wire;
mod refs;
#[cfg(test)]
pub(crate) mod test_support;

#[cfg(test)]
pub(crate) use reader_wire::READER_PRIMITIVE_LIST_FORMAT_VERSION;
pub(crate) use reader_wire::{contract, encode_reader_primitive_list};
pub(crate) use refs::summarize_display_list_resource_refs;

use contract::{
    ReaderBlockPaint, ReaderBorderBox, ReaderCornerRadius, ReaderHorizontalRulePaint,
    ReaderPagePaint, ReaderPoint, ReaderRect, ReaderSize, ReaderTransform,
};

/// One command of a frame's display list, in CSS pixels. The painter
/// emits these from the fragment tree; the lowering resolves them to
/// device-pixel primitives, which the wire encodes and the hosts blit.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DisplayCommand {
    PushState,
    PopState,
    Translate {
        dx: f64,
        dy: f64,
    },
    Opacity {
        value: f64,
    },
    Transform {
        origin: ReaderPoint,
        box_size: ReaderSize,
        transforms: Vec<ReaderTransform>,
    },
    ClipRect {
        rect: ReaderRect,
        radius: Option<ReaderCornerRadius>,
    },
    PaintPage {
        rect: ReaderRect,
        paint: ReaderPagePaint,
    },
    PaintBlock {
        rect: ReaderRect,
        paint: ReaderBlockPaint,
        border_box: Option<ReaderBorderBox>,
    },
    PaintText(DisplayTextCommand),
    PaintRuby(DisplayTextCommand),
    PaintImage {
        src: String,
        rect: ReaderRect,
        alt: Option<String>,
        href: Option<String>,
        source_rect: Option<ReaderRect>,
    },
    PaintHorizontalRule {
        rect: ReaderRect,
        paint: ReaderHorizontalRulePaint,
    },
}

/// A painted text run or ruby annotation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DisplayTextCommand {
    pub text: String,
    pub rect: ReaderRect,
    pub paint: RunPaint,
    pub line_height_px: Option<f64>,
    pub href: Option<String>,
    pub source_text: Option<String>,
    pub source_text_offset: Option<u64>,
    /// Where each cluster of the text paints, in text order: byte offset
    /// into `text` and the absolute CSS origin the pen draws it at — its
    /// alphabetic baseline, for a text run and an annotation alike.
    /// Empty only for a run the renderer still places itself.
    pub clusters: Vec<(u32, f64, f64)>,
}

impl DisplayCommand {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "opacity lowers to the wire and both pens paint it, but fragment paint does not emit it yet"
        )
    )]
    pub(crate) fn opacity(value: f64) -> Self {
        Self::Opacity { value }
    }

    pub(crate) fn paint_image(
        src: String,
        rect: ReaderRect,
        alt: Option<String>,
        href: Option<String>,
    ) -> Self {
        Self::PaintImage {
            src,
            rect,
            alt,
            href,
            source_rect: None,
        }
    }

    /// An image command that samples only `source_rect` (raster pixels)
    /// — the clamp-bleed strip an svg letterbox smears across its sliver.
    pub(crate) fn paint_image_slice(
        src: String,
        rect: ReaderRect,
        source_rect: ReaderRect,
    ) -> Self {
        Self::PaintImage {
            src,
            rect,
            alt: None,
            href: None,
            source_rect: Some(source_rect),
        }
    }
}

/// A display coordinate rounded to six decimals: every 1/64 LayoutUnit
/// position exactly, float noise from the paint arithmetic removed.
///
/// Three decimals proved too coarse for text positions: a run x of
/// 840.65625 shipped as 840.656, pulling every glyph 0.00025px below its
/// LayoutUnit position — invisible everywhere except characters whose
/// position lands exactly on a quarter-pixel raster tie (fraction 1/8,
/// 3/8, 5/8, 7/8), where the browser rounds the exact value UP and the
/// depressed value rounded DOWN, flipping the glyph one raster bucket
/// left on a ~125px page lattice (measured: restoring the lost 0.00025
/// made the engine's canvas replay bit-identical to the browser's page).
pub(crate) fn display_number(value: f64) -> f64 {
    (value * 1e6).round() / 1e6
}

/// A command rectangle with every edge at display precision.
pub(crate) fn display_rect(x: f64, y: f64, width: f64, height: f64) -> ReaderRect {
    ReaderRect {
        x: display_number(x),
        y: display_number(y),
        width: display_number(width),
        height: display_number(height),
    }
}

#[cfg(test)]
mod tests;
