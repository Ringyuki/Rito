use super::super::{
    fixture_compatible_measurement, TextMeasurement, TextMeasurementCacheKey, TextMeasurementInput,
    TextMeasurementStyle,
};
use super::{
    parse_font_family_list,
    runs::{font_runs, FontMeasurementRun},
    shaping::{glyph_run_width, shape_run_checked, shaped_run_width, ShapeRunFailure},
    TextMeasurementFontFace, TextMeasurementFonts,
};
use crate::layout::text_shape::{
    RunShape, RunShapeCluster, RunShapeFaceSpan, RunShapeProvenance, RunShapeUnavailableReason,
};

pub(in super::super) fn font_aware_measurement(
    input: &TextMeasurementInput<'_>,
) -> TextMeasurement {
    if input.text.is_empty() {
        return TextMeasurement { width: 0.0 };
    }
    let cache_key = TextMeasurementCacheKey::new(input);
    let cached_width = input.fonts.cached_width(&cache_key);
    #[cfg(any(test, feature = "bench-internals"))]
    crate::layout::bounded_work_probe::record_measure_width_cache(
        cached_width.is_some(),
        input.text,
    );
    #[cfg(test)]
    crate::layout::text_work_trace::record_measurement_cache(
        input.text,
        crate::layout::text_work_trace::MeasurementCacheSource::MeasureWidth,
        if cached_width.is_some() {
            crate::layout::text_work_trace::MeasurementCacheOutcome::Hit
        } else {
            crate::layout::text_work_trace::MeasurementCacheOutcome::Miss
        },
    );
    if let Some(width) = cached_width {
        return TextMeasurement { width };
    }
    let faces = input.fonts.matching_faces(&input.style);
    if faces.is_empty() && input.fonts.uses_fixture_compatible_fallback() {
        // Frozen fixture layouts depend on the exact arithmetic order of the
        // original 0.6em formula, not a per-character sum of the same widths.
        return fixture_compatible_measurement(input);
    }
    let monospace = uses_generic_monospace(&input.style);
    let width = if faces.is_empty() {
        fallback_text_width(input.text, input.style.font_size, input.fonts, monospace)
    } else {
        let fallback_family = faces.first().map(|face| face.family.as_str());
        font_run_width(
            input.text,
            &faces,
            input.style.font_size,
            input.fonts,
            monospace,
            fallback_family,
        )
    };
    let ascii_spaces = input
        .text
        .chars()
        .filter(|character| *character == ' ')
        .count();
    let scalar_gaps = input.text.chars().count().saturating_sub(1);
    let width = width
        + ascii_spaces as f64 * input.style.word_spacing
        + scalar_gaps as f64 * input.style.letter_spacing;
    input.fonts.cache_width(cache_key, width);
    TextMeasurement { width }
}

