use std::{env, fs, process, time::Instant};

use rito_core::runtime::{
    ReaderAdjacentDirectionV1, ReaderAdjacentRequestV1, ReaderArtifactRequestV1, ReaderArtifactV1,
    ReaderErrorKindV1, ReaderLayoutV1, ReaderLocatorV1, ReaderSessionV1, ReaderSpreadModeV1,
    ReaderTextRenderingProfileV1, ReaderWorkBudgetV1, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole, RuntimePinnedFontPolicyInput,
};
use sha2::{Digest, Sha256};

const WORK: ReaderWorkBudgetV1 = ReaderWorkBudgetV1 {
    max_top_level_nodes_per_quantum: 32,
    max_foreground_quanta: 8,
    local_page_cap: 16,
};
const MAX_RETRIES: u64 = 4096;

fn main() {
    if let Err(error) = run() {
        eprintln!("reader-v1-prev-probe: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        return Err("usage: reader-v1-prev-probe <epub> <chapter-href> <serif-font>".to_owned());
    }
    let epub = fs::read(&args[0]).map_err(|error| format!("read {}: {error}", args[0]))?;
    let href = args[1].clone();
    let serif = fs::read(&args[2]).map_err(|error| format!("read {}: {error}", args[2]))?;

    for direction in [
        ReaderAdjacentDirectionV1::Next,
        ReaderAdjacentDirectionV1::Previous,
    ] {
        let policy = RuntimePinnedFontPolicyInput {
            faces: vec![RuntimePinnedFontFaceInput {
                expected_sha256: format!("{:x}", Sha256::digest(&serif)),
                bytes: serif.clone(),
                generic_role: RuntimePinnedFontGenericRole::Serif,
                language: None,
            }],
        };
        let mut session =
            ReaderSessionV1::open_owned_with_pinned_font_policy(7, epub.clone(), policy)
                .map_err(|error| format!("open: {error:?}"))?;
        let current = session
            .request_artifact(request(7, 1, &href))
            .map_err(|error| format!("initial artifact: {error}"))?;
        let started = Instant::now();
        let mut request_id = 2u64;
        let mut retries = 0u64;
        let resolved: ReaderArtifactV1 = loop {
            match session.request_adjacent(ReaderAdjacentRequestV1 {
                session_id: 7,
                request_id,
                from_artifact_id: current.artifact_id,
                direction,
                work: WORK,
            }) {
                Ok(artifact) => break artifact,
                Err(error) if error.kind == ReaderErrorKindV1::TargetNotPublished => {
                    retries += 1;
                    if retries > MAX_RETRIES {
                        return Err(format!(
                            "{direction:?}: gave up after {MAX_RETRIES} retries"
                        ));
                    }
                    request_id += 1;
                }
                Err(error) => return Err(format!("{direction:?}: {error:?}")),
            }
        };
        let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
        println!(
            "{direction:?}: {elapsed_ms:.1} ms, {retries} budget-exhausted retries, landed {}#page{}",
            resolved.locator.href, resolved.local_page_index
        );
    }
    Ok(())
}

fn request(session_id: u64, request_id: u64, href: &str) -> ReaderArtifactRequestV1 {
    ReaderArtifactRequestV1 {
        session_id,
        request_id,
        layout: ReaderLayoutV1 {
            viewport_width: 420.0,
            viewport_height: 640.0,
            margin_top: 24.0,
            margin_right: 24.0,
            margin_bottom: 24.0,
            margin_left: 24.0,
            spread_mode: ReaderSpreadModeV1::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            font_family_override: None,
        },
        text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
        locator: ReaderLocatorV1 {
            href: href.to_owned(),
            anchor_id: None,
            source_point: None,
            source_range: None,
            progression: None,
        },
        work: WORK,
    }
}
