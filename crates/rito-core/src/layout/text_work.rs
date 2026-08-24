use std::num::NonZeroUsize;

/// Signals that resumable text work has exhausted the current quantum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::layout) struct TextWorkYield;

/// Upper bounds for text work performed by one layout quantum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::layout) struct TextWorkBudget {
    max_utf16_units: NonZeroUsize,
    max_atomic_operations: NonZeroUsize,
}

impl TextWorkBudget {
    pub(in crate::layout) const fn new(
        max_utf16_units: NonZeroUsize,
        max_atomic_operations: NonZeroUsize,
    ) -> Self {
        Self {
            max_utf16_units,
            max_atomic_operations,
        }
    }
}

/// Text operations that cannot yet be resumed partway through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::layout) enum AtomicTextOperationKind {
    InlineCollection,
    LineBreakScan,
    Hyphenation,
    Measure,
    Shape,
}

/// The result of reserving one indivisible text operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[must_use]
pub(in crate::layout) enum TextWorkPermitResult {
    Permit {
        kind: AtomicTextOperationKind,
        utf16_units: usize,
        oversized: bool,
    },
    Yield,
}

/// One quantum-wide meter shared by resumable and atomic text work.
#[derive(Debug)]
pub(in crate::layout) struct TextWorkMeter {
    max_utf16_units: usize,
    max_atomic_operations: usize,
    utf16_units_remaining: usize,
    atomic_operations_remaining: usize,
}

impl TextWorkMeter {
    pub(in crate::layout) fn new(budget: TextWorkBudget) -> Self {
        Self {
            max_utf16_units: budget.max_utf16_units.get(),
            max_atomic_operations: budget.max_atomic_operations.get(),
            utf16_units_remaining: budget.max_utf16_units.get(),
            atomic_operations_remaining: budget.max_atomic_operations.get(),
        }
    }

    /// Takes as much resumable character work as the current quantum allows.
    pub(in crate::layout) fn take_utf16_units(&mut self, requested: usize) -> usize {
        let taken = requested.min(self.utf16_units_remaining);
        self.utf16_units_remaining -= taken;
        #[cfg(any(test, feature = "bench-internals"))]
        crate::layout::bounded_work_probe::record_resumable_utf16(taken);
        taken
    }

    /// Reserves a complete atomic operation or asks the caller to yield.
    ///
    /// A single operation larger than the quantum's full character limit may
    /// run only before any other work. This escape hatch prevents livelock;
    /// ordinary requests that merely exceed the leftover allowance must wait
    /// for the next quantum.
    pub(in crate::layout) fn try_permit_atomic(
        &mut self,
        kind: AtomicTextOperationKind,
        utf16_units: usize,
    ) -> TextWorkPermitResult {
        if self.atomic_operations_remaining == 0 {
            #[cfg(any(test, feature = "bench-internals"))]
            crate::layout::bounded_work_probe::record_atomic_yield(kind, utf16_units);
            return TextWorkPermitResult::Yield;
        }

        if utf16_units <= self.utf16_units_remaining {
            self.atomic_operations_remaining -= 1;
            self.utf16_units_remaining -= utf16_units;
            #[cfg(any(test, feature = "bench-internals"))]
            crate::layout::bounded_work_probe::record_atomic_permit(kind, utf16_units, false);
            return TextWorkPermitResult::Permit {
                kind,
                utf16_units,
                oversized: false,
            };
        }

        if self.is_fresh() && utf16_units > self.max_utf16_units {
            self.atomic_operations_remaining -= 1;
            self.utf16_units_remaining = 0;
            #[cfg(any(test, feature = "bench-internals"))]
            crate::layout::bounded_work_probe::record_atomic_permit(kind, utf16_units, true);
            return TextWorkPermitResult::Permit {
                kind,
                utf16_units,
                oversized: true,
            };
        }

        #[cfg(any(test, feature = "bench-internals"))]
        crate::layout::bounded_work_probe::record_atomic_yield(kind, utf16_units);
        TextWorkPermitResult::Yield
    }

    #[cfg(test)]
    pub(in crate::layout) const fn utf16_units_remaining(&self) -> usize {
        self.utf16_units_remaining
    }

    #[cfg(test)]
    pub(in crate::layout) const fn atomic_operations_remaining(&self) -> usize {
        self.atomic_operations_remaining
    }

    pub(in crate::layout) const fn has_capacity(&self) -> bool {
        self.utf16_units_remaining > 0 && self.atomic_operations_remaining > 0
    }

    const fn is_fresh(&self) -> bool {
        self.utf16_units_remaining == self.max_utf16_units
            && self.atomic_operations_remaining == self.max_atomic_operations
    }
}

#[cfg(test)]
mod tests {
    use super::{AtomicTextOperationKind, TextWorkBudget, TextWorkMeter, TextWorkPermitResult};
    use std::num::NonZeroUsize;

