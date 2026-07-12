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
    let json = serde_json::to_vec(layout_config)
        .map_err(|error| EpubError::new(format!("layout config does not serialize: {error}")))?;
    if pinned_font_policy.is_empty() {
        return Ok(short_sha256(&json));
    }
    let mut identity = Vec::with_capacity(json.len() + pinned_font_policy.identity().len() + 32);
    identity.extend_from_slice(b"RITO-RUNTIME-LAYOUT-IDENTITY\0");
    identity.extend_from_slice(&(json.len() as u64).to_be_bytes());
    identity.extend_from_slice(&json);
    identity.extend_from_slice(pinned_font_policy.identity());
    Ok(short_sha256(&identity))
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
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}
