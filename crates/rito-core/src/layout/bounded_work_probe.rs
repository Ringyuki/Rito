use std::{cell::RefCell, time::Instant};

use serde::Serialize;

use super::text_work::AtomicTextOperationKind;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedPaginationWorkProbe {
    pub capture_wall_time_ns: u64,
    pub quantum_count: u64,
    pub root: LayoutScopeWorkProbe,
    pub descendant: LayoutScopeWorkProbe,
    pub line_boxes: u64,
    pub text: TextWorkProbe,
    pub atomic_operations: AtomicTextOperationsProbe,
    pub measurement_cache: MeasurementCacheSourcesProbe,
    pub rustybuzz_shape_runs: RustybuzzShapeRunProbe,
    pub style_backend: StyleBackendWorkProbe,
    pub continuation_timings: ContinuationStageTimingsProbe,
    pub continuation_timing_semantics: ContinuationTimingSemanticsProbe,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleBackendWorkProbe {
    pub stylo_successes: u64,
    pub legacy_fallbacks: u64,
    pub source_topology_fallbacks: u64,
    pub unsupported_configuration_fallbacks: u64,
    pub source_gate_fallbacks: u64,
    pub invalid_viewport_fallbacks: u64,
    pub stylo_engine_fallbacks: u64,
    pub materialization_fallbacks: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutScopeWorkProbe {
    pub accepts: u64,
    pub starts: u64,
    pub start_yields: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextWorkProbe {
    pub resumable_utf16_units: u64,
    pub atomic_utf16_units: u64,
    pub total_utf16_units: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtomicTextOperationsProbe {
    pub inline_collection: AtomicTextOperationProbe,
    pub line_break_scan: AtomicTextOperationProbe,
    pub hyphenation: AtomicTextOperationProbe,
    pub measure: AtomicTextOperationProbe,
    pub shape: AtomicTextOperationProbe,
}

impl AtomicTextOperationsProbe {
    fn for_kind_mut(&mut self, kind: AtomicTextOperationKind) -> &mut AtomicTextOperationProbe {
        match kind {
            AtomicTextOperationKind::InlineCollection => &mut self.inline_collection,
            AtomicTextOperationKind::LineBreakScan => &mut self.line_break_scan,
            AtomicTextOperationKind::Hyphenation => &mut self.hyphenation,
            AtomicTextOperationKind::Measure => &mut self.measure,
            AtomicTextOperationKind::Shape => &mut self.shape,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtomicTextOperationProbe {
    pub permits: u64,
    pub yields: u64,
    pub oversized_permits: u64,
    pub permitted_utf16_units: u64,
    pub yielded_utf16_units: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementCacheSourcesProbe {
    pub total: MeasurementCacheProbe,
    pub measure_width: MeasurementCacheProbe,
    pub exact_shape_advance: MeasurementCacheProbe,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementCacheProbe {
    pub hits: u64,
    pub misses: u64,
    pub hit_utf16_units: u64,
    pub miss_utf16_units: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustybuzzShapeRunProbe {
    pub count: u64,
    pub utf16_units: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuationStageTimingsProbe {
    pub ensure_start_chapter: DurationProbe,
    pub font_assembly: DurationProbe,
    pub session_advance: DurationProbe,
    pub publish_cleanup: DurationProbe,
    pub chapter_start: ChapterStartTimingsProbe,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterStartTimingsProbe {
    pub footnote_index: DurationProbe,
    pub chapter_source_load: DurationProbe,
    pub chapter_image_preparation: DurationProbe,
    pub document_window: DurationProbe,
    pub chapter_parse: DurationProbe,
    pub prepared_base: DurationProbe,
    pub font_fallback_discovery: DurationProbe,
    pub css_rule_assembly: DurationProbe,
    pub style_resolution: DurationProbe,
    pub font_fallback_rewrite: DurationProbe,
    pub interaction_build: DurationProbe,
    pub session_initialize: DurationProbe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuationTimingSemanticsProbe {
    pub ensure_start_chapter_includes_chapter_start: bool,
    pub document_window_includes_chapter_parse: bool,
    pub document_window_includes_prepared_base: bool,
    pub nested_durations_are_not_additive: bool,
}

impl Default for ContinuationTimingSemanticsProbe {
    fn default() -> Self {
        Self {
            ensure_start_chapter_includes_chapter_start: true,
            document_window_includes_chapter_parse: true,
            document_window_includes_prepared_base: true,
            nested_durations_are_not_additive: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurationProbe {
    pub calls: u64,
    pub total_ns: u64,
    pub max_ns: u64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum ContinuationTimingStage {
    EnsureStartChapter,
    FontAssembly,
    SessionAdvance,
    PublishCleanup,
    FootnoteIndex,
    ChapterSourceLoad,
    ChapterImagePreparation,
    DocumentWindow,
    ChapterParse,
    PreparedBase,
    FontFallbackDiscovery,
    #[expect(
        dead_code,
        reason = "the probe keeps the retired legacy stage for baseline schema continuity"
    )]
    CssRuleAssembly,
    StyleResolution,
    FontFallbackRewrite,
    InteractionBuild,
    SessionInitialize,
}

#[derive(Debug, Clone, Copy)]
enum MeasurementCacheSource {
    MeasureWidth,
    ExactShapeAdvance,
}

thread_local! {
    static ACTIVE_PROBE: RefCell<Option<BoundedPaginationWorkProbe>> = const { RefCell::new(None) };
}

struct ProbeCaptureGuard;

pub(crate) struct ProbeTimingGuard {
    stage: ContinuationTimingStage,
    started_at: Instant,
}

impl Drop for ProbeCaptureGuard {
    fn drop(&mut self) {
        ACTIVE_PROBE.with(|probe| {
            probe.borrow_mut().take();
        });
    }
}

impl Drop for ProbeTimingGuard {
    fn drop(&mut self) {
        record_timing(self.stage, self.started_at.elapsed().as_nanos());
    }
}

pub fn capture_bounded_pagination_work<T>(
    operation: impl FnOnce() -> T,
) -> (T, BoundedPaginationWorkProbe) {
    let style_backend_before = crate::style::style_backend_metrics();
    ACTIVE_PROBE.with(|probe| {
        let mut probe = probe.borrow_mut();
        assert!(
            probe.is_none(),
            "bounded work probe capture cannot be nested"
        );
        *probe = Some(BoundedPaginationWorkProbe::default());
    });
    let guard = ProbeCaptureGuard;
    let started_at = Instant::now();
    let output = operation();
    let elapsed_ns = started_at.elapsed().as_nanos();
    let mut probe = ACTIVE_PROBE.with(|probe| {
        probe
            .borrow_mut()
            .take()
            .expect("bounded work probe capture is active")
    });
    probe.capture_wall_time_ns = saturating_u64(elapsed_ns);
    probe.style_backend =
        style_backend_delta(style_backend_before, crate::style::style_backend_metrics());
    drop(guard);
    (output, probe)
}

fn style_backend_delta(
    before: crate::style::StyleBackendMetrics,
    after: crate::style::StyleBackendMetrics,
) -> StyleBackendWorkProbe {
    StyleBackendWorkProbe {
        stylo_successes: after.stylo_successes.saturating_sub(before.stylo_successes),
        legacy_fallbacks: after
            .legacy_fallbacks
            .saturating_sub(before.legacy_fallbacks),
        source_topology_fallbacks: after
            .source_topology_fallbacks
            .saturating_sub(before.source_topology_fallbacks),
        unsupported_configuration_fallbacks: after
            .unsupported_configuration_fallbacks
            .saturating_sub(before.unsupported_configuration_fallbacks),
        source_gate_fallbacks: after
            .source_gate_fallbacks
            .saturating_sub(before.source_gate_fallbacks),
        invalid_viewport_fallbacks: after
            .invalid_viewport_fallbacks
            .saturating_sub(before.invalid_viewport_fallbacks),
        stylo_engine_fallbacks: after
            .stylo_engine_fallbacks
            .saturating_sub(before.stylo_engine_fallbacks),
        materialization_fallbacks: after
            .materialization_fallbacks
            .saturating_sub(before.materialization_fallbacks),
    }
}

pub(crate) fn start_timing(stage: ContinuationTimingStage) -> Option<ProbeTimingGuard> {
    let active = ACTIVE_PROBE.with(|probe| probe.borrow().is_some());
    active.then(|| ProbeTimingGuard {
        stage,
        started_at: Instant::now(),
    })
}

pub(super) fn record_quantum() {
    with_active_probe(|probe| increment(&mut probe.quantum_count, 1));
}

pub(super) fn record_accepts(descendant: bool, count: usize) {
    with_active_probe(|probe| {
        increment(&mut scope_mut(probe, descendant).accepts, count);
    });
}

pub(super) fn record_start(descendant: bool, permitted: bool) {
    with_active_probe(|probe| {
        let scope = scope_mut(probe, descendant);
        if permitted {
            increment(&mut scope.starts, 1);
        } else {
            increment(&mut scope.start_yields, 1);
        }
    });
}

pub(super) fn record_line_boxes(count: usize) {
    with_active_probe(|probe| increment(&mut probe.line_boxes, count));
}

pub(super) fn record_resumable_utf16(count: usize) {
    with_active_probe(|probe| {
        increment(&mut probe.text.resumable_utf16_units, count);
        increment(&mut probe.text.total_utf16_units, count);
    });
}

pub(super) fn record_atomic_permit(
    kind: AtomicTextOperationKind,
    utf16_units: usize,
    oversized: bool,
) {
    with_active_probe(|probe| {
        let operation = probe.atomic_operations.for_kind_mut(kind);
        increment(&mut operation.permits, 1);
        increment(&mut operation.permitted_utf16_units, utf16_units);
        if oversized {
            increment(&mut operation.oversized_permits, 1);
        }
        increment(&mut probe.text.atomic_utf16_units, utf16_units);
        increment(&mut probe.text.total_utf16_units, utf16_units);
    });
}

pub(super) fn record_atomic_yield(kind: AtomicTextOperationKind, utf16_units: usize) {
    with_active_probe(|probe| {
        let operation = probe.atomic_operations.for_kind_mut(kind);
        increment(&mut operation.yields, 1);
        increment(&mut operation.yielded_utf16_units, utf16_units);
    });
}

pub(super) fn record_measure_width_cache(hit: bool, text: &str) {
    record_measurement_cache(MeasurementCacheSource::MeasureWidth, hit, text);
}

pub(super) fn record_exact_shape_advance_cache(hit: bool, text: &str) {
    record_measurement_cache(MeasurementCacheSource::ExactShapeAdvance, hit, text);
}

pub(super) fn record_rustybuzz_shape_run(text: &str) {
    with_active_probe(|probe| {
        increment(&mut probe.rustybuzz_shape_runs.count, 1);
        increment(
            &mut probe.rustybuzz_shape_runs.utf16_units,
            text.encode_utf16().count(),
        );
    });
}

fn record_measurement_cache(source: MeasurementCacheSource, hit: bool, text: &str) {
    with_active_probe(|probe| {
        let utf16_units = text.encode_utf16().count();
        record_cache_outcome(&mut probe.measurement_cache.total, hit, utf16_units);
        let source = match source {
            MeasurementCacheSource::MeasureWidth => &mut probe.measurement_cache.measure_width,
            MeasurementCacheSource::ExactShapeAdvance => {
                &mut probe.measurement_cache.exact_shape_advance
            }
        };
        record_cache_outcome(source, hit, utf16_units);
    });
}

fn record_timing(stage: ContinuationTimingStage, elapsed_ns: u128) {
    with_active_probe(|probe| {
        let timing = match stage {
            ContinuationTimingStage::EnsureStartChapter => {
                &mut probe.continuation_timings.ensure_start_chapter
            }
            ContinuationTimingStage::FontAssembly => &mut probe.continuation_timings.font_assembly,
            ContinuationTimingStage::SessionAdvance => {
                &mut probe.continuation_timings.session_advance
            }
            ContinuationTimingStage::PublishCleanup => {
                &mut probe.continuation_timings.publish_cleanup
            }
            ContinuationTimingStage::FootnoteIndex => {
                &mut probe.continuation_timings.chapter_start.footnote_index
            }
            ContinuationTimingStage::ChapterSourceLoad => {
                &mut probe.continuation_timings.chapter_start.chapter_source_load
            }
            ContinuationTimingStage::ChapterImagePreparation => {
                &mut probe
                    .continuation_timings
                    .chapter_start
                    .chapter_image_preparation
            }
            ContinuationTimingStage::DocumentWindow => {
                &mut probe.continuation_timings.chapter_start.document_window
            }
            ContinuationTimingStage::ChapterParse => {
                &mut probe.continuation_timings.chapter_start.chapter_parse
            }
            ContinuationTimingStage::PreparedBase => {
                &mut probe.continuation_timings.chapter_start.prepared_base
            }
            ContinuationTimingStage::FontFallbackDiscovery => {
                &mut probe
                    .continuation_timings
                    .chapter_start
                    .font_fallback_discovery
            }
            ContinuationTimingStage::CssRuleAssembly => {
                &mut probe.continuation_timings.chapter_start.css_rule_assembly
            }
            ContinuationTimingStage::StyleResolution => {
                &mut probe.continuation_timings.chapter_start.style_resolution
            }
            ContinuationTimingStage::FontFallbackRewrite => {
                &mut probe
                    .continuation_timings
                    .chapter_start
                    .font_fallback_rewrite
            }
            ContinuationTimingStage::InteractionBuild => {
                &mut probe.continuation_timings.chapter_start.interaction_build
            }
            ContinuationTimingStage::SessionInitialize => {
                &mut probe.continuation_timings.chapter_start.session_initialize
            }
        };
        timing.calls = timing.calls.saturating_add(1);
        let elapsed_ns = saturating_u64(elapsed_ns);
        timing.total_ns = timing.total_ns.saturating_add(elapsed_ns);
        timing.max_ns = timing.max_ns.max(elapsed_ns);
    });
}

fn record_cache_outcome(probe: &mut MeasurementCacheProbe, hit: bool, utf16_units: usize) {
    if hit {
        increment(&mut probe.hits, 1);
        increment(&mut probe.hit_utf16_units, utf16_units);
    } else {
        increment(&mut probe.misses, 1);
        increment(&mut probe.miss_utf16_units, utf16_units);
    }
}

fn scope_mut(
    probe: &mut BoundedPaginationWorkProbe,
    descendant: bool,
) -> &mut LayoutScopeWorkProbe {
    if descendant {
        &mut probe.descendant
    } else {
        &mut probe.root
    }
}

fn increment(target: &mut u64, count: usize) {
    let count = u64::try_from(count).unwrap_or(u64::MAX);
    *target = target.saturating_add(count);
}

fn saturating_u64(value: u128) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

fn with_active_probe(record: impl FnOnce(&mut BoundedPaginationWorkProbe)) {
    ACTIVE_PROBE.with(|probe| {
        if let Some(probe) = probe.borrow_mut().as_mut() {
            record(probe);
        }
    });
}

#[cfg(test)]
mod tests {
    use std::{mem::size_of, num::NonZeroUsize};

    use super::{
        capture_bounded_pagination_work, start_timing, BoundedPaginationWorkProbe,
        ContinuationTimingStage,
    };
    use crate::layout::{
        pagination_session::{LayoutSessionScope, LayoutWorkBudget, LayoutWorkMeter},
        text_work::{AtomicTextOperationKind, TextWorkPermitResult},
    };

    #[test]
    fn aggregates_bounded_work_without_event_storage() {
        let (_, probe) = capture_bounded_pagination_work(|| {
            let budget =
                LayoutWorkBudget::with_text_work_limits(non_zero(2), non_zero(4), non_zero(1));
            let mut work = LayoutWorkMeter::new(budget);
            work.consume_accepts(LayoutSessionScope::Root, 1);
            work.consume_accepts(LayoutSessionScope::Descendant, 2);
            assert!(work.try_start_node(LayoutSessionScope::Root));
            assert!(work.try_start_node(LayoutSessionScope::Descendant));
            work.consume_line_boxes(3);
            assert_eq!(work.text_work_mut().take_utf16_units(1), 1);
            assert!(matches!(
                work.text_work_mut()
                    .try_permit_atomic(AtomicTextOperationKind::Measure, 3),
                TextWorkPermitResult::Permit { .. }
            ));
            assert_eq!(
                work.text_work_mut()
                    .try_permit_atomic(AtomicTextOperationKind::Shape, 1),
                TextWorkPermitResult::Yield
            );

            let oversized_budget =
                LayoutWorkBudget::with_text_work_limits(non_zero(1), non_zero(4), non_zero(2));
            let mut oversized = LayoutWorkMeter::new(oversized_budget);
            assert!(matches!(
                oversized
                    .text_work_mut()
                    .try_permit_atomic(AtomicTextOperationKind::LineBreakScan, 5),
                TextWorkPermitResult::Permit {
                    oversized: true,
                    ..
                }
            ));

            super::record_measure_width_cache(false, "abc");
            super::record_measure_width_cache(true, "abc");
            super::record_exact_shape_advance_cache(true, "xy");
            super::record_rustybuzz_shape_run("a💡");
            let _timing = start_timing(ContinuationTimingStage::SessionAdvance);
            {
                let _ensure = start_timing(ContinuationTimingStage::EnsureStartChapter);
                let _window = start_timing(ContinuationTimingStage::DocumentWindow);
                let _parse = start_timing(ContinuationTimingStage::ChapterParse);
                let _base = start_timing(ContinuationTimingStage::PreparedBase);
            }
        });

        assert_eq!(probe.quantum_count, 2);
        assert_eq!(probe.root.accepts, 1);
        assert_eq!(probe.root.starts, 1);
        assert_eq!(probe.descendant.accepts, 2);
        assert_eq!(probe.descendant.starts, 1);
        assert_eq!(probe.line_boxes, 3);
        assert_eq!(probe.text.resumable_utf16_units, 1);
        assert_eq!(probe.text.atomic_utf16_units, 8);
        assert_eq!(probe.text.total_utf16_units, 9);
        assert_eq!(probe.atomic_operations.measure.permits, 1);
        assert_eq!(probe.atomic_operations.shape.yields, 1);
        assert_eq!(probe.atomic_operations.line_break_scan.oversized_permits, 1);
        assert_eq!(probe.measurement_cache.total.hits, 2);
        assert_eq!(probe.measurement_cache.total.misses, 1);
        assert_eq!(probe.rustybuzz_shape_runs.count, 1);
        assert_eq!(probe.rustybuzz_shape_runs.utf16_units, 3);
        assert_eq!(probe.continuation_timings.session_advance.calls, 1);
        assert_eq!(probe.continuation_timings.ensure_start_chapter.calls, 1);
        assert_eq!(
            probe
                .continuation_timings
                .chapter_start
                .document_window
                .calls,
            1
        );
        assert_eq!(
            probe.continuation_timings.chapter_start.chapter_parse.calls,
            1
        );
        assert_eq!(
            probe.continuation_timings.chapter_start.prepared_base.calls,
            1
        );
        assert!(
            probe
                .continuation_timing_semantics
                .ensure_start_chapter_includes_chapter_start
        );
        assert!(
            probe
                .continuation_timing_semantics
                .nested_durations_are_not_additive
        );
        assert!(probe.capture_wall_time_ns >= probe.continuation_timings.session_advance.total_ns);
    }

    #[test]
    fn aggregate_has_a_fixed_small_footprint() {
        assert!(size_of::<BoundedPaginationWorkProbe>() <= 1_024);
    }

    fn non_zero(value: usize) -> NonZeroUsize {
        NonZeroUsize::new(value).expect("test value is non-zero")
    }
}
