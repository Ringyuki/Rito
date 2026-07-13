use std::cell::RefCell;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AtomicTextOperationKind {
    LineBreakScan,
    MeasureRequest,
    ShapeRequest,
    RustybuzzShapeRun,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MeasurementCacheOutcome {
    Hit,
    Miss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MeasurementCacheSource {
    MeasureWidth,
    ExactShapeAdvance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PrefixProbeTrace {
    pub(crate) start_utf16: usize,
    pub(crate) end_utf16: usize,
}

impl PrefixProbeTrace {
    pub(crate) const fn utf16_units(self) -> usize {
        self.end_utf16.saturating_sub(self.start_utf16)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LineBreakScanTrace {
    pub(crate) utf16_units: usize,
    pub(crate) boundary_count: usize,
    pub(crate) break_opportunity_count: usize,
    pub(crate) text_hash: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TextRequestTrace {
    pub(crate) kind: AtomicTextOperationKind,
    pub(crate) utf16_units: usize,
    pub(crate) text_hash: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MeasurementCacheTrace {
    pub(crate) source: MeasurementCacheSource,
    pub(crate) outcome: MeasurementCacheOutcome,
    pub(crate) utf16_units: usize,
    pub(crate) text_hash: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RustybuzzShapeRunTrace {
    pub(crate) utf16_units: usize,
    pub(crate) text_hash: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TextWorkEvent {
    PrefixProbe(PrefixProbeTrace),
    LineBreakScan(LineBreakScanTrace),
    TextRequest(TextRequestTrace),
    MeasurementCache(MeasurementCacheTrace),
    RustybuzzShapeRun(RustybuzzShapeRunTrace),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OversizedAtomicTextOperation {
    pub(crate) kind: AtomicTextOperationKind,
    pub(crate) utf16_units: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TextWorkTrace {
    pub(crate) events: Vec<TextWorkEvent>,
    pub(crate) prefix_probes: Vec<PrefixProbeTrace>,
    pub(crate) line_break_scans: Vec<LineBreakScanTrace>,
    pub(crate) text_requests: Vec<TextRequestTrace>,
    pub(crate) measurement_cache: Vec<MeasurementCacheTrace>,
    pub(crate) rustybuzz_shape_runs: Vec<RustybuzzShapeRunTrace>,
}

impl TextWorkTrace {
    pub(crate) fn max_request_utf16_units(&self, kind: AtomicTextOperationKind) -> usize {
        self.text_requests
            .iter()
            .filter(|request| request.kind == kind)
            .map(|request| request.utf16_units)
            .max()
            .unwrap_or(0)
    }

    pub(crate) fn max_rustybuzz_shape_run_utf16_units(&self) -> usize {
        self.rustybuzz_shape_runs
            .iter()
            .map(|run| run.utf16_units)
            .max()
            .unwrap_or(0)
    }

    pub(crate) fn oversized_atomic_operations(
        &self,
        max_utf16_units: usize,
    ) -> Vec<OversizedAtomicTextOperation> {
        self.events
            .iter()
            .filter_map(|event| match event {
                TextWorkEvent::LineBreakScan(scan) => oversized_operation(
                    AtomicTextOperationKind::LineBreakScan,
                    scan.utf16_units,
                    max_utf16_units,
                ),
                TextWorkEvent::TextRequest(request) => {
                    oversized_operation(request.kind, request.utf16_units, max_utf16_units)
                }
                TextWorkEvent::RustybuzzShapeRun(shape_run) => oversized_operation(
                    AtomicTextOperationKind::RustybuzzShapeRun,
                    shape_run.utf16_units,
                    max_utf16_units,
                ),
                TextWorkEvent::PrefixProbe(_) | TextWorkEvent::MeasurementCache(_) => None,
            })
            .collect()
    }
}

fn oversized_operation(
    kind: AtomicTextOperationKind,
    utf16_units: usize,
    max_utf16_units: usize,
) -> Option<OversizedAtomicTextOperation> {
    (utf16_units > max_utf16_units).then_some(OversizedAtomicTextOperation { kind, utf16_units })
}

thread_local! {
    static ACTIVE_TRACE: RefCell<Option<TextWorkTrace>> = const { RefCell::new(None) };
}

struct TraceCaptureGuard;

impl Drop for TraceCaptureGuard {
    fn drop(&mut self) {
        ACTIVE_TRACE.with(|trace| {
            trace.borrow_mut().take();
        });
    }
}

pub(crate) fn capture_text_work_trace<T>(operation: impl FnOnce() -> T) -> (T, TextWorkTrace) {
    ACTIVE_TRACE.with(|trace| {
        let mut trace = trace.borrow_mut();
        assert!(trace.is_none(), "text-work trace capture cannot be nested");
        *trace = Some(TextWorkTrace::default());
    });
    let guard = TraceCaptureGuard;
    let output = operation();
    let trace = ACTIVE_TRACE.with(|trace| {
        trace
            .borrow_mut()
            .take()
            .expect("text-work trace capture is active")
    });
    drop(guard);
    (output, trace)
}

pub(crate) fn record_prefix_probe(start_utf16: usize, end_utf16: usize) {
    with_active_trace(|trace| {
        let event = PrefixProbeTrace {
            start_utf16,
            end_utf16,
        };
        trace.prefix_probes.push(event);
        trace.events.push(TextWorkEvent::PrefixProbe(event));
    });
}

pub(crate) fn record_line_break_scan(
    text: &str,
    utf16_units: usize,
    boundary_count: usize,
    break_opportunity_count: usize,
) {
    with_active_trace(|trace| {
        let event = LineBreakScanTrace {
            utf16_units,
            boundary_count,
            break_opportunity_count,
            text_hash: stable_text_hash(text),
        };
        trace.line_break_scans.push(event);
        trace.events.push(TextWorkEvent::LineBreakScan(event));
    });
}

pub(crate) fn record_text_request(kind: AtomicTextOperationKind, text: &str) {
    with_active_trace(|trace| {
        let event = TextRequestTrace {
            kind,
            utf16_units: text.encode_utf16().count(),
            text_hash: stable_text_hash(text),
        };
        trace.text_requests.push(event);
        trace.events.push(TextWorkEvent::TextRequest(event));
    });
}

pub(crate) fn record_measurement_cache(
    text: &str,
    source: MeasurementCacheSource,
    outcome: MeasurementCacheOutcome,
) {
    with_active_trace(|trace| {
        let event = MeasurementCacheTrace {
            source,
            outcome,
            utf16_units: text.encode_utf16().count(),
            text_hash: stable_text_hash(text),
        };
        trace.measurement_cache.push(event);
        trace.events.push(TextWorkEvent::MeasurementCache(event));
    });
}

pub(crate) fn record_rustybuzz_shape_run(text: &str) {
    with_active_trace(|trace| {
        let event = RustybuzzShapeRunTrace {
            utf16_units: text.encode_utf16().count(),
            text_hash: stable_text_hash(text),
        };
        trace.rustybuzz_shape_runs.push(event);
        trace.events.push(TextWorkEvent::RustybuzzShapeRun(event));
    });
}

fn stable_text_hash(text: &str) -> u64 {
    text.as_bytes()
        .iter()
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
        })
}

fn with_active_trace(record: impl FnOnce(&mut TextWorkTrace)) {
    ACTIVE_TRACE.with(|trace| {
        if let Some(trace) = trace.borrow_mut().as_mut() {
            record(trace);
        }
    });
}
