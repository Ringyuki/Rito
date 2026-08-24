use std::{collections::BTreeSet, env, fs, process, time::Instant};

use rito_core::runtime::{
    encode_reader_artifact_v1, ReaderAdjacentAvailabilityV1, ReaderAdjacentDirectionV1,
    ReaderAdjacentRequestV1, ReaderArtifactRequestV1, ReaderArtifactV1, ReaderLayoutV1,
    ReaderLocatorV1, ReaderNavigationV1, ReaderSessionV1, ReaderSpreadModeV1,
    ReaderTextRenderingProfileV1, ReaderWorkBudgetV1,
};
use serde_json::json;
use sha2::{Digest, Sha256};

const LOCAL_PAGE_CAP: u32 = 16;
const DEFAULT_TURNS: usize = 8;
const DEFAULT_SAMPLES: usize = 6;

fn main() {
    if let Err(error) = run() {
        eprintln!("reader-v1-turn-probe: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if !(2..=4).contains(&args.len()) {
        return Err(
            "usage: reader-v1-turn-probe <epub> <chapter-href> [turns] [samples]".to_owned(),
        );
    }
    let epub = fs::read(&args[0]).map_err(|error| format!("read {}: {error}", args[0]))?;
    let href = args[1].clone();
    let turns = parse_positive(args.get(2), DEFAULT_TURNS, "turns")?;
    let samples = parse_positive(args.get(3), DEFAULT_SAMPLES, "samples")?;
    if turns >= usize::try_from(LOCAL_PAGE_CAP).unwrap_or(usize::MAX) {
        return Err(format!(
            "turns must be below local page cap {LOCAL_PAGE_CAP}"
        ));
    }

    let locators = discover_targets(&epub, &href, turns)?;
    let mut adjacent_ms = Vec::with_capacity(samples);
    let mut reseek_ms = Vec::with_capacity(samples);
    let mut sample_parity = Vec::with_capacity(samples);
    let mut output_digests = Vec::with_capacity(samples);
    let mut adjacent_revision_counts = Vec::with_capacity(samples);
    let mut reseek_revision_counts = Vec::with_capacity(samples);

    for sample in 0..samples {
        let sample_offset = u64::try_from(sample)
            .map_err(|_| "sample id overflow")?
            .checked_mul(4)
            .ok_or("session id overflow")?;
        let base = 1_000_u64
            .checked_add(sample_offset)
            .ok_or("session id overflow")?;
        let (adjacent, reseek) = if sample.is_multiple_of(2) {
            (
                measure_adjacent(&epub, &href, turns, base)?,
                measure_reseek(&epub, &href, &locators, base + 1)?,
            )
        } else {
            let reseek = measure_reseek(&epub, &href, &locators, base + 1)?;
            let adjacent = measure_adjacent(&epub, &href, turns, base)?;
            (adjacent, reseek)
        };
        sample_parity.push(visible_outputs_match(
            &adjacent.artifacts,
            &reseek.artifacts,
        ));
        output_digests.push(visible_output_digest(&adjacent.artifacts)?);
        adjacent_revision_counts.push(revision_count(&adjacent.artifacts));
        reseek_revision_counts.push(revision_count(&reseek.artifacts));
        adjacent_ms.push(adjacent.elapsed_ms);
        reseek_ms.push(reseek.elapsed_ms);
    }

    let output_stable = output_digests
        .first()
        .is_some_and(|first| output_digests.iter().all(|digest| digest == first));
    let parity_eligible = sample_parity.iter().all(|matches| *matches) && output_stable;
    let adjacent_median = median(&adjacent_ms);
    let reseek_median = median(&reseek_ms);
    let ratio = parity_eligible.then(|| reseek_median / adjacent_median);
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "protocol": "rito/reader-v1-turn-probe-v1",
            "scope": "same native core visible turns; reseek/re-layout divided by adjacent/revision-reuse",
            "epub": args[0],
            "epubByteLength": epub.len(),
            "epubSha256": hex_digest(Sha256::digest(&epub)),
            "chapterHref": href,
            "turnsPerSample": turns,
            "samples": samples,
            "order": "alternating adjacent-first/reseek-first",
            "parityEligible": parity_eligible,
            "sampleParity": sample_parity,
            "outputStable": output_stable,
            "visibleOutputSha256": output_digests.first(),
            "adjacent": {
                "rawMs": adjacent_ms,
                "medianMs": adjacent_median,
                "medianMsPerTurn": adjacent_median / turns as f64,
                "p95Ms": percentile_95(&adjacent_ms),
                "revisionCounts": adjacent_revision_counts,
            },
            "reseek": {
                "rawMs": reseek_ms,
                "medianMs": reseek_median,
                "medianMsPerTurn": reseek_median / turns as f64,
                "p95Ms": percentile_95(&reseek_ms),
                "revisionCounts": reseek_revision_counts,
            },
            "reseekMsDivAdjacentMsMedian": ratio,
            "interpretation": if parity_eligible {
                "eligible only for the Reader v1 adjacent-vs-reseek implementation comparison; not a TypeScript comparison"
            } else {
                "ineligible: at least one visible artifact sequence differed"
            },
        }))
        .map_err(|error| format!("encode report: {error}"))?
    );
    Ok(())
}

