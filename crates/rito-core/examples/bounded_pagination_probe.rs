use std::{env, fs, path::PathBuf};

use rito_core::{
    bench::capture_bounded_pagination_work,
    layout::{
        create_layout_config, LayoutConfig, LayoutConfigInput, LineBreaking, MarginInput,
        SpreadMode, TextMeasurementMode,
    },
    runtime::{
        RuntimeBoundedRevisionRequest, RuntimeContinueRevisionRequest, RuntimeDocument,
        RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole, RuntimePinnedFontLanguageTag,
        RuntimePinnedFontPolicyInput, RuntimeRevisionAdvance, RuntimeRevisionHandle,
        RuntimeRevisionStatus, RuntimeRevisionWorkBudget, RuntimeSourceLocator,
        RuntimeSourceLocatorResolution,
    },
};
use serde_json::json;

const DEFAULT_BOOK10_PATH: &str = "packages/rito/tests/fixtures/books/book-10.epub";
const DEFAULT_TINOS_PATH: &str = "apps/reader/src/assets/fonts/Tinos-Regular.ttf";
const DEFAULT_SOURCE_HAN_PATH: &str = "apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf";
const TINOS_SHA256: &str = "60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61";
const SOURCE_HAN_SHA256: &str = "3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d";
const READER_BOOK10_FAR_TOC_HREF: &str = "OEBPS/Text/Section040.xhtml";
const READER_BOOK10_PAGE_COUNT: usize = 771;
const READER_BOOK10_SPREAD_COUNT: usize = 392;
const READER_BOOK10_QUANTUM_COUNT: u64 = 2_014;
const READER_BOOK10_REVISION_VERSION: u32 = 2_013;

fn main() -> Result<(), String> {
    let input = ProbeInput::from_args()?;
    let bytes = fs::read(&input.epub_path)
        .map_err(|error| format!("read {}: {error}", input.epub_path.display()))?;
    let pinned_font_policy = production_pinned_font_policy(&input)?;
    let mut document = RuntimeDocument::open_with_pinned_font_policy(&bytes, pinned_font_policy)
        .map_err(|error| format!("open {}: {error}", input.epub_path.display()))?;
    let pinned_font_policy = document.pinned_font_policy_summary();
    let budget = RuntimeRevisionWorkBudget {
        max_top_level_nodes: input.max_top_level_nodes,
    };
    let target_locator = far_toc_locator();
    let (result, probe) = capture_bounded_pagination_work(|| {
        run_bounded_pagination_toward_locator(
            &mut document,
            input.layout_config.clone(),
            budget,
            target_locator.clone(),
        )
    });
    let (bounded_request_count, processed_top_level_nodes, final_advance, target_resolution) =
        result?;
    let workload_match = reader_book10_workload_match(&final_advance, &probe);
    let report = json!({
        "schemaVersion": 1,
        "epubPath": input.epub_path,
        "fontPaths": {
            "tinos": input.tinos_path,
            "sourceHanSerifCn": input.source_han_path,
        },
        "layoutConfig": input.layout_config,
        "pinnedFontPolicy": pinned_font_policy,
        "maxTopLevelNodes": input.max_top_level_nodes,
        "targetLocator": target_locator,
        "targetResolution": target_resolution,
        "boundedRequestCount": bounded_request_count,
        "processedTopLevelNodes": processed_top_level_nodes,
        "finalRevision": final_advance.revision,
        "workloadMatch": workload_match,
        "probe": probe,
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&report)
            .map_err(|error| format!("serialize probe report: {error}"))?
    );
    Ok(())
}

struct ProbeInput {
    epub_path: PathBuf,
    layout_config: LayoutConfig,
    max_top_level_nodes: usize,
    tinos_path: PathBuf,
    source_han_path: PathBuf,
}

impl ProbeInput {
    fn from_args() -> Result<Self, String> {
        let mut args = env::args_os().skip(1);
        let epub_path = args
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_BOOK10_PATH));
        let layout_config_path = args.next().map(PathBuf::from);
        let layout_config = match layout_config_path.as_deref() {
            None => default_layout_config(),
            Some(path) if path.as_os_str() == "-" => default_layout_config(),
            Some(path) => read_layout_config(path.to_path_buf())?,
        };
        let max_top_level_nodes = args
            .next()
            .map(|value| value.to_string_lossy().parse::<usize>())
            .transpose()
            .map_err(|error| format!("invalid max_top_level_nodes: {error}"))?
            // The formal far-TOC replacement starts directly with the Reader's
            // growth budget. One captured quantum is still one core call.
            .unwrap_or(32);
        let tinos_path = args
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_TINOS_PATH));
        let source_han_path = args
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_SOURCE_HAN_PATH));
        if args.next().is_some() {
            return Err(
                "usage: bounded-pagination-probe [book.epub] [layout-config.json|-] [max_top_level_nodes] [Tinos-Regular.ttf] [SourceHanSerifCN-Regular.otf]".to_owned(),
            );
        }
        if max_top_level_nodes == 0 {
            return Err("max_top_level_nodes must be greater than zero".to_owned());
        }
        Ok(Self {
            epub_path,
            layout_config,
            max_top_level_nodes,
            tinos_path,
            source_han_path,
        })
    }
}

fn read_layout_config(path: PathBuf) -> Result<LayoutConfig, String> {
    let bytes = fs::read(&path).map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse layout config {}: {error}", path.display()))
}

