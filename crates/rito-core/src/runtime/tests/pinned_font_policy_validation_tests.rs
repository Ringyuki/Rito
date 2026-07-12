use super::fixture::fixture_epub;
use super::pinned_font_policy_fixtures::{face, illustration_font, policy, title_font};
use crate::runtime::{
    RuntimeDocument, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
};

#[test]
fn pinned_font_policy_rejects_empty_hash_mismatch_and_invalid_font() {
    let epub = fixture_epub();
    let empty = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        RuntimePinnedFontPolicyInput { faces: Vec::new() },
    )
    .expect_err("empty policy is rejected");
    assert!(empty.message().contains("at least one face"));

    let empty_bytes = policy(vec![face(
        Vec::new(),
        RuntimePinnedFontGenericRole::Serif,
        None,
    )]);
    let error = RuntimeDocument::open_with_pinned_font_policy(&epub, empty_bytes)
        .expect_err("empty face bytes are rejected");
    assert!(error.message().contains("must not be empty"));

    let bytes = title_font();
    let malformed_hash = RuntimePinnedFontPolicyInput {
        faces: vec![RuntimePinnedFontFaceInput {
            bytes: bytes.clone(),
            expected_sha256: "abcd".to_owned(),
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: None,
        }],
    };
    let error = RuntimeDocument::open_with_pinned_font_policy(&epub, malformed_hash)
        .expect_err("short hash is rejected");
    assert!(error.message().contains("64 hexadecimal digits"));

    let mismatched = RuntimePinnedFontPolicyInput {
        faces: vec![RuntimePinnedFontFaceInput {
            bytes,
            expected_sha256: "0".repeat(64),
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: None,
        }],
    };
    let error = RuntimeDocument::open_with_pinned_font_policy(&epub, mismatched)
        .expect_err("mismatched hash is rejected");
    assert!(error.message().contains("SHA-256 mismatch"));

    let invalid_bytes = b"not-a-font".to_vec();
    let error = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        policy(vec![face(
            invalid_bytes,
            RuntimePinnedFontGenericRole::Serif,
            None,
        )]),
    )
    .expect_err("invalid font is rejected");
    assert!(error.message().contains("parseable TTF/OTF face 0"));

    let error = RuntimePinnedFontLanguageTag::parse("zh--hant")
        .expect_err("invalid language is rejected before policy construction");
    assert!(error.message().contains("BCP47-style tag"));
    let normalized =
        RuntimePinnedFontLanguageTag::parse("ZH-Hant").expect("uppercase language is accepted");
    assert_eq!(normalized.as_str(), "zh-hant");
}

#[test]
fn pinned_font_policy_rejects_duplicate_selector_and_hash() {
    let epub = fixture_epub();
    let selector_duplicate = policy(vec![
        face(
            title_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("ZH"),
        ),
        face(
            illustration_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("zh"),
        ),
    ]);
    let error = RuntimeDocument::open_with_pinned_font_policy(&epub, selector_duplicate)
        .expect_err("duplicate selector is rejected");
    assert!(error.message().contains("generic role and language"));

    let bytes = title_font();
    let hash_duplicate = policy(vec![
        face(
            bytes.clone(),
            RuntimePinnedFontGenericRole::Serif,
            Some("zh"),
        ),
        face(bytes, RuntimePinnedFontGenericRole::SansSerif, Some("ja")),
    ]);
    let error = RuntimeDocument::open_with_pinned_font_policy(&epub, hash_duplicate)
        .expect_err("duplicate hash is rejected");
    assert!(error.message().contains("duplicate face SHA-256"));

    let und_duplicate = policy(vec![
        face(title_font(), RuntimePinnedFontGenericRole::Serif, None),
        face(
            illustration_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("UND"),
        ),
    ]);
    assert!(RuntimeDocument::open_with_pinned_font_policy(&epub, und_duplicate).is_err());
}
