//! Architectural freeze for the layout engine that predates the browser-grade
//! chapter-engine boundary.
//!
//! Deleting modules from this inventory is expected. Adding another generic
//! formatting, line, pagination, or text authority beside them is not: new
//! layout work must live behind the engine-neutral chapter/page contracts.

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

const LEGACY_LAYOUT_ROOT: &str = include_str!("../src/layout.rs");
const CHAPTER_ENGINE_SESSION: &str = include_str!("../src/runtime/chapter_engine_session.rs");
const RUNTIME_FRAME: &str = include_str!("../src/runtime/frame.rs");
const RUNTIME_PAGE: &str = include_str!("../src/runtime/page.rs");
const RUNTIME_MOVEMENT_SCOPE: &str =
    include_str!("../src/runtime/text_interaction/movement/scope.rs");
const RUNTIME_TEXT_INTERACTION: &str = include_str!("../src/runtime/text_interaction.rs");
const RUNTIME_TEXT_GRANULARITY: &str =
    include_str!("../src/runtime/text_interaction/granularity.rs");
const RUNTIME_TEXT_MOVEMENT: &str = include_str!("../src/runtime/text_interaction/movement.rs");
const RUNTIME_TEXT_RANGE_TO_POINT: &str =
    include_str!("../src/runtime/text_interaction/range_to_point.rs");
const RUNTIME_NAVIGATION: &str = include_str!("../src/runtime/navigation.rs");
const RUNTIME_PAGE_SEMANTICS: &str = include_str!("../src/runtime/page_semantics.rs");
const RUNTIME_PAGE_TARGET: &str = include_str!("../src/runtime/page_target.rs");
const RUNTIME_SOURCE_LOCATOR: &str = include_str!("../src/runtime/source_locator.rs");
const RUNTIME_SOURCE_PROJECTION: &str = include_str!("../src/runtime/source_locator/projection.rs");

const MIGRATED_RUNTIME_CONSUMERS: &[(&str, &str)] = &[
    ("src/runtime/frame.rs", RUNTIME_FRAME),
    ("src/runtime/navigation.rs", RUNTIME_NAVIGATION),
    ("src/runtime/page.rs", RUNTIME_PAGE),
    ("src/runtime/page_semantics.rs", RUNTIME_PAGE_SEMANTICS),
    ("src/runtime/page_target.rs", RUNTIME_PAGE_TARGET),
    ("src/runtime/source_locator.rs", RUNTIME_SOURCE_LOCATOR),
    (
        "src/runtime/source_locator/projection.rs",
        RUNTIME_SOURCE_PROJECTION,
    ),
    ("src/runtime/text_interaction.rs", RUNTIME_TEXT_INTERACTION),
    (
        "src/runtime/text_interaction/granularity.rs",
        RUNTIME_TEXT_GRANULARITY,
    ),
    (
        "src/runtime/text_interaction/movement.rs",
        RUNTIME_TEXT_MOVEMENT,
    ),
    (
        "src/runtime/text_interaction/movement/scope.rs",
        RUNTIME_MOVEMENT_SCOPE,
    ),
    (
        "src/runtime/text_interaction/range_to_point.rs",
        RUNTIME_TEXT_RANGE_TO_POINT,
    ),
];

const SESSION_ENTRY_CONSUMERS: &[(&str, &str)] = &[
    ("src/runtime/frame.rs", RUNTIME_FRAME),
    ("src/runtime/navigation.rs", RUNTIME_NAVIGATION),
    ("src/runtime/page.rs", RUNTIME_PAGE),
    ("src/runtime/page_semantics.rs", RUNTIME_PAGE_SEMANTICS),
    ("src/runtime/page_target.rs", RUNTIME_PAGE_TARGET),
    ("src/runtime/source_locator.rs", RUNTIME_SOURCE_LOCATOR),
    ("src/runtime/text_interaction.rs", RUNTIME_TEXT_INTERACTION),
    (
        "src/runtime/text_interaction/granularity.rs",
        RUNTIME_TEXT_GRANULARITY,
    ),
    (
        "src/runtime/text_interaction/movement.rs",
        RUNTIME_TEXT_MOVEMENT,
    ),
    (
        "src/runtime/text_interaction/movement/scope.rs",
        RUNTIME_MOVEMENT_SCOPE,
    ),
    (
        "src/runtime/text_interaction/range_to_point.rs",
        RUNTIME_TEXT_RANGE_TO_POINT,
    ),
];

