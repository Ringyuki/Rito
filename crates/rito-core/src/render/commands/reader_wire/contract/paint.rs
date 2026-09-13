use super::ReaderLength;

#[allow(
    dead_code,
    reason = "RITODL1 freezes color-space tags before every typed provider emits each space"
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderColorSpace {
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

impl ReaderColorSpace {
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

    /// The space's CSS name, as a JSON decoder spells it.
    #[cfg(test)]
    pub(crate) const fn tag_name(self) -> &'static str {
        match self {
            Self::Srgb => "srgb",
            Self::Hsl => "hsl",
            Self::Hwb => "hwb",
            Self::Lab => "lab",
            Self::Lch => "lch",
            Self::Oklab => "oklab",
            Self::Oklch => "oklch",
            Self::SrgbLinear => "srgb-linear",
            Self::DisplayP3 => "display-p3",
            Self::DisplayP3Linear => "display-p3-linear",
            Self::A98Rgb => "a98-rgb",
            Self::ProphotoRgb => "prophoto-rgb",
            Self::Rec2020 => "rec2020",
            Self::XyzD50 => "xyz-d50",
            Self::XyzD65 => "xyz-d65",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ReaderColorNoneFlags {
    pub component_0: bool,
    pub component_1: bool,
    pub component_2: bool,
    pub alpha: bool,
}

impl ReaderColorNoneFlags {
    pub(crate) const fn bits(self) -> u8 {
        self.component_0 as u8
            | ((self.component_1 as u8) << 1)
            | ((self.component_2 as u8) << 2)
            | ((self.alpha as u8) << 3)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderColor {
    pub space: ReaderColorSpace,
    pub components: [f32; 3],
    pub alpha: f32,
    pub none: ReaderColorNoneFlags,
}

impl ReaderColor {
    pub(crate) const BLACK: Self = Self::srgb8(0, 0, 0, 1.0);
    pub(crate) const WHITE: Self = Self::srgb8(0xff, 0xff, 0xff, 1.0);

    /// An sRGB colour from 8-bit channels, the way a browser stores a
    /// legacy `#rrggbb` / `rgba()` value.
    pub(crate) const fn srgb8(red: u8, green: u8, blue: u8, alpha: f32) -> Self {
        Self {
            space: ReaderColorSpace::Srgb,
            components: [
                red as f32 / 255.0,
                green as f32 / 255.0,
                blue as f32 / 255.0,
            ],
            alpha,
            none: ReaderColorNoneFlags {
                component_0: false,
                component_1: false,
                component_2: false,
                alpha: false,
            },
        }
    }

    /// The 8-bit sRGB channels of an opaque sRGB colour, `None` for a
    /// translucent one or another colour space.
    pub(crate) fn opaque_srgb8(self) -> Option<[u8; 3]> {
        if self.space != ReaderColorSpace::Srgb || self.alpha != 1.0 || self.none.alpha {
            return None;
        }
        Some(
            self.components
                .map(|component| (component.clamp(0.0, 1.0) * 255.0).round() as u8),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderFontStyle {
    Normal,
    Italic,
}

impl ReaderFontStyle {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Normal => 1,
            Self::Italic => 2,
        }
    }

    #[cfg(test)]
    pub(crate) const fn tag_name(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Italic => "italic",
        }
    }
}

#[allow(
    dead_code,
    reason = "RITODL1 freezes the border-style tags before the painter emits every style"
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderBorderStyle {
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ReaderBackgroundSize {
    Auto,
    Cover,
    Contain,
    /// CSS `background-size` with explicit axes (`auto 40%`, `100% 100%`).
    /// A `None` axis is `auto`: it derives from the image's intrinsic
    /// ratio once the other axis resolves.
    Explicit {
        x: Option<ReaderLength>,
        y: Option<ReaderLength>,
    },
}
#[allow(
    dead_code,
    reason = "RITODL1 freezes the background-repeat tags before the style projection emits every value"
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderBackgroundRepeat {
    Repeat,
    NoRepeat,
    RepeatX,
    RepeatY,
    Space,
    Round,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReaderRunDecorationKind {
    Underline,
    LineThrough,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderBackgroundPosition {
    pub x: ReaderLength,
    pub y: ReaderLength,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ReaderBackgroundPaint {
    pub color: Option<ReaderColor>,
    pub image: Option<String>,
    pub size: Option<ReaderBackgroundSize>,
    pub repeat: Option<ReaderBackgroundRepeat>,
    pub position: Option<ReaderBackgroundPosition>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderBorderEdgePaint {
    pub color: ReaderColor,
    pub style: ReaderBorderStyle,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct ReaderBlockBorder {
    pub top: Option<ReaderBorderEdgePaint>,
    pub right: Option<ReaderBorderEdgePaint>,
    pub bottom: Option<ReaderBorderEdgePaint>,
    pub left: Option<ReaderBorderEdgePaint>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ReaderBlockRadius {
    Px(f64),
    Percent(f64),
    /// Circular corner radii in CSS order (top-left, top-right,
    /// bottom-right, bottom-left) for boxes whose corners disagree.
    Corners([f64; 4]),
}
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderBoxShadow {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur: f64,
    pub spread: f64,
    pub color: ReaderColor,
    pub inset: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ReaderBlockPaint {
    pub background: Option<ReaderBackgroundPaint>,
    pub border: Option<ReaderBlockBorder>,
    pub radius: Option<ReaderBlockRadius>,
    pub box_shadows: Vec<ReaderBoxShadow>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderBorderBox {
    pub top_width: f64,
    pub right_width: f64,
    pub bottom_width: f64,
    pub left_width: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderPagePaint {
    pub background_color: Option<ReaderColor>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderFontPaint {
    pub family: String,
    pub size_px: f64,
    pub weight: f64,
    pub style: ReaderFontStyle,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderTextShadow {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur: f64,
    pub color: ReaderColor,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderRunDecoration {
    pub kind: ReaderRunDecorationKind,
    pub y: f64,
    pub thickness: f64,
    pub color: ReaderColor,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderSpacing {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderRunBorderEdge {
    pub width_px: f64,
    pub paint: ReaderBorderEdgePaint,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct ReaderRunBorder {
    pub top: Option<ReaderRunBorderEdge>,
    pub bottom: Option<ReaderRunBorderEdge>,
    pub start: Option<ReaderRunBorderEdge>,
    pub end: Option<ReaderRunBorderEdge>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderRunPaint {
    pub font: ReaderFontPaint,
    pub color: ReaderColor,
    pub word_spacing_px: Option<f64>,
    pub letter_spacing_px: Option<f64>,
    pub background_color: Option<ReaderColor>,
    pub background_radius: Option<f64>,
    pub text_shadows: Vec<ReaderTextShadow>,
    pub decoration: Option<ReaderRunDecoration>,
    pub padding: Option<ReaderSpacing>,
    pub border: Option<ReaderRunBorder>,
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

impl Default for ReaderRunPaint {
    /// Black 16px upright regular text in the UA serif, no box paint.
    fn default() -> Self {
        Self {
            font: ReaderFontPaint {
                family: "serif".to_owned(),
                size_px: 16.0,
                weight: 400.0,
                style: ReaderFontStyle::Normal,
            },
            color: ReaderColor::BLACK,
            word_spacing_px: None,
            letter_spacing_px: None,
            background_color: None,
            background_radius: None,
            text_shadows: Vec::new(),
            decoration: None,
            padding: None,
            border: None,
            box_offsets: None,
            box_start: true,
            box_end: true,
        }
    }
}

/// The paint a text run carries onto the wire: what a renderer needs to
/// raster its glyphs. The run's inline box (background band, padding,
/// border edges) and its decoration line lower to primitives around the
/// run and never reach the renderer as run paint.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReaderTextRunPaint {
    pub font: ReaderFontPaint,
    pub color: ReaderColor,
    pub text_shadows: Vec<ReaderTextShadow>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderHorizontalRulePaint {
    pub color: ReaderColor,
    pub style: ReaderBorderStyle,
}
