use super::{bounded_request, continue_request};
use crate::{
    layout::{
        FontVerticalMetricDemand, FontVerticalMetricSample, LineBox, LineRun, RuntimeBlock,
        RuntimeChild, TextMeasurementMode, TextRunBox,
    },
    runtime::{
        tests::fixture::{double_layout, fixture_epub, layout, source_locator_fixture_epub},
        RuntimeCalibrateRevisionFontVerticalMetricsRequest, RuntimeContinuationErrorKind,
        RuntimeContinueRevisionRequest, RuntimeDocument, RuntimeRevisionAccessErrorKind,
        RuntimeRevisionCursor, RuntimeRevisionHandle, RuntimeRevisionStatus,
        RuntimeRevisionSummary,
    },
};

#[test]
fn eager_calibration_is_exact_and_preserves_frames_and_revision_extent() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let mut config = layout();
    config.text_measurement = TextMeasurementMode::FontAware;
    let original = document
        .create_revision(&config)
        .expect("font-aware revision completes");
    let original_handle = RuntimeRevisionHandle::from(&original);
    let demands = demands_at(&document, &original_handle);
    let original_bounds = first_run_bounds(&document, &original.revision_id);
    let frame_bytes = document
        .read_frame_command_buffer(&original.revision_id, 0)
        .expect("frame bytes warm");
    let cached_frame_count = document.cached_frame_count(&original.revision_id);

    let wrong = document
        .calibrate_revision_font_vertical_metrics(calibration_request(
            &original,
            None,
            vec![non_matching_size_sample(&demands)],
        ))
        .expect("non-matching exact sample is accepted");
    assert_eq!(wrong.calibrated_published_run_count, 0);
    assert_eq!(wrong.calibrated_unpublished_run_count, 0);
    assert_revision_shape_unchanged(&original, &wrong.revision);
    assert_eq!(
        first_run_bounds(&document, &original.revision_id),
        original_bounds,
        "a different font-size key must not be scaled onto this run"
    );
    assert!(document
        .revision_presentation_at(&RuntimeRevisionHandle::from(&wrong.revision))
        .expect("version one presentation")
        .value
        .font_vertical_metric_demands
        .is_some());

    let samples = samples_for_demands(demands);
    let calibrated = document
        .calibrate_revision_font_vertical_metrics(calibration_request(
            &wrong.revision,
            None,
            samples.clone(),
        ))
        .expect("exact samples calibrate");
    assert!(calibrated.calibrated_published_run_count > 0);
    assert_eq!(calibrated.calibrated_unpublished_run_count, 0);
    assert_revision_shape_unchanged(&wrong.revision, &calibrated.revision);
    assert_eq!(
        document.cached_frame_count(&original.revision_id),
        cached_frame_count
    );
    assert_eq!(
        document
            .read_frame_command_buffer(&original.revision_id, 0)
            .expect("calibrated frame bytes remain cached"),
        frame_bytes
    );
    assert_eq!(
        document
            .get_frame_at(&original_handle, 0)
            .expect_err("the pre-calibration handle is stale")
            .kind,
        RuntimeRevisionAccessErrorKind::StaleRevisionVersion
    );

    let run = first_text_run(&document, &original.revision_id);
    let sample = exact_sample_for_run(run, &samples);
    let calibrated_bounds = run.interaction_vertical_bounds();
    assert_ne!(calibrated_bounds, original_bounds);
    assert_close(
        calibrated_bounds.1,
        sample.top_baseline_ascent_px + sample.top_baseline_descent_px,
    );
    assert!(document
        .revision_presentation_at(&RuntimeRevisionHandle::from(&calibrated.revision))
        .expect("calibrated presentation")
        .value
        .font_vertical_metric_demands
        .is_none());
}

#[test]
fn zero_line_height_with_a_shared_descriptor_calibrates_and_clears_demand() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let mut config = layout();
    config.text_measurement = TextMeasurementMode::FontAware;
    let original = document
        .create_revision(&config)
        .expect("font-aware revision completes");
    let zero_height_demand = {
        let run = first_text_run_mut(&mut document, &original.revision_id);
        run.height = 0.0;
        run.interaction_geometry = None;
        demand_for_run(run)
    };
    assert!(
        matching_text_run_count(&document, &original.revision_id, &zero_height_demand) > 1,
        "fixture must share the zero-height run's exact descriptor"
    );

    let handle = RuntimeRevisionHandle::from(&original);
    let demands = demands_at(&document, &handle);
    assert!(demands.contains(&zero_height_demand));
    let calibrated = document
        .calibrate_revision_font_vertical_metrics(calibration_request(
            &original,
            None,
            samples_for_demands(demands),
        ))
        .expect("zero line-height accepts exact font geometry");

    assert!(calibrated.calibrated_published_run_count > 0);
    assert!(document
        .revision_presentation_at(&RuntimeRevisionHandle::from(&calibrated.revision))
        .expect("calibrated presentation")
        .value
        .font_vertical_metric_demands
        .is_none());
    let run = first_text_run(&document, &original.revision_id);
    assert_eq!(run.height, 0.0);
    assert!(
        run.interaction_vertical_bounds().1 > 0.0,
        "zero line-height text keeps its measurable glyph bounds"
    );
}