struct Measurement {
    elapsed_ms: f64,
    artifacts: Vec<ReaderArtifactV1>,
}

fn discover_targets(epub: &[u8], href: &str, turns: usize) -> Result<Vec<ReaderLocatorV1>, String> {
    let measurement = measure_adjacent(epub, href, turns, 900)?;
    Ok(measurement
        .artifacts
        .into_iter()
        .map(|artifact| artifact.locator)
        .collect())
}

fn measure_adjacent(
    epub: &[u8],
    href: &str,
    turns: usize,
    session_id: u64,
) -> Result<Measurement, String> {
    let mut session = ReaderSessionV1::open_owned(session_id, epub.to_vec())
        .map_err(|error| format!("open adjacent session: {error}"))?;
    let mut current = session
        .request_artifact(initial_request(session_id, href))
        .map_err(|error| format!("initial adjacent artifact: {error}"))?;
    let started = Instant::now();
    let mut artifacts = Vec::with_capacity(turns);
    for turn in 0..turns {
        let next = session
            .request_adjacent(ReaderAdjacentRequestV1 {
                session_id,
                request_id: u64::try_from(turn + 2).map_err(|_| "request id overflow")?,
                from_artifact_id: current.artifact_id,
                direction: ReaderAdjacentDirectionV1::Next,
                work: work_budget(),
            })
            .map_err(|error| format!("adjacent turn {}: {error}", turn + 1))?;
        session
            .release_artifact(current.artifact_id)
            .map_err(|error| format!("release adjacent source: {error}"))?;
        artifacts.push(next.clone());
        current = next;
    }
    let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
    session
        .release_artifact(current.artifact_id)
        .map_err(|error| format!("release final adjacent artifact: {error}"))?;
    session
        .dispose()
        .map_err(|error| format!("dispose adjacent session: {error}"))?;
    Ok(Measurement {
        elapsed_ms,
        artifacts,
    })
}

