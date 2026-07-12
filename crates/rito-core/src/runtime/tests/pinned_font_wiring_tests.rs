use serde_json::Value;

use super::{
    fixture::fixture_epub,
    pinned_font_policy_fixtures::{
        content_epub, face, font_aware_layout, illustration_font, policy, sha256_hex,
        shared_supported_character, title_font, unique_supported_character, xml_text,
    },
};
use crate::{
    layout::LineBreaking,
    runtime::{
        frame::chapter_window_layout_config, RuntimeBoundedRevisionRequest,
        RuntimeContinueRevisionRequest, RuntimeDocument, RuntimePinnedFontGenericRole,
        RuntimeRevisionAdvance, RuntimeRevisionHandle, RuntimeRevisionWorkBudget,
    },
};

mod face_order;

#[test]
fn fixture_compatible_policy_is_identity_only_and_keeps_rendering_unchanged() {
    let bytes = fixture_epub();
    let mut baseline = RuntimeDocument::open(&bytes).expect("baseline opens");
    let mut pinned = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            title_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("pinned document opens");
    let baseline_revision = baseline.create_revision(&super::fixture::layout()).unwrap();
    let pinned_revision = pinned.create_revision(&super::fixture::layout()).unwrap();

    assert_ne!(baseline_revision.layout_key, pinned_revision.layout_key);
    assert_eq!(baseline_revision.page_count, pinned_revision.page_count);
    assert_eq!(baseline_revision.spread_count, pinned_revision.spread_count);
    for spread in 0..baseline_revision.spread_count {
        assert_eq!(
            baseline
                .get_frame(&baseline_revision.revision_id, spread)
                .unwrap(),
            pinned
                .get_frame(&pinned_revision.revision_id, spread)
                .unwrap()
        );
    }
}

#[test]
fn resolved_family_chain_drives_author_text_list_marker_and_ruby_paint() {
    let ja_font = title_font();
    let zh_font = illustration_font();
    let character = shared_supported_character(&ja_font, &zh_font);
    let body = format!(
        r#"<ol lang="ja" style="font-family: Author, serif"><li><ruby>{0}<rt>{0}</rt></ruby></li></ol>"#,
        xml_text(character)
    );
    let bytes = content_epub("zh-Hant", &body, "", None);
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![
            face(zh_font, RuntimePinnedFontGenericRole::Serif, Some("zh")),
            face(ja_font, RuntimePinnedFontGenericRole::Serif, Some("ja")),
        ]),
    )
    .expect("document opens");
    let summary = document.pinned_font_policy_summary();
    let ja_alias = alias(&summary, "ja");
    let zh_alias = alias(&summary, "zh");
    let expected_family = format!("{ja_alias}, {zh_alias}, serif");
    let revision = document
        .create_revision_with_line_breaking(&font_aware_layout(), LineBreaking::Optimal)
        .unwrap();
    let frame = document.get_frame(&revision.revision_id, 0).unwrap();
    let text_commands = frame
        .commands
        .iter()
        .filter(|command| command["kind"] == "paintText")
        .collect::<Vec<_>>();
    let ruby_commands = frame
        .commands
        .iter()
        .filter(|command| command["kind"] == "paintRuby")
        .collect::<Vec<_>>();

    assert!(!text_commands.is_empty());
    assert!(!ruby_commands.is_empty());
    assert!(text_commands.iter().any(|command| command["text"]
        .as_str()
        .is_some_and(|text| text.contains('1'))));
    for command in text_commands.into_iter().chain(ruby_commands) {
        assert_eq!(paint_family(command), Some(expected_family.as_str()));
    }
    let diagnostic = document
        .shape_provenance_diagnostic_at(&RuntimeRevisionHandle::from(&revision))
        .unwrap()
        .value;
    assert!(diagnostic.exact_text_runs > 0);
    assert!(diagnostic.excluded_ruby_text_run_count > 0);
}

#[test]
fn missing_glyph_uses_the_next_locale_face_in_the_full_alias_chain() {
    let primary = title_font();
    let fallback = illustration_font();
    let character = unique_supported_character(&primary, &fallback);
    let body = format!(
        r#"<p lang="ja" style="font-family: serif">{}</p>"#,
        xml_text(character)
    );
    let bytes = content_epub("zh", &body, "", None);
    let fallback_fingerprint = sha256_hex(&fallback)[..16].to_owned();
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![
            face(primary, RuntimePinnedFontGenericRole::Serif, Some("ja")),
            face(fallback, RuntimePinnedFontGenericRole::Serif, Some("zh")),
        ]),
    )
    .unwrap();
    let revision = document.create_revision(&font_aware_layout()).unwrap();
    let diagnostic = document
        .shape_provenance_diagnostic_at(&RuntimeRevisionHandle::from(&revision))
        .unwrap()
        .value;

    assert_eq!(diagnostic.total_text_runs, 1);
    assert_eq!(diagnostic.exact_text_runs, 1);
    assert_eq!(
        diagnostic
            .single_font_fingerprints
            .get(&fallback_fingerprint),
        Some(&1)
    );
}