#[test]
fn active_calibration_patches_published_and_unpublished_pages_atomically() {
    let bytes = source_locator_fixture_epub();
    let mut config = double_layout();
    config.page_height = 180.0;
    config.viewport_height = 180.0;
    config.margin_top = 10.0;
    config.margin_right = 10.0;
    config.margin_bottom = 10.0;
    config.margin_left = 10.0;
    config.first_page_alone = false;
    config.text_measurement = TextMeasurementMode::FontAware;
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let mut advance = document
        .create_bounded_revision(bounded_request(config, 1))
        .expect("bounded revision starts");

    let cursor = loop {
        let cursor = advance
            .continuation
            .clone()
            .expect("fixture must remain active until a tail is withheld");
        let has_published = advance.revision.known_extent.page_count > 0;
        let has_unpublished = document
            .continuation_unpublished_page_count(&cursor.cursor)
            .is_some_and(|count| count > 0);
        if has_published && has_unpublished {
            break cursor;
        }
        advance = document
            .continue_revision(continue_request(&cursor, 1))
            .expect("bounded revision advances to a withheld tail");
    };
    let before = advance.revision.clone();
    let before_handle = RuntimeRevisionHandle::from(&before);
    let samples = samples_for_demands(demands_at(&document, &before_handle));
    let frame_bytes = document
        .read_frame_command_buffer(&before.revision_id, 0)
        .expect("published frame bytes warm");
    let cached_frame_count = document.cached_frame_count(&before.revision_id);

    let invalid = document
        .calibrate_revision_font_vertical_metrics(calibration_request(
            &before,
            Some(cursor.clone()),
            vec![invalid_sample()],
        ))
        .expect_err("invalid samples fail before mutation");
    assert_eq!(invalid.kind, RuntimeContinuationErrorKind::EngineFailure);
    assert_eq!(
        document
            .get_revision_summary(&before.revision_id)
            .expect("failed calibration keeps revision")
            .revision_version,
        before.revision_version
    );
    assert!(document.continuations.contains_cursor(&cursor.cursor));

    let calibrated = document
        .calibrate_revision_font_vertical_metrics(calibration_request(
            &before,
            Some(cursor.clone()),
            samples,
        ))
        .expect("active revision calibrates");
    assert!(calibrated.calibrated_published_run_count > 0);
    assert!(calibrated.calibrated_unpublished_run_count > 0);
    assert_revision_shape_unchanged(&before, &calibrated.revision);
    assert_eq!(
        document.cached_frame_count(&before.revision_id),
        cached_frame_count
    );
    assert_eq!(
        document
            .read_frame_command_buffer(&before.revision_id, 0)
            .expect("published frame remains byte-identical"),
        frame_bytes
    );

    let next_cursor = calibrated
        .continuation
        .clone()
        .expect("active cursor rotates");
    assert_eq!(next_cursor.revision_version, before.revision_version + 1);
    assert_ne!(next_cursor.cursor, cursor.cursor);
    assert!(!document.continuations.contains_cursor(&cursor.cursor));
    assert!(document.continuations.contains_cursor(&next_cursor.cursor));
    let replay = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: before.revision_id.clone(),
            revision_version: next_cursor.revision_version,
            cursor: cursor.cursor,
            budget: super::budget(1),
        })
        .expect_err("the consumed cursor cannot be replayed at the new version");
    assert_eq!(replay.kind, RuntimeContinuationErrorKind::UnknownCursor);
    assert!(document
        .revision_presentation_at(&RuntimeRevisionHandle::from(&calibrated.revision))
        .expect("calibrated presentation")
        .value
        .font_vertical_metric_demands
        .is_none());

    let advanced = document
        .continue_revision(continue_request(&next_cursor, 1))
        .expect("rotated cursor remains usable");
    assert!(document
        .revision_presentation_at(&RuntimeRevisionHandle::from(&advanced.revision))
        .expect("continued presentation")
        .value
        .font_vertical_metric_demands
        .is_none());
}

