use sha2::{Digest, Sha256};

use crate::{
    epub::{EpubError, EpubResult, LoadedEpubDocument},
    layout::LayoutConfig,
    resources::{
        binary_summary_from_metadata, sort_publication_resources,
        summarize_loaded_publication_resources, PublicationResources,
    },
    runtime::{pinned_font_policy::RuntimePinnedFontPolicy, RuntimeFontFaceSummary},
    xhtml::ChapterSource,
};

pub(super) fn runtime_publication_resources(document: &LoadedEpubDocument) -> PublicationResources {
    let mut resources = summarize_loaded_publication_resources(
        document
            .stylesheets
            .iter()
            .map(|resource| (resource.href.as_str(), resource.text.as_str())),
        [],
        [],
    );
    resources.fonts = document
        .fonts
        .iter()
        .map(|resource| {
            binary_summary_from_metadata(
                &resource.href,
                resource.byte_length,
                resource.byte_hash.clone(),
                None,
                None,
            )
        })
        .collect();
    resources.images = document
        .images
        .iter()
        .map(|resource| {
            binary_summary_from_metadata(
                &resource.href,
                resource.byte_length,
                resource.byte_hash.clone(),
                resource.width,
                resource.height,
            )
        })
        .collect();
    sort_publication_resources(&mut resources);
    resources
}

pub(super) fn runtime_font_faces(document: &LoadedEpubDocument) -> Vec<RuntimeFontFaceSummary> {
    let mut faces = Vec::new();
    for stylesheet in &document.stylesheets {
        for rule in crate::css::parse_font_face_rules(&stylesheet.text) {
            let Some(href) = resolve_font_face_href(&stylesheet.href, &rule.src) else {
                continue;
            };
            let Some(resource) = document
                .fonts
                .iter()
                .find(|font| font.href == href || font.href.ends_with(&format!("/{href}")))
            else {
                continue;
            };
            let face = RuntimeFontFaceSummary {
                family: rule.family,
                href: resource.href.clone(),
                style: rule.style,
                weight: rule.weight,
            };
            if let Some(index) = faces.iter().position(|existing| existing == &face) {
                faces.remove(index);
            }
            faces.push(face);
        }
    }
    faces
}

pub(super) fn chapter_sources_from_document(document: &LoadedEpubDocument) -> Vec<ChapterSource> {
    document
        .chapters
        .iter()
        .map(|chapter| ChapterSource {
            idref: chapter.idref.clone(),
            href: chapter.href.clone(),
            linear: chapter.linear,
            text_length: utf16_len(&chapter.xhtml_source),
            text_hash: short_sha256(chapter.xhtml_source.as_bytes()),
        })
        .collect()
}

pub(super) fn layout_key(
    layout_config: &LayoutConfig,
    pinned_font_policy: &RuntimePinnedFontPolicy,
) -> EpubResult<String> {
    let policy_identity = (!pinned_font_policy.is_empty()).then(|| pinned_font_policy.identity());
    layout_key_from_policy_identity(layout_config, policy_identity)
}

fn layout_key_from_policy_identity(
    layout_config: &LayoutConfig,
    policy_identity: Option<&[u8]>,
) -> EpubResult<String> {
    let Some(policy_identity) = policy_identity else {
        let mut hasher = Sha256::new();
        serde_json::to_writer(&mut hasher, layout_config).map_err(layout_serialization_error)?;
        return Ok(short_sha256_digest(&hasher.finalize()));
    };
    let json = serde_json::to_vec(layout_config).map_err(layout_serialization_error)?;
    let mut hasher = Sha256::new();
    hasher.update(b"RITO-RUNTIME-LAYOUT-IDENTITY\0");
    hasher.update((json.len() as u64).to_be_bytes());
    hasher.update(&json);
    hasher.update(policy_identity);
    Ok(short_sha256_digest(&hasher.finalize()))
}

fn layout_serialization_error(error: serde_json::Error) -> EpubError {
    EpubError::new(format!("layout config does not serialize: {error}"))
}