#[test]
fn eager_window_bounded_and_cached_revisions_share_pinned_layout_results() {
    let pinned_font = title_font();
    let author_font = illustration_font();
    let author_character = unique_supported_character(&pinned_font, &author_font);
    let pinned_character = unique_supported_character(&author_font, &pinned_font);
    let pair = format!(
        "{}{}",
        xml_text(author_character),
        xml_text(pinned_character)
    );
    let text = pair.repeat(12);
    let body = format!(
        r#"<p style="font-family: HostOnly, Author, serif">{text}</p><p style="font-family: HostOnly, Author, serif">{text}</p>"#
    );
    let stylesheet = r#"@font-face { font-family: "Author"; src: url("book.ttf"); font-style: normal; font-weight: 400; }"#;
    let bytes = content_epub("en", &body, stylesheet, Some(&author_font));
    let input = policy(vec![face(
        pinned_font.clone(),
        RuntimePinnedFontGenericRole::Serif,
        Some("en"),
    )]);
    let base_config = font_aware_layout();
    let effective_config = chapter_window_layout_config(&base_config);
    let mut eager = RuntimeDocument::open_with_pinned_font_policy(&bytes, input.clone()).unwrap();
    let first = eager.create_revision(&effective_config).unwrap();
    let second = eager.create_revision(&effective_config).unwrap();
    assert_revision_layouts_equal(&eager, &first.revision_id, &eager, &second.revision_id);
    let pinned_alias = alias(&eager.pinned_font_policy_summary(), "en").to_owned();
    let expected_family = format!("Author, {pinned_alias}, serif");
    let frame = eager.get_frame(&first.revision_id, 0).unwrap();
    for command in frame
        .commands
        .iter()
        .filter(|command| command["kind"] == "paintText")
    {
        assert_eq!(paint_family(command), Some(expected_family.as_str()));
    }
    let diagnostic = eager
        .shape_provenance_diagnostic_at(&RuntimeRevisionHandle::from(&first))
        .unwrap()
        .value;
    assert!(diagnostic.mixed_font_text_runs > 0);
    for fingerprint in [sha256_hex(&author_font), sha256_hex(&pinned_font)] {
        assert!(diagnostic
            .mixed_font_fingerprints
            .contains_key(&fingerprint[..16]));
    }

    let mut window = RuntimeDocument::open_with_pinned_font_policy(&bytes, input.clone()).unwrap();
    let window_revision = window
        .create_revision_window_with_line_breaking(&base_config, LineBreaking::Greedy, 0, 1)
        .unwrap();
    assert_revision_layouts_equal(
        &eager,
        &first.revision_id,
        &window,
        &window_revision.revision_id,
    );

    let mut bounded = RuntimeDocument::open_with_pinned_font_policy(&bytes, input).unwrap();
    let initial = bounded
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: effective_config,
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .unwrap();
    let completed = complete_revision(&mut bounded, initial);
    assert_revision_layouts_equal(
        &eager,
        &first.revision_id,
        &bounded,
        &completed.revision.revision_id,
    );
}

fn alias<'a>(
    summary: &'a crate::runtime::RuntimePinnedFontPolicySummary,
    language: &str,
) -> &'a str {
    &summary
        .faces
        .iter()
        .find(|face| face.language == language)
        .expect("language face exists")
        .family_alias
}

fn paint_family(command: &Value) -> Option<&str> {
    command["paint"]["font"]["family"].as_str()
}

fn complete_revision(
    document: &mut RuntimeDocument,
    mut advance: RuntimeRevisionAdvance,
) -> RuntimeRevisionAdvance {
    while let Some(cursor) = advance.continuation.clone() {
        advance = document
            .continue_revision(RuntimeContinueRevisionRequest {
                revision_id: cursor.revision_id,
                revision_version: cursor.revision_version,
                cursor: cursor.cursor,
                budget: RuntimeRevisionWorkBudget {
                    max_top_level_nodes: 1,
                },
            })
            .unwrap();
    }
    advance
}

fn assert_revision_layouts_equal(
    left: &RuntimeDocument,
    left_id: &str,
    right: &RuntimeDocument,
    right_id: &str,
) {
    assert_eq!(
        left.revisions[left_id].layout.pages,
        right.revisions[right_id].layout.pages
    );
}