#[test]
fn pre_calibration_open_page_runs_are_exact_when_later_published() {
    let bytes = source_locator_fixture_epub();
    let mut config = layout();
    config.text_measurement = TextMeasurementMode::FontAware;
    let samples = {
        let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
        let eager_revision = eager
            .create_revision(&config)
            .expect("eager revision completes");
        samples_for_demands(demands_at(
            &eager,
            &RuntimeRevisionHandle::from(&eager_revision),
        ))
    };
    let mut document = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let initial = document
        .create_bounded_revision(bounded_request(config, 1))
        .expect("first paragraph is laid out");
    let cursor = initial
        .continuation
        .clone()
        .expect("more paragraphs remain");
    assert_eq!(initial.revision.known_extent.page_count, 0);
    assert_eq!(
        document.continuation_unpublished_page_count(&cursor.cursor),
        Some(0)
    );
    assert!(document
        .continuation_open_page_block_count(&cursor.cursor)
        .is_some_and(|count| count > 0));

    let calibrated = document
        .calibrate_revision_font_vertical_metrics(calibration_request(
            &initial.revision,
            Some(cursor),
            samples,
        ))
        .expect("open-page revision calibrates");
    assert_eq!(calibrated.calibrated_published_run_count, 0);
    assert_eq!(calibrated.calibrated_unpublished_run_count, 0);

    let mut revision = calibrated.revision;
    let mut continuation = calibrated.continuation;
    while let Some(cursor) = continuation {
        let next = document
            .continue_revision(continue_request(&cursor, 256))
            .expect("calibrated revision completes");
        if next.revision.known_extent.page_count > 0 {
            assert!(document
                .revision_presentation_at(&RuntimeRevisionHandle::from(&next.revision))
                .expect("published calibrated presentation")
                .value
                .font_vertical_metric_demands
                .is_none());
        }
        revision = next.revision;
        continuation = next.continuation;
    }
    assert_eq!(revision.status, RuntimeRevisionStatus::Complete);
    assert!(document
        .revision_presentation_at(&RuntimeRevisionHandle::from(&revision))
        .expect("completed calibrated presentation")
        .value
        .font_vertical_metric_demands
        .is_none());
}

fn calibration_request(
    revision: &RuntimeRevisionSummary,
    continuation: Option<RuntimeRevisionCursor>,
    font_vertical_metrics: Vec<FontVerticalMetricSample>,
) -> RuntimeCalibrateRevisionFontVerticalMetricsRequest {
    RuntimeCalibrateRevisionFontVerticalMetricsRequest {
        revision_id: revision.revision_id.clone(),
        revision_version: revision.revision_version,
        continuation,
        font_vertical_metrics,
    }
}

fn demands_at(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
) -> Vec<FontVerticalMetricDemand> {
    document
        .revision_presentation_at(handle)
        .expect("revision presentation resolves")
        .value
        .font_vertical_metric_demands
        .expect("font-aware revision exposes exact demands")
}

fn samples_for_demands(demands: Vec<FontVerticalMetricDemand>) -> Vec<FontVerticalMetricSample> {
    demands
        .into_iter()
        .map(|demand| FontVerticalMetricSample {
            font_family: demand.font_family,
            font_style: demand.font_style,
            font_weight: demand.font_weight,
            font_size_px: demand.font_size_px,
            top_baseline_ascent_px: demand.font_size_px * 0.3,
            top_baseline_descent_px: demand.font_size_px * 0.2,
        })
        .collect()
}

fn non_matching_size_sample(demands: &[FontVerticalMetricDemand]) -> FontVerticalMetricSample {
    let demand = demands.first().expect("fixture has a font demand");
    let mut size = demand.font_size_px * 2.0;
    while demands.iter().any(|candidate| {
        candidate.font_family == demand.font_family
            && candidate.font_style == demand.font_style
            && candidate.font_weight == demand.font_weight
            && candidate.font_size_px.to_bits() == size.to_bits()
    }) {
        size += 0.125;
    }
    FontVerticalMetricSample {
        font_family: demand.font_family.clone(),
        font_style: demand.font_style.clone(),
        font_weight: demand.font_weight,
        font_size_px: size,
        top_baseline_ascent_px: size * 0.3,
        top_baseline_descent_px: size * 0.2,
    }
}

fn invalid_sample() -> FontVerticalMetricSample {
    FontVerticalMetricSample {
        font_family: "serif".to_owned(),
        font_style: "normal".to_owned(),
        font_weight: 400,
        font_size_px: 16.0,
        top_baseline_ascent_px: -1.0,
        top_baseline_descent_px: 4.0,
    }
}

