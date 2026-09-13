//! Owned, renderer-neutral value types shared by the display list and the
//! `RITODL1` encoder. They contain no JSON values and no CSS token
//! strings: colours, lengths and keywords are typed at the source.

mod geometry;
mod paint;

pub(crate) use geometry::{
    ReaderCornerRadius, ReaderLength, ReaderPoint, ReaderRect, ReaderSize, ReaderTransform,
};
pub(crate) use paint::{
    ReaderBackgroundPaint, ReaderBackgroundPosition, ReaderBackgroundRepeat, ReaderBackgroundSize,
    ReaderBlockBorder, ReaderBlockPaint, ReaderBlockRadius, ReaderBorderBox, ReaderBorderEdgePaint,
    ReaderBorderStyle, ReaderBoxShadow, ReaderColor, ReaderColorNoneFlags, ReaderColorSpace,
    ReaderFontPaint, ReaderFontStyle, ReaderHorizontalRulePaint, ReaderPagePaint, ReaderRunBorder,
    ReaderRunBorderEdge, ReaderRunDecoration, ReaderRunDecorationKind, ReaderRunPaint,
    ReaderSpacing, ReaderTextRunPaint, ReaderTextShadow,
};

/// Where one cluster of a run paints: the origin of the cluster starting
/// at `byte` of the run's text, in CSS pixels. Spacing and justification
/// are already in it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderCluster {
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
pub(crate) struct ReaderTextRun {
    pub text: String,
    pub rect: ReaderRect,
    pub paint: ReaderTextRunPaint,
    pub line_height_px: Option<f64>,
    pub href: Option<String>,
    pub source_text: Option<String>,
    pub source_text_offset: Option<u64>,
    pub clusters: Vec<ReaderCluster>,
}
