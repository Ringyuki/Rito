use crate::{CssPx, Percentage};

/// The representable linear subset of computed `<length-percentage>`.
///
/// This is deliberately not a full CSS math AST. Producers may project pure
/// lengths, pure percentages, and expressions proven equivalent to `px + %`.
/// They must fail closed for unresolved non-linear math such as
/// `min()`, `max()`, `clamp()`, or `round()`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LengthPercentage {
    /// A pure absolute length.
    Length(CssPx),
    /// A pure percentage.
    Percentage(Percentage),
    /// A producer-proven linear `length + percentage` expression.
    Linear {
        /// The absolute CSS-pixel term.
        length: CssPx,
        /// The percentage term, represented as a unit ratio.
        percentage: Percentage,
    },
}

impl LengthPercentage {
    /// Creates a producer-proven linear `length + percentage` expression.
    pub const fn linear(length: CssPx, percentage: Percentage) -> Self {
        Self::Linear { length, percentage }
    }
}

/// A `<length-percentage>` with CSS's non-negative range constraint retained.
///
/// The two expression terms may have opposite signs, so non-negativity cannot
/// be checked until the percentage basis is known. Consumers must clamp the
/// resolved used value according to the originating property's CSS rules.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct NonNegativeLengthPercentage(LengthPercentage);

impl NonNegativeLengthPercentage {
    /// Marks a computed expression as carrying a non-negative range constraint.
    pub const fn new(value: LengthPercentage) -> Self {
        Self(value)
    }

    /// Returns the unresolved length-percentage expression.
    pub const fn value(self) -> LengthPercentage {
        self.0
    }
}

/// A computed `<length-percentage> | auto` value.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LengthPercentageOrAuto {
    /// The `auto` keyword, whose used value is consumer-specific.
    Auto,
    /// An explicit length-percentage expression.
    Value(LengthPercentage),
}
