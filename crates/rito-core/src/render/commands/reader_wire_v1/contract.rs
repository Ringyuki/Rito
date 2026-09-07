//! Owned, renderer-neutral command contract encoded by `RITODL1`.
//!
//! These types deliberately contain no JSON values and no CSS token strings.
//! The legacy display-list provider is converted at the adapter boundary
//! before the primary wire encoder sees a command.

mod geometry;
mod paint;

pub(crate) use geometry::{
    ReaderCornerRadiusV1, ReaderLengthV1, ReaderPointV1, ReaderRectV1, ReaderSizeV1,
    ReaderTransformV1,
};
pub(crate) use paint::{
    ReaderBackgroundPaintV1, ReaderBackgroundPositionV1, ReaderBackgroundRepeatV1,
    ReaderBackgroundSizeV1, ReaderBlockBorderV1, ReaderBlockPaintV1, ReaderBlockRadiusV1,
    ReaderBorderBoxV1, ReaderBorderEdgePaintV1, ReaderBorderStyleV1, ReaderBoxShadowV1,
    ReaderColorNoneFlagsV1, ReaderColorSpaceV1, ReaderColorV1, ReaderFontPaintV1,
    ReaderFontStyleV1, ReaderHorizontalRulePaintV1, ReaderPagePaintV1, ReaderRunBorderEdgeV1,
    ReaderRunBorderV1, ReaderRunDecorationKindV1, ReaderRunDecorationV1, ReaderRunPaintV1,
    ReaderSpacingV1, ReaderTextRunPaintV1, ReaderTextShadowV1,
};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderDisplayListV1 {
    pub commands: Vec<ReaderDisplayCommandV1>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ReaderDisplayCommandV1 {
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
        origin: ReaderPointV1,
        box_size: ReaderSizeV1,
        transforms: Vec<ReaderTransformV1>,
    },
    ClipRect {
        rect: ReaderRectV1,
        radius: Option<ReaderCornerRadiusV1>,
    },
    PaintPage {
        rect: ReaderRectV1,
        paint: ReaderPagePaintV1,
    },
    PaintBlock {
        rect: ReaderRectV1,
        paint: ReaderBlockPaintV1,
        border_box: Option<ReaderBorderBoxV1>,
    },
    PaintText(ReaderTextCommandV1),
    PaintRuby(ReaderTextCommandV1),
    PaintImage {
        src: String,
        rect: ReaderRectV1,
        alt: Option<String>,
        href: Option<String>,
        source_rect: Option<ReaderRectV1>,
    },
    PaintHorizontalRule {
        rect: ReaderRectV1,
        paint: ReaderHorizontalRulePaintV1,
    },
}
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderTextCommandV1 {
    pub text: String,
    pub rect: ReaderRectV1,
    pub paint: ReaderRunPaintV1,
    pub line_height_px: Option<f64>,
    pub href: Option<String>,
    pub source_text: Option<String>,
    pub source_text_offset: Option<u64>,
    pub ruby_align: Option<String>,
    /// Right-aligned draw: `rect.x` is the text's RIGHT edge and the
    /// renderer measures the string to place the pen (outside list
    /// markers, whose width only the host's text stack can measure).
    pub align_right: bool,
    /// Vertical writing: the renderer draws the string as one downward
    /// column with `rect.x` the column's left edge and `rect.y` the first
    /// glyph's top.
    pub vertical: bool,
}

/// The text run the wire carries (opcodes 12 and 13): the run stripped to
/// what the renderer rasters, in CSS pixels. Its inline box and decoration
/// line have lowered to primitives around it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderTextRunV1 {
    pub text: String,
    pub rect: ReaderRectV1,
    pub paint: ReaderTextRunPaintV1,
    pub line_height_px: Option<f64>,
    pub href: Option<String>,
    pub source_text: Option<String>,
    pub source_text_offset: Option<u64>,
    pub ruby_align: Option<String>,
    pub align_right: bool,
    pub vertical: bool,
}
