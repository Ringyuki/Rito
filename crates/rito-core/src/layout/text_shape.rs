use std::collections::HashSet;

mod direction;

pub(crate) use direction::requires_bidi_itemization;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunShapeDirection {
    LeftToRight,
    RightToLeft,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunShapeCaretAffinity {
    Upstream,
    Downstream,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunShapeUnavailableReason {
    FixtureCompatibleMeasurement,
    HostMetricsFallback,
    RustybuzzUnavailable,
    SyntheticLayoutText,
    MixedDirection,
    NonClusterSafeSpacing,
    NonGraphemeSafeClusters,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RunShapeProvenance {
    Single { fingerprint: [u8; 8] },
    Mixed(Box<MixedRunShapeProvenance>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MixedRunShapeProvenance {
    pub(crate) font_fingerprints: Vec<[u8; 8]>,
    pub(crate) face_spans: Vec<RunShapeFaceSpan>,
}

impl RunShapeProvenance {
    pub(crate) fn single(fingerprint: [u8; 8]) -> Self {
        Self::Single { fingerprint }
    }

    pub(crate) fn mixed(
        font_fingerprints: Vec<[u8; 8]>,
        face_spans: Vec<RunShapeFaceSpan>,
    ) -> Self {
        Self::Mixed(Box::new(MixedRunShapeProvenance {
            font_fingerprints,
            face_spans,
        }))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RunShapeFaceSpan {
    pub(crate) logical_start: u32,
    pub(crate) logical_end: u32,
    pub(crate) font_index: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunShapeCluster {
    pub(crate) logical_start: u32,
    pub(crate) logical_end: u32,
    /// Advance of this cluster only. Visual offsets are derived on demand so
    /// production pages do not retain a second per-character caret table.
    pub(crate) advance: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct RunShapeCaretStop {
    pub(crate) logical_offset: u32,
    pub(crate) visual_offset: f32,
    pub(crate) affinity: RunShapeCaretAffinity,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ExactRunShape {
    pub(crate) advance: f64,
    pub(crate) direction: RunShapeDirection,
    pub(crate) provenance: RunShapeProvenance,
    pub(crate) clusters: Vec<RunShapeCluster>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct UnavailableRunShape {
    pub(crate) advance: f64,
    pub(crate) reason: RunShapeUnavailableReason,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum RunShape {
    Exact(Box<ExactRunShape>),
    Unavailable(UnavailableRunShape),
}

impl RunShape {
    pub(crate) fn exact(
        provenance: RunShapeProvenance,
        direction: RunShapeDirection,
        advance: f64,
        clusters: Vec<RunShapeCluster>,
    ) -> Self {
        Self::Exact(Box::new(ExactRunShape {
            advance,
            direction,
            provenance,
            clusters,
        }))
    }

    pub(crate) fn unavailable(reason: RunShapeUnavailableReason, advance: f64) -> Self {
        Self::Unavailable(UnavailableRunShape { advance, reason })
    }

    pub(crate) fn advance(&self) -> f64 {
        match self {
            Self::Exact(shape) => shape.advance,
            Self::Unavailable(shape) => shape.advance,
        }
    }

    pub(crate) fn apply_spacing(
        mut self,
        text: &str,
        word_spacing: f64,
        letter_spacing: f64,
        expected_advance: f64,
    ) -> Self {
        self.apply_spacing_delta_in_place(text, word_spacing, letter_spacing, expected_advance);
        self
    }

    pub(crate) fn apply_spacing_delta_in_place(
        &mut self,
        text: &str,
        word_spacing_delta: f64,
        letter_spacing_delta: f64,
        expected_advance: f64,
    ) {
        match self {
            Self::Exact(shape) => {
                let scalar_gaps = text.chars().count().saturating_sub(1);
                let cluster_gaps = shape.clusters.len().saturating_sub(1);
                if letter_spacing_delta != 0.0 && scalar_gaps != cluster_gaps {
                    *self = Self::unavailable(
                        RunShapeUnavailableReason::NonClusterSafeSpacing,
                        expected_advance,
                    );
                    return;
                }

                for (index, cluster) in shape.clusters.iter_mut().enumerate() {
                    let mut advance = f64::from(cluster.advance);
                    let cluster_text = utf16_slice(
                        text,
                        cluster.logical_start as usize,
                        cluster.logical_end as usize,
                    );
                    advance += cluster_text
                        .chars()
                        .filter(|character| *character == ' ')
                        .count() as f64
                        * word_spacing_delta;
                    if index < cluster_gaps {
                        advance += letter_spacing_delta;
                    }
                    cluster.advance = advance as f32;
                }
                shape.advance = expected_advance;
            }
            Self::Unavailable(shape) => shape.advance = expected_advance,
        }
    }
}

impl ExactRunShape {
    /// Derives the transient caret table from compact cluster advances. A
    /// ligature/complex cluster contributes only its two real cluster edges;
    /// no interior stops are synthesized by interpolation.
    pub(crate) fn caret_stops(&self) -> Vec<RunShapeCaretStop> {
        build_caret_stops(self)
    }
}

fn build_caret_stops(shape: &ExactRunShape) -> Vec<RunShapeCaretStop> {
    let mut stops = Vec::with_capacity(shape.clusters.len().saturating_add(1));
    let mut seen = HashSet::with_capacity(shape.clusters.len().saturating_add(1));
    let mut cursor = 0.0_f64;
    for (index, cluster) in shape.clusters.iter().enumerate() {
        let visual_start = cursor;
        let visual_end = if index + 1 == shape.clusters.len() {
            shape.advance
        } else {
            cursor + f64::from(cluster.advance)
        };
        let (start_x, end_x) = match shape.direction {
            RunShapeDirection::LeftToRight => (visual_start, visual_end),
            RunShapeDirection::RightToLeft => (visual_end, visual_start),
        };
        push_unique_stop(
            &mut stops,
            &mut seen,
            RunShapeCaretStop {
                logical_offset: cluster.logical_start,
                visual_offset: start_x as f32,
                affinity: RunShapeCaretAffinity::Downstream,
            },
        );
        push_unique_stop(
            &mut stops,
            &mut seen,
            RunShapeCaretStop {
                logical_offset: cluster.logical_end,
                visual_offset: end_x as f32,
                affinity: RunShapeCaretAffinity::Upstream,
            },
        );
        cursor = visual_end;
    }
    stops
}

fn push_unique_stop(
    stops: &mut Vec<RunShapeCaretStop>,
    seen: &mut HashSet<(u32, u32)>,
    stop: RunShapeCaretStop,
) {
    if seen.insert((stop.logical_offset, stop.visual_offset.to_bits())) {
        stops.push(stop);
    }
}

fn utf16_slice(text: &str, start: usize, end: usize) -> &str {
    let mut utf16_offset = 0usize;
    let mut start_byte = None;
    let mut end_byte = None;
    for (byte, character) in text.char_indices() {
        if utf16_offset == start {
            start_byte = Some(byte);
        }
        if utf16_offset == end {
            end_byte = Some(byte);
            break;
        }
        utf16_offset += character.len_utf16();
    }
    let start_byte = start_byte.unwrap_or(text.len());
    let end_byte = end_byte.unwrap_or({
        if utf16_offset == end {
            text.len()
        } else {
            start_byte
        }
    });
    &text[start_byte..end_byte]
}

#[cfg(test)]
pub(crate) fn fixture_run_shape(advance: f64) -> RunShape {
    RunShape::unavailable(
        RunShapeUnavailableReason::FixtureCompatibleMeasurement,
        advance,
    )
}

#[cfg(test)]
mod tests;
