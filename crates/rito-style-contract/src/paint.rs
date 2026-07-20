use std::{fmt, sync::Arc};

use crate::{
    AbsoluteColor, ComputedColorV1, CssPx, LengthPercentage, NonNegativeCssPx, TransformListV1,
    UnitInterval, RESOLVED_URL_BYTE_LIMIT_V1,
};

/// Error returned when a resolved URL violates the bounded V1 contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResolvedUrlErrorV1 {
    /// A computed URL must contain a non-empty absolute URL.
    Empty,
    /// The value does not begin with an RFC 3986 URL scheme.
    NotAbsolute,
    /// The UTF-8 representation exceeded the V1 resource guard.
    ByteLimitExceeded {
        /// Actual UTF-8 byte length.
        byte_len: usize,
        /// Maximum accepted UTF-8 byte length.
        limit: usize,
    },
}

impl fmt::Display for ResolvedUrlErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("resolved URL must not be empty"),
            Self::NotAbsolute => formatter.write_str("resolved URL must be absolute"),
            Self::ByteLimitExceeded { byte_len, limit } => {
                write!(
                    formatter,
                    "resolved URL has {byte_len} bytes; limit is {limit}"
                )
            }
        }
    }
}

impl std::error::Error for ResolvedUrlErrorV1 {}

/// A bounded absolute URL already resolved against its owning stylesheet.
///
/// This type deliberately retains an opaque serialized URL. Publication-path
/// policy and resource lookup belong to the consumer, not this engine-neutral
/// computed-value contract.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ResolvedUrlV1(Arc<str>);

impl ResolvedUrlV1 {
    /// Validates and owns one serialized absolute URL.
    pub fn new(value: impl AsRef<str>) -> Result<Self, ResolvedUrlErrorV1> {
        let value = value.as_ref();
        if value.is_empty() {
            return Err(ResolvedUrlErrorV1::Empty);
        }
        if value.len() > RESOLVED_URL_BYTE_LIMIT_V1 {
            return Err(ResolvedUrlErrorV1::ByteLimitExceeded {
                byte_len: value.len(),
                limit: RESOLVED_URL_BYTE_LIMIT_V1,
            });
        }
        if !has_absolute_url_scheme(value) {
            return Err(ResolvedUrlErrorV1::NotAbsolute);
        }
        Ok(Self(Arc::from(value)))
    }

    /// Returns the resolved URL serialization.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn storage_identity(&self) -> usize {
        self.0.as_ptr() as usize
    }
}

fn has_absolute_url_scheme(value: &str) -> bool {
    let Some((scheme, _)) = value.split_once(':') else {
        return false;
    };
    let mut bytes = scheme.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
}

/// Supported computed `background-size` values for a URL image.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BackgroundImageSizeV1 {
    /// Intrinsic image dimensions (`auto auto`).
    Auto,
    /// Fill the positioning area while preserving aspect ratio.
    Cover,
    /// Fit inside the positioning area while preserving aspect ratio.
    Contain,
}

/// Supported computed `background-repeat` behavior for a URL image.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BackgroundImageRepeatV1 {
    /// Tile the image on both axes (the CSS initial value).
    Repeat,
    /// Paint one image without tiling either axis.
    NoRepeat,
}

/// Physical computed position for one background URL image.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct BackgroundImagePositionV1 {
    /// Horizontal offset in CSS pixels or positioning-area percentage.
    pub x: LengthPercentage,
    /// Vertical offset in CSS pixels or positioning-area percentage.
    pub y: LengthPercentage,
}

/// One fully coupled, single-layer background URL image.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct BackgroundImagePaintV1 {
    /// Absolute URL resolved by the CSS engine against the owning stylesheet.
    pub url: ResolvedUrlV1,
    /// Supported image sizing mode.
    pub size: BackgroundImageSizeV1,
    /// Supported image repetition mode.
    pub repeat: BackgroundImageRepeatV1,
    /// Physical image position.
    pub position: BackgroundImagePositionV1,
}

/// Computed border line style.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BorderStyle {
    /// No border is painted.
    None,
    /// A hidden border, significant for border conflict resolution.
    Hidden,
    /// A dotted line.
    Dotted,
    /// A dashed line.
    Dashed,
    /// A solid line.
    Solid,
    /// Two parallel solid lines.
    Double,
    /// A carved groove effect.
    Groove,
    /// A raised ridge effect.
    Ridge,
    /// An inset bevel effect.
    Inset,
    /// An outset bevel effect.
    Outset,
}

/// Width and paint data for one physical border edge.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct BorderEdge {
    /// Resolved width after `none` / `hidden` paint suppression.
    pub resolved_width: NonNegativeCssPx,
    /// The computed border style.
    pub style: BorderStyle,
    /// The computed border color with `currentColor` retained symbolically.
    pub color: ComputedColorV1,
}

