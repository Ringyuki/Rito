use super::ReaderLengthV1;

#[allow(
    dead_code,
    reason = "RITODL1 freezes color-space tags before every typed provider emits each space"
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderColorSpaceV1 {
    Srgb,
    Hsl,
    Hwb,
    Lab,
    Lch,
    Oklab,
    Oklch,
    SrgbLinear,
    DisplayP3,
    DisplayP3Linear,
    A98Rgb,
    ProphotoRgb,
    Rec2020,
    XyzD50,
    XyzD65,
}

impl ReaderColorSpaceV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Srgb => 1,
            Self::Hsl => 2,
            Self::Hwb => 3,
            Self::Lab => 4,
            Self::Lch => 5,
            Self::Oklab => 6,
            Self::Oklch => 7,
            Self::SrgbLinear => 8,
            Self::DisplayP3 => 9,
            Self::DisplayP3Linear => 10,
            Self::A98Rgb => 11,
            Self::ProphotoRgb => 12,
            Self::Rec2020 => 13,
            Self::XyzD50 => 14,
            Self::XyzD65 => 15,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ReaderColorNoneFlagsV1 {
    pub component_0: bool,
    pub component_1: bool,
    pub component_2: bool,
    pub alpha: bool,
}

impl ReaderColorNoneFlagsV1 {
    pub(crate) const fn bits(self) -> u8 {
        self.component_0 as u8
            | ((self.component_1 as u8) << 1)
            | ((self.component_2 as u8) << 2)
            | ((self.alpha as u8) << 3)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderColorV1 {
    pub space: ReaderColorSpaceV1,
    pub components: [f32; 3],
    pub alpha: f32,
    pub none: ReaderColorNoneFlagsV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderFontStyleV1 {
    Normal,
    Italic,
}

impl ReaderFontStyleV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Normal => 1,
            Self::Italic => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderBorderStyleV1 {
    None,
    Hidden,
    Dotted,
    Dashed,
    Solid,
    Double,
    Groove,
    Ridge,
    Inset,
    Outset,
}

impl ReaderBorderStyleV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::None => 1,
            Self::Hidden => 2,
            Self::Dotted => 3,
            Self::Dashed => 4,
            Self::Solid => 5,
            Self::Double => 6,
            Self::Groove => 7,
            Self::Ridge => 8,
            Self::Inset => 9,
            Self::Outset => 10,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ReaderBackgroundSizeV1 {
    Auto,
    Cover,
    Contain,
    /// CSS `background-size` with explicit axes (`auto 40%`, `100% 100%`).
    /// A `None` axis is `auto`: it derives from the image's intrinsic
    /// ratio once the other axis resolves.
    Explicit {
        x: Option<ReaderLengthV1>,
        y: Option<ReaderLengthV1>,
    },
}

impl ReaderBackgroundSizeV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Auto => 1,
            Self::Cover => 2,
            Self::Contain => 3,
            Self::Explicit { .. } => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderBackgroundRepeatV1 {
    Repeat,
    NoRepeat,
    RepeatX,
    RepeatY,
    Space,
    Round,
}

impl ReaderBackgroundRepeatV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Repeat => 1,
            Self::NoRepeat => 2,
            Self::RepeatX => 3,
            Self::RepeatY => 4,
            Self::Space => 5,
            Self::Round => 6,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderRunDecorationKindV1 {
    Underline,
    LineThrough,
}

impl ReaderRunDecorationKindV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Underline => 1,
            Self::LineThrough => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderBackgroundPositionV1 {
    pub x: ReaderLengthV1,
    pub y: ReaderLengthV1,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderBackgroundPaintV1 {
    pub color: Option<ReaderColorV1>,
    pub image: Option<String>,
    pub size: Option<ReaderBackgroundSizeV1>,
    pub repeat: Option<ReaderBackgroundRepeatV1>,
    pub position: Option<ReaderBackgroundPositionV1>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderBorderEdgePaintV1 {
    pub color: ReaderColorV1,
    pub style: ReaderBorderStyleV1,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct ReaderBlockBorderV1 {
    pub top: Option<ReaderBorderEdgePaintV1>,
    pub right: Option<ReaderBorderEdgePaintV1>,
    pub bottom: Option<ReaderBorderEdgePaintV1>,
    pub left: Option<ReaderBorderEdgePaintV1>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ReaderBlockRadiusV1 {
    Px(f64),
    Percent(f64),
    /// Circular corner radii in CSS order (top-left, top-right,
    /// bottom-right, bottom-left) for boxes whose corners disagree.
    Corners([f64; 4]),
}

impl ReaderBlockRadiusV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Px(_) => 1,
            Self::Percent(_) => 2,
            Self::Corners(_) => 3,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderBoxShadowV1 {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur: f64,
    pub spread: f64,
    pub color: ReaderColorV1,
    pub inset: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderBlockPaintV1 {
    pub background: Option<ReaderBackgroundPaintV1>,
    pub border: Option<ReaderBlockBorderV1>,
    pub radius: Option<ReaderBlockRadiusV1>,
    pub box_shadows: Vec<ReaderBoxShadowV1>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderBorderBoxV1 {
    pub top_width: f64,
    pub right_width: f64,
    pub bottom_width: f64,
    pub left_width: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderPagePaintV1 {
    pub background_color: Option<ReaderColorV1>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderFontPaintV1 {
    pub family: String,
    pub size_px: f64,
    pub weight: f64,
    pub style: ReaderFontStyleV1,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderTextShadowV1 {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur: f64,
    pub color: ReaderColorV1,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderRunDecorationV1 {
    pub kind: ReaderRunDecorationKindV1,
    pub y: f64,
    pub thickness: f64,
    pub color: ReaderColorV1,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderSpacingV1 {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderRunBorderEdgeV1 {
    pub width_px: f64,
    pub paint: ReaderBorderEdgePaintV1,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct ReaderRunBorderV1 {
    pub top: Option<ReaderRunBorderEdgeV1>,
    pub bottom: Option<ReaderRunBorderEdgeV1>,
    pub start: Option<ReaderRunBorderEdgeV1>,
    pub end: Option<ReaderRunBorderEdgeV1>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderRunPaintV1 {
    pub font: ReaderFontPaintV1,
    pub color: ReaderColorV1,
    pub word_spacing_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub background_color: Option<ReaderColorV1>,
    pub background_radius: Option<f64>,
    pub text_shadows: Vec<ReaderTextShadowV1>,
    pub decoration: Option<ReaderRunDecorationV1>,
    pub padding: Option<ReaderSpacingV1>,
    pub border: Option<ReaderRunBorderV1>,
    /// Engine-computed inline box top/bottom, relative to the run rect
    /// top. Absent when the run carries no box paint; the renderer then
    /// derives extents from font metrics.
    pub box_offsets: Option<(f64, f64)>,
    /// Whether this run opens/closes its inline box. A run split across
    /// lines squares the split ends: rounding and start/end borders
    /// apply only where the box actually opens or closes.
    pub box_start: bool,
    pub box_end: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderHorizontalRulePaintV1 {
    pub color: ReaderColorV1,
    pub style: ReaderBorderStyleV1,
}
