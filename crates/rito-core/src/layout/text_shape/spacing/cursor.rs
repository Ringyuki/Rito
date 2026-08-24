use super::super::{ExactRunShape, RunShapeCluster, RunShapeDirection};
use crate::layout::text_work::{TextWorkMeter, TextWorkYield};

#[derive(Debug, Default)]
pub(super) struct PendingScalarCount {
    byte_cursor: usize,
    scalar_count: usize,
    pending_scalar: Option<PendingScalar>,
}

#[derive(Debug)]
pub(super) struct PendingClusterSpacing {
    direction: RunShapeDirection,
    visual_index: usize,
    byte_cursor: usize,
    logical_cursor: usize,
    spaces: usize,
    cluster_active: bool,
    pending_scalar: Option<PendingScalar>,
}

#[derive(Debug)]
struct PendingScalar {
    character: char,
    utf8_len: usize,
    utf16_len: usize,
    utf16_units_remaining: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ClusterSpacingOutcome {
    Complete,
    Unsafe,
}

impl PendingScalarCount {
    pub(super) fn advance(
        &mut self,
        text: &str,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        loop {
            if self.pending_scalar.is_none() {
                let Some(character) = text[self.byte_cursor..].chars().next() else {
                    return Ok(());
                };
                self.pending_scalar = Some(PendingScalar::new(character));
            }
            consume_pending_scalar(&mut self.pending_scalar, work)?;
            let scalar = self.pending_scalar.take().expect("scalar is complete");
            self.byte_cursor += scalar.utf8_len;
            self.scalar_count += 1;
            #[cfg(test)]
            record_safety_scalar_visit();
        }
    }

    pub(super) fn scalar_count(&self) -> usize {
        self.scalar_count
    }
}

impl PendingClusterSpacing {
    pub(super) fn new(shape: &ExactRunShape, text: &str) -> Self {
        let (byte_cursor, logical_cursor) = match shape.direction {
            RunShapeDirection::LeftToRight => (0, 0),
            RunShapeDirection::RightToLeft => (
                text.len(),
                shape
                    .clusters
                    .first()
                    .map_or(0, |cluster| cluster.logical_end as usize),
            ),
        };
        Self {
            direction: shape.direction,
            visual_index: 0,
            byte_cursor,
            logical_cursor,
            spaces: 0,
            cluster_active: false,
            pending_scalar: None,
        }
    }

    pub(super) fn advance(
        &mut self,
        clusters: &mut [RunShapeCluster],
        text: &str,
        word_spacing_delta: f64,
        letter_spacing_delta: f64,
        work: &mut TextWorkMeter,
    ) -> Result<ClusterSpacingOutcome, TextWorkYield> {
        let cluster_gaps = clusters.len().saturating_sub(1);
        while self.visual_index < clusters.len() {
            let cluster = &clusters[self.visual_index];
            if !self.cluster_active {
                if !self.cluster_starts_at_cursor(cluster) {
                    return Ok(ClusterSpacingOutcome::Unsafe);
                }
                self.cluster_active = true;
            }
            let logical_target = match self.direction {
                RunShapeDirection::LeftToRight => cluster.logical_end as usize,
                RunShapeDirection::RightToLeft => cluster.logical_start as usize,
            };
            if !self.consume_cluster_text(text, logical_target, work)? {
                return Ok(ClusterSpacingOutcome::Unsafe);
            }
            require_unit(work)?;
            update_cluster_advance(
                &mut clusters[self.visual_index],
                self.spaces,
                self.visual_index,
                cluster_gaps,
                word_spacing_delta,
                letter_spacing_delta,
            );
            self.visual_index += 1;
            self.spaces = 0;
            self.cluster_active = false;
        }
        if self.covers_entire_text(text) {
            Ok(ClusterSpacingOutcome::Complete)
        } else {
            Ok(ClusterSpacingOutcome::Unsafe)
        }
    }