/// Four physical border edges before writing-mode mapping by a consumer.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct BorderEdges {
    /// Top edge.
    pub top: BorderEdge,
    /// Right edge.
    pub right: BorderEdge,
    /// Bottom edge.
    pub bottom: BorderEdge,
    /// Left edge.
    pub left: BorderEdge,
}

/// Independent line flags for `text-decoration-line`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct TextDecorationLines {
    /// Draw an underline.
    pub underline: bool,
    /// Draw an overline.
    pub overline: bool,
    /// Draw a line through the text.
    pub line_through: bool,
    /// Retain the legacy CSS `blink` request for explicit consumer policy.
    pub blink: bool,
}

impl TextDecorationLines {
    /// Creates the four independently composable decoration flags.
    pub const fn new(underline: bool, overline: bool, line_through: bool, blink: bool) -> Self {
        Self {
            underline,
            overline,
            line_through,
            blink,
        }
    }

    /// Reports whether no decoration line is requested.
    pub const fn is_empty(self) -> bool {
        !self.underline && !self.overline && !self.line_through && !self.blink
    }
}

/// Stroke style used by text decorations.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TextDecorationStyle {
    /// A single solid stroke.
    Solid,
    /// Two solid strokes.
    Double,
    /// A dotted stroke.
    Dotted,
    /// A dashed stroke.
    Dashed,
    /// A wavy stroke.
    Wavy,
    /// Servo's internal `-moz-none` computed value.
    MozNone,
}

/// Computed text-decoration paint state.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct TextDecoration {
    /// Independently composable decoration lines.
    pub lines: TextDecorationLines,
    /// Shared stroke style for the decoration lines.
    pub style: TextDecorationStyle,
    /// Computed decoration color with `currentColor` retained symbolically.
    pub color: ComputedColorV1,
}

/// One computed text shadow.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct TextShadow {
    /// Horizontal offset.
    pub offset_x: CssPx,
    /// Vertical offset.
    pub offset_y: CssPx,
    /// Non-negative CSS shadow blur radius.
    pub blur_radius: NonNegativeCssPx,
    /// Computed shadow color with `currentColor` retained symbolically.
    pub color: ComputedColorV1,
}

/// One computed box shadow retained as a reusable paint foundation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct BoxShadow {
    /// Horizontal offset.
    pub offset_x: CssPx,
    /// Vertical offset.
    pub offset_y: CssPx,
    /// Non-negative CSS shadow blur radius.
    pub blur_radius: NonNegativeCssPx,
    /// Signed spread radius.
    pub spread_radius: CssPx,
    /// Computed shadow color with `currentColor` retained symbolically.
    pub color: ComputedColorV1,
    /// Whether this is an inset shadow.
    pub inset: bool,
}

/// Foreground and inline paint inputs consumed after text layout.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct InlinePaintStyleV1 {
    /// Computed foreground color.
    pub foreground: AbsoluteColor,
    /// Computed element-group opacity in the inclusive unit interval.
    pub opacity: UnitInterval,
    /// Computed background color with `currentColor` retained symbolically.
    pub background: ComputedColorV1,
    /// A coupled single-layer URL background, absent for computed `none`.
    pub background_image: Option<BackgroundImagePaintV1>,
    /// Ordered visual transforms; an empty list represents computed `none`.
    pub transform: TransformListV1,
    /// This element's own computed text-decoration longhands.
    ///
    /// Decoration propagation follows the CSS box tree, not the source-node
    /// ancestor chain, and therefore belongs in layout/box construction.
    pub text_decoration: TextDecoration,
    /// Ordered text-shadow list; the first shadow is painted on top.
    pub text_shadows: Arc<[TextShadow]>,
    /// Ordered box-shadow list; the first shadow is painted on top.
    pub box_shadows: Arc<[BoxShadow]>,
}

#[cfg(test)]
mod tests {
    use super::{ResolvedUrlErrorV1, ResolvedUrlV1};
    use crate::RESOLVED_URL_BYTE_LIMIT_V1;

    #[test]
    fn resolved_url_requires_an_absolute_bounded_value() {
        assert_eq!(ResolvedUrlV1::new(""), Err(ResolvedUrlErrorV1::Empty));
        assert_eq!(
            ResolvedUrlV1::new("../Images/cover.jpg"),
            Err(ResolvedUrlErrorV1::NotAbsolute)
        );
        assert_eq!(
            ResolvedUrlV1::new("https://example.test/Images/cover.jpg")
                .unwrap()
                .as_str(),
            "https://example.test/Images/cover.jpg"
        );
    }

    #[test]
    fn resolved_url_budget_counts_utf8_bytes() {
        let oversized = format!(
            "https://example.test/{}",
            "x".repeat(RESOLVED_URL_BYTE_LIMIT_V1)
        );
        assert_eq!(
            ResolvedUrlV1::new(oversized.as_str()),
            Err(ResolvedUrlErrorV1::ByteLimitExceeded {
                byte_len: oversized.len(),
                limit: RESOLVED_URL_BYTE_LIMIT_V1,
            })
        );
    }
}
