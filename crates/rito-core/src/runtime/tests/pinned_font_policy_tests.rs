use super::fixture::{fixture_epub, layout, multi_chapter_fixture_epub};
use super::pinned_font_policy_fixtures::{face, illustration_font, policy, sha256_hex, title_font};
use crate::{
    epub::open_runtime_document,
    runtime::{
        RuntimeDocument, RuntimePinnedFontGenericRole, RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION,
    },
};

#[test]
fn pinned_font_policy_summary_is_bytes_free_canonical_and_publication_neutral() {
    let title = title_font();
    let illustration = illustration_font();
    let title_hash = sha256_hex(&title);
    let illustration_hash = sha256_hex(&illustration);
    let faces = vec![
        face(
            illustration.clone(),
            RuntimePinnedFontGenericRole::SansSerif,
            Some("JA"),
        ),
        face(
            title.clone(),
            RuntimePinnedFontGenericRole::Serif,
            Some("ZH-Hant"),
        ),
    ];
    let loaded = open_runtime_document(&fixture_epub()).expect("fixture opens");
    let document = RuntimeDocument::from_loaded_document_with_pinned_font_policy(
        loaded,
        policy(faces.clone()),
    )
    .expect("policy is accepted");
    let reversed = RuntimeDocument::open_owned_with_pinned_font_policy(
        fixture_epub(),
        policy(faces.into_iter().rev().collect()),
    )
    .expect("reversed policy is accepted");
    let summary = document.pinned_font_policy_summary();

    assert_eq!(summary, reversed.pinned_font_policy_summary());
    assert_eq!(
        summary.schema_version,
        RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION
    );
    assert_eq!(summary.policy_id.len(), 64);
    assert_eq!(summary.faces.len(), 2);
    assert_eq!(
        summary.faces[0].generic_role,
        RuntimePinnedFontGenericRole::Serif
    );
    assert_eq!(summary.faces[0].language, "zh-hant");
    assert_eq!(summary.faces[0].sha256, title_hash);
    assert_eq!(summary.faces[0].shape_fingerprint, title_hash[..16]);
    assert_eq!(
        summary.faces[0].family_alias,
        format!("__RitoPinned_{title_hash}")
    );
    assert_eq!(summary.faces[0].byte_length, title.len());
    assert_eq!(summary.faces[0].style, "normal");
    assert_eq!(summary.faces[0].weight, 400);
    assert_eq!(summary.faces[1].sha256, illustration_hash);
    assert_eq!(summary.faces[1].byte_length, illustration.len());

    let baseline = RuntimeDocument::open(&fixture_epub())
        .expect("baseline opens")
        .publication_info();
    assert_eq!(document.publication_info(), baseline);
    let json = serde_json::to_value(summary).expect("summary serializes");
    assert!(json.get("faces").is_some());
    assert!(json.to_string().find("bytes").is_none());
}

#[test]
fn pinned_policy_changes_layout_identity_and_is_stable_across_runtime_paths() {
    let bytes = multi_chapter_fixture_epub();
    let title_policy = policy(vec![face(
        title_font(),
        RuntimePinnedFontGenericRole::Serif,
        Some("zh"),
    )]);
    let illustration_policy = policy(vec![face(
        illustration_font(),
        RuntimePinnedFontGenericRole::Serif,
        Some("zh"),
    )]);
    let mut title_document =
        RuntimeDocument::open_with_pinned_font_policy(&bytes, title_policy.clone())
            .expect("title policy opens");
    let mut illustration_document =
        RuntimeDocument::open_with_pinned_font_policy(&bytes, illustration_policy)
            .expect("illustration policy opens");
    let title_revision = title_document
        .create_revision(&layout())
        .expect("title revision completes");
    let illustration_revision = illustration_document
        .create_revision(&layout())
        .expect("illustration revision completes");
    assert_ne!(title_revision.layout_key, illustration_revision.layout_key);

    let mut document = RuntimeDocument::open_with_pinned_font_policy(&bytes, title_policy)
        .expect("document opens");
    let summary = document
        .create_revision(&layout())
        .expect("revision is created");
    assert_eq!(summary.layout_key, title_revision.layout_key);
    assert_eq!(
        document
            .get_revision_summary(&summary.revision_id)
            .expect("revision summary")
            .layout_key,
        title_revision.layout_key
    );
}

#[test]
fn releasing_revisions_does_not_release_document_pinned_font_policy() {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &fixture_epub(),
        policy(vec![face(
            title_font(),
            RuntimePinnedFontGenericRole::Serif,
            None,
        )]),
    )
    .expect("document opens");
    let policy_before = document.pinned_font_policy_summary();
    let first = document
        .create_revision(&layout())
        .expect("first revision completes");
    assert!(document.release_revision(&first.revision_id));
    assert_eq!(document.pinned_font_policy_summary(), policy_before);
    let second = document
        .create_revision(&layout())
        .expect("second revision completes");
    assert_eq!(first.layout_key, second.layout_key);
}
