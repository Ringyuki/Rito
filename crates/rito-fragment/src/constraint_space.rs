/// Typed layout constraints for one formatting-context invocation.
///
/// A constraint space is a pure value: equal spaces plus an equal tree and
/// break token must produce byte-equal fragments, which is what makes
/// input-keyed fragment caching sound.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ConstraintSpace {
    /// Available inline-axis size in CSS px.
    pub inline_size: f64,
    /// Remaining block-axis space in the current fragmentainer, in CSS px.
    /// `None` means unfragmented (continuous) layout; this field alone
    /// decides whether an invocation may fragment.
    pub fragmentainer_remaining: Option<f64>,
    /// Total block size of one fragmentainer, in CSS px. Present without
    /// `fragmentainer_remaining`, it is pure context: the layout stays
    /// continuous but describes content that page-sized fragmentainers
    /// will slice, which reader semantics (such as scaling a replaced
    /// image down to one page) need to know about.
    pub fragmentainer_size: Option<f64>,
    /// Inline space floats withhold from the top of this layout. Line
    /// boxes inside the band are narrowed and offset; content below it
    /// uses the full inline size, exactly as CSS floats shorten line
    /// boxes rather than displacing the block box.
    pub float_band: Option<FloatBand>,
}

/// One band of float exclusion at the top of a layout's block axis.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FloatBand {
    /// Inline space withheld on the line-left side.
    pub left_inset: f64,
    /// Inline space withheld on the line-right side.
    pub right_inset: f64,
    /// Block-axis extent of the band, measured from this layout's origin.
    pub bottom: f64,
}

impl ConstraintSpace {
    /// Continuous, unfragmented layout at the given inline size.
    pub fn continuous(inline_size: f64) -> Self {
        Self {
            inline_size,
            fragmentainer_remaining: None,
            fragmentainer_size: None,
            float_band: None,
        }
    }

    /// Fragmented layout with a full fragmentainer available.
    pub fn fragmented(inline_size: f64, fragmentainer_size: f64) -> Self {
        Self {
            inline_size,
            fragmentainer_remaining: Some(fragmentainer_size),
            fragmentainer_size: Some(fragmentainer_size),
            float_band: None,
        }
    }
}
