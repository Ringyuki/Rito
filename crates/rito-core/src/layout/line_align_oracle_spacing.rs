use crate::layout::{
    line::TextRunBox,
    text_shape::{RunShape, RunShapeUnavailableReason},
};

pub(super) fn apply_inter_character_spacing(
    run: &mut TextRunBox,
    gap_size: f64,
    grapheme_gaps: usize,
) {
    run.add_letter_spacing_value(gap_size);
    let expected_advance = run.width;
    if matches!(
        &run.shape,
        RunShape::Exact(shape)
            if shape.clusters.len().saturating_sub(1) != grapheme_gaps
    ) {
        run.shape = RunShape::unavailable(
            RunShapeUnavailableReason::NonClusterSafeSpacing,
            expected_advance,
        );
        return;
    }
    match &mut run.shape {
        RunShape::Exact(shape) => {
            let cluster_gaps = shape.clusters.len().saturating_sub(1);
            for (visual_index, cluster) in shape.clusters.iter_mut().enumerate() {
                if visual_index < cluster_gaps {
                    cluster.advance = (f64::from(cluster.advance) + gap_size) as f32;
                }
            }
            shape.advance = expected_advance;
        }
        RunShape::Unavailable(shape) => shape.advance = expected_advance,
    }
}
