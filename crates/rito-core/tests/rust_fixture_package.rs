use std::{collections::BTreeMap, env, fs, io::Read, path::PathBuf};

use flate2::read::GzDecoder;

use rito_core::{
    css::CssSummary,
    epub::{analyze_publication_with_layout_and_line_breaking, EpubPublication, PackageDocument},
    layout::{LayoutConfig, LayoutSummary, LineBreaking},
    resources::PublicationResources,
    runtime::{RuntimeDocument, RuntimePageTarget, RuntimeResourceKind, RuntimeSearchRequest},
    style::StyleSummary,
    xhtml::{ChapterSource, XhtmlSummary},
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

const EXPECTED_FIXTURE_BOOKS: &[&str] = &[
    "book-01", "book-02", "book-03", "book-04", "book-05", "book-06", "book-07", "book-08",
    "book-09", "book-10",
];
const EXPECTED_FIXTURE_CONFIGS: &[&str] = &[
    "smoke.greedy",
    "default.greedy",
    "narrow.greedy",
    "default.optimal",
];
const RENDER_COMMAND_GOLDEN_CONFIGS: &[&str] =
    &["default.greedy", "narrow.greedy", "default.optimal"];
const RUNTIME_RENDER_COMMAND_PARITY_CASES: &[(&str, &str, &str)] = &[
    (
        "book-01",
        "default.greedy",
        "book-01-default.greedy-page-0010",
    ),
    (
        "book-01",
        "default.greedy",
        "book-01-default.greedy-page-0217",
    ),
    (
        "book-02",
        "default.greedy",
        "book-02-default.greedy-page-0009",
    ),
    (
        "book-01",
        "default.optimal",
        "book-01-default.optimal-page-0010",
    ),
    (
        "book-03",
        "default.greedy",
        "book-03-default.greedy-page-0001",
    ),
    (
        "book-04",
        "default.greedy",
        "book-04-default.greedy-page-0008",
    ),
    (
        "book-10",
        "default.greedy",
        "book-10-default.greedy-page-0046",
    ),
];
const EXPECTED_RUNTIME_RENDER_COMMAND_KINDS: &[&str] = &[
    "clipRect",
    "paintBlock",
    "paintHorizontalRule",
    "paintImage",
    "paintPage",
    "paintRuby",
    "paintText",
    "popState",
    "pushState",
    "transform",
    "translate",
];
const EXPECTED_RUNTIME_RENDER_FEATURES: &[&str] = &[
    "blockBackground",
    "blockBorder",
    "blockClip",
    "blockTransform",
    "horizontalRule",
    "image",
    "inlineAtom",
    "inlineBackground",
    "inlineBorder",
    "ruby",
    "text",
    "textDecoration",
    "textShadow",
];
const EXPECTED_RUNTIME_RENDER_GROUP_COUNT: usize = 6;
const EXPECTED_RUNTIME_RENDER_CASE_COUNT: usize = 37;
const EXPECTED_RUNTIME_RENDER_SUMMARY_COUNT: usize = 74;
const EXPECTED_EXHAUSTIVE_RUNTIME_RENDER_GROUP_COUNT: usize = 30;
const EXPECTED_EXHAUSTIVE_RUNTIME_RENDER_CASE_COUNT: usize = 189;
const EXPECTED_EXHAUSTIVE_RUNTIME_RENDER_SUMMARY_COUNT: usize = 378;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureManifest {
    schema_version: u32,
    kind: String,
    entries: Vec<FixtureManifestEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureManifestEntry {
    book_id: String,
    config_id: String,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustParityFixture {
    schema_version: u32,
    kind: String,
    book: FixtureBook,
    config: FixtureConfig,
    package: PackageDocument,
    resources: PublicationResources,
    chapters: Vec<FixtureChapter>,
    xhtml: XhtmlSummary,
    css: CssSummary,
    style: StyleSummary,
    layout: LayoutSummary,
    pagination: FixturePaginationSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureBook {
    id: String,
    path: String,
    byte_length: usize,
    byte_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureConfig {
    id: String,
    line_breaking: LineBreaking,
    layout: LayoutConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureChapter {
    idref: String,
    href: String,
    linear: bool,
    text_length: usize,
    text_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixturePaginationSummary {
    chapter_text_index_ids: Vec<String>,
    footnote_keys: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderCommandFixture {
    cases: Vec<RenderCommandCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderCommandCase {
    id: String,
    page: RenderCommandPage,
    renders: Vec<RenderCommandRender>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderCommandPage {
    index: usize,
    selected_feature_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderCommandRender {
    display_list: RenderCommandDisplayList,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderCommandDisplayList {
    command_count: usize,
    commands: BTreeMap<String, usize>,
    hash: String,
    width: Value,
    height: Value,
}

#[derive(Debug, Default)]
struct RuntimeRenderParityCounters {
    covered_commands: BTreeMap<String, usize>,
    covered_features: BTreeMap<String, usize>,
    checked_case_count: usize,
    checked_render_count: usize,
}

#[test]
fn reads_rust_parity_fixture_manifest() {
    let manifest = read_manifest();

    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.kind, "rito-rust-parity-fixture-manifest");
    assert_eq!(
        manifest.entries.len(),
        EXPECTED_FIXTURE_BOOKS.len() * EXPECTED_FIXTURE_CONFIGS.len()
    );

    let mut index = 0usize;
    for book_id in EXPECTED_FIXTURE_BOOKS {
        for config_id in EXPECTED_FIXTURE_CONFIGS {
            assert_manifest_entry(&manifest.entries[index], book_id, config_id);
            index += 1;
        }
    }
}

fn assert_manifest_entry(entry: &FixtureManifestEntry, book_id: &str, config_id: &str) {
    assert_eq!(entry.book_id, book_id);
    assert_eq!(entry.config_id, config_id);
    assert_eq!(entry.path, format!("{book_id}/{config_id}.json.gz"));
}

#[test]
fn parses_package_and_resource_summaries_from_ts_fixture() {
    let fixture = read_fixture("book-01/smoke.greedy.json.gz");

    assert_eq!(fixture.schema_version, 1);
    assert_eq!(fixture.kind, "rito-rust-parity-fixture");
    assert_eq!(fixture.book.id, "book-01");
    assert_eq!(fixture.book.path, "book-01.epub");
    assert_eq!(fixture.book.byte_length, 6_683_820);
    assert_eq!(fixture.book.byte_hash, "e0320b357206a90f");
    assert_eq!(fixture.config.id, "smoke.greedy");
    assert_eq!(fixture.config.line_breaking, LineBreaking::Greedy);
    assert_eq!(fixture.config.layout.content_width(), 372.0);
    assert_eq!(fixture.config.layout.content_height(), 592.0);
    assert_eq!(
        fixture.layout.pagination_flow.search_flow.query_count, 4,
        "search flow fixture should lock the query contract"
    );
    assert_eq!(
        fixture.layout.pagination_flow.search_flow.result_count, 655,
        "search flow fixture should lock aggregate result count"
    );

    assert_eq!(fixture.package.metadata.title, "败犬女主太多了！");
    assert_eq!(fixture.package.metadata.language, "zh");
    assert_eq!(
        fixture.package.metadata.creator.as_deref(),
        Some("雨森たきび")
    );
    assert_eq!(fixture.package.manifest.len(), 72);
    assert_eq!(fixture.package.spine_len(), 32);
    assert_eq!(fixture.package.toc.len(), 18);

    let cover = fixture
        .package
        .manifest_item("cover.jpg")
        .expect("cover.jpg manifest item");
    assert_eq!(cover.href, "Images/cover.jpg");
    assert_eq!(cover.media_type, "image/jpeg");

    assert_eq!(fixture.resources.stylesheets.len(), 1);
    assert_eq!(fixture.resources.fonts.len(), 2);
    assert_eq!(fixture.resources.images.len(), 36);
    assert_eq!(fixture.resources.total_binary_bytes(), 6_714_644);

    let cover_image = fixture
        .resources
        .image("Images/cover.jpg")
        .expect("cover image resource");
    assert_eq!(cover_image.byte_length, 669_336);
    assert_eq!(cover_image.byte_hash.as_deref(), Some("111dc6cfa3eec11f"));
    assert_eq!(cover_image.width, Some(1119));
    assert_eq!(cover_image.height, Some(1600));
}

#[test]
#[ignore = "real-EPUB package/resource parity; run explicitly before Rust core parity milestones"]
fn loads_real_epub_package_and_resources_to_match_ts_fixture() {
    for entry in fixture_entries_for_parity() {
        let fixture = read_fixture(&entry.path);
        let publication = read_publication(&fixture);
        let label = format!("{} / {}", entry.book_id, entry.config_id);

        assert_eq!(
            publication.package, fixture.package,
            "{label}: package mismatch"
        );
        assert_eq!(
            publication.resources, fixture.resources,
            "{label}: resources mismatch"
        );
        assert_eq!(
            publication.chapters,
            fixture.chapter_sources(),
            "{label}: chapter sources mismatch"
        );
        assert_eq!(
            publication.chapters.len(),
            fixture.chapters.len(),
            "{label}: chapter count mismatch"
        );
        assert_eq!(
            publication
                .chapters
                .first()
                .map(|chapter| chapter.href.as_str()),
            fixture
                .chapters
                .first()
                .map(|chapter| chapter.href.as_str()),
            "{label}: first chapter href mismatch"
        );
        assert_eq!(
            publication
                .chapters
                .last()
                .map(|chapter| chapter.idref.as_str()),
            fixture
                .chapters
                .last()
                .map(|chapter| chapter.idref.as_str()),
            "{label}: last chapter idref mismatch"
        );
        assert_eq!(publication.xhtml, fixture.xhtml, "{label}: xhtml mismatch");
        assert_eq!(
            publication.css.as_ref(),
            Some(&fixture.css),
            "{label}: css mismatch"
        );
        assert_style_matches(
            publication
                .style
                .as_ref()
                .expect("diagnostic style summary"),
            &fixture.style,
            &label,
        );
        assert_layout_matches(&publication.layout, &fixture.layout, &label);
        assert_eq!(
            publication.interaction.chapter_text_index_ids,
            fixture.pagination.chapter_text_index_ids,
            "{label}: chapter text index ids mismatch"
        );
        assert_eq!(
            publication.interaction.footnote_keys, fixture.pagination.footnote_keys,
            "{label}: footnote keys mismatch"
        );
    }
}

fn fixture_entries_for_parity() -> Vec<FixtureManifestEntry> {
    let manifest = read_manifest();
    let book_filter = env_filter("RITO_RUST_FIXTURE_BOOKS");
    let config_filter = env_filter("RITO_RUST_FIXTURE_CONFIGS");
    manifest
        .entries
        .into_iter()
        .filter(|entry| filter_matches(&book_filter, &entry.book_id))
        .filter(|entry| filter_matches(&config_filter, &entry.config_id))
        .collect()
}

fn env_filter(name: &str) -> Option<Vec<String>> {
    let value = env::var(name).ok()?;
    let values = value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    (!values.is_empty()).then_some(values)
}

fn filter_matches(filter: &Option<Vec<String>>, value: &str) -> bool {
    match filter {
        Some(values) => values.iter().any(|item| item == value),
        None => true,
    }
}

fn assert_style_matches(actual: &StyleSummary, expected: &StyleSummary, label: &str) {
    assert_eq!(
        actual.selector_matches.chapter_count, expected.selector_matches.chapter_count,
        "{label}: selector chapter count mismatch"
    );
    assert_eq!(
        actual.selector_matches.total_element_count, expected.selector_matches.total_element_count,
        "{label}: selector total element count mismatch"
    );
    assert_eq!(
        actual.selector_matches.total_matched_element_count,
        expected.selector_matches.total_matched_element_count,
        "{label}: selector total matched element count mismatch"
    );
    assert_eq!(
        actual.selector_matches.total_match_count, expected.selector_matches.total_match_count,
        "{label}: selector total match count mismatch"
    );
    for (index, (actual, expected)) in actual
        .selector_matches
        .chapters
        .iter()
        .zip(&expected.selector_matches.chapters)
        .enumerate()
    {
        if actual != expected {
            panic!(
                "{label}: selector chapter mismatch at {index} ({})\nactual: {}\nexpected: {}",
                actual.idref,
                serde_json::to_string_pretty(actual).expect("serialize actual selector chapter"),
                serde_json::to_string_pretty(expected)
                    .expect("serialize expected selector chapter")
            );
        }
    }
    assert_eq!(
        actual.selector_matches.full_detail_hash, expected.selector_matches.full_detail_hash,
        "{label}: selector full detail hash mismatch"
    );
    assert_eq!(
        actual.computed_styles, expected.computed_styles,
        "{label}: computed style mismatch"
    );
}

#[test]
fn display_list_flow_tracks_render_command_golden_hashes() {
    for book_id in EXPECTED_FIXTURE_BOOKS {
        for config_id in RENDER_COMMAND_GOLDEN_CONFIGS {
            assert_all_render_command_hashes_match(&format!("{book_id}/{config_id}.json.gz"));
        }
    }
}

#[test]
fn book_06_embedded_body_font_size_drives_runtime_render_commands() {
    const CASE_ID: &str = "book-06-default.greedy-page-0001";
    const GOLDEN_HASH: &str = "b05149e160dc57a7";
    let fixture = read_fixture("book-06/default.greedy.json.gz");
    let bytes = fs::read(book_root().join(&fixture.book.path)).expect("read book-06 EPUB");
    let mut document = RuntimeDocument::open(&bytes).expect("open book-06 runtime document");
    let revision = document
        .create_revision_with_line_breaking(&fixture.config.layout, fixture.config.line_breaking)
        .expect("create book-06 runtime revision");
    let frame = document
        .get_frame(&revision.revision_id, 1)
        .expect("read book-06 title frame");
    let normalized = normalize_runtime_commands_for_render_hash(&frame.commands);

    assert_eq!(
        hash_json_value(&Value::Array(normalized)),
        GOLDEN_HASH,
        "runtime commands must match the authoritative TS render golden for {CASE_ID}"
    );
    let author = frame
        .commands
        .iter()
        .find(|command| {
            command.get("kind").and_then(Value::as_str) == Some("paintText")
                && command.get("text").and_then(Value::as_str) == Some("羊太郎")
        })
        .expect("title author paintText command");
    assert_eq!(
        author.pointer("/paint/font/sizePx").and_then(Value::as_f64),
        Some(25.2),
        "embedded body {{ font-size: 14px }} must be the em basis"
    );
}

#[test]
fn runtime_frames_normalize_to_render_command_golden_hashes() {
    let mut counters = RuntimeRenderParityCounters::default();
    let groups = runtime_render_command_groups();
    assert_eq!(
        groups.len(),
        EXPECTED_RUNTIME_RENDER_GROUP_COUNT,
        "runtime render-command parity group count changed"
    );

    for (book_id, config_id) in groups {
        assert_runtime_frames_match_render_command_golden(
            &book_id,
            &config_id,
            true,
            &mut counters,
        );
    }

    assert_eq!(
        counters.checked_case_count, EXPECTED_RUNTIME_RENDER_CASE_COUNT,
        "runtime render-command parity case count changed"
    );
    assert_eq!(
        counters.checked_render_count, EXPECTED_RUNTIME_RENDER_SUMMARY_COUNT,
        "runtime render-command parity render summary count changed"
    );
    assert_runtime_render_surface_is_covered("command", &counters.covered_commands);
    assert_runtime_render_surface_is_covered("feature", &counters.covered_features);
}

#[test]
#[ignore = "exhaustive real-EPUB runtime parity; run explicitly before Rust core parity milestones"]
fn runtime_frames_match_all_render_command_goldens() {
    let mut counters = RuntimeRenderParityCounters::default();
    let groups = exhaustive_runtime_render_command_groups();
    assert_eq!(
        groups.len(),
        EXPECTED_EXHAUSTIVE_RUNTIME_RENDER_GROUP_COUNT,
        "exhaustive runtime render-command parity group count changed"
    );

    for (book_id, config_id) in groups {
        assert_runtime_frames_match_render_command_golden(
            &book_id,
            &config_id,
            false,
            &mut counters,
        );
    }

    assert_eq!(
        counters.checked_case_count, EXPECTED_EXHAUSTIVE_RUNTIME_RENDER_CASE_COUNT,
        "exhaustive runtime render-command parity case count changed"
    );
    assert_eq!(
        counters.checked_render_count, EXPECTED_EXHAUSTIVE_RUNTIME_RENDER_SUMMARY_COUNT,
        "exhaustive runtime render-command parity render summary count changed"
    );
    assert_runtime_render_surface_is_covered("command", &counters.covered_commands);
    assert_runtime_render_surface_is_covered("feature", &counters.covered_features);
}

fn assert_layout_matches(actual: &LayoutSummary, expected: &LayoutSummary, label: &str) {
    assert_eq!(
        actual.inline_segments.chapter_count, expected.inline_segments.chapter_count,
        "inline segment chapter count mismatch"
    );
    assert_eq!(
        actual.inline_segments.total_block_count, expected.inline_segments.total_block_count,
        "inline segment block count mismatch"
    );
    assert_eq!(
        actual.inline_segments.total_segment_count, expected.inline_segments.total_segment_count,
        "inline segment count mismatch"
    );
    assert_eq!(
        actual.inline_segments.total_atom_count, expected.inline_segments.total_atom_count,
        "inline atom count mismatch"
    );

    for (index, (actual, expected)) in actual
        .inline_segments
        .chapters
        .iter()
        .zip(&expected.inline_segments.chapters)
        .enumerate()
    {
        if actual != expected {
            panic!(
                "inline segment chapter mismatch at {index} ({})\nactual: {}\nexpected: {}",
                actual.idref,
                serde_json::to_string_pretty(actual).expect("serialize actual chapter"),
                serde_json::to_string_pretty(expected).expect("serialize expected chapter")
            );
        }
    }

    assert_eq!(
        actual.inline_segments.full_detail_hash, expected.inline_segments.full_detail_hash,
        "{label}: inline segment full detail hash mismatch"
    );

    assert_eq!(
        actual.line_break_inputs, expected.line_break_inputs,
        "{label}: line break input summary mismatch"
    );

    assert_eq!(
        actual.line_boxes.chapter_count, expected.line_boxes.chapter_count,
        "{label}: line box chapter count mismatch"
    );
    assert_eq!(
        actual.line_boxes.total_block_count, expected.line_boxes.total_block_count,
        "{label}: line box block count mismatch"
    );
    for (index, (actual, expected)) in actual
        .line_boxes
        .chapters
        .iter()
        .zip(&expected.line_boxes.chapters)
        .enumerate()
    {
        if actual != expected {
            let block_mismatch = actual
                .blocks
                .iter()
                .zip(&expected.blocks)
                .enumerate()
                .find(|(_, (actual, expected))| actual != expected);
            if let Some((block_index, (actual_block, expected_block))) = block_mismatch {
                panic!(
                    "{label}: line box chapter mismatch at {index} ({}), first block mismatch {block_index}\nactual block: {}\nexpected block: {}\nactual sample: {}\nexpected sample: {}",
                    actual.idref,
                    serde_json::to_string_pretty(actual_block)
                        .expect("serialize actual line box block"),
                    serde_json::to_string_pretty(expected_block)
                        .expect("serialize expected line box block"),
                    serde_json::to_string_pretty(&actual.samples.get(block_index))
                        .expect("serialize actual line box sample"),
                    serde_json::to_string_pretty(&expected.samples.get(block_index))
                        .expect("serialize expected line box sample")
                );
            }
            panic!(
                "line box chapter mismatch at {index} ({})\nactual: {}\nexpected: {}",
                actual.idref,
                serde_json::to_string_pretty(actual).expect("serialize actual line box chapter"),
                serde_json::to_string_pretty(expected)
                    .expect("serialize expected line box chapter")
            );
        }
    }

    assert_eq!(
        actual.line_boxes.total_line_count, expected.line_boxes.total_line_count,
        "line box line count mismatch"
    );

    assert_eq!(
        actual.line_boxes.total_run_count, expected.line_boxes.total_run_count,
        "line box text run count mismatch"
    );
    assert_eq!(
        actual.line_boxes.total_atom_count, expected.line_boxes.total_atom_count,
        "line box atom count mismatch"
    );
    assert_eq!(
        actual.line_boxes.total_ruby_count, expected.line_boxes.total_ruby_count,
        "line box ruby count mismatch"
    );

    assert_eq!(
        actual.line_boxes.full_detail_hash, expected.line_boxes.full_detail_hash,
        "line box full detail hash mismatch"
    );

    assert_eq!(
        actual.continuous_blocks.chapter_count, expected.continuous_blocks.chapter_count,
        "continuous block chapter count mismatch"
    );
    if actual.continuous_blocks.total_top_level_block_count
        != expected.continuous_blocks.total_top_level_block_count
    {
        if let Some((index, (actual_chapter, expected_chapter))) = actual
            .continuous_blocks
            .chapters
            .iter()
            .zip(&expected.continuous_blocks.chapters)
            .enumerate()
            .find(|(_, (actual_chapter, expected_chapter))| {
                actual_chapter.top_level_block_count != expected_chapter.top_level_block_count
            })
        {
            panic!(
                "continuous top-level block count mismatch at chapter {index} ({})\nactual chapter topLevelBlockCount: {}\nexpected chapter topLevelBlockCount: {}\nactual chapter: {}\nexpected chapter: {}",
                actual_chapter.idref,
                actual_chapter.top_level_block_count,
                expected_chapter.top_level_block_count,
                serde_json::to_string_pretty(actual_chapter)
                    .expect("serialize actual continuous chapter"),
                serde_json::to_string_pretty(expected_chapter)
                    .expect("serialize expected continuous chapter")
            );
        }
        panic!(
            "continuous top-level block count mismatch\nactual: {}\nexpected: {}",
            actual.continuous_blocks.total_top_level_block_count,
            expected.continuous_blocks.total_top_level_block_count
        );
    }
    assert_eq!(
        actual.continuous_blocks.total_line_count, expected.continuous_blocks.total_line_count,
        "continuous line count mismatch"
    );
    if actual.continuous_blocks.total_text_run_count
        != expected.continuous_blocks.total_text_run_count
    {
        if let Some((index, (actual_chapter, expected_chapter))) = actual
            .continuous_blocks
            .chapters
            .iter()
            .zip(&expected.continuous_blocks.chapters)
            .enumerate()
            .find(|(_, (actual_chapter, expected_chapter))| {
                actual_chapter.text_run_count != expected_chapter.text_run_count
            })
        {
            let block_mismatch = actual_chapter
                .blocks
                .iter()
                .zip(&expected_chapter.blocks)
                .enumerate()
                .find(|(_, (actual_block, expected_block))| actual_block != expected_block);
            if let Some((block_index, (actual_block, expected_block))) = block_mismatch {
                panic!(
                    "continuous text run count mismatch at chapter {index} ({}), first block mismatch {block_index}\nactual chapter textRunCount: {}\nexpected chapter textRunCount: {}\nactual block: {}\nexpected block: {}",
                    actual_chapter.idref,
                    actual_chapter.text_run_count,
                    expected_chapter.text_run_count,
                    serde_json::to_string_pretty(actual_block)
                        .expect("serialize actual continuous block"),
                    serde_json::to_string_pretty(expected_block)
                        .expect("serialize expected continuous block")
                );
            }
            panic!(
                "continuous text run count mismatch at chapter {index} ({})\nactual: {}\nexpected: {}",
                actual_chapter.idref,
                actual_chapter.text_run_count,
                expected_chapter.text_run_count
            );
        }
        panic!(
            "continuous text run count mismatch\nactual: {}\nexpected: {}",
            actual.continuous_blocks.total_text_run_count,
            expected.continuous_blocks.total_text_run_count
        );
    }
    assert_eq!(
        actual.continuous_blocks.total_image_count, expected.continuous_blocks.total_image_count,
        "continuous image count mismatch"
    );
    assert_eq!(
        actual.continuous_blocks.total_hr_count, expected.continuous_blocks.total_hr_count,
        "continuous hr count mismatch"
    );

    for (index, (actual, expected)) in actual
        .continuous_blocks
        .chapters
        .iter()
        .zip(&expected.continuous_blocks.chapters)
        .enumerate()
    {
        if actual != expected {
            let block_mismatch = actual
                .blocks
                .iter()
                .zip(&expected.blocks)
                .enumerate()
                .find(|(_, (actual, expected))| actual != expected);
            if let Some((block_index, (actual_block, expected_block))) = block_mismatch {
                panic!(
                    "continuous block chapter mismatch at {index} ({}), first block mismatch {block_index}\nfirst value mismatch: {}\nactual block: {}\nexpected block: {}",
                    actual.idref,
                    first_json_mismatch("$", actual_block, expected_block),
                    serde_json::to_string_pretty(actual_block)
                        .expect("serialize actual continuous block"),
                    serde_json::to_string_pretty(expected_block)
                        .expect("serialize expected continuous block")
                );
            }
            panic!(
                "continuous block chapter mismatch at {index} ({})\nactual: {}\nexpected: {}",
                actual.idref,
                serde_json::to_string_pretty(actual)
                    .expect("serialize actual continuous block chapter"),
                serde_json::to_string_pretty(expected)
                    .expect("serialize expected continuous block chapter")
            );
        }
    }

    assert_eq!(
        actual.continuous_blocks.full_detail_hash, expected.continuous_blocks.full_detail_hash,
        "continuous block full detail hash mismatch"
    );

    assert_pagination_flow_matches(actual, expected);
}

fn first_json_mismatch(path: &str, actual: &Value, expected: &Value) -> String {
    if actual == expected {
        return format!("{path}: equal");
    }
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => {
            for key in actual.keys().chain(expected.keys()) {
                if actual.get(key) != expected.get(key) {
                    let next_path = format!("{path}.{key}");
                    return match (actual.get(key), expected.get(key)) {
                        (Some(actual), Some(expected)) => {
                            first_json_mismatch(&next_path, actual, expected)
                        }
                        (actual, expected) => format!(
                            "{next_path}: actual={} expected={}",
                            json_preview(actual),
                            json_preview(expected)
                        ),
                    };
                }
            }
            format!("{path}: object mismatch")
        }
        (Value::Array(actual), Value::Array(expected)) => {
            let len = actual.len().min(expected.len());
            for index in 0..len {
                if actual[index] != expected[index] {
                    return first_json_mismatch(
                        &format!("{path}[{index}]"),
                        &actual[index],
                        &expected[index],
                    );
                }
            }
            format!(
                "{path}.length: actual={} expected={}",
                actual.len(),
                expected.len()
            )
        }
        _ => format!("{path}: actual={actual} expected={expected}"),
    }
}

fn json_preview(value: Option<&Value>) -> String {
    value
        .map(ToString::to_string)
        .unwrap_or_else(|| "<missing>".to_owned())
}

fn assert_pagination_flow_matches(actual: &LayoutSummary, expected: &LayoutSummary) {
    assert_eq!(
        actual.pagination_flow.page_count, expected.pagination_flow.page_count,
        "pagination flow page count mismatch"
    );
    assert_eq!(
        actual.pagination_flow.totals, expected.pagination_flow.totals,
        "pagination flow totals mismatch"
    );
    assert_eq!(
        actual.pagination_flow.chapter_map, expected.pagination_flow.chapter_map,
        "pagination flow chapter map mismatch"
    );
    assert_eq!(
        actual.pagination_flow.page_digests.len(),
        expected.pagination_flow.page_digests.len(),
        "pagination flow page digest length mismatch"
    );

    for (index, (actual, expected)) in actual
        .pagination_flow
        .page_digests
        .iter()
        .zip(&expected.pagination_flow.page_digests)
        .enumerate()
    {
        if actual != expected {
            panic!(
                "pagination flow page digest mismatch at {index}\nactual: {}\nexpected: {}",
                serde_json::to_string_pretty(actual).expect("serialize actual page digest"),
                serde_json::to_string_pretty(expected).expect("serialize expected page digest")
            );
        }
    }

    for (index, (actual, expected)) in actual
        .pagination_flow
        .samples
        .iter()
        .zip(&expected.pagination_flow.samples)
        .enumerate()
    {
        if actual != expected {
            panic!(
                "pagination flow sample mismatch at {index}\nactual: {}\nexpected: {}",
                serde_json::to_string_pretty(actual).expect("serialize actual sample"),
                serde_json::to_string_pretty(expected).expect("serialize expected sample")
            );
        }
    }
    assert_eq!(
        actual.pagination_flow.samples.len(),
        expected.pagination_flow.samples.len(),
        "pagination flow sample length mismatch"
    );
    assert_eq!(
        actual.pagination_flow.spread_flow, expected.pagination_flow.spread_flow,
        "pagination spread flow mismatch"
    );
    assert_display_list_flow_matches(actual, expected);
    assert_eq!(
        actual.pagination_flow.hit_map_flow, expected.pagination_flow.hit_map_flow,
        "pagination hit-map flow mismatch"
    );
    assert_eq!(
        actual.pagination_flow.text_position_flow, expected.pagination_flow.text_position_flow,
        "pagination text-position flow mismatch"
    );
    assert_eq!(
        actual.pagination_flow.link_map_flow, expected.pagination_flow.link_map_flow,
        "pagination link-map flow mismatch"
    );
    assert_eq!(
        actual.pagination_flow.search_flow, expected.pagination_flow.search_flow,
        "pagination search flow mismatch"
    );
    assert_eq!(
        actual.pagination_flow.full_detail_hash, expected.pagination_flow.full_detail_hash,
        "pagination flow full detail hash mismatch"
    );
}

fn assert_display_list_flow_matches(actual: &LayoutSummary, expected: &LayoutSummary) {
    let actual_flow = &actual.pagination_flow.display_list_flow;
    let expected_flow = &expected.pagination_flow.display_list_flow;
    assert_eq!(
        actual_flow.spread_count, expected_flow.spread_count,
        "pagination display-list spread count mismatch"
    );
    for (index, (actual, expected)) in actual_flow
        .spread_digests
        .iter()
        .zip(&expected_flow.spread_digests)
        .enumerate()
    {
        if actual != expected {
            panic!(
                "pagination display-list spread digest mismatch at {index}\nactual: {}\nexpected: {}",
                serde_json::to_string_pretty(actual)
                    .expect("serialize actual display-list digest"),
                serde_json::to_string_pretty(expected)
                    .expect("serialize expected display-list digest")
            );
        }
    }
    assert_eq!(
        actual_flow.spread_digests.len(),
        expected_flow.spread_digests.len(),
        "pagination display-list spread digest length mismatch"
    );
    assert_eq!(
        actual_flow.samples, expected_flow.samples,
        "pagination display-list samples mismatch"
    );
    assert_eq!(
        actual_flow.full_detail_hash, expected_flow.full_detail_hash,
        "pagination display-list full detail hash mismatch"
    );
}

fn assert_render_command_hash_matches(
    fixture: &RustParityFixture,
    render_fixture: &RenderCommandFixture,
    case_id: &str,
) {
    let (rust, golden) = render_command_pair(fixture, render_fixture, case_id);
    assert_render_command_display_list_matches(
        rust.command_count,
        &rust.command_counts,
        &rust.render_command_hash,
        &rust.width,
        &rust.height,
        golden,
        case_id,
    );
}

fn assert_all_render_command_hashes_match(fixture_path: &str) {
    let fixture = read_fixture(fixture_path);
    let render_fixture = read_render_command_fixture(
        fixture_path
            .strip_suffix(".gz")
            .expect("compressed fixture path ends in .gz"),
    );
    for case in &render_fixture.cases {
        assert_render_command_hash_matches(&fixture, &render_fixture, &case.id);
    }
}

fn assert_render_command_counts_match(
    command_count: usize,
    command_counts: &BTreeMap<String, usize>,
    golden: &RenderCommandRender,
    case_id: &str,
) {
    assert_eq!(
        command_count, golden.display_list.command_count,
        "render-command display-list command count mismatch for {case_id}"
    );
    assert_eq!(
        command_counts, &golden.display_list.commands,
        "render-command display-list command kind counts mismatch for {case_id}"
    );
}

fn assert_render_command_display_list_matches(
    command_count: usize,
    command_counts: &BTreeMap<String, usize>,
    command_hash: &str,
    width: &Value,
    height: &Value,
    golden: &RenderCommandRender,
    case_id: &str,
) {
    assert_eq!(
        command_hash, golden.display_list.hash,
        "render-command display-list hash mismatch for {case_id}"
    );
    assert_render_command_counts_match(command_count, command_counts, golden, case_id);
    assert_eq!(
        width, &golden.display_list.width,
        "render-command display-list width mismatch for {case_id}"
    );
    assert_eq!(
        height, &golden.display_list.height,
        "render-command display-list height mismatch for {case_id}"
    );
}

fn assert_runtime_frames_match_render_command_golden(
    book_id: &str,
    config_id: &str,
    require_selected_coverage_case: bool,
    counters: &mut RuntimeRenderParityCounters,
) {
    let fixture = read_fixture(&format!("{book_id}/{config_id}.json.gz"));
    let render_fixture = read_render_command_fixture(&format!("{book_id}/{config_id}.json"));
    let bytes = fs::read(book_root().join(&fixture.book.path))
        .unwrap_or_else(|error| panic!("read fixture EPUB {book_id}: {error}"));
    let mut document =
        RuntimeDocument::open(&bytes).unwrap_or_else(|error| panic!("{book_id}: {error}"));
    let revision = document
        .create_revision_with_line_breaking(&fixture.config.layout, fixture.config.line_breaking)
        .unwrap_or_else(|error| panic!("{book_id}/{config_id}: create runtime revision: {error}"));
    assert_runtime_navigation_matches_fixture(&document, &revision.revision_id, &fixture);
    assert_runtime_locators_match_fixture(&document, &revision.revision_id, &fixture);
    assert_runtime_search_matches_fixture(&document, &revision.revision_id, &fixture);
    assert_runtime_footnotes_match_fixture(&mut document, &revision.revision_id, &fixture);
    assert_runtime_resources_match_fixture(&mut document, &revision.revision_id, &fixture);

    if require_selected_coverage_case {
        assert!(
            render_fixture.cases.iter().any(|case| {
                runtime_render_command_case_selected(book_id, config_id, &case.id)
            }),
            "runtime render-command parity group {book_id}/{config_id} must contain a selected coverage case"
        );
    }

    for case in &render_fixture.cases {
        counters.checked_case_count += 1;
        document
            .get_frame_command_buffer_metadata(&revision.revision_id, case.page.index)
            .unwrap_or_else(|error| panic!("{}: warm packed runtime frame: {error}", case.id));
        let frame = document
            .get_frame(&revision.revision_id, case.page.index)
            .unwrap_or_else(|error| panic!("{}: get runtime frame: {error}", case.id));
        assert_runtime_page_text_positions_match_fixture(
            &document,
            &revision.revision_id,
            &fixture,
            case,
        );
        assert_runtime_page_targets_match_fixture(&document, &revision.revision_id, &fixture, case);
        record_positive_counts(
            &mut counters.covered_features,
            &case.page.selected_feature_counts,
        );
        let fixture_digest = display_list_digest_for_page(&fixture, case.page.index, &case.id);
        assert_eq!(
            frame.page_indexes, fixture_digest.page_indexes,
            "runtime frame pageIndexes mismatch for {}",
            case.id
        );
        assert_eq!(
            frame.resource_refs, fixture_digest.resource_refs,
            "runtime frame resourceRefs mismatch for {}",
            case.id
        );
        assert_runtime_frame_command_buffer_matches_frame(
            &mut document,
            &revision.revision_id,
            &frame,
            &case.id,
        );
        let runtime_render_hash = hash_json_value(&Value::Array(
            normalize_runtime_commands_for_render_hash(&frame.commands),
        ));
        for render in &case.renders {
            counters.checked_render_count += 1;
            record_positive_counts(
                &mut counters.covered_commands,
                &render.display_list.commands,
            );
            assert_render_command_display_list_matches(
                frame.command_count,
                &frame.command_counts,
                &runtime_render_hash,
                &frame.width,
                &frame.height,
                render,
                &case.id,
            );
        }
    }
}

fn assert_runtime_frame_command_buffer_matches_frame(
    document: &mut RuntimeDocument,
    revision_id: &str,
    frame: &rito_core::runtime::RuntimeFrame,
    case_id: &str,
) {
    let buffer = document
        .get_frame_command_buffer(revision_id, frame.spread_index)
        .unwrap_or_else(|error| panic!("{case_id}: get packed frame command buffer: {error}"));
    assert_eq!(
        buffer.metadata.revision_id, frame.revision_id,
        "packed frame revision mismatch for {case_id}"
    );
    assert_eq!(
        buffer.metadata.spread_index, frame.spread_index,
        "packed frame spread index mismatch for {case_id}"
    );
    assert_eq!(
        buffer.metadata.command_count, frame.command_count,
        "packed frame command count mismatch for {case_id}"
    );
    assert_eq!(
        buffer.metadata.command_counts, frame.command_counts,
        "packed frame command counts mismatch for {case_id}"
    );
    assert_eq!(
        buffer.metadata.command_hash, frame.command_hash,
        "packed frame command hash mismatch for {case_id}"
    );
    assert!(
        buffer.metadata.record_stats.geometry_records <= frame.command_count,
        "packed frame geometry record stats exceed command count for {case_id}"
    );
    assert!(
        buffer.metadata.record_stats.payload_records <= frame.command_count,
        "packed frame payload record stats exceed command count for {case_id}"
    );
    assert_eq!(
        buffer.metadata.resource_ref_count, frame.resource_refs.image_refs,
        "packed frame resource ref count mismatch for {case_id}"
    );
    assert_eq!(
        buffer.metadata.resource_table, frame.resource_refs.images,
        "packed frame resource table mismatch for {case_id}"
    );
    assert_eq!(
        buffer.metadata.byte_length,
        buffer.bytes.len(),
        "packed frame byte length mismatch for {case_id}"
    );
    assert_eq!(
        &buffer.bytes[0..8],
        b"RITOFCB2",
        "packed frame magic mismatch for {case_id}"
    );
    for payload in &buffer.metadata.payload_table {
        let value: Value = serde_json::from_str(payload)
            .unwrap_or_else(|error| panic!("{case_id}: packed payload is invalid JSON: {error}"));
        assert!(
            frame
                .commands
                .iter()
                .any(|command| { json_values_match_after_number_round_trip(command, &value) }),
            "packed payload should mirror runtime frame command for {case_id}: {payload}"
        );
    }
}

fn json_values_match_after_number_round_trip(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => {
            // Stable JSON serialization can move a non-integer f64 by one ULP.
            // Keep the full tree exact apart from that wire-format artifact.
            if !left.is_f64() || !right.is_f64() {
                return left == right;
            }
            let Some(left) = left.as_f64() else {
                return left == right;
            };
            let Some(right) = right.as_f64() else {
                return false;
            };
            ordered_f64_bits(left).abs_diff(ordered_f64_bits(right)) <= 1
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| json_values_match_after_number_round_trip(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, left)| {
                    right
                        .get(key)
                        .is_some_and(|right| json_values_match_after_number_round_trip(left, right))
                })
        }
        _ => left == right,
    }
}

fn ordered_f64_bits(value: f64) -> u64 {
    const SIGN_MASK: u64 = 1 << 63;
    let bits = value.to_bits();
    if bits & SIGN_MASK == 0 {
        bits | SIGN_MASK
    } else {
        !bits
    }
}

fn assert_runtime_navigation_matches_fixture(
    document: &RuntimeDocument,
    revision_id: &str,
    fixture: &RustParityFixture,
) {
    let bundle = document
        .revision_bundle(revision_id, true)
        .unwrap_or_else(|error| panic!("runtime revision bundle should resolve: {error}"));
    let navigation = bundle.navigation;
    assert_eq!(
        navigation.page_count, fixture.layout.pagination_flow.page_count,
        "runtime navigation pageCount mismatch"
    );
    assert_eq!(
        navigation.spread_count,
        fixture
            .layout
            .pagination_flow
            .display_list_flow
            .spread_count,
        "runtime navigation spreadCount mismatch"
    );
    assert_eq!(
        navigation.chapter_map, fixture.layout.pagination_flow.chapter_map,
        "runtime navigation chapterMap mismatch"
    );
    assert_eq!(
        navigation.chapters.len(),
        fixture.chapters.len(),
        "runtime navigation chapter count mismatch"
    );
}

fn assert_runtime_locators_match_fixture(
    document: &RuntimeDocument,
    revision_id: &str,
    fixture: &RustParityFixture,
) {
    for chapter in &fixture.chapters {
        let Some(range) = fixture
            .layout
            .pagination_flow
            .chapter_map
            .get(&chapter.idref)
        else {
            continue;
        };
        let locator = document
            .resolve_locator(
                revision_id,
                rito_core::runtime::RuntimeLocatorRequest {
                    href: chapter.href.clone(),
                },
            )
            .unwrap_or_else(|error| {
                panic!(
                    "runtime locator {} should resolve for {}: {error}",
                    chapter.href, chapter.idref
                )
            });
        assert_eq!(
            locator.spine_idref, chapter.idref,
            "runtime locator spine idref mismatch for {}",
            chapter.href
        );
        assert_eq!(
            locator.page_index, range.start_page,
            "runtime locator page index mismatch for {}",
            chapter.href
        );
        assert_eq!(
            locator.spread_index,
            display_list_digest_for_page(fixture, range.start_page, &chapter.href).spread_index,
            "runtime locator spread index mismatch for {}",
            chapter.href
        );
        assert_eq!(
            locator.fragment, None,
            "chapter href locator should not resolve a fragment for {}",
            chapter.href
        );
    }
}

fn assert_runtime_search_matches_fixture(
    document: &RuntimeDocument,
    revision_id: &str,
    fixture: &RustParityFixture,
) {
    for expected in &fixture.layout.pagination_flow.search_flow.queries {
        let response = document
            .search(
                revision_id,
                RuntimeSearchRequest {
                    query: expected.query.clone(),
                    case_sensitive: expected.case_sensitive,
                    whole_word: expected.whole_word,
                    limit: None,
                },
            )
            .unwrap_or_else(|error| {
                panic!("runtime search {} should resolve: {error}", expected.id)
            });
        let results = response
            .results
            .iter()
            .map(runtime_search_result_value)
            .collect::<Vec<_>>();
        let page_indexes = results
            .iter()
            .filter_map(|result| result.get("pageIndex").and_then(Value::as_u64))
            .map(|index| (index as usize, ()))
            .collect::<BTreeMap<_, _>>()
            .into_keys()
            .collect::<Vec<_>>();
        let contexts = results
            .iter()
            .filter_map(|result| result.get("context").cloned())
            .collect::<Vec<_>>();
        let ranges = results
            .iter()
            .map(runtime_search_result_range_value)
            .collect::<Vec<_>>();
        assert_eq!(
            response.result_count, expected.result_count,
            "runtime search resultCount mismatch for {}",
            expected.id
        );
        assert_eq!(
            page_indexes, expected.page_indexes,
            "runtime search pageIndexes mismatch for {}",
            expected.id
        );
        assert_eq!(
            hash_json_value(&Value::Array(contexts)),
            expected.context_hash,
            "runtime search contextHash mismatch for {}",
            expected.id
        );
        assert_eq!(
            hash_json_value(&Value::Array(ranges)),
            expected.range_hash,
            "runtime search rangeHash mismatch for {}",
            expected.id
        );
        assert_eq!(
            results.iter().take(6).cloned().collect::<Vec<_>>(),
            expected.samples,
            "runtime search samples mismatch for {}",
            expected.id
        );
        assert_eq!(
            hash_json_value(&Value::Array(results)),
            expected.detail_hash,
            "runtime search detailHash mismatch for {}",
            expected.id
        );
    }
}

fn assert_runtime_footnotes_match_fixture(
    document: &mut RuntimeDocument,
    revision_id: &str,
    fixture: &RustParityFixture,
) {
    for key in &fixture.pagination.footnote_keys {
        let footnote = document
            .get_footnote(revision_id, key)
            .unwrap_or_else(|error| panic!("runtime footnote {key} should resolve: {error}"));
        assert_eq!(
            footnote.key, *key,
            "runtime footnote key mismatch for {key}"
        );
        assert!(
            !footnote.text.is_empty() || !footnote.html.is_empty(),
            "runtime footnote should retain text or html for {key}"
        );
    }
}

fn assert_runtime_resources_match_fixture(
    document: &mut RuntimeDocument,
    revision_id: &str,
    fixture: &RustParityFixture,
) {
    for resource in &fixture.resources.stylesheets {
        let runtime = document
            .get_resource(revision_id, RuntimeResourceKind::Stylesheet, &resource.href)
            .unwrap_or_else(|error| {
                panic!(
                    "runtime stylesheet {} should resolve: {error}",
                    resource.href
                )
            });
        let text = std::str::from_utf8(&runtime.bytes).unwrap_or_else(|error| {
            panic!("runtime stylesheet {} is not UTF-8: {error}", resource.href)
        });
        assert_eq!(
            text.encode_utf16().count(),
            resource.text_length,
            "runtime stylesheet text length mismatch for {}",
            resource.href
        );
        assert_eq!(
            hash_text(text),
            resource.text_hash,
            "runtime stylesheet text hash mismatch for {}",
            resource.href
        );
    }
    for resource in &fixture.resources.fonts {
        let runtime = document
            .get_resource(revision_id, RuntimeResourceKind::Font, &resource.href)
            .unwrap_or_else(|error| {
                panic!("runtime font {} should resolve: {error}", resource.href)
            });
        assert_runtime_binary_resource_matches(
            &runtime.bytes,
            runtime.width,
            runtime.height,
            resource,
            "font",
        );
    }
    for resource in &fixture.resources.images {
        let runtime = document
            .get_resource(revision_id, RuntimeResourceKind::Image, &resource.href)
            .unwrap_or_else(|error| {
                panic!("runtime image {} should resolve: {error}", resource.href)
            });
        assert_runtime_binary_resource_matches(
            &runtime.bytes,
            runtime.width,
            runtime.height,
            resource,
            "image",
        );
    }
}

fn assert_runtime_binary_resource_matches(
    bytes: &[u8],
    width: Option<u32>,
    height: Option<u32>,
    expected: &rito_core::resources::BinaryResourceSummary,
    label: &str,
) {
    assert_eq!(
        bytes.len(),
        expected.byte_length,
        "runtime {label} byte length mismatch for {}",
        expected.href
    );
    let actual_hash = hash_bytes(bytes);
    assert_eq!(
        Some(actual_hash.as_str()),
        expected.byte_hash.as_deref(),
        "runtime {label} byte hash mismatch for {}",
        expected.href
    );
    assert_eq!(
        width, expected.width,
        "runtime {label} width mismatch for {}",
        expected.href
    );
    assert_eq!(
        height, expected.height,
        "runtime {label} height mismatch for {}",
        expected.href
    );
}

fn runtime_search_result_value(result: &rito_core::runtime::RuntimeSearchResult) -> Value {
    json!({
        "pageIndex": result.page_index,
        "range": {
            "start": search_text_position_value(result.match_range.start),
            "end": search_text_position_value(result.match_range.end),
        },
        "context": {
            "length": result.match_range.context.encode_utf16().count(),
            "hash": hash_text(&result.match_range.context),
        },
    })
}

fn runtime_search_result_range_value(result: &Value) -> Value {
    json!({
        "pageIndex": result.get("pageIndex").cloned().unwrap_or(Value::Null),
        "range": result.get("range").cloned().unwrap_or(Value::Null),
    })
}

fn search_text_position_value(position: rito_core::layout::SearchTextPosition) -> Value {
    json!({
        "blockIndex": position.block_index,
        "lineIndex": position.line_index,
        "runIndex": position.run_index,
        "charIndex": position.char_index,
    })
}

fn assert_runtime_page_text_positions_match_fixture(
    document: &RuntimeDocument,
    revision_id: &str,
    fixture: &RustParityFixture,
    case: &RenderCommandCase,
) {
    let positions = document
        .get_page_text_positions(revision_id, case.page.index)
        .unwrap_or_else(|error| panic!("{}: get page text positions: {error}", case.id));
    let expected = fixture
        .layout
        .pagination_flow
        .text_position_flow
        .page_digests
        .iter()
        .find(|digest| digest.index == case.page.index)
        .unwrap_or_else(|| panic!("{}: missing text-position digest", case.id));
    let offsets = positions
        .offsets
        .iter()
        .map(text_run_offset_value)
        .collect::<Vec<_>>();
    let detail = json!({
        "index": positions.page_index,
        "text": {
            "length": positions.text_length,
            "hash": positions.text_hash,
        },
        "offsets": offsets,
    });
    assert_eq!(
        positions.text_length, expected.text_length,
        "runtime text-position textLength mismatch for {}",
        case.id
    );
    assert_eq!(
        positions.text_hash, expected.text_hash,
        "runtime text-position textHash mismatch for {}",
        case.id
    );
    assert_eq!(
        positions.offsets.len(),
        expected.offset_count,
        "runtime text-position offsetCount mismatch for {}",
        case.id
    );
    assert_eq!(
        hash_json_value(&detail["offsets"]),
        expected.offset_hash,
        "runtime text-position offsetHash mismatch for {}",
        case.id
    );
    assert_eq!(
        hash_json_value(&detail),
        expected.detail_hash,
        "runtime text-position detailHash mismatch for {}",
        case.id
    );
}

fn text_run_offset_value(offset: &rito_core::layout::TextRunOffset) -> Value {
    json!({
        "start": offset.start,
        "end": offset.end,
        "blockIndex": offset.block_index,
        "lineIndex": offset.line_index,
        "runIndex": offset.run_index,
    })
}

fn assert_runtime_page_targets_match_fixture(
    document: &RuntimeDocument,
    revision_id: &str,
    fixture: &RustParityFixture,
    case: &RenderCommandCase,
) {
    let targets = document
        .get_page_targets(revision_id, case.page.index)
        .unwrap_or_else(|error| panic!("{}: get page targets: {error}", case.id));
    let expected = fixture
        .layout
        .pagination_flow
        .hit_map_flow
        .page_digests
        .iter()
        .find(|digest| digest.index == case.page.index)
        .unwrap_or_else(|| panic!("{}: missing hit-map digest", case.id));
    let diagnostic_entries = targets
        .entries
        .iter()
        .map(runtime_page_target_value)
        .collect::<Vec<_>>();
    let detail = json!({
        "index": targets.page_index,
        "counts": count_runtime_hit_map_entries(&diagnostic_entries),
        "textHash": targets.text_hash,
        "entries": diagnostic_entries,
    });
    assert_eq!(
        targets.entry_count, expected.counts.entries,
        "runtime page target entryCount mismatch for {}",
        case.id
    );
    assert_eq!(
        detail["counts"],
        serde_json::to_value(&expected.counts).expect("hit-map counts serialize"),
        "runtime page target counts mismatch for {}",
        case.id
    );
    assert_eq!(
        targets.text_hash, expected.text_hash,
        "runtime page target textHash mismatch for {}",
        case.id
    );
    assert_eq!(
        hash_json_value(&detail),
        expected.detail_hash,
        "runtime page target detailHash mismatch for {}",
        case.id
    );
}

fn runtime_page_target_value(target: &RuntimePageTarget) -> Value {
    let mut value = Map::new();
    value.insert("blockIndex".to_owned(), json!(target.block_index));
    value.insert(
        "bounds".to_owned(),
        Value::Object(Map::from_iter([
            ("x".to_owned(), runtime_target_number(target.bounds.x)),
            ("y".to_owned(), runtime_target_number(target.bounds.y)),
            (
                "width".to_owned(),
                runtime_target_number(target.bounds.width),
            ),
            (
                "height".to_owned(),
                runtime_target_number(target.bounds.height),
            ),
        ])),
    );
    value.insert("lineIndex".to_owned(), json!(target.line_index));
    value.insert("runIndex".to_owned(), json!(target.run_index));
    value.insert(
        "text".to_owned(),
        json!({"hash": target.text.hash, "length": target.text.length}),
    );
    insert_runtime_target_string(&mut value, "href", target.href.as_deref());
    insert_runtime_target_string(&mut value, "imageSrc", target.image_src.as_deref());
    insert_runtime_target_string(&mut value, "imageAlt", target.image_alt.as_deref());
    if let Some(point) = target
        .source_locator
        .as_ref()
        .and_then(|locator| locator.source_point.as_ref())
    {
        value.insert("sourcePath".to_owned(), json!(point.node_path));
        value.insert("sourceTextOffset".to_owned(), json!(point.text_offset));
    }
    Value::Object(value)
}

fn insert_runtime_target_string(value: &mut Map<String, Value>, key: &str, field: Option<&str>) {
    if let Some(field) = field {
        value.insert(key.to_owned(), Value::String(field.to_owned()));
    }
}

fn runtime_target_number(value: f64) -> Value {
    if value.fract().abs() < f64::EPSILON {
        json!(value as i64)
    } else {
        json!(value)
    }
}

fn count_runtime_hit_map_entries(entries: &[Value]) -> Value {
    let mut counts = BTreeMap::from([
        ("entries", 0usize),
        ("imageEntries", 0usize),
        ("linkEntries", 0usize),
        ("sourceRefs", 0usize),
        ("textEntries", 0usize),
    ]);
    for entry in entries {
        *counts.get_mut("entries").expect("entries count exists") += 1;
        if hit_map_entry_text_len(entry) > 0 {
            *counts
                .get_mut("textEntries")
                .expect("text entries count exists") += 1;
        }
        if entry.get("imageSrc").is_some() {
            *counts
                .get_mut("imageEntries")
                .expect("image entries count exists") += 1;
        }
        if entry.get("href").is_some() {
            *counts
                .get_mut("linkEntries")
                .expect("link entries count exists") += 1;
        }
        if entry.get("sourcePath").is_some() {
            *counts
                .get_mut("sourceRefs")
                .expect("source refs count exists") += 1;
        }
    }
    serde_json::to_value(counts).expect("hit-map count value serializes")
}

fn hit_map_entry_text_len(entry: &Value) -> usize {
    entry
        .get("text")
        .and_then(|text| text.get("length"))
        .and_then(Value::as_u64)
        .map(|length| length as usize)
        .unwrap_or(0)
}

fn runtime_render_command_groups() -> Vec<(String, String)> {
    let mut groups = BTreeMap::new();
    for (book_id, config_id, _) in RUNTIME_RENDER_COMMAND_PARITY_CASES {
        groups.insert(((*book_id).to_owned(), (*config_id).to_owned()), ());
    }
    groups.into_keys().collect()
}

fn exhaustive_runtime_render_command_groups() -> Vec<(String, String)> {
    let mut groups = Vec::new();
    for book_id in EXPECTED_FIXTURE_BOOKS {
        for config_id in RENDER_COMMAND_GOLDEN_CONFIGS {
            groups.push(((*book_id).to_owned(), (*config_id).to_owned()));
        }
    }
    groups
}

fn runtime_render_command_case_selected(book_id: &str, config_id: &str, case_id: &str) -> bool {
    RUNTIME_RENDER_COMMAND_PARITY_CASES.iter().any(
        |(selected_book, selected_config, selected_case)| {
            *selected_book == book_id && *selected_config == config_id && *selected_case == case_id
        },
    )
}

fn record_positive_counts(target: &mut BTreeMap<String, usize>, counts: &BTreeMap<String, usize>) {
    for (key, count) in counts {
        if *count > 0 {
            *target.entry(key.clone()).or_insert(0) += count;
        }
    }
}

fn assert_runtime_render_surface_is_covered(label: &str, covered: &BTreeMap<String, usize>) {
    let expected = match label {
        "command" => EXPECTED_RUNTIME_RENDER_COMMAND_KINDS,
        "feature" => EXPECTED_RUNTIME_RENDER_FEATURES,
        _ => unreachable!("unknown runtime render surface label"),
    };
    let covered_keys = covered.keys().map(String::as_str).collect::<Vec<_>>();
    assert_eq!(
        covered_keys, expected,
        "runtime render-command parity {label} coverage mismatch"
    );
}

fn display_list_digest_for_page<'a>(
    fixture: &'a RustParityFixture,
    page_index: usize,
    case_id: &str,
) -> &'a rito_core::layout::DisplayListFlowSpreadDigest {
    fixture
        .layout
        .pagination_flow
        .display_list_flow
        .spread_digests
        .iter()
        .find(|digest| digest.page_indexes == [page_index])
        .unwrap_or_else(|| panic!("missing fixture display-list digest for {case_id}"))
}

fn render_command_pair<'a>(
    fixture: &'a RustParityFixture,
    render_fixture: &'a RenderCommandFixture,
    case_id: &str,
) -> (
    &'a rito_core::layout::DisplayListFlowSpreadDigest,
    &'a RenderCommandRender,
) {
    let case = render_fixture
        .cases
        .iter()
        .find(|case| case.id == case_id)
        .unwrap_or_else(|| panic!("missing render-command case {case_id}"));
    let rust = display_list_digest_for_page(fixture, case.page.index, case_id);
    let golden = case
        .renders
        .first()
        .unwrap_or_else(|| panic!("missing render-command render for {case_id}"));
    (rust, golden)
}

fn normalize_runtime_commands_for_render_hash(commands: &[Value]) -> Vec<Value> {
    commands
        .iter()
        .map(normalize_runtime_command_for_render_hash)
        .collect()
}

fn normalize_runtime_command_for_render_hash(command: &Value) -> Value {
    let Some(object) = command.as_object() else {
        return round_json_value(command);
    };
    let mut normalized = object.clone();
    if matches!(
        object.get("kind").and_then(Value::as_str),
        Some("paintText" | "paintRuby")
    ) {
        if let Some(text) = object.get("text").and_then(Value::as_str) {
            normalized.insert("text".to_owned(), text_summary_value(text));
        }
    }
    round_json_value(&Value::Object(normalized))
}

fn round_json_value(value: &Value) -> Value {
    match value {
        Value::Number(number) => number.as_f64().map_or_else(
            || value.clone(),
            |number| {
                let rounded = (number * 1000.0).round() / 1000.0;
                if rounded.fract().abs() < f64::EPSILON {
                    Value::Number(serde_json::Number::from(rounded as i64))
                } else {
                    Value::Number(
                        serde_json::Number::from_f64(rounded)
                            .unwrap_or_else(|| serde_json::Number::from(0)),
                    )
                }
            },
        ),
        Value::Array(values) => Value::Array(values.iter().map(round_json_value).collect()),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), round_json_value(value)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn text_summary_value(text: &str) -> Value {
    serde_json::json!({
        "hash": hash_display_list_text(text),
        "length": text.encode_utf16().count(),
    })
}

fn hash_display_list_text(text: &str) -> String {
    let json_string = Value::String(text.to_owned()).to_string();
    hash_text(&format!("{json_string}\n"))
}

fn hash_json_value(value: &Value) -> String {
    hash_text(&format!("{}\n", stable_json(value, 0)))
}

fn hash_text(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn stable_json(value: &Value, depth: usize) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => value.to_string(),
        Value::Array(values) => stable_json_array(values, depth),
        Value::Object(object) => stable_json_object(object, depth),
    }
}

fn stable_json_array(values: &[Value], depth: usize) -> String {
    if values.is_empty() {
        return "[]".to_owned();
    }
    let next_depth = depth + 1;
    let indent = "  ".repeat(next_depth);
    let closing = "  ".repeat(depth);
    let entries = values
        .iter()
        .map(|value| format!("{indent}{}", stable_json(value, next_depth)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("[\n{entries}\n{closing}]")
}

fn stable_json_object(object: &Map<String, Value>, depth: usize) -> String {
    if object.is_empty() {
        return "{}".to_owned();
    }
    let next_depth = depth + 1;
    let indent = "  ".repeat(next_depth);
    let closing = "  ".repeat(depth);
    let entries = object
        .iter()
        .map(|(key, value)| format!("{indent}{key:?}: {}", stable_json(value, next_depth)))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("{{\n{entries}\n{closing}}}")
}

fn read_manifest() -> FixtureManifest {
    read_json("manifest.json")
}

fn read_fixture(path: &str) -> RustParityFixture {
    read_json(path)
}

fn read_render_command_fixture(path: &str) -> RenderCommandFixture {
    read_json_path(render_command_golden_root().join(path))
}

fn read_publication(fixture: &RustParityFixture) -> EpubPublication {
    let path = book_root().join(&fixture.book.path);
    let bytes = fs::read(&path)
        .unwrap_or_else(|error| panic!("failed to read EPUB {}: {error}", path.display()));
    analyze_publication_with_layout_and_line_breaking(
        &bytes,
        &fixture.config.layout,
        fixture.config.line_breaking,
    )
    .unwrap_or_else(|error| panic!("failed to load EPUB {}: {error}", path.display()))
}

fn read_json<T>(relative_path: &str) -> T
where
    T: for<'de> Deserialize<'de>,
{
    read_json_path(fixture_root().join(relative_path))
}

fn read_json_path<T>(path: PathBuf) -> T
where
    T: for<'de> Deserialize<'de>,
{
    let bytes = fs::read(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    let text = if path.extension().and_then(|extension| extension.to_str()) == Some("gz") {
        let mut text = String::new();
        GzDecoder::new(bytes.as_slice())
            .read_to_string(&mut text)
            .unwrap_or_else(|error| panic!("failed to decompress {}: {error}", path.display()));
        text
    } else {
        String::from_utf8(bytes)
            .unwrap_or_else(|error| panic!("failed to decode {}: {error}", path.display()))
    };
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

impl RustParityFixture {
    fn chapter_sources(&self) -> Vec<ChapterSource> {
        self.chapters
            .iter()
            .map(|chapter| ChapterSource {
                idref: chapter.idref.clone(),
                href: chapter.href.clone(),
                linear: chapter.linear,
                text_length: chapter.text_length,
                text_hash: chapter.text_hash.clone(),
            })
            .collect()
    }
}

fn fixture_root() -> PathBuf {
    if let Ok(path) = env::var("RITO_RUST_FIXTURE_ROOT") {
        return PathBuf::from(path);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("packages/rito/tests/rust-fixtures")
}

fn render_command_golden_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("packages/rito/tests/golden/render-commands")
}

fn book_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("packages/rito/tests/fixtures/books")
}