pub(in super::super) fn font_aware_shape(input: &TextMeasurementInput<'_>) -> RunShape {
    if crate::layout::text_shape::requires_bidi_itemization(input.text) {
        return unavailable_shape(input, RunShapeUnavailableReason::MixedDirection);
    }
    let faces = input.fonts.matching_faces(&input.style);
    if faces.is_empty() {
        let reason = if input.fonts.uses_fixture_compatible_fallback() {
            RunShapeUnavailableReason::FixtureCompatibleMeasurement
        } else {
            RunShapeUnavailableReason::HostMetricsFallback
        };
        return unavailable_shape(input, reason);
    }

    let mut logical_cursor = 0usize;
    let mut exact_runs = Vec::new();
    for run in font_runs(input.text, &faces) {
        match run {
            FontMeasurementRun::Shaped { text, face } => {
                let logical_start = logical_cursor;
                logical_cursor += text.encode_utf16().count();
                let shape = match shape_run_checked(text, face, input.style.font_size) {
                    Ok(shape) => shape,
                    Err(ShapeRunFailure::RustybuzzUnavailable) => {
                        return unavailable_shape(
                            input,
                            RunShapeUnavailableReason::RustybuzzUnavailable,
                        );
                    }
                    Err(ShapeRunFailure::NonGraphemeSafeClusters { .. }) => {
                        return unavailable_shape(
                            input,
                            RunShapeUnavailableReason::NonGraphemeSafeClusters,
                        );
                    }
                };
                exact_runs.push((logical_start, logical_cursor, face.fingerprint(), shape));
            }
            FontMeasurementRun::Fallback(_) => {
                return unavailable_shape(input, RunShapeUnavailableReason::HostMetricsFallback);
            }
        }
    }

    let expected_advance = exact_shape_advance(input, &exact_runs);
    let Some(direction) = exact_runs.first().map(|(_, _, _, shape)| shape.direction) else {
        return RunShape::unavailable(
            RunShapeUnavailableReason::RustybuzzUnavailable,
            expected_advance,
        );
    };
    if exact_runs
        .iter()
        .any(|(_, _, _, shape)| shape.direction != direction)
    {
        return RunShape::unavailable(RunShapeUnavailableReason::MixedDirection, expected_advance);
    }

    let first_fingerprint = exact_runs[0].2;
    let single_face = exact_runs
        .iter()
        .all(|(_, _, fingerprint, _)| *fingerprint == first_fingerprint);
    if matches!(
        direction,
        crate::layout::text_shape::RunShapeDirection::RightToLeft
    ) {
        exact_runs.reverse();
    }

    let mut mixed = (!single_face).then(|| (Vec::new(), Vec::new()));
    let mut clusters = Vec::<RunShapeCluster>::new();
    for (logical_start, logical_end, fingerprint, shape) in exact_runs {
        let Ok(logical_start) = u32::try_from(logical_start) else {
            return RunShape::unavailable(
                RunShapeUnavailableReason::RustybuzzUnavailable,
                expected_advance,
            );
        };
        let Ok(logical_end) = u32::try_from(logical_end) else {
            return RunShape::unavailable(
                RunShapeUnavailableReason::RustybuzzUnavailable,
                expected_advance,
            );
        };
        if let Some((fingerprints, face_spans)) = &mut mixed {
            let font_index = intern_fingerprint(fingerprints, fingerprint);
            let Ok(font_index) = u32::try_from(font_index) else {
                return RunShape::unavailable(
                    RunShapeUnavailableReason::RustybuzzUnavailable,
                    expected_advance,
                );
            };
            face_spans.push(RunShapeFaceSpan {
                logical_start,
                logical_end,
                font_index,
            });
        }
        for mut cluster in shape.clusters {
            let Some(logical_cluster_start) = cluster.logical_start.checked_add(logical_start)
            else {
                return RunShape::unavailable(
                    RunShapeUnavailableReason::RustybuzzUnavailable,
                    expected_advance,
                );
            };
            let Some(logical_cluster_end) = cluster.logical_end.checked_add(logical_start) else {
                return RunShape::unavailable(
                    RunShapeUnavailableReason::RustybuzzUnavailable,
                    expected_advance,
                );
            };
            cluster.logical_start = logical_cluster_start;
            cluster.logical_end = logical_cluster_end;
            clusters.push(cluster);
        }
    }

    let provenance = match mixed {
        None => RunShapeProvenance::single(first_fingerprint),
        Some((fingerprints, mut face_spans)) => {
            face_spans.sort_unstable_by_key(|span| span.logical_start);
            RunShapeProvenance::mixed(fingerprints, face_spans)
        }
    };
    RunShape::exact(provenance, direction, expected_advance, clusters).apply_spacing(
        input.text,
        input.style.word_spacing,
        input.style.letter_spacing,
        expected_advance,
    )
}

type ExactFontRun = (usize, usize, [u8; 8], super::shaping::ShapedFontRun);

