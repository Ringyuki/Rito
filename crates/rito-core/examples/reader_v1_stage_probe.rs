use std::{env, fs, process, time::Instant};

use rito_core::{
    bench::{capture_bounded_pagination_work, BoundedPaginationWorkProbe},
    runtime::{
        encode_reader_artifact_v1, ReaderArtifactRequestV1, ReaderArtifactV1, ReaderDisposeAckV1,
        ReaderErrorKindV1, ReaderLayoutV1, ReaderLocatorMatchV1, ReaderLocatorV1, ReaderSessionV1,
        ReaderSpreadModeV1, ReaderTextRenderingProfileV1, ReaderWorkBudgetV1,
    },
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const DEFAULT_EPUB_PATH: &str = "packages/rito/tests/fixtures/books/book-10.epub";
const BOOK10_SHA256: &str = "7e9a8d4d6dfb7f24ab05544375322cf9ef1e49dd865231f964f5d296cd1336ba";
const BOOK10_BYTE_LENGTH: usize = 852_438;
const TARGET_HREF: &str = "OEBPS/Text/Section011.xhtml";
const SAMPLE_COUNT: usize = 12;
const MAX_REQUEST_COUNT: u64 = 4_096;
const SESSION_ID: u64 = 1;

fn main() {
    if let Err(error) = run() {
        eprintln!("reader-v1-stage-probe: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let epub_path = input_path()?;
    let epub = fs::read(&epub_path).map_err(|error| format!("read {epub_path}: {error}"))?;
    let epub_sha256 = hex_digest(Sha256::digest(&epub));
    if epub.len() != BOOK10_BYTE_LENGTH || epub_sha256 != BOOK10_SHA256 {
        return Err(format!(
            "fixture identity mismatch: expected {BOOK10_BYTE_LENGTH} bytes/{BOOK10_SHA256}, got {} bytes/{epub_sha256}",
            epub.len()
        ));
    }

    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    for sample_index in 0..SAMPLE_COUNT {
        samples.push(run_fresh_session(sample_index, &epub)?);
    }
    require_stable_output(&samples)?;
    let warm_samples = &samples[1..];
    let report = json!({
        "schemaVersion": 1,
        "protocol": "rito/reader-v1-stage-probe-v1",
        "scope": {
            "processIsolation": "one-process",
            "sessionIsolation": "fresh ReaderSessionV1 per sample",
            "epubReadAndHashExcluded": true,
            "epubOwnedCloneIncludedInOpenOwned": true,
            "hostYieldBetweenRequests": false,
            "uiSchedulingMeasured": false,
            "workerTransportMeasured": false,
            "wasmBoundaryMeasured": false,
            "canvasMeasured": false,
            "firstSampleDisposition": "reported separately; includes first-use process state",
            "summaryDisposition": "R-7 p50/p95 over samples 1..11 only",
        },
        "input": {
            "epubPath": epub_path,
            "epubByteLength": epub.len(),
            "epubSha256": epub_sha256,
            "target": { "href": TARGET_HREF, "progression": 0.0 },
            "layout": layout_report(),
            "work": {
                "maxTopLevelNodesPerQuantum": 64,
                "maxForegroundQuanta": 1,
                "localPageCap": 16,
                "maximumRequestCount": MAX_REQUEST_COUNT,
            },
            "textProfile": "platform-string-runs",
            "sampleCount": SAMPLE_COUNT,
        },
        "outputIdentity": {
            "stableAcrossAllSessions": true,
            "ritoart1Sha256": samples[0].artifact_wire_sha256,
            "ritoart1ByteLength": samples[0].artifact_wire_byte_length,
        },
        "firstFreshSession": &samples[0],
        "warmFreshSessions": warm_samples,
        "warmFreshSessionStatistics": warm_statistics(warm_samples),
        "interpretation": {
            "purpose": "attribute ReaderV1 Core compute without Worker, WASM transport, Canvas, animation, or host scheduling",
            "requestWall": "all strictly increasing foreground requests needed to resolve the exact locator; no host yield occurs between retries",
            "probe": "nested chapter-start durations are diagnostic subspans and are not additive to their enclosing ensureStartChapter/documentWindow durations",
            "pageIdentity": "localPageIndex 0 is Section011's chapter-local first page; the fixture check proves firstSpineHref differs from the target, so this is not publication page one",
            "latencyBoundary": "same-process fresh-session evidence only; it neither replaces nor recomputes browser r1/r2 latency",
        },
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&report)
            .map_err(|error| format!("serialize stage probe: {error}"))?
    );
    Ok(())
}

fn input_path() -> Result<String, String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    match args.as_slice() {
        [] => Ok(DEFAULT_EPUB_PATH.to_owned()),
        [path] => Ok(path.clone()),
        _ => Err("usage: reader-v1-stage-probe [book-10.epub]".to_owned()),
    }
}

fn run_fresh_session(sample_index: usize, epub: &[u8]) -> Result<StageSample, String> {
    let open_started = Instant::now();
    let mut session = ReaderSessionV1::open_owned(SESSION_ID, epub.to_vec())
        .map_err(|error| format!("sample {sample_index} open_owned: {error}"))?;
    let open_owned_ns = elapsed_ns(open_started);
    let first_spine_href = session
        .publication_v1()
        .spine
        .first()
        .map(|item| item.href.clone())
        .ok_or_else(|| format!("sample {sample_index} publication has no spine"))?;
    if first_spine_href == TARGET_HREF {
        return Err(
            "book-10 invariant failed: target unexpectedly is publication page one".to_owned(),
        );
    }

    let request_started = Instant::now();
    let (request_result, probe) =
        capture_bounded_pagination_work(|| request_exact_artifact(&mut session, sample_index));
    let request_wall_ns = elapsed_ns(request_started);
    let (artifact, request_count) = request_result?;
    validate_artifact(&artifact, request_count, sample_index)?;

    let encode_started = Instant::now();
    let artifact_wire = encode_reader_artifact_v1(&artifact)
        .map_err(|error| format!("sample {sample_index} encode RITOART1: {error}"))?;
    let artifact_encode_ns = elapsed_ns(encode_started);
    let artifact_wire_sha256 = hex_digest(Sha256::digest(&artifact_wire));

    let dispose_started = Instant::now();
    let dispose = session
        .dispose()
        .map_err(|error| format!("sample {sample_index} dispose: {error}"))?;
    let dispose_ns = elapsed_ns(dispose_started);
    validate_dispose(dispose, sample_index)?;
    let timings = StageTimings {
        open_owned_ns,
        request_wall_ns,
        artifact_encode_ns,
        dispose_ns,
        total_measured_core_ns: open_owned_ns
            .saturating_add(request_wall_ns)
            .saturating_add(artifact_encode_ns)
            .saturating_add(dispose_ns),
    };
    Ok(StageSample {
        sample_index,
        request_count,
        final_request_id: artifact.request_id,
        first_spine_href,
        resolved_href: artifact.locator.href,
        matched_by: "progression",
        local_page_index: artifact.local_page_index,
        local_spread_index: artifact.local_spread_index,
        display_list_command_count: artifact.display_list.command_count,
        display_list_byte_length: artifact.display_list.bytes.len(),
        artifact_wire_byte_length: artifact_wire.len(),
        artifact_wire_sha256,
        timings,
        probe,
    })
}

fn request_exact_artifact(
    session: &mut ReaderSessionV1,
    sample_index: usize,
) -> Result<(ReaderArtifactV1, u64), String> {
    for request_id in 1..=MAX_REQUEST_COUNT {
        match session.request_artifact(request(request_id)) {
            Ok(artifact) => return Ok((artifact, request_id)),
            Err(error)
                if error.kind == ReaderErrorKindV1::TargetNotPublished
                    && session.has_pending_exact_seek_v1() => {}
            Err(error) => {
                return Err(format!(
                    "sample {sample_index} request {request_id}: {:?}: {}",
                    error.kind, error.message
                ));
            }
        }
    }
    Err(format!(
        "sample {sample_index} exact locator remained pending after {MAX_REQUEST_COUNT} requests"
    ))
}

fn request(request_id: u64) -> ReaderArtifactRequestV1 {
    ReaderArtifactRequestV1 {
        session_id: SESSION_ID,
        request_id,
        layout: layout(),
        locator: ReaderLocatorV1 {
            href: TARGET_HREF.to_owned(),
            anchor_id: None,
            source_point: None,
            source_range: None,
            progression: Some(0.0),
        },
        work: ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: 64,
            max_foreground_quanta: 1,
            local_page_cap: 16,
        },
        text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
    }
}

fn layout() -> ReaderLayoutV1 {
    ReaderLayoutV1 {
        viewport_width: 600.0,
        viewport_height: 800.0,
        margin_top: 40.0,
        margin_right: 40.0,
        margin_bottom: 40.0,
        margin_left: 40.0,
        spread_mode: ReaderSpreadModeV1::Single,
        first_page_alone: false,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        font_family_override: None,
    }
}

fn validate_artifact(
    artifact: &ReaderArtifactV1,
    request_count: u64,
    sample_index: usize,
) -> Result<(), String> {
    let exact_locator = artifact.locator.href == TARGET_HREF
        && artifact.locator.progression == Some(0.0)
        && artifact.matched_by == ReaderLocatorMatchV1::Progression;
    let identity = artifact.session_id == SESSION_ID
        && artifact.request_id == request_count
        && artifact.artifact_id > 0
        && artifact.revision_id > 0;
    let exact_first_target_page = artifact.local_page_index == 0
        && artifact.local_spread_index == 0
        && artifact.local_page_indexes.len() == 1
        && artifact.local_page_indexes.first() == Some(&0);
    let paint_ready = artifact.display_list.command_count > 0
        && !artifact.display_list.bytes.is_empty()
        && !artifact.pages.is_empty()
        && artifact.text_profile == ReaderTextRenderingProfileV1::PlatformStringRuns;
    if !exact_locator || !identity || !exact_first_target_page || !paint_ready {
        return Err(format!(
            "sample {sample_index} returned a non-exact, page-one, empty, or invalid artifact"
        ));
    }
    Ok(())
}

fn validate_dispose(dispose: ReaderDisposeAckV1, sample_index: usize) -> Result<(), String> {
    if dispose.session_id != SESSION_ID || dispose.released_artifacts != 1 {
        return Err(format!(
            "sample {sample_index} dispose released {} artifacts for session {}",
            dispose.released_artifacts, dispose.session_id
        ));
    }
    Ok(())
}

fn require_stable_output(samples: &[StageSample]) -> Result<(), String> {
    let first = samples
        .first()
        .ok_or_else(|| "stage probe produced no samples".to_owned())?;
    if samples.iter().all(|sample| {
        sample.artifact_wire_sha256 == first.artifact_wire_sha256
            && sample.artifact_wire_byte_length == first.artifact_wire_byte_length
            && sample.request_count == first.request_count
    }) {
        Ok(())
    } else {
        Err("fresh sessions produced different RITOART1 bytes or request counts".to_owned())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StageSample {
    sample_index: usize,
    request_count: u64,
    final_request_id: u64,
    first_spine_href: String,
    resolved_href: String,
    matched_by: &'static str,
    local_page_index: u32,
    local_spread_index: u32,
    display_list_command_count: u32,
    display_list_byte_length: usize,
    artifact_wire_byte_length: usize,
    artifact_wire_sha256: String,
    timings: StageTimings,
    probe: BoundedPaginationWorkProbe,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct StageTimings {
    open_owned_ns: u64,
    request_wall_ns: u64,
    artifact_encode_ns: u64,
    dispose_ns: u64,
    total_measured_core_ns: u64,
}

fn warm_statistics(samples: &[StageSample]) -> Value {
    json!({
        "sampleIndexes": samples.iter().map(|sample| sample.sample_index).collect::<Vec<_>>(),
        "timings": {
            "openOwnedNs": summarize(samples, |sample| sample.timings.open_owned_ns),
            "requestWallNs": summarize(samples, |sample| sample.timings.request_wall_ns),
            "artifactEncodeNs": summarize(samples, |sample| sample.timings.artifact_encode_ns),
            "disposeNs": summarize(samples, |sample| sample.timings.dispose_ns),
            "totalMeasuredCoreNs": summarize(samples, |sample| sample.timings.total_measured_core_ns),
            "probeCaptureWallNs": summarize(samples, |sample| sample.probe.capture_wall_time_ns),
        },
        "continuationStages": {
            "ensureStartChapterNs": summarize(samples, |sample| sample.probe.continuation_timings.ensure_start_chapter.total_ns),
            "fontAssemblyNs": summarize(samples, |sample| sample.probe.continuation_timings.font_assembly.total_ns),
            "sessionAdvanceNs": summarize(samples, |sample| sample.probe.continuation_timings.session_advance.total_ns),
            "publishCleanupNs": summarize(samples, |sample| sample.probe.continuation_timings.publish_cleanup.total_ns),
            "footnoteIndexNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.footnote_index.total_ns),
            "chapterSourceLoadNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.chapter_source_load.total_ns),
            "chapterImagePreparationNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.chapter_image_preparation.total_ns),
            "chapterParseNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.chapter_parse.total_ns),
            "documentWindowNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.document_window.total_ns),
            "preparedBaseNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.prepared_base.total_ns),
            "fontFallbackDiscoveryNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.font_fallback_discovery.total_ns),
            "cssRuleAssemblyNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.css_rule_assembly.total_ns),
            "styleResolutionNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.style_resolution.total_ns),
            "fontFallbackRewriteNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.font_fallback_rewrite.total_ns),
            "interactionBuildNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.interaction_build.total_ns),
            "sessionInitializeNs": summarize(samples, |sample| sample.probe.continuation_timings.chapter_start.session_initialize.total_ns),
        },
        "workCounters": {
            "quantumCount": summarize(samples, |sample| sample.probe.quantum_count),
            "shapeRunCount": summarize(samples, |sample| sample.probe.rustybuzz_shape_runs.count),
            "shapeUtf16Units": summarize(samples, |sample| sample.probe.rustybuzz_shape_runs.utf16_units),
            "measurementCacheHits": summarize(samples, |sample| sample.probe.measurement_cache.total.hits),
            "measurementCacheMisses": summarize(samples, |sample| sample.probe.measurement_cache.total.misses),
        },
        "styleBackendCounters": {
            "styloSuccesses": summarize(samples, |sample| sample.probe.style_backend.stylo_successes),
            "legacyFallbacks": summarize(samples, |sample| sample.probe.style_backend.legacy_fallbacks),
            "sourceTopologyFallbacks": summarize(samples, |sample| sample.probe.style_backend.source_topology_fallbacks),
            "unsupportedConfigurationFallbacks": summarize(samples, |sample| sample.probe.style_backend.unsupported_configuration_fallbacks),
            "sourceGateFallbacks": summarize(samples, |sample| sample.probe.style_backend.source_gate_fallbacks),
            "invalidViewportFallbacks": summarize(samples, |sample| sample.probe.style_backend.invalid_viewport_fallbacks),
            "styloEngineFallbacks": summarize(samples, |sample| sample.probe.style_backend.stylo_engine_fallbacks),
            "materializationFallbacks": summarize(samples, |sample| sample.probe.style_backend.materialization_fallbacks),
        },
    })
}

fn summarize(samples: &[StageSample], value: impl Fn(&StageSample) -> u64) -> Value {
    let raw = samples.iter().map(value).collect::<Vec<_>>();
    json!({
        "raw": raw,
        "p50": percentile_r7(&raw, 0.50),
        "p95": percentile_r7(&raw, 0.95),
        "max": raw.iter().copied().max().unwrap_or(0),
    })
}

fn percentile_r7(values: &[u64], probability: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let position = (sorted.len().saturating_sub(1)) as f64 * probability;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let fraction = position - lower as f64;
    sorted[lower] as f64 + (sorted[upper] - sorted[lower]) as f64 * fraction
}

fn elapsed_ns(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_nanos()).unwrap_or(u64::MAX)
}

fn layout_report() -> Value {
    json!({
        "viewportWidth": 600,
        "viewportHeight": 800,
        "marginTop": 40,
        "marginRight": 40,
        "marginBottom": 40,
        "marginLeft": 40,
        "spreadMode": "single",
        "firstPageAlone": false,
        "spreadGap": 0,
        "rootFontSize": 16,
    })
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