/// The layout root is closed to new, unreviewed authorities. An approved
/// replacement provider must update this inventory deliberately and remain
/// behind ChapterEngineSession; a new `grid`, `flex_v2`, or similar module may
/// not silently bypass the legacy-prefix check.
const KNOWN_LAYOUT_MODULES: &[&str] = &[
    "bounded_work_probe",
    "cleanup",
    "content",
    "continuous_flex",
    "continuous_float",
    "continuous_image",
    "continuous_layout",
    "continuous_list",
    "continuous_summary",
    "continuous_table",
    "continuous_table_model",
    "continuous_table_rows",
    "display_list",
    "display_list_flow",
    "font_summary",
    "font_vertical_metrics",
    "hit_map",
    "hit_target",
    "hyphenation",
    "image_size",
    "inline_atoms",
    "inline_content",
    "inline_ruby",
    "inline_segment",
    "inline_summary",
    "line",
    "line_align",
    "line_break",
    "line_break_input",
    "line_finalize",
    "line_layout",
    "line_metrics",
    "line_mode",
    "line_optimal",
    "line_prefix",
    "line_ruby",
    "link_map",
    "locator",
    "page",
    "pagination_flow",
    "pagination_session",
    "paint",
    "runtime_session",
    "search_flow",
    "segment_details",
    "segments",
    "semantic_tree",
    "shape_provenance_diagnostic",
    "spread",
    "spread_flow",
    "style_values",
    "summary_json",
    "summary_types",
    "text_geometry",
    "text_grapheme",
    "text_mapping",
    "text_measure",
    "text_position",
    "text_shape",
    "text_work",
    "text_work_trace",
    "visual_geometry",
];

// Monotonic budgets for non-test production sources rooted at the frozen
// authorities. Deletion is always allowed; net expansion requires moving the
// work behind a replacement provider rather than growing legacy in place.
// Admitted exception: `pagination_session/image_frontier.rs` defers image
// decode out of bounded first paint, a memory/latency gate fix permitted by
// the freeze policy.
const MAX_FROZEN_LEGACY_PRODUCTION_FILES: usize = 120;
const MAX_FROZEN_LEGACY_PRODUCTION_LINES: usize = 30_099;

#[test]
fn legacy_layout_authority_is_feature_frozen() {
    let additions = declared_modules(LEGACY_LAYOUT_ROOT)
        .filter(|module| !KNOWN_LAYOUT_MODULES.contains(module))
        .collect::<Vec<_>>();

    assert!(
        additions.is_empty(),
        "legacy layout is feature-frozen; route new browser-layout work through the \
         engine-neutral chapter/page boundary instead of adding: {}",
        additions.join(", "),
    );
}

#[test]
fn legacy_layout_authority_cannot_expand_in_place() {
    let layout_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/layout");
    let sources = frozen_legacy_production_sources(&layout_root);
    let line_count = sources
        .iter()
        .map(|path| {
            fs::read_to_string(path)
                .unwrap_or_else(|error| panic!("could not read {}: {error}", path.display()))
                .lines()
                .count()
        })
        .sum::<usize>();

    assert!(
        sources.len() <= MAX_FROZEN_LEGACY_PRODUCTION_FILES
            && line_count <= MAX_FROZEN_LEGACY_PRODUCTION_LINES,
        "legacy layout production authority grew in place: {} files / {} lines; budgets are {} files / {} lines. Delete or replace legacy code instead of expanding it. Sources: {}",
        sources.len(),
        line_count,
        MAX_FROZEN_LEGACY_PRODUCTION_FILES,
        MAX_FROZEN_LEGACY_PRODUCTION_LINES,
        sources
            .iter()
            .map(|path| path.strip_prefix(&layout_root).unwrap_or(path).display().to_string())
            .collect::<Vec<_>>()
            .join(", "),
    );
}

#[test]
fn migrated_runtime_consumers_do_not_reenter_legacy_layout() {
    const FORBIDDEN: &[&str] = &[
        "build_display_list_frame_commands",
        "DisplayListFrameCommands",
        "build_page_semantic_tree",
        "build_spread_slots",
        "collect_anchor_pages",
        "collect_source_run_starts",
        "LayoutSemanticNode",
        "LayoutSemanticRole",
        "LayoutHitTarget",
        "LayoutRuntimePage",
        "LayoutSourceRunStart",
        "LegacyChapterEngineSession",
        "build_hit_targets",
        "build_text_position_page",
        "build_text_range_geometry",
        "layout.pages",
        "layout.chapter_start_pages",
        "page_artifact_",
        "pagination_flow.chapter_map",
    ];

    let violations = MIGRATED_RUNTIME_CONSUMERS
        .iter()
        .copied()
        .flat_map(|(path, source)| {
            let source = without_whitespace(source);
            FORBIDDEN
                .iter()
                .filter(move |needle| source.contains(**needle))
                .map(move |needle| format!("{path} names `{needle}`"))
        })
        .collect::<Vec<_>>();

    assert!(
        violations.is_empty(),
        "runtime consumers migrated to PageArtifact must not inspect the legacy layout tree: {}",
        violations.join(", "),
    );
}

