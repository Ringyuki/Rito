use super::super::transform::{next_word_boundary, ScalarMapping, TransformMode};
use super::preflight::{PaintPlan, TransformCounts};
use crate::layout::text_work::{
    AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield,
};

#[derive(Debug)]
pub(super) struct PendingTextAssembly {
    counts: TransformCounts,
    plan: PaintPlan,
    mode: TransformMode,
    reserve_step: ReserveStep,
    byte_cursor: usize,
    scalar: Option<PendingScalar>,
    at_word_boundary: bool,
    logical: Option<String>,
    painted: Option<String>,
    logical_capacity: usize,
    painted_capacity: usize,
    logical_utf16: usize,
    painted_utf16: usize,
    contextual_lowercase_resolved: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReserveStep {
    Logical,
    Painted,
    Complete,
}

#[derive(Debug)]
struct PendingScalar {
    character: char,
    utf16_units_remaining: usize,
}

#[derive(Debug)]
pub(super) struct AssembledText {
    pub(super) logical: String,
    pub(super) painted: String,
}

impl PendingTextAssembly {
    pub(super) fn new(
        counts: TransformCounts,
        plan: PaintPlan,
        mode: TransformMode,
        byte_start: usize,
    ) -> Self {
        Self {
            counts,
            plan,
            mode,
            reserve_step: ReserveStep::Logical,
            byte_cursor: byte_start,
            scalar: None,
            at_word_boundary: true,
            logical: None,
            painted: None,
            logical_capacity: 0,
            painted_capacity: 0,
            logical_utf16: 0,
            painted_utf16: 0,
            contextual_lowercase_resolved: false,
        }
    }

    pub(super) fn advance(
        &mut self,
        source: &str,
        work: &mut TextWorkMeter,
    ) -> Result<Option<AssembledText>, TextWorkYield> {
        self.reserve(work)?;
        while self.byte_cursor < source.len() || self.scalar.is_some() {
            self.prepare_scalar(source);
            let scalar = self.scalar.as_mut().expect("an assembly scalar exists");
            let taken = work.take_utf16_units(scalar.utf16_units_remaining);
            scalar.utf16_units_remaining -= taken;
            if scalar.utf16_units_remaining != 0 {
                return Err(TextWorkYield);
            }
            self.commit_scalar();
        }
        self.resolve_contextual_lowercase(work)?;
        self.verify_complete();
        Ok(Some(AssembledText {
            logical: self.logical.take().expect("logical text was reserved"),
            painted: self.painted.take().expect("painted text was assembled"),
        }))
    }

    fn reserve(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        loop {
            match self.reserve_step {
                ReserveStep::Logical => {
                    admit_reserve(work, self.counts.logical_utf16)?;
                    let logical = String::with_capacity(self.counts.logical_bytes);
                    self.logical_capacity = logical.capacity();
                    self.logical = Some(logical);
                    self.reserve_step = if self.plan == PaintPlan::ContextualLowercase {
                        ReserveStep::Complete
                    } else {
                        ReserveStep::Painted
                    };
                }
                ReserveStep::Painted => {
                    admit_reserve(work, self.counts.painted_utf16(self.plan))?;
                    let painted = String::with_capacity(self.counts.painted_bytes(self.plan));
                    self.painted_capacity = painted.capacity();
                    self.painted = Some(painted);
                    self.reserve_step = ReserveStep::Complete;
                }
                ReserveStep::Complete => return Ok(()),
            }
        }
    }

    fn prepare_scalar(&mut self, source: &str) {
        if self.scalar.is_some() {
            return;
        }
        let character = source[self.byte_cursor..]
            .chars()
            .next()
            .expect("the assembly cursor precedes source end");
        self.scalar = Some(PendingScalar {
            character,
            utf16_units_remaining: character.len_utf16(),
        });
    }

    fn commit_scalar(&mut self) {
        let character = self
            .scalar
            .take()
            .expect("a fully paid assembly scalar exists")
            .character;
        checked_add(&mut self.byte_cursor, character.len_utf8());
        self.logical
            .as_mut()
            .expect("logical text was reserved")
            .push(character);
        checked_add(&mut self.logical_utf16, character.len_utf16());
        debug_assert_eq!(
            self.logical
                .as_ref()
                .expect("logical text exists")
                .capacity(),
            self.logical_capacity,
            "exact logical preflight must prevent buffer growth"
        );

        match self.plan {
            PaintPlan::IdentityFallback => self.push_painted(character),
            PaintPlan::ScalarMapping => {
                for mapped in ScalarMapping::new(self.mode, character, self.at_word_boundary) {
                    self.push_painted(mapped);
                }
            }
            PaintPlan::ContextualLowercase => {}
        }
        self.at_word_boundary = next_word_boundary(character);
    }

    fn push_painted(&mut self, character: char) {
        self.painted
            .as_mut()
            .expect("ordinary painted text was reserved")
            .push(character);
        checked_add(&mut self.painted_utf16, character.len_utf16());
        debug_assert_eq!(
            self.painted
                .as_ref()
                .expect("ordinary painted text exists")
                .capacity(),
            self.painted_capacity,
            "exact painted preflight must prevent buffer growth"
        );
    }

    fn resolve_contextual_lowercase(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if self.plan != PaintPlan::ContextualLowercase || self.contextual_lowercase_resolved {
            return Ok(());
        }
        // `str::to_lowercase` applies Unicode Final_Sigma using surrounding
        // cased and case-ignorable scalars. Its allocation remains one paid
        // atomic residual; ordinary transforms use exact reserved assembly.
        if matches!(
            work.try_permit_atomic(
                AtomicTextOperationKind::InlineCollection,
                self.counts.logical_utf16,
            ),
            TextWorkPermitResult::Yield
        ) {
            return Err(TextWorkYield);
        }
        let painted = self
            .logical
            .as_deref()
            .expect("contextual lowercase has assembled logical text")
            .to_lowercase();
        debug_assert_eq!(painted.len(), self.counts.transformed_bytes);
        debug_assert_eq!(
            painted.encode_utf16().count(),
            self.counts.transformed_utf16
        );
        self.painted_utf16 = self.counts.transformed_utf16;
        self.painted = Some(painted);
        self.contextual_lowercase_resolved = true;
        Ok(())
    }

    fn verify_complete(&self) {
        let logical = self.logical.as_ref().expect("logical text was reserved");
        let painted = self.painted.as_ref().expect("painted text was assembled");
        debug_assert_eq!(logical.len(), self.counts.logical_bytes);
        debug_assert_eq!(self.logical_utf16, self.counts.logical_utf16);
        debug_assert_eq!(painted.len(), self.counts.painted_bytes(self.plan));
        debug_assert_eq!(self.painted_utf16, self.counts.painted_utf16(self.plan));
        debug_assert_eq!(logical.capacity(), self.logical_capacity);
        if self.plan != PaintPlan::ContextualLowercase {
            debug_assert_eq!(painted.capacity(), self.painted_capacity);
        }
    }
}

fn admit_reserve(work: &mut TextWorkMeter, utf16_units: usize) -> Result<(), TextWorkYield> {
    if matches!(
        work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, utf16_units),
        TextWorkPermitResult::Yield
    ) {
        Err(TextWorkYield)
    } else {
        Ok(())
    }
}

fn checked_add(target: &mut usize, value: usize) {
    *target = target
        .checked_add(value)
        .expect("inline transform sizes must fit in usize");
}
