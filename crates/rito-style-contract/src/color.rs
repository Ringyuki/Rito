use crate::{FiniteF32, NumericError, UnitInterval};

/// An absolute CSS Color 4 color space.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum AbsoluteColorSpace {
    /// Gamma-encoded sRGB on a scale where `1.0 == 100%`; values are not clamped.
    Srgb,
    /// HSL as hue degrees followed by saturation/lightness percentage points.
    Hsl,
    /// HWB as hue degrees followed by whiteness/blackness percentage points.
    Hwb,
    /// CIE Lab using D50: lightness percentage points, then `a` and `b`.
    Lab,
    /// Polar CIE LCH using D50: lightness percentage points, chroma, hue degrees.
    Lch,
    /// Oklab: normalized lightness, then `a` and `b`.
    Oklab,
    /// Oklch: normalized lightness, chroma, hue degrees.
    Oklch,
    /// Linear sRGB on a scale where `1.0 == 100%`; values are not clamped.
    SrgbLinear,
    /// Display P3 on a scale where `1.0 == 100%`; values are not clamped.
    DisplayP3,
    /// Linear Display P3 where `1.0 == 100%`; values are not clamped.
    DisplayP3Linear,
    /// A98 RGB on a scale where `1.0 == 100%`; values are not clamped.
    A98Rgb,
    /// ProPhoto RGB on a scale where `1.0 == 100%`; values are not clamped.
    ProphotoRgb,
    /// Rec. 2020 RGB on a scale where `1.0 == 100%`; values are not clamped.
    Rec2020,
    /// CIE XYZ using D50 on a scale where `1.0` is reference white.
    XyzD50,
    /// CIE XYZ using D65 on a scale where `1.0` is reference white.
    XyzD65,
}

/// Flags preserving CSS `none` components independently of numeric storage.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ColorNoneFlags {
    /// Whether the first color-space component was `none`.
    pub component_0: bool,
    /// Whether the second color-space component was `none`.
    pub component_1: bool,
    /// Whether the third color-space component was `none`.
    pub component_2: bool,
    /// Whether the alpha component was `none`.
    pub alpha: bool,
}

impl ColorNoneFlags {
    /// Creates the four independent `none` flags.
    pub const fn new(component_0: bool, component_1: bool, component_2: bool, alpha: bool) -> Self {
        Self {
            component_0,
            component_1,
            component_2,
            alpha,
        }
    }
}

/// A paint-semantics-preserving absolute color for projection and interning.
///
/// Components remain in their declared color space; the contract does not
/// silently narrow wide-gamut colors to legacy sRGB. Structural equality also
/// retains the `none` flags and does not perform approximate cross-space color
/// conversion.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct AbsoluteColor {
    /// The color space that defines the three component meanings.
    space: AbsoluteColorSpace,
    /// Three finite components in the units documented by [`AbsoluteColorSpace`].
    components: [FiniteF32; 3],
    /// Alpha in the inclusive normalized range `0..=1`.
    alpha: UnitInterval,
    /// CSS `none` state for the components and alpha.
    none: ColorNoneFlags,
}

/// A computed paint color whose `currentColor` dependency remains symbolic.
///
/// Consumers resolve [`Self::CurrentColor`] against the element foreground at
/// used-value / paint time. Keeping that dependency symbolic lets inherited
/// shadow templates remain shared across elements with different foregrounds.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ComputedColorV1 {
    /// A color independent of the element foreground.
    Absolute(AbsoluteColor),
    /// The CSS `currentColor` keyword.
    CurrentColor,
}

impl ComputedColorV1 {
    /// Resolves the symbolic color for painting.
    pub const fn resolve(self, current_color: AbsoluteColor) -> AbsoluteColor {
        match self {
            Self::Absolute(color) => color,
            Self::CurrentColor => current_color,
        }
    }
}

impl From<AbsoluteColor> for ComputedColorV1 {
    fn from(value: AbsoluteColor) -> Self {
        Self::Absolute(value)
    }
}

impl AbsoluteColor {
    /// Validates finite raw components and constructs an absolute color.
    pub fn new(
        space: AbsoluteColorSpace,
        components: [f32; 3],
        alpha: f32,
        none: ColorNoneFlags,
    ) -> Result<Self, NumericError> {
        let [component_0, component_1, component_2] = components;
        let component_0 = if none.component_0 { 0.0 } else { component_0 };
        let component_1 = if none.component_1 { 0.0 } else { component_1 };
        let component_2 = if none.component_2 { 0.0 } else { component_2 };
        let alpha = UnitInterval::new(if none.alpha { 0.0 } else { alpha })?;
        Ok(Self {
            space,
            components: [
                FiniteF32::new(component_0)?,
                FiniteF32::new(component_1)?,
                FiniteF32::new(component_2)?,
            ],
            alpha,
            none,
        })
    }

    /// Returns the retained absolute color space.
    pub const fn space(self) -> AbsoluteColorSpace {
        self.space
    }

    /// Returns the canonical finite component triplet.
    pub const fn components(self) -> [FiniteF32; 3] {
        self.components
    }

    /// Returns the canonical alpha scalar.
    pub const fn alpha(self) -> UnitInterval {
        self.alpha
    }

    /// Returns the CSS missing-component flags.
    pub const fn none(self) -> ColorNoneFlags {
        self.none
    }
}

#[cfg(test)]
mod tests {
    use super::{AbsoluteColor, AbsoluteColorSpace, ColorNoneFlags};
    use crate::NumericError;

    #[test]
    fn absolute_color_rejects_alpha_outside_the_unit_interval() {
        let none = ColorNoneFlags::new(false, false, false, false);
        assert_eq!(
            AbsoluteColor::new(AbsoluteColorSpace::Srgb, [0.0; 3], 1.1, none),
            Err(NumericError::UnitIntervalOutOfRange)
        );
    }

    #[test]
    fn missing_components_have_one_canonical_numeric_representation() {
        let none = ColorNoneFlags::new(true, false, false, true);
        let first = AbsoluteColor::new(
            AbsoluteColorSpace::Srgb,
            [f32::NAN, 0.5, 0.25],
            f32::INFINITY,
            none,
        )
        .expect("missing components ignore their backing scalar");
        let second = AbsoluteColor::new(AbsoluteColorSpace::Srgb, [42.0, 0.5, 0.25], -10.0, none)
            .expect("missing components canonicalize to zero");
        assert_eq!(first, second);
        assert_eq!(first.components()[0].get(), 0.0);
        assert_eq!(first.alpha().get(), 0.0);
    }
}