    #[test]
    fn exact_fit_is_permitted_and_exhausts_both_limits() {
        let mut meter = meter(8, 1);

        assert_eq!(
            meter.try_permit_atomic(AtomicTextOperationKind::Measure, 8),
            permitted(AtomicTextOperationKind::Measure, 8, false)
        );
        assert_eq!(meter.utf16_units_remaining(), 0);
        assert_eq!(meter.atomic_operations_remaining(), 0);
    }

    #[test]
    fn exhausted_operation_limit_yields_without_spending_characters() {
        let mut meter = meter(8, 1);
        assert!(matches!(
            meter.try_permit_atomic(AtomicTextOperationKind::Measure, 2),
            TextWorkPermitResult::Permit { .. }
        ));

        assert_eq!(
            meter.try_permit_atomic(AtomicTextOperationKind::Shape, 1),
            TextWorkPermitResult::Yield
        );
        assert_eq!(meter.utf16_units_remaining(), 6);
    }

    #[test]
    fn request_larger_than_leftover_yields_instead_of_running_oversized() {
        let mut meter = meter(8, 3);
        assert!(matches!(
            meter.try_permit_atomic(AtomicTextOperationKind::Measure, 3),
            TextWorkPermitResult::Permit { .. }
        ));

        assert_eq!(
            meter.try_permit_atomic(AtomicTextOperationKind::Shape, 6),
            TextWorkPermitResult::Yield
        );
        assert_eq!(meter.utf16_units_remaining(), 5);
        assert_eq!(meter.atomic_operations_remaining(), 2);
    }

    #[test]
    fn fresh_quantum_permits_one_operation_larger_than_its_full_limit() {
        let mut meter = meter(8, 2);

        assert_eq!(
            meter.try_permit_atomic(AtomicTextOperationKind::LineBreakScan, 9),
            permitted(AtomicTextOperationKind::LineBreakScan, 9, true)
        );
        assert_eq!(meter.utf16_units_remaining(), 0);
        assert_eq!(meter.atomic_operations_remaining(), 1);
    }

    #[test]
    fn second_nonempty_operation_is_denied_after_oversized_escape() {
        let mut meter = meter(8, 2);
        assert!(matches!(
            meter.try_permit_atomic(AtomicTextOperationKind::LineBreakScan, 9),
            TextWorkPermitResult::Permit {
                oversized: true,
                ..
            }
        ));

        assert_eq!(
            meter.try_permit_atomic(AtomicTextOperationKind::Shape, 1),
            TextWorkPermitResult::Yield
        );
        assert_eq!(meter.atomic_operations_remaining(), 1);
    }

    #[test]
    fn character_work_takes_only_the_available_units() {
        let mut meter = meter(8, 1);

        assert_eq!(meter.take_utf16_units(3), 3);
        assert_eq!(meter.take_utf16_units(9), 5);
        assert_eq!(meter.take_utf16_units(1), 0);
        assert_eq!(meter.utf16_units_remaining(), 0);
        assert_eq!(meter.atomic_operations_remaining(), 1);
    }

    #[test]
    fn zero_length_character_take_keeps_quantum_fresh() {
        let mut meter = meter(8, 1);
        assert_eq!(meter.take_utf16_units(0), 0);

        assert_eq!(
            meter.try_permit_atomic(AtomicTextOperationKind::Shape, 9),
            permitted(AtomicTextOperationKind::Shape, 9, true)
        );
    }

    #[test]
    fn zero_length_atomic_operation_consumes_only_an_operation_slot() {
        let mut meter = meter(8, 2);

        assert_eq!(
            meter.try_permit_atomic(AtomicTextOperationKind::Measure, 0),
            permitted(AtomicTextOperationKind::Measure, 0, false)
        );
        assert_eq!(meter.utf16_units_remaining(), 8);
        assert_eq!(meter.atomic_operations_remaining(), 1);
        assert_eq!(
            meter.try_permit_atomic(AtomicTextOperationKind::Shape, 9),
            TextWorkPermitResult::Yield
        );
    }

    fn meter(max_utf16_units: usize, max_atomic_operations: usize) -> TextWorkMeter {
        TextWorkMeter::new(TextWorkBudget::new(
            non_zero(max_utf16_units),
            non_zero(max_atomic_operations),
        ))
    }

    fn non_zero(value: usize) -> NonZeroUsize {
        NonZeroUsize::new(value).expect("test budget is non-zero")
    }

    const fn permitted(
        kind: AtomicTextOperationKind,
        utf16_units: usize,
        oversized: bool,
    ) -> TextWorkPermitResult {
        TextWorkPermitResult::Permit {
            kind,
            utf16_units,
            oversized,
        }
    }
}
