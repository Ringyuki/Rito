use std::collections::BTreeSet;

use serde_json::{Map, Value};

use super::{
    rewrite_family_list, rewrite_font_families, FontFallbackFace, FontFallbackPolicy,
    FontGenericRole,
};
use crate::{style::StyledNode, xhtml::SourceRef};

const SERIF_ZH: &str = "__RitoPinned_serif_zh";
const SERIF_JA: &str = "__RitoPinned_serif_ja";
const SERIF_UND: &str = "__RitoPinned_serif_und";
const SANS_ZH: &str = "__RitoPinned_sans_zh";
const MONO_JA: &str = "__RitoPinned_mono_ja";

fn policy(package_language: &str) -> FontFallbackPolicy<'_> {
    FontFallbackPolicy {
        faces: vec![
            face(SERIF_JA, FontGenericRole::Serif, "ja"),
            face(SERIF_UND, FontGenericRole::Serif, "und"),
            face(SERIF_ZH, FontGenericRole::Serif, "zh"),
            face(SANS_ZH, FontGenericRole::SansSerif, "zh"),
            face(MONO_JA, FontGenericRole::Monospace, "ja"),
        ],
        package_language,
        available_publication_families: BTreeSet::from(["author".to_owned(), "serif".to_owned()]),
    }
}

fn face(
    alias: &'static str,
    role: FontGenericRole,
    language: &'static str,
) -> FontFallbackFace<'static> {
    FontFallbackFace {
        alias,
        role,
        language,
    }
}

#[test]
fn preserves_author_families_and_quoted_generic_names() {
    let fallback = policy("zh");
    assert_eq!(
        rewrite_family_list(r#"Author, "serif", serif"#, "und", &fallback),
        format!(r#"Author, "serif", {SERIF_ZH}, {SERIF_UND}, {SERIF_JA}, serif"#)
    );
    assert_eq!(
        rewrite_family_list("Author, sans-serif", "zh", &fallback),
        format!("Author, {SANS_ZH}, sans-serif")
    );
}

#[test]
fn maps_supported_generics_and_leaves_unmapped_generics_alone() {
    let fallback = policy("zh");
    for generic in ["serif", "ui-serif", "fangsong"] {
        assert!(rewrite_family_list(generic, "zh", &fallback).contains(SERIF_ZH));
    }
    for generic in ["sans-serif", "system-ui", "ui-sans-serif", "ui-rounded"] {
        assert!(rewrite_family_list(generic, "zh", &fallback).contains(SANS_ZH));
    }
    for generic in ["cursive", "fantasy", "emoji", "math"] {
        assert_eq!(rewrite_family_list(generic, "zh", &fallback), generic);
    }
    assert_eq!(
        rewrite_family_list("fantasy, serif", "zh", &fallback),
        "fantasy, serif"
    );
    let monospace = rewrite_family_list("monospace", "ja", &fallback);
    assert_eq!(monospace, format!("{MONO_JA}, monospace"));
    assert!(!monospace.contains(SERIF_JA));
    assert!(!rewrite_family_list("serif", "ja", &fallback).contains(MONO_JA));
}

#[test]
fn keeps_the_family_unchanged_when_the_policy_has_no_matching_role_face() {
    let fallback = FontFallbackPolicy {
        faces: vec![face(SANS_ZH, FontGenericRole::SansSerif, "zh")],
        package_language: "zh",
        available_publication_families: BTreeSet::from(["author".to_owned()]),
    };
    assert_eq!(rewrite_family_list("Author", "und", &fallback), "Author");
}

#[test]
fn removes_host_only_names_and_preserves_shapeable_publication_families() {
    let fallback = policy("zh");

    assert_eq!(
        rewrite_family_list("HostOnly, AUTHOR, serif", "zh", &fallback),
        format!("AUTHOR, {SERIF_ZH}, {SERIF_UND}, {SERIF_JA}, serif")
    );
    assert_eq!(
        rewrite_family_list("HostOnly", "zh", &fallback),
        format!("{SERIF_ZH}, {SERIF_UND}, {SERIF_JA}, serif")
    );
}

#[test]
fn appends_serif_chain_when_no_generic_and_is_idempotent() {
    let fallback = policy("ja");
    let once = rewrite_family_list("Author", "und", &fallback);
    let twice = rewrite_family_list(&once, "und", &fallback);
    assert_eq!(
        once,
        format!("Author, {SERIF_JA}, {SERIF_UND}, {SERIF_ZH}, serif")
    );
    assert_eq!(twice, once);
}

#[test]
fn removes_host_only_names_before_an_existing_pinned_chain() {
    let fallback = policy("zh");
    let input = format!("HostOnly, {SERIF_ZH}, {SERIF_UND}, {SERIF_JA}, serif");
    let rewritten = rewrite_family_list(&input, "zh", &fallback);

    assert_eq!(
        rewritten,
        format!("{SERIF_ZH}, {SERIF_UND}, {SERIF_JA}, serif")
    );
    assert_eq!(rewrite_family_list(&rewritten, "zh", &fallback), rewritten);
}

#[test]
fn chooses_exact_parent_und_then_canonical_remaining_faces() {
    let fallback = policy("ja");
    assert_eq!(
        rewrite_family_list("serif", "zh-Hant-HK", &fallback),
        format!("{SERIF_ZH}, {SERIF_UND}, {SERIF_JA}, serif")
    );
    assert_eq!(
        rewrite_family_list("serif", "JA", &fallback),
        format!("{SERIF_JA}, {SERIF_UND}, {SERIF_ZH}, serif")
    );
}

#[test]
fn invalid_and_und_element_languages_safely_fall_back_to_package_language() {
    let fallback = policy("zh-Hant");
    for language in ["und", "zh--hant", "💥"] {
        assert!(rewrite_family_list("serif", language, &fallback).starts_with(SERIF_ZH));
    }
    let invalid_package = policy("not_a_tag");
    assert!(rewrite_family_list("serif", "und", &invalid_package).starts_with(SERIF_UND));
}

#[test]
fn recursively_rewrites_the_resolved_style_map() {
    let fallback = policy("zh");
    let mut root_style = Map::new();
    root_style.insert("fontFamily".to_owned(), Value::String("serif".to_owned()));
    root_style.insert("language".to_owned(), Value::String("und".to_owned()));
    let mut child_style = root_style.clone();
    child_style.insert(
        "fontFamily".to_owned(),
        Value::String("sans-serif".to_owned()),
    );
    let child = StyledNode::text(
        "text".to_owned(),
        None,
        child_style,
        SourceRef {
            node_path: vec![0],
            source_node_id: None,
        },
    );
    let mut root = StyledNode::text(
        "root".to_owned(),
        None,
        root_style,
        SourceRef {
            node_path: vec![1],
            source_node_id: None,
        },
    );
    root.children.push(child);
    rewrite_font_families(std::slice::from_mut(&mut root), &fallback);
    assert!(root.style["fontFamily"]
        .as_str()
        .unwrap()
        .contains(SERIF_ZH));
    assert!(root.children[0].style["fontFamily"]
        .as_str()
        .unwrap()
        .contains(SANS_ZH));
}