fn resolve_font_face_href(stylesheet_href: &str, src: &str) -> Option<String> {
    let href = src.split(['?', '#']).next()?.trim();
    let lower = href.to_ascii_lowercase();
    if href.is_empty()
        || lower.starts_with("data:")
        || lower.starts_with("http:")
        || lower.starts_with("https:")
    {
        return None;
    }
    let base = stylesheet_href
        .rfind('/')
        .map(|index| &stylesheet_href[..=index])
        .unwrap_or_default();
    Some(normalize_relative_href(&format!("{base}{href}")))
}

fn normalize_relative_href(href: &str) -> String {
    let mut parts = Vec::new();
    for part in href.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

fn short_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    short_sha256_digest(&digest)
}

fn short_sha256_digest(digest: &[u8]) -> String {
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::layout::{
        create_layout_config, LayoutConfigInput, MarginInput, PaginationPolicy, SpreadMode,
        TextMeasurementMode,
    };

    use super::*;

    #[test]
    fn streamed_layout_keys_match_the_legacy_vec_contract() {
        let mut rich = test_layout();
        rich.line_height_override = Some(1.125);
        rich.line_height_force = Some(true);
        rich.font_family_override = Some("雪 \\\"quoted\\\" \\\\ family".to_owned());
        rich.font_family_force = Some(false);
        rich.pagination_policy = Some(PaginationPolicy {
            enabled: Some(true),
            default_orphans: Some(2),
            default_widows: Some(3),
        });
        rich.text_measurement = TextMeasurementMode::FontAware;
        rich.generic_serif_advances =
            BTreeMap::from([("A".to_owned(), -0.0), ("😀".to_owned(), 1.234_567_890_123)]);
        rich.font_family_advances = BTreeMap::from([(
            "serif".to_owned(),
            BTreeMap::from([("雪".to_owned(), 0.875)]),
        )]);
        rich.generic_serif_pair_adjustments = BTreeMap::from([("：「".to_owned(), -0.5)]);
        rich.font_family_pair_adjustments = BTreeMap::from([(
            "serif".to_owned(),
            BTreeMap::from([("AV".to_owned(), -0.25)]),
        )]);

        let mut wide = test_layout();
        wide.generic_serif_advances = (0..256)
            .map(|index| (format!("glyph-{index}"), index as f64 / 7.0))
            .collect();

        for layout_config in [test_layout(), rich, wide] {
            for policy_identity in [None, Some(&b""[..]), Some(&b"pinned\0policy\xff"[..])] {
                assert_eq!(
                    layout_key_from_policy_identity(&layout_config, policy_identity)
                        .expect("streamed layout key succeeds"),
                    legacy_vec_layout_key(&layout_config, policy_identity)
                        .expect("legacy layout key succeeds")
                );
            }
        }
    }

    #[test]
    fn layout_key_byte_contract_has_fixed_goldens() {
        let layout_config = test_layout();

        assert_eq!(
            (
                layout_key_from_policy_identity(&layout_config, None)
                    .expect("empty-policy key succeeds"),
                layout_key_from_policy_identity(&layout_config, Some(b"pinned-policy-identity"),)
                    .expect("pinned-policy key succeeds"),
            ),
            ("bf4b78407bf7a2d3".to_owned(), "851328446b8fd5ef".to_owned(),)
        );
    }

    fn legacy_vec_layout_key(
        layout_config: &LayoutConfig,
        policy_identity: Option<&[u8]>,
    ) -> EpubResult<String> {
        let json = serde_json::to_vec(layout_config).map_err(layout_serialization_error)?;
        let Some(policy_identity) = policy_identity else {
            return Ok(short_sha256(&json));
        };
        let mut identity = Vec::new();
        identity.extend_from_slice(b"RITO-RUNTIME-LAYOUT-IDENTITY\0");
        identity.extend_from_slice(&(json.len() as u64).to_be_bytes());
        identity.extend_from_slice(&json);
        identity.extend_from_slice(policy_identity);
        Ok(short_sha256(&identity))
    }

    fn test_layout() -> LayoutConfig {
        create_layout_config(LayoutConfigInput {
            width: 420.0,
            height: 640.0,
            margin: MarginInput::All(24.0),
            spread: SpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: None,
        })
    }
}