    fn consume_cluster_text(
        &mut self,
        text: &str,
        logical_target: usize,
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        while self.logical_cursor != logical_target {
            if self.passed(logical_target) {
                return Ok(false);
            }
            if self.pending_scalar.is_none() {
                let character = match self.direction {
                    RunShapeDirection::LeftToRight => text[self.byte_cursor..].chars().next(),
                    RunShapeDirection::RightToLeft => text[..self.byte_cursor].chars().next_back(),
                };
                let Some(character) = character else {
                    return Ok(false);
                };
                self.pending_scalar = Some(PendingScalar::new(character));
            }
            consume_pending_scalar(&mut self.pending_scalar, work)?;
            if !self.commit_scalar() {
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn passed(&self, logical_target: usize) -> bool {
        match self.direction {
            RunShapeDirection::LeftToRight => self.logical_cursor > logical_target,
            RunShapeDirection::RightToLeft => self.logical_cursor < logical_target,
        }
    }

    fn cluster_starts_at_cursor(&self, cluster: &RunShapeCluster) -> bool {
        match self.direction {
            RunShapeDirection::LeftToRight => {
                cluster.logical_start as usize == self.logical_cursor
                    && cluster.logical_end > cluster.logical_start
            }
            RunShapeDirection::RightToLeft => {
                cluster.logical_end as usize == self.logical_cursor
                    && cluster.logical_start < cluster.logical_end
            }
        }
    }

    fn covers_entire_text(&self, text: &str) -> bool {
        self.pending_scalar.is_none()
            && match self.direction {
                RunShapeDirection::LeftToRight => self.byte_cursor == text.len(),
                RunShapeDirection::RightToLeft => self.byte_cursor == 0 && self.logical_cursor == 0,
            }
    }

    fn commit_scalar(&mut self) -> bool {
        let scalar = self.pending_scalar.take().expect("scalar is complete");
        match self.direction {
            RunShapeDirection::LeftToRight => {
                let Some(byte_cursor) = self.byte_cursor.checked_add(scalar.utf8_len) else {
                    return false;
                };
                let Some(logical_cursor) = self.logical_cursor.checked_add(scalar.utf16_len) else {
                    return false;
                };
                self.byte_cursor = byte_cursor;
                self.logical_cursor = logical_cursor;
            }
            RunShapeDirection::RightToLeft => {
                let Some(byte_cursor) = self.byte_cursor.checked_sub(scalar.utf8_len) else {
                    return false;
                };
                let Some(logical_cursor) = self.logical_cursor.checked_sub(scalar.utf16_len) else {
                    return false;
                };
                self.byte_cursor = byte_cursor;
                self.logical_cursor = logical_cursor;
            }
        }
        self.spaces += usize::from(scalar.character == ' ');
        #[cfg(test)]
        record_cluster_scalar_visit();
        true
    }
}

impl PendingScalar {
    fn new(character: char) -> Self {
        let utf16_len = character.len_utf16();
        Self {
            character,
            utf8_len: character.len_utf8(),
            utf16_len,
            utf16_units_remaining: utf16_len,
        }
    }
}

fn consume_pending_scalar(
    pending: &mut Option<PendingScalar>,
    work: &mut TextWorkMeter,
) -> Result<(), TextWorkYield> {
    let scalar = pending.as_mut().expect("pending scalar is initialized");
    let taken = work.take_utf16_units(scalar.utf16_units_remaining);
    scalar.utf16_units_remaining -= taken;
    if scalar.utf16_units_remaining == 0 {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}

fn require_unit(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    if work.take_utf16_units(1) == 1 {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}

fn update_cluster_advance(
    cluster: &mut RunShapeCluster,
    spaces: usize,
    visual_index: usize,
    cluster_gaps: usize,
    word_spacing_delta: f64,
    letter_spacing_delta: f64,
) {
    let mut advance = f64::from(cluster.advance);
    advance += spaces as f64 * word_spacing_delta;
    if visual_index < cluster_gaps {
        advance += letter_spacing_delta;
    }
    cluster.advance = advance as f32;
}

#[cfg(test)]
std::thread_local! {
    static CLUSTER_SCALAR_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static SAFETY_SCALAR_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn record_cluster_scalar_visit() {
    CLUSTER_SCALAR_VISITS.set(CLUSTER_SCALAR_VISITS.get().saturating_add(1));
}

#[cfg(test)]
fn record_safety_scalar_visit() {
    SAFETY_SCALAR_VISITS.set(SAFETY_SCALAR_VISITS.get().saturating_add(1));
}

#[cfg(test)]
pub(super) fn reset_scalar_visits() {
    CLUSTER_SCALAR_VISITS.set(0);
    SAFETY_SCALAR_VISITS.set(0);
}

#[cfg(test)]
pub(super) fn scalar_visits() -> (usize, usize) {
    (CLUSTER_SCALAR_VISITS.get(), SAFETY_SCALAR_VISITS.get())
}
