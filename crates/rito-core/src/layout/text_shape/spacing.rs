use super::{RunShape, RunShapeUnavailableReason};
use crate::layout::text_work::{TextWorkMeter, TextWorkYield};

mod cursor;

use cursor::{ClusterSpacingOutcome, PendingClusterSpacing, PendingScalarCount};

#[cfg(test)]
use cursor::{reset_scalar_visits, scalar_visits};

#[derive(Debug)]
pub(in crate::layout) struct PendingShapeSpacing {
    word_spacing_delta: f64,
    letter_spacing_delta: f64,
    expected_advance: f64,
    known_spacing_gaps: Option<usize>,
    stage: ShapeSpacingStage,
}

#[derive(Debug)]
enum ShapeSpacingStage {
    Initialize,
    CheckSafety(PendingScalarCount),
    Apply(PendingClusterSpacing),
    Complete,
}

impl PendingShapeSpacing {
    pub(in crate::layout) fn new(
        word_spacing_delta: f64,
        letter_spacing_delta: f64,
        expected_advance: f64,
        known_spacing_gaps: Option<usize>,
    ) -> Self {
        Self {
            word_spacing_delta,
            letter_spacing_delta,
            expected_advance,
            known_spacing_gaps,
            stage: ShapeSpacingStage::Initialize,
        }
    }

    pub(in crate::layout) fn advance(
        &mut self,
        shape: &mut RunShape,
        text: &str,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        loop {
            match &mut self.stage {
                ShapeSpacingStage::Initialize => self.initialize(shape, text),
                ShapeSpacingStage::CheckSafety(count) => {
                    count.advance(text, work)?;
                    let scalar_gaps = count.scalar_count().saturating_sub(1);
                    self.finish_safety_check(shape, text, scalar_gaps);
                }
                ShapeSpacingStage::Apply(spacing) => {
                    let RunShape::Exact(exact) = shape else {
                        unreachable!("only exact shapes retain cluster spacing state")
                    };
                    let outcome = spacing.advance(
                        &mut exact.clusters,
                        text,
                        self.word_spacing_delta,
                        self.letter_spacing_delta,
                        work,
                    )?;
                    if outcome == ClusterSpacingOutcome::Unsafe {
                        self.mark_unsafe(shape);
                    } else {
                        exact.advance = self.expected_advance;
                        self.stage = ShapeSpacingStage::Complete;
                    }
                }
                ShapeSpacingStage::Complete => return Ok(()),
            }
        }
    }

    fn initialize(&mut self, shape: &mut RunShape, text: &str) {
        let RunShape::Exact(exact) = shape else {
            let RunShape::Unavailable(unavailable) = shape else {
                unreachable!()
            };
            unavailable.advance = self.expected_advance;
            self.stage = ShapeSpacingStage::Complete;
            return;
        };
        if self.letter_spacing_delta == 0.0 {
            self.stage = ShapeSpacingStage::Apply(PendingClusterSpacing::new(exact, text));
            return;
        }
        if let Some(spacing_gaps) = self.known_spacing_gaps {
            self.finish_safety_check(shape, text, spacing_gaps);
            return;
        }
        self.stage = ShapeSpacingStage::CheckSafety(PendingScalarCount::default());
    }

    fn finish_safety_check(&mut self, shape: &mut RunShape, text: &str, scalar_gaps: usize) {
        let RunShape::Exact(exact) = shape else {
            unreachable!("shape availability cannot change during a safety scan")
        };
        if scalar_gaps != exact.clusters.len().saturating_sub(1) {
            self.mark_unsafe(shape);
            return;
        }
        self.stage = ShapeSpacingStage::Apply(PendingClusterSpacing::new(exact, text));
    }

    fn mark_unsafe(&mut self, shape: &mut RunShape) {
        *shape = RunShape::unavailable(
            RunShapeUnavailableReason::NonClusterSafeSpacing,
            self.expected_advance,
        );
        self.stage = ShapeSpacingStage::Complete;
    }
}

#[cfg(test)]
mod tests;
