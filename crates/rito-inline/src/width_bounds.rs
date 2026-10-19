//! The inline sizes a paragraph's lines hold for.
//!
//! Every decision that breaks a paragraph into lines compares a measured
//! advance against a limit that is the available inline size plus a fixed
//! offset (the fit tolerance, an indent, a float's insets). Each answer
//! therefore holds on one side of a threshold inline size, and a layout at
//! any inline size on the same side of every threshold makes every
//! decision the same way: its lines break, and stack, exactly alike. The
//! bounds record those thresholds while the paragraph is laid out, each
//! moved inward by a margin wider than the rounding between the inline
//! size and the limits derived from it, so a size inside them never
//! answers differently.

/// How far inside each threshold the bounds stay: limits are derived from
/// the inline size through `f32` sums, whose rounding at page widths is
/// some ten thousandths of a pixel.
const MARGIN: f64 = 1.0 / 256.0;

/// The inline sizes, `[lo, hi)`, at which every decision recorded so far
/// answers as it did at `inline_size`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct WidthBounds {
    inline_size: f64,
    lo: f64,
    hi: f64,
}

impl WidthBounds {
    pub(crate) fn new(inline_size: f64) -> Self {
        Self {
            inline_size,
            lo: f64::NEG_INFINITY,
            hi: f64::INFINITY,
        }
    }

    /// Whether `value` fits `limit` (`value <= limit`), where `limit` is
    /// the inline size plus an offset that does not depend on it, narrowing
    /// the bounds to the inline sizes that answer the same.
    pub(crate) fn fits(&mut self, value: f64, limit: f64) -> bool {
        let fits = value <= limit;
        self.record(value, limit, fits);
        fits
    }

    /// [`Self::fits`] on `f32` operands, compared in `f32`.
    pub(crate) fn fits_f32(&mut self, value: f32, limit: f32) -> bool {
        let fits = value <= limit;
        self.record(f64::from(value), f64::from(limit), fits);
        fits
    }

    /// Records that content measured `floor` fit `limit` and content
    /// measured `ceiling` did not, either bound possibly unbounded.
    pub(crate) fn fit_range(&mut self, floor: f64, ceiling: f64, limit: f64) {
        if floor.is_finite() {
            self.record(floor, limit, true);
        }
        if ceiling.is_finite() {
            self.record(ceiling, limit, false);
        }
    }

    /// Records a decision that no inline size but this one is known to
    /// answer alike.
    pub(crate) fn pin(&mut self) {
        self.lo = f64::INFINITY;
        self.hi = f64::NEG_INFINITY;
    }

    /// The bounds, when they hold the inline size they were recorded at.
    pub(crate) fn range(&self) -> Option<(f64, f64)> {
        (self.lo <= self.inline_size && self.inline_size < self.hi).then_some((self.lo, self.hi))
    }

    fn record(&mut self, value: f64, limit: f64, fits: bool) {
        // The inline size at which `value` meets the limit.
        let threshold = self.inline_size + (value - limit);
        if fits {
            self.lo = self.lo.max(threshold + MARGIN);
        } else {
            self.hi = self.hi.min(threshold - MARGIN);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::WidthBounds;

    #[test]
    fn decisions_bound_the_sizes_that_answer_alike() {
        // Laid out at 500 with a limit of 500 + 1/64.
        let mut bounds = WidthBounds::new(500.0);
        let limit = 500.0 + 1.0 / 64.0;
        assert!(bounds.fits(480.0, limit));
        assert!(!bounds.fits(512.0, limit));
        let (lo, hi) = bounds.range().expect("500 is inside");
        // 480 still fits from 480 − 1/64 on; 512 stops fitting below
        // 512 − 1/64.
        assert!(lo > 480.0 - 1.0 / 64.0 && lo < 480.0);
        assert!(hi < 512.0 - 1.0 / 64.0 && hi > 511.9);
    }

    #[test]
    fn a_size_on_a_threshold_holds_no_bounds() {
        let mut bounds = WidthBounds::new(500.0);
        bounds.fits(500.0, 500.0);
        assert_eq!(bounds.range(), None);
    }

    #[test]
    fn a_pinned_layout_holds_no_bounds() {
        let mut bounds = WidthBounds::new(500.0);
        bounds.pin();
        assert_eq!(bounds.range(), None);
    }
}
