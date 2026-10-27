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

    /// The used value against a percentage `basis` in CSS px (a percentage
    /// term resolves to zero without one).
    pub fn resolve(self, basis: Option<f32>) -> f32 {
        let percent =
            |percentage: Percentage| basis.map_or(0.0, |basis| percentage.ratio() * basis);
        match self {
            Self::Length(length) => length.get(),
            Self::Percentage(percentage) => percent(percentage),
            Self::Linear { length, percentage } => length.get() + percent(percentage),
        }
    }

    /// Whether the value is zero at every basis.
    pub fn is_zero(self) -> bool {
        match self {
            Self::Length(length) => length.get() == 0.0,
            Self::Percentage(percentage) => percentage.ratio() == 0.0,
            Self::Linear { length, percentage } => length.get() == 0.0 && percentage.ratio() == 0.0,
        }
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
