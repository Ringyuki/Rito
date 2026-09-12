//! Owned, renderer-neutral value types shared by the display list and the
//! `RITODL1` encoder. They contain no JSON values and no CSS token
//! strings: colours, lengths and keywords are typed at the source.

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

/// Where one cluster of a run paints: the origin of the cluster starting
/// at `byte` of the run's text, in CSS pixels. Spacing and justification
/// are already in it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderClusterV1 {
    pub byte: u32,
    pub x: f64,
    /// The cluster's paint anchor: the alphabetic baseline of a text run,
    /// the em-box top of an annotation.
    pub y: f64,
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
    pub clusters: Vec<ReaderClusterV1>,
}
