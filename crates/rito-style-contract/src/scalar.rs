use std::{fmt, hash::Hash};

/// Error returned when a numeric value violates a contract invariant.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NumericError {
    /// The input was NaN or positive/negative infinity.
    NonFinite,
    /// The input was negative where the CSS value must be non-negative.
    Negative,
    /// A font weight was outside CSS Fonts' inclusive `1..=1000` range.
    FontWeightOutOfRange,
    /// A value was outside the inclusive unit interval `0..=1`.
    UnitIntervalOutOfRange,
    /// A font oblique angle was outside CSS Fonts' `-90..=90deg` range.
    FontObliqueAngleOutOfRange,
    /// Zero degrees is the canonical normal slant, not an oblique variant.
    ZeroFontObliqueAngle,
}

impl fmt::Display for NumericError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFinite => formatter.write_str("value must be finite"),
            Self::Negative => formatter.write_str("value must be non-negative"),
            Self::FontWeightOutOfRange => {
                formatter.write_str("font weight must be in the inclusive range 1..=1000")
            }
            Self::UnitIntervalOutOfRange => {
                formatter.write_str("value must be in the inclusive range 0..=1")
            }
            Self::FontObliqueAngleOutOfRange => {
                formatter.write_str("font oblique angle must be in the range -90..=90deg")
            }
            Self::ZeroFontObliqueAngle => {
                formatter.write_str("zero-degree font slant must use the normal variant")
            }
        }
    }
}

impl std::error::Error for NumericError {}

/// A finite `f32` with `-0.0` normalized to `0.0`.
///
/// Equality and hashing use the normalized IEEE-754 bits. Construction rejects
/// NaN and infinities, making bit equality reflexive and suitable for style
/// interning.
#[derive(Clone, Copy, Debug)]
pub struct FiniteF32(f32);

impl FiniteF32 {
    /// Validates and normalizes a floating-point value.
    pub fn new(value: f32) -> Result<Self, NumericError> {
        if !value.is_finite() {
            return Err(NumericError::NonFinite);
        }
        Ok(Self(if value == 0.0 { 0.0 } else { value }))
    }

    /// Returns the finite floating-point value.
    pub const fn get(self) -> f32 {
        self.0
    }

    /// Returns the normalized IEEE-754 representation used for equality.
    pub const fn to_bits(self) -> u32 {
        self.0.to_bits()
    }
}

impl TryFrom<f32> for FiniteF32 {
    type Error = NumericError;

    fn try_from(value: f32) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl PartialEq for FiniteF32 {
    fn eq(&self, other: &Self) -> bool {
        self.to_bits() == other.to_bits()
    }
}

impl Eq for FiniteF32 {}

impl Hash for FiniteF32 {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.to_bits().hash(state);
    }
}

/// A signed length measured in CSS reference pixels.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct CssPx(FiniteF32);

impl CssPx {
    /// Creates a finite CSS-pixel length.
    pub fn new(value: f32) -> Result<Self, NumericError> {
        FiniteF32::new(value).map(Self)
    }

    /// Returns the length in CSS pixels.
    pub const fn get(self) -> f32 {
        self.0.get()
    }

    /// Returns the underlying finite scalar.
    pub const fn finite(self) -> FiniteF32 {
        self.0
    }
}

impl From<FiniteF32> for CssPx {
    fn from(value: FiniteF32) -> Self {
        Self(value)
    }
}

/// A non-negative length measured in CSS reference pixels.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct NonNegativeCssPx(FiniteF32);

impl NonNegativeCssPx {
    /// Creates a finite, non-negative CSS-pixel length.
    pub fn new(value: f32) -> Result<Self, NumericError> {
        let value = FiniteF32::new(value)?;
        if value.get() < 0.0 {
            return Err(NumericError::Negative);
        }
        Ok(Self(value))
    }

    /// Returns the length in CSS pixels.
    pub const fn get(self) -> f32 {
        self.0.get()
    }

    /// Returns the underlying finite scalar.
    pub const fn finite(self) -> FiniteF32 {
        self.0
    }
}

/// A finite, non-negative unitless CSS number.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct NonNegativeNumber(FiniteF32);

impl NonNegativeNumber {
    /// Creates a finite, non-negative unitless number.
    pub fn new(value: f32) -> Result<Self, NumericError> {
        let value = FiniteF32::new(value)?;
        if value.get() < 0.0 {
            return Err(NumericError::Negative);
        }
        Ok(Self(value))
    }

    /// Returns the unitless number.
    pub const fn get(self) -> f32 {
        self.0.get()
    }
}

/// A finite CSS percentage stored as a unit ratio (`1.0 == 100%`).
///
/// Negative and above-100% values remain representable because many CSS
/// properties allow them. Property-specific contracts apply tighter ranges.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct Percentage(FiniteF32);

impl Percentage {
    /// Creates a percentage from a unit ratio (`0.5 == 50%`).
    pub fn from_ratio(value: f32) -> Result<Self, NumericError> {
        FiniteF32::new(value).map(Self)
    }

    /// Creates a percentage from percentage points (`50.0 == 50%`).
    pub fn from_percent(value: f32) -> Result<Self, NumericError> {
        Self::from_ratio(value / 100.0)
    }

    /// Returns the percentage as a unit ratio.
    pub const fn ratio(self) -> f32 {
        self.0.get()
    }

    /// Returns the value in percentage points.
    pub fn percent(self) -> f32 {
        self.ratio() * 100.0
    }
}

/// A finite scalar constrained to the inclusive unit interval `0..=1`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct UnitInterval(FiniteF32);

impl UnitInterval {
    /// Creates a finite scalar in the inclusive unit interval.
    pub fn new(value: f32) -> Result<Self, NumericError> {
        let value = FiniteF32::new(value)?;
        if !(0.0..=1.0).contains(&value.get()) {
            return Err(NumericError::UnitIntervalOutOfRange);
        }
        Ok(Self(value))
    }

    /// Returns the normalized scalar.
    pub const fn get(self) -> f32 {
        self.0.get()
    }
}

/// A finite CSS angle expressed in degrees.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct AngleDegrees(FiniteF32);

impl AngleDegrees {
    /// Creates a finite degree angle without modulo normalization.
    pub fn new(value: f32) -> Result<Self, NumericError> {
        FiniteF32::new(value).map(Self)
    }

    /// Returns the angle in degrees.
    pub const fn get(self) -> f32 {
        self.0.get()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{FiniteF32, NumericError};

    #[test]
    fn finite_value_rejects_nan_and_infinity() {
        assert_eq!(FiniteF32::new(f32::NAN), Err(NumericError::NonFinite));
        assert_eq!(FiniteF32::new(f32::INFINITY), Err(NumericError::NonFinite));
        assert_eq!(
            FiniteF32::new(f32::NEG_INFINITY),
            Err(NumericError::NonFinite)
        );
    }

    #[test]
    fn finite_value_normalizes_negative_zero_for_equality_and_hashing() {
        let negative = FiniteF32::new(-0.0).expect("negative zero is finite");
        let positive = FiniteF32::new(0.0).expect("positive zero is finite");
        assert_eq!(negative.to_bits(), 0.0_f32.to_bits());
        assert_eq!(negative, positive);

        let values = HashSet::from([negative, positive]);
        assert_eq!(values.len(), 1);
    }
}
