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
    /// `None` means unfragmented (continuous) layout.
    pub fragmentainer_remaining: Option<f64>,
    /// Total block size of one fragmentainer, for resumed fragments. CSS px.
    pub fragmentainer_size: Option<f64>,
}

impl ConstraintSpace {
    /// Continuous, unfragmented layout at the given inline size.
    pub fn continuous(inline_size: f64) -> Self {
        Self {
            inline_size,
            fragmentainer_remaining: None,
            fragmentainer_size: None,
        }
    }

    /// Fragmented layout with a full fragmentainer available.
    pub fn fragmented(inline_size: f64, fragmentainer_size: f64) -> Self {
        Self {
            inline_size,
            fragmentainer_remaining: Some(fragmentainer_size),
            fragmentainer_size: Some(fragmentainer_size),
        }
    }
}