fn exact_shape_advance(input: &TextMeasurementInput<'_>, runs: &[ExactFontRun]) -> f64 {
    let cache_key = TextMeasurementCacheKey::new(input);
    let cached_width = input.fonts.cached_width(&cache_key);
    #[cfg(any(test, feature = "bench-internals"))]
    crate::layout::bounded_work_probe::record_exact_shape_advance_cache(
        cached_width.is_some(),
        input.text,
    );
    #[cfg(test)]
    crate::layout::text_work_trace::record_measurement_cache(
        input.text,
        crate::layout::text_work_trace::MeasurementCacheSource::ExactShapeAdvance,
        if cached_width.is_some() {
            crate::layout::text_work_trace::MeasurementCacheOutcome::Hit
        } else {
            crate::layout::text_work_trace::MeasurementCacheOutcome::Miss
        },
    );
    if let Some(width) = cached_width {
        return width;
    }
    let ascii_spaces = input
        .text
        .chars()
        .filter(|character| *character == ' ')
        .count();
    let scalar_gaps = input.text.chars().count().saturating_sub(1);
    let width = runs
        .iter()
        .map(|(_, _, _, shape)| shape.advance)
        .sum::<f64>()
        + ascii_spaces as f64 * input.style.word_spacing
        + scalar_gaps as f64 * input.style.letter_spacing;
    input.fonts.cache_width(cache_key, width);
    width
}

fn unavailable_shape(
    input: &TextMeasurementInput<'_>,
    reason: RunShapeUnavailableReason,
) -> RunShape {
    RunShape::unavailable(reason, font_aware_measurement(input).width)
}

fn intern_fingerprint(fingerprints: &mut Vec<[u8; 8]>, fingerprint: [u8; 8]) -> usize {
    if let Some(index) = fingerprints
        .iter()
        .position(|candidate| *candidate == fingerprint)
    {
        index
    } else {
        fingerprints.push(fingerprint);
        fingerprints.len() - 1
    }
}

fn uses_generic_monospace(style: &TextMeasurementStyle) -> bool {
    style
        .font_family
        .as_deref()
        .map(parse_font_family_list)
        .unwrap_or_default()
        .iter()
        .any(|family| family.eq_ignore_ascii_case("monospace"))
}

fn fallback_text_width(
    text: &str,
    font_size: f64,
    fonts: &TextMeasurementFonts<'_>,
    monospace: bool,
) -> f64 {
    let mut previous = None;
    text.chars()
        .map(|character| {
            let adjustment = previous
                .map(|left| {
                    fonts.fallback_pair_adjustment(left, character, font_size, monospace, None)
                })
                .unwrap_or(0.0);
            previous = Some(character);
            fonts.fallback_character_width(character, font_size, monospace, None) + adjustment
        })
        .sum()
}

fn font_run_width(
    text: &str,
    faces: &[&TextMeasurementFontFace<'_>],
    font_size: f64,
    fonts: &TextMeasurementFonts<'_>,
    monospace: bool,
    fallback_family: Option<&str>,
) -> f64 {
    let mut previous_fallback = None;
    font_runs(text, faces)
        .into_iter()
        .map(|run| match run {
            FontMeasurementRun::Shaped { text, face } => {
                previous_fallback = None;
                shaped_run_width(text, face, font_size).unwrap_or_else(|| {
                    glyph_run_width(text, &[face], font_size, fonts, monospace, fallback_family)
                })
            }
            FontMeasurementRun::Fallback(text) => text
                .chars()
                .map(|character| {
                    let adjustment = previous_fallback
                        .map(|left| {
                            fonts.fallback_pair_adjustment(
                                left,
                                character,
                                font_size,
                                monospace,
                                fallback_family,
                            )
                        })
                        .unwrap_or(0.0);
                    previous_fallback = Some(character);
                    fonts.fallback_character_width(character, font_size, monospace, fallback_family)
                        + adjustment
                })
                .sum(),
        })
        .sum()
}