fn default_layout_config() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        // The profile browser is 1280x720 at the Reader's default 1.2 render
        // scale, so core pagination receives round(container / 1.2).
        width: 1_067.0,
        height: 600.0,
        margin: MarginInput::All(50.0),
        spread: SpreadMode::Double,
        first_page_alone: true,
        spread_gap: 20.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: Some(TextMeasurementMode::FontAware),
    })
}

fn production_pinned_font_policy(
    input: &ProbeInput,
) -> Result<RuntimePinnedFontPolicyInput, String> {
    Ok(RuntimePinnedFontPolicyInput {
        faces: vec![
            pinned_font_face(
                &input.tinos_path,
                TINOS_SHA256,
                RuntimePinnedFontLanguageTag::parse("und")
                    .map_err(|error| format!("parse Tinos language: {error}"))?,
            )?,
            pinned_font_face(
                &input.source_han_path,
                SOURCE_HAN_SHA256,
                RuntimePinnedFontLanguageTag::parse("zh-Hans")
                    .map_err(|error| format!("parse Source Han language: {error}"))?,
            )?,
        ],
    })
}

fn pinned_font_face(
    path: &PathBuf,
    expected_sha256: &str,
    language: RuntimePinnedFontLanguageTag,
) -> Result<RuntimePinnedFontFaceInput, String> {
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    Ok(RuntimePinnedFontFaceInput {
        bytes,
        expected_sha256: expected_sha256.to_owned(),
        generic_role: RuntimePinnedFontGenericRole::Serif,
        language: Some(language),
    })
}

fn reader_book10_workload_match(
    final_advance: &RuntimeRevisionAdvance,
    probe: &rito_core::bench::BoundedPaginationWorkProbe,
) -> serde_json::Value {
    let known_extent = final_advance.revision.known_extent;
    let page_count_matches = known_extent.page_count == READER_BOOK10_PAGE_COUNT;
    let spread_count_matches = known_extent.spread_count == READER_BOOK10_SPREAD_COUNT;
    let quantum_count_matches = probe.quantum_count == READER_BOOK10_QUANTUM_COUNT;
    let revision_version_matches =
        final_advance.revision.revision_version == READER_BOOK10_REVISION_VERSION;
    let status_matches = final_advance.revision.status == RuntimeRevisionStatus::Ready;
    let comparable = page_count_matches
        && spread_count_matches
        && quantum_count_matches
        && revision_version_matches
        && status_matches;
    json!({
        "status": if comparable { "matched" } else { "mismatchDoNotInterpret" },
        "comparable": comparable,
        "expected": {
            "pageCount": READER_BOOK10_PAGE_COUNT,
            "spreadCount": READER_BOOK10_SPREAD_COUNT,
            "quantumCount": READER_BOOK10_QUANTUM_COUNT,
            "revisionVersion": READER_BOOK10_REVISION_VERSION,
            "status": RuntimeRevisionStatus::Ready,
        },
        "pageCountMatches": page_count_matches,
        "spreadCountMatches": spread_count_matches,
        "quantumCountMatches": quantum_count_matches,
        "revisionVersionMatches": revision_version_matches,
        "statusMatches": status_matches,
    })
}

fn far_toc_locator() -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: READER_BOOK10_FAR_TOC_HREF.to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}

type ProbeRun = (
    usize,
    usize,
    RuntimeRevisionAdvance,
    RuntimeSourceLocatorResolution,
);

fn run_bounded_pagination_toward_locator(
    document: &mut RuntimeDocument,
    layout_config: LayoutConfig,
    budget: RuntimeRevisionWorkBudget,
    locator: RuntimeSourceLocator,
) -> Result<ProbeRun, String> {
    let mut advance = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config,
            line_breaking: LineBreaking::Greedy,
            budget,
        })
        .map_err(|error| format!("create bounded revision: {error:?}"))?;
    let mut bounded_request_count = 1usize;
    let mut processed_top_level_nodes = advance.processed_top_level_nodes;
    loop {
        let resolution = resolve_target(document, &advance, &locator)?;
        if matches!(resolution, RuntimeSourceLocatorResolution::Resolved { .. }) {
            return Ok((
                bounded_request_count,
                processed_top_level_nodes,
                advance,
                resolution,
            ));
        }
        let continuation = advance.continuation.take().ok_or_else(|| {
            format!(
                "target locator did not resolve before revision {} completed",
                advance.revision.revision_id
            )
        })?;
        advance = document
            .continue_revision(RuntimeContinueRevisionRequest {
                revision_id: continuation.revision_id,
                revision_version: continuation.revision_version,
                cursor: continuation.cursor,
                budget,
            })
            .map_err(|error| format!("continue bounded revision: {error:?}"))?;
        bounded_request_count = bounded_request_count.saturating_add(1);
        processed_top_level_nodes =
            processed_top_level_nodes.saturating_add(advance.processed_top_level_nodes);
    }
}

fn resolve_target(
    document: &mut RuntimeDocument,
    advance: &RuntimeRevisionAdvance,
    locator: &RuntimeSourceLocator,
) -> Result<RuntimeSourceLocatorResolution, String> {
    document
        .resolve_source_locator_at(
            &RuntimeRevisionHandle::from(&advance.revision),
            locator.clone(),
        )
        .map(|versioned| versioned.value)
        .map_err(|error| format!("resolve target source locator: {error:?}"))
}
