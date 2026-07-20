use std::{fmt, sync::Arc};

use crate::{AngleDegrees, FiniteF32, NonNegativeCssPx, NonNegativeNumber, NumericError};

/// A concrete font-family name after CSS token/string parsing.
///
/// The wrapper preserves the engine-provided spelling. It does not parse CSS
/// syntax or perform platform-dependent family matching.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum FontFamilyNameSyntax {
    /// The author supplied a CSS string, such as `"Book Face"`.
    Quoted,
    /// The author supplied one or more CSS identifiers, such as `Book Face`.
    Identifiers,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct FontFamilyName {
    name: Arc<str>,
    syntax: FontFamilyNameSyntax,
}

impl FontFamilyName {
    /// Wraps an already parsed family name.
    pub fn new(name: impl Into<Box<str>>) -> Self {
        Self::with_syntax(name, FontFamilyNameSyntax::Identifiers)
    }

    /// Wraps an already parsed family name while retaining its CSS syntax.
    pub fn with_syntax(name: impl Into<Box<str>>, syntax: FontFamilyNameSyntax) -> Self {
        let name: Box<str> = name.into();
        Self {
            name: Arc::from(name),
            syntax,
        }
    }

    /// Returns the family name.
    pub fn as_str(&self) -> &str {
        &self.name
    }

    /// Returns whether the computed family originated as a string or identifiers.
    pub fn syntax(&self) -> FontFamilyNameSyntax {
        self.syntax
    }
}

/// A generic CSS font family supported by Rito's engine-neutral contract.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum GenericFontFamily {
    /// A serif family.
    Serif,
    /// A sans-serif family.
    SansSerif,
    /// A fixed-pitch family.
    Monospace,
    /// A cursive family.
    Cursive,
    /// A decorative fantasy family.
    Fantasy,
    /// The platform user-interface family.
    SystemUi,
}

/// One entry in a computed font-family fallback list.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum FontFamily {
    /// A concrete family name.
    Named(FontFamilyName),
    /// A generic family resolved by the platform font database.
    Generic(GenericFontFamily),
}

/// Error returned when a font-family list violates its contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FontFamilyError {
    /// CSS computed font-family lists must contain at least one entry.
    Empty,
}

impl fmt::Display for FontFamilyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("font-family list must not be empty")
    }
}

impl std::error::Error for FontFamilyError {}

/// An ordered, non-empty computed font-family fallback list.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct FontFamilies(Arc<[FontFamily]>);

impl FontFamilies {
    /// Creates a non-empty family list in CSS fallback order.
    pub fn new(families: Vec<FontFamily>) -> Result<Self, FontFamilyError> {
        if families.is_empty() {
            return Err(FontFamilyError::Empty);
        }
        Ok(Self(Arc::from(families)))
    }

    /// Returns the family list in CSS fallback order.
    pub fn as_slice(&self) -> &[FontFamily] {
        &self.0
    }

    /// Iterates over families in CSS fallback order.
    pub fn iter(&self) -> std::slice::Iter<'_, FontFamily> {
        self.0.iter()
    }

    pub(crate) fn storage_identity(&self) -> usize {
        self.0.as_ptr() as usize
    }
}

/// A numeric computed CSS font weight in the inclusive `1..=1000` range.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct FontWeight(FiniteF32);

impl FontWeight {
    /// Creates a validated numeric font weight.
    pub fn new(value: f32) -> Result<Self, NumericError> {
        let value = FiniteF32::new(value)?;
        if !(1.0..=1000.0).contains(&value.get()) {
            return Err(NumericError::FontWeightOutOfRange);
        }
        Ok(Self(value))
    }

    /// Returns the numeric font weight.
    pub const fn get(self) -> f32 {
        self.0.get()
    }
}

/// A computed CSS font slant.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum FontSlant {
    /// Upright glyphs.
    Normal,
    /// A font's italic face.
    Italic,
    /// An oblique face with its computed angle retained.
    Oblique(FontObliqueAngle),
}

/// A non-zero computed oblique angle in CSS Fonts' `-90..=90deg` range.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct FontObliqueAngle(AngleDegrees);

impl FontObliqueAngle {
    /// Creates a canonical oblique angle.
    pub fn new(value: f32) -> Result<Self, NumericError> {
        let value = AngleDegrees::new(value)?;
        if value.get() == 0.0 {
            return Err(NumericError::ZeroFontObliqueAngle);
        }
        if !(-90.0..=90.0).contains(&value.get()) {
            return Err(NumericError::FontObliqueAngleOutOfRange);
        }
        Ok(Self(value))
    }

    /// Returns the oblique angle in degrees.
    pub const fn degrees(self) -> f32 {
        self.0.get()
    }
}

/// A computed line-height that retains keyword, number, and length semantics.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LineHeight {
    /// The `normal` keyword; font metrics determine the used value.
    Normal,
    /// A unitless multiplier inherited as a number.
    Number(NonNegativeNumber),
    /// An absolute computed length inherited as a length.
    Length(NonNegativeCssPx),
}

#[cfg(test)]
mod tests {
    use super::{FontFamilies, FontFamilyError, FontObliqueAngle, FontWeight};
    use crate::NumericError;

    #[test]
    fn font_family_list_is_non_empty() {
        assert_eq!(FontFamilies::new(Vec::new()), Err(FontFamilyError::Empty));
    }

    #[test]
    fn font_weight_uses_css_range() {
        assert!(FontWeight::new(1.0).is_ok());
        assert!(FontWeight::new(1000.0).is_ok());
        assert_eq!(
            FontWeight::new(0.0),
            Err(NumericError::FontWeightOutOfRange)
        );
    }

    #[test]
    fn oblique_angle_has_one_canonical_nonzero_range() {
        assert_eq!(
            FontObliqueAngle::new(0.0),
            Err(NumericError::ZeroFontObliqueAngle)
        );
        assert_eq!(
            FontObliqueAngle::new(91.0),
            Err(NumericError::FontObliqueAngleOutOfRange)
        );
        assert_eq!(FontObliqueAngle::new(-12.5).unwrap().degrees(), -12.5);
    }
}