fn measure_reseek(
    epub: &[u8],
    href: &str,
    locators: &[ReaderLocatorV1],
    session_id: u64,
) -> Result<Measurement, String> {
    let mut session = ReaderSessionV1::open_owned(session_id, epub.to_vec())
        .map_err(|error| format!("open reseek session: {error}"))?;
    let initial = session
        .request_artifact(initial_request(session_id, href))
        .map_err(|error| format!("initial reseek artifact: {error}"))?;
    session
        .release_artifact(initial.artifact_id)
        .map_err(|error| format!("release initial reseek artifact: {error}"))?;
    let started = Instant::now();
    let mut artifacts = Vec::with_capacity(locators.len());
    let mut live_artifact_id = None;
    for (turn, locator) in locators.iter().enumerate() {
        let artifact = session
            .request_artifact(ReaderArtifactRequestV1 {
                session_id,
                request_id: u64::try_from(turn + 2).map_err(|_| "request id overflow")?,
                layout: layout(),
                locator: locator.clone(),
                work: work_budget(),
                text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
            })
            .map_err(|error| format!("reseek turn {}: {error}", turn + 1))?;
        if let Some(previous_artifact_id) = live_artifact_id.replace(artifact.artifact_id) {
            session
                .release_artifact(previous_artifact_id)
                .map_err(|error| format!("release reseek source: {error}"))?;
        }
        artifacts.push(artifact.clone());
    }
    let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
    if let Some(artifact_id) = live_artifact_id {
        session
            .release_artifact(artifact_id)
            .map_err(|error| format!("release final reseek artifact: {error}"))?;
    }
    session
        .dispose()
        .map_err(|error| format!("dispose reseek session: {error}"))?;
    Ok(Measurement {
        elapsed_ms,
        artifacts,
    })
}

fn initial_request(session_id: u64, href: &str) -> ReaderArtifactRequestV1 {
    ReaderArtifactRequestV1 {
        session_id,
        request_id: 1,
        layout: layout(),
        locator: ReaderLocatorV1 {
            href: href.to_owned(),
            anchor_id: None,
            source_point: None,
            source_range: None,
            progression: None,
        },
        work: work_budget(),
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
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        font_family_override: None,
    }
}

const fn work_budget() -> ReaderWorkBudgetV1 {
    ReaderWorkBudgetV1 {
        max_top_level_nodes_per_quantum: 32,
        max_foreground_quanta: 128,
        local_page_cap: LOCAL_PAGE_CAP,
    }
}

fn visible_outputs_match(left: &[ReaderArtifactV1], right: &[ReaderArtifactV1]) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(left, right)| {
            left.locator == right.locator
                && left.matched_by == right.matched_by
                && left.local_page_index == right.local_page_index
                && left.local_spread_index == right.local_spread_index
                && left.local_page_indexes == right.local_page_indexes
                && left.width == right.width
                && left.height == right.height
                && left.text_profile == right.text_profile
                && left.display_list == right.display_list
                && left.resources == right.resources
                && left.fonts == right.fonts
                && left.pages == right.pages
        })
}

fn revision_count(artifacts: &[ReaderArtifactV1]) -> usize {
    artifacts
        .iter()
        .map(|artifact| artifact.revision_id)
        .collect::<BTreeSet<_>>()
        .len()
}

fn visible_output_digest(artifacts: &[ReaderArtifactV1]) -> Result<String, String> {
    let mut digest = Sha256::new();
    for (index, artifact) in artifacts.iter().enumerate() {
        let identity = u64::try_from(index + 1).map_err(|_| "artifact identity overflow")?;
        let mut normalized = artifact.clone();
        normalized.session_id = 1;
        normalized.request_id = identity;
        normalized.revision_id = 1;
        normalized.revision_version = 1;
        normalized.artifact_id = identity;
        normalized.terminal_extent = false;
        normalized.navigation = ReaderNavigationV1 {
            previous: ReaderAdjacentAvailabilityV1::Blocked,
            next: ReaderAdjacentAvailabilityV1::Blocked,
        };
        let wire = encode_reader_artifact_v1(&normalized)
            .map_err(|error| format!("normalize visible artifact: {error}"))?;
        digest.update(
            u64::try_from(wire.len())
                .map_err(|_| "artifact wire length overflow")?
                .to_le_bytes(),
        );
        digest.update(wire);
    }
    Ok(hex_digest(digest.finalize()))
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn parse_positive(value: Option<&String>, default: usize, field: &str) -> Result<usize, String> {
    let parsed = match value {
        Some(value) => value
            .parse::<usize>()
            .map_err(|error| format!("invalid {field}: {error}"))?,
        None => default,
    };
    if parsed == 0 {
        return Err(format!("{field} must be positive"));
    }
    Ok(parsed)
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

fn percentile_95(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let index = (sorted.len() * 95).div_ceil(100).saturating_sub(1);
    sorted[index]
}