#[test]
fn migrated_revision_consumers_enter_through_chapter_engine_session() {
    let violations = SESSION_ENTRY_CONSUMERS
        .iter()
        .copied()
        .filter(|(_, source)| !without_whitespace(source).contains(".chapter_engine_session()"))
        .map(|(path, _)| format!("{path} bypasses ChapterEngineSession"))
        .collect::<Vec<_>>();

    assert!(
        violations.is_empty(),
        "migrated revision consumers must use the read-only engine session façade: {}",
        violations.join(", "),
    );
}

#[test]
fn chapter_engine_session_facade_does_not_reveal_legacy_layout() {
    const FORBIDDEN: &[&str] = &[
        "build_display_list_frame_commands",
        "build_spread_slots",
        "collect_anchor_pages",
        "collect_source_run_starts",
        "LayoutRuntimePage",
        "layout.pages",
        "layout.chapter_start_pages",
        "pagination_flow.chapter_map",
    ];
    let source = without_whitespace(CHAPTER_ENGINE_SESSION);
    let violations = FORBIDDEN
        .iter()
        .filter(|needle| source.contains(**needle))
        .collect::<Vec<_>>();

    assert!(
        source.contains("pub(super)structChapterEngineSession")
            && source.contains("fnchapter_engine_session(&self)->ChapterEngineSession<'_>"),
        "runtime must retain one private ChapterEngineSession façade",
    );
    assert!(
        violations.is_empty(),
        "ChapterEngineSession façade must not reveal legacy layout internals: {}",
        violations
            .into_iter()
            .copied()
            .collect::<Vec<_>>()
            .join(", "),
    );
}

fn without_whitespace(source: &str) -> String {
    source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn declared_modules(source: &str) -> impl Iterator<Item = &str> {
    source.lines().filter_map(|line| {
        let declaration = line.trim();
        let module = if let Some(module) = declaration.strip_prefix("mod ") {
            module
        } else if declaration.starts_with("pub") {
            declaration.split_once(" mod ")?.1
        } else {
            return None;
        };
        module.strip_suffix(';')
    })
}

fn is_legacy_layout_authority(module: &str) -> bool {
    module == "line"
        || ["continuous_", "inline_", "line_", "pagination_", "text_"]
            .iter()
            .any(|prefix| module.starts_with(prefix))
}

fn frozen_legacy_production_sources(layout_root: &Path) -> Vec<PathBuf> {
    let mut sources = vec![layout_root.with_extension("rs")];
    collect_rust_sources(layout_root, layout_root, &mut sources);
    sources.sort();
    sources
}

fn collect_rust_sources(layout_root: &Path, directory: &Path, sources: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("could not scan {}: {error}", directory.display()));
    for entry in entries {
        let path = entry
            .unwrap_or_else(|error| panic!("could not scan {}: {error}", directory.display()))
            .path();
        if path.is_dir() {
            collect_rust_sources(layout_root, &path, sources);
            continue;
        }
        let relative = path.strip_prefix(layout_root).unwrap_or(&path);
        if path.extension().and_then(|extension| extension.to_str()) != Some("rs")
            || is_test_only_source(relative)
            || !is_frozen_legacy_path(relative)
        {
            continue;
        }
        sources.push(path);
    }
}

fn is_frozen_legacy_path(relative: &Path) -> bool {
    let Some(Component::Normal(first)) = relative.components().next() else {
        return false;
    };
    let first = first.to_string_lossy();
    let module = first.strip_suffix(".rs").unwrap_or(&first);
    is_legacy_layout_authority(module)
}

fn is_test_only_source(relative: &Path) -> bool {
    relative.components().any(|component| {
        component.as_os_str() == "tests" || component.as_os_str() == "test_support.rs"
    }) || relative
        .file_stem()
        .and_then(|stem| stem.to_str())
        .is_some_and(|stem| stem == "tests" || stem.ends_with("_tests"))
}