fn assert_revision_shape_unchanged(
    before: &RuntimeRevisionSummary,
    after: &RuntimeRevisionSummary,
) {
    assert_eq!(after.revision_id, before.revision_id);
    assert_eq!(after.revision_version, before.revision_version + 1);
    assert_eq!(after.layout_key, before.layout_key);
    assert_eq!(after.status, before.status);
    assert_eq!(after.known_extent, before.known_extent);
    assert_eq!(after.final_extent, before.final_extent);
    assert_eq!(after.page_count, before.page_count);
    assert_eq!(after.spread_count, before.spread_count);
}

fn first_run_bounds(document: &RuntimeDocument, revision_id: &str) -> (f64, f64) {
    first_text_run(document, revision_id).interaction_vertical_bounds()
}

fn first_text_run<'a>(document: &'a RuntimeDocument, revision_id: &str) -> &'a TextRunBox {
    document.revisions[revision_id]
        .layout
        .pages
        .iter()
        .flat_map(|page| page.content.iter())
        .find_map(first_text_run_in_block)
        .expect("fixture has a text run")
}

fn first_text_run_mut<'a>(
    document: &'a mut RuntimeDocument,
    revision_id: &str,
) -> &'a mut TextRunBox {
    document
        .revisions
        .get_mut(revision_id)
        .expect("revision exists")
        .layout
        .pages
        .iter_mut()
        .flat_map(|page| page.content.iter_mut())
        .find_map(first_text_run_in_block_mut)
        .expect("fixture has a text run")
}

fn first_text_run_in_block(block: &RuntimeBlock<LineBox>) -> Option<&TextRunBox> {
    block.children.iter().find_map(|child| match child {
        RuntimeChild::Block(block) => first_text_run_in_block(block),
        RuntimeChild::Line(line) => line.runs.iter().find_map(|run| match run {
            LineRun::Text(run) => Some(run),
            LineRun::Atom(_) | LineRun::Ruby(_) => None,
        }),
        RuntimeChild::Image(_) | RuntimeChild::Hr(_) => None,
    })
}

fn first_text_run_in_block_mut(block: &mut RuntimeBlock<LineBox>) -> Option<&mut TextRunBox> {
    block.children.iter_mut().find_map(|child| match child {
        RuntimeChild::Block(block) => first_text_run_in_block_mut(block),
        RuntimeChild::Line(line) => line.runs.iter_mut().find_map(|run| match run {
            LineRun::Text(run) => Some(run),
            LineRun::Atom(_) | LineRun::Ruby(_) => None,
        }),
        RuntimeChild::Image(_) | RuntimeChild::Hr(_) => None,
    })
}

fn demand_for_run(run: &TextRunBox) -> FontVerticalMetricDemand {
    let font = &run.paint.measure().font;
    FontVerticalMetricDemand::normalized(
        Some(&font.family),
        Some(font.style.as_str()),
        Some(font.weight),
        run.font_size,
    )
    .expect("fixture run has a valid font descriptor")
}

fn matching_text_run_count(
    document: &RuntimeDocument,
    revision_id: &str,
    demand: &FontVerticalMetricDemand,
) -> usize {
    document.revisions[revision_id]
        .layout
        .pages
        .iter()
        .flat_map(|page| page.content.iter())
        .map(|block| matching_text_runs_in_block(block, demand))
        .sum()
}

fn matching_text_runs_in_block(
    block: &RuntimeBlock<LineBox>,
    demand: &FontVerticalMetricDemand,
) -> usize {
    block
        .children
        .iter()
        .map(|child| match child {
            RuntimeChild::Block(block) => matching_text_runs_in_block(block, demand),
            RuntimeChild::Line(line) => line
                .runs
                .iter()
                .filter(|run| matches!(run, LineRun::Text(run) if demand_for_run(run) == *demand))
                .count(),
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => 0,
        })
        .sum()
}

fn exact_sample_for_run<'a>(
    run: &TextRunBox,
    samples: &'a [FontVerticalMetricSample],
) -> &'a FontVerticalMetricSample {
    let font = &run.paint.measure().font;
    samples
        .iter()
        .find(|sample| {
            sample.font_family == font.family
                && sample.font_style == font.style.as_str()
                && f64::from(sample.font_weight) == font.weight
                && sample.font_size_px.to_bits() == run.font_size.to_bits()
        })
        .expect("the first run has an exact sample")
}

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-9,
        "expected {expected}, got {actual}"
    );
}
