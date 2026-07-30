use std::collections::BTreeSet;

use crate::{
    layout::{parse_font_family_list, LayoutConfig},
    render::encode_reader_display_list_v1,
    runtime::{
        page_artifact::{
            PageArtifact, PageArtifactRect, PageArtifactSemanticNode, PageArtifactSemanticRole,
        },
        RuntimeChapterLocalRevisionHandle, RuntimeDocument, RuntimeRevision, RuntimeRevisionHandle,
        RuntimeSourceLocator, RuntimeSourceLocatorMatchedBy, RuntimeSourcePoint,
    },
};

use super::{
    convert::{reader_locator, u32_from_usize, u64_from_usize},
    ReaderArtifactV1, ReaderDisplayListV1, ReaderErrorKindV1, ReaderErrorV1, ReaderFontRefV1,
    ReaderHitEntryV1, ReaderNavigationV1, ReaderPageV1, ReaderRectV1, ReaderResourceKindV1,
    ReaderResourceRefV1, ReaderSemanticNodeV1, ReaderSemanticRoleV1, ReaderSourcePointV1,
    ReaderTextRenderingProfileV1, ReaderTextRunOffsetV1, READER_CAPABILITY_PROFILE_STRING_TEXT_V1,
    READER_PROTOCOL_VERSION_V1,
};

#[derive(Debug, Clone)]
pub(super) enum ResolvedArtifactOwnerV1 {
    ChapterLocal(RuntimeChapterLocalRevisionHandle),
    Publication(RuntimeRevisionHandle),
}

impl ResolvedArtifactOwnerV1 {
    pub(super) const fn revision_version(&self) -> u32 {
        match self {
            Self::ChapterLocal(owner) => owner.revision_version,
            Self::Publication(owner) => owner.revision_version,
        }
    }
}

pub(super) struct ResolvedArtifactTarget {
    pub(super) owner: ResolvedArtifactOwnerV1,
    pub(super) locator: RuntimeSourceLocator,
    pub(super) matched_by: RuntimeSourceLocatorMatchedBy,
    pub(super) local_page_index: usize,
    pub(super) local_spread_index: usize,
}

pub(super) struct ArtifactIdentityV1 {
    pub(super) session_id: u64,
    pub(super) request_id: u64,
    pub(super) revision_id: u64,
    pub(super) artifact_id: u64,
}

pub(super) fn build_reader_artifact_v1(
    document: &RuntimeDocument,
    identity: ArtifactIdentityV1,
    target: &ResolvedArtifactTarget,
    navigation: ReaderNavigationV1,
) -> Result<ReaderArtifactV1, ReaderErrorV1> {
    let revision = match &target.owner {
        ResolvedArtifactOwnerV1::ChapterLocal(owner) => document
            .require_chapter_local_owner(owner)
            .map_err(engine_error)?,
        ResolvedArtifactOwnerV1::Publication(owner) => {
            document
                .validate_revision_handle(owner)
                .map_err(engine_error)?;
            document.revisions.get(&owner.revision_id).ok_or_else(|| {
                ReaderErrorV1::new(
                    ReaderErrorKindV1::EngineFailure,
                    "publication revision ownership is missing",
                )
            })?
        }
    };
    build_reader_artifact_from_revision(document, revision, identity, target, navigation)
}

fn build_reader_artifact_from_revision(
    document: &RuntimeDocument,
    revision: &RuntimeRevision,
    identity: ArtifactIdentityV1,
    target: &ResolvedArtifactTarget,
    navigation: ReaderNavigationV1,
) -> Result<ReaderArtifactV1, ReaderErrorV1> {
    let engine = revision.chapter_engine_session();
    let frame = engine.frame(target.local_spread_index).ok_or_else(|| {
        ReaderErrorV1::new(
            ReaderErrorKindV1::TargetNotPublished,
            "resolved target frame is not published",
        )
    })?;
    let encoded: crate::render::ReaderEncodedDisplayListV1 =
        encode_reader_display_list_v1(&frame.commands).map_err(engine_error)?;
    // Page geometry from the engine is content-box relative and
    // page-local. The display list this artifact carries is not: it
    // translates the right-hand page of a spread and paints content at
    // the margin origin. Hosts hit-test against what they painted, so
    // every rect this artifact publishes is lifted into that same
    // display-list space here — see `page_origin`.
    let config = &revision.layout_config;
    let pages = frame
        .page_indexes
        .iter()
        .enumerate()
        .map(|(slot, page_index)| {
            let page = engine.page(*page_index).ok_or_else(|| {
                ReaderErrorV1::new(
                    ReaderErrorKindV1::TargetNotPublished,
                    format!("published frame references unknown page {page_index}"),
                )
            })?;
            reader_page(
                document,
                revision,
                *page_index,
                page,
                page_origin(config, slot),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let font_families = used_font_families(&encoded.font_families);
    let fonts = revision
        .required_font_face_catalog
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(|font| font_families.contains(&font.family.trim().to_ascii_lowercase()))
        .map(reader_font_ref)
        .collect::<Result<Vec<_>, _>>()?;
    let mut resources = encoded
        .image_hrefs
        .into_iter()
        .map(|href| ReaderResourceRefV1 {
            kind: ReaderResourceKindV1::Image,
            href,
        })
        .collect::<Vec<_>>();
    resources.extend(fonts.iter().map(|font| ReaderResourceRefV1 {
        kind: ReaderResourceKindV1::Font,
        href: font.href.clone(),
    }));

    Ok(ReaderArtifactV1 {
        protocol_version: READER_PROTOCOL_VERSION_V1,
        capability_profile_id: READER_CAPABILITY_PROFILE_STRING_TEXT_V1,
        session_id: identity.session_id,
        request_id: identity.request_id,
        revision_id: identity.revision_id,
        revision_version: target.owner.revision_version(),
        artifact_id: identity.artifact_id,
        locator: reader_locator(target.locator.clone())?,
        matched_by: super::convert::locator_match(target.matched_by),
        local_page_index: u32_from_usize(target.local_page_index, "local page index")?,
        local_spread_index: u32_from_usize(target.local_spread_index, "local spread index")?,
        local_page_indexes: frame
            .page_indexes
            .into_iter()
            .map(|index| u32_from_usize(index, "frame page index"))
            .collect::<Result<Vec<_>, _>>()?,
        width: revision.layout_config.viewport_width,
        height: revision.layout_config.viewport_height,
        terminal_extent: revision.final_extent.is_some(),
        // Whole-book numbering exists only in absolute coordinate space.
        // A chapter-local revision's page index is a window ordinal that
        // restarts at every rollover, so it must never be published as a
        // book page number.
        book_page_index: revision
            .is_absolute_coordinate_space()
            .then(|| u32_from_usize(target.local_page_index, "book page index"))
            .transpose()?,
        book_page_count: revision
            .is_absolute_coordinate_space()
            .then_some(revision.final_extent)
            .flatten()
            .map(|extent| u32_from_usize(extent.page_count, "book page count"))
            .transpose()?,
        navigation,
        text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
        display_list: ReaderDisplayListV1 {
            format_version: encoded.format_version,
            command_count: encoded.command_count,
            semantic_digest: encoded.semantic_digest,
            bytes: encoded.bytes,
        },
        resources,
        fonts,
        pages,
    })
}

/// Projects an already-published spread into an artifact target without
/// invoking layout or source-locator resolution.
pub(super) fn published_spread_target(
    document: &RuntimeDocument,
    owner: &RuntimeChapterLocalRevisionHandle,
    local_spread_index: usize,
) -> Result<ResolvedArtifactTarget, ReaderErrorV1> {
    let revision = document
        .require_chapter_local_owner(owner)
        .map_err(engine_error)?;
    let engine = revision.chapter_engine_session();
    let frame = engine.frame(local_spread_index).ok_or_else(|| {
        ReaderErrorV1::new(
            ReaderErrorKindV1::TargetNotPublished,
            format!("adjacent spread {local_spread_index} is not published"),
        )
    })?;
    let local_page_index = frame.page_indexes.first().copied().ok_or_else(|| {
        ReaderErrorV1::new(
            ReaderErrorKindV1::TargetNotPublished,
            "published adjacent spread contains no pages",
        )
    })?;
    let source_point = local_page_index
        .checked_add(1)
        .and_then(|end| engine.source_run_starts(local_page_index..end))
        .and_then(|starts| starts.into_iter().next())
        .map(|start| RuntimeSourcePoint {
            node_path: start.node_path,
            text_offset: start.text_offset,
        })
        .or_else(|| {
            engine.page(local_page_index).and_then(|page| {
                page.targets().entries.into_iter().find_map(|entry| {
                    Some(RuntimeSourcePoint {
                        node_path: entry.source_path?,
                        text_offset: entry.source_text_offset.unwrap_or(0),
                    })
                })
            })
        });
    let fallback_progression = source_point.is_none().then(|| {
        let page_count = engine.metadata().page_count;
        if page_count <= 1 {
            0.0
        } else {
            local_page_index as f64 / (page_count - 1) as f64
        }
    });
    let matched_by = if source_point.is_some() {
        RuntimeSourceLocatorMatchedBy::SourcePoint
    } else {
        RuntimeSourceLocatorMatchedBy::Progression
    };
    Ok(ResolvedArtifactTarget {
        owner: ResolvedArtifactOwnerV1::ChapterLocal(owner.clone()),
        locator: RuntimeSourceLocator {
            href: owner.coordinate.href.clone(),
            anchor_id: None,
            source_point,
            source_range: None,
            progression: fallback_progression,
        },
        matched_by,
        local_page_index,
        local_spread_index,
    })
}

/// Origin of a spread slot's content box in display-list space.
///
/// `build_display_list_commands` lays the left page at x 0 and the right
/// page at `page_width + spread_gap` (slot order matches
/// `frame.page_indexes`), then paints each page's blocks offset by the
/// page margins. Anything the artifact publishes as a rect must carry
/// the same origin or it cannot be compared with the pixels the host
/// drew.
fn page_origin(config: &LayoutConfig, slot: usize) -> (f64, f64) {
    let spread_offset_x = if slot == 0 {
        0.0
    } else {
        config.page_width + config.spread_gap
    };
    (spread_offset_x + config.margin_left, config.margin_top)
}

fn reader_page(
    document: &RuntimeDocument,
    revision: &RuntimeRevision,
    page_index: usize,
    page: &dyn PageArtifact,
    origin: (f64, f64),
) -> Result<ReaderPageV1, ReaderErrorV1> {
    let metadata = page.metadata();
    let targets = page.targets();
    // Classified through the same resolver `get_page_targets` uses, so
    // the artifact's hits and the runtime's page targets never disagree
    // about which hrefs are footnotes or under which key they are held.
    let footnotes = document.footnote_hit_resolver(revision, page_index);
    let text = page.text_positions();
    Ok(ReaderPageV1 {
        page_index: u32_from_usize(page_index, "page index")?,
        width: metadata.width,
        height: metadata.height,
        hits: targets
            .entries
            .into_iter()
            .map(|target| {
                let source_point = match (target.source_path, target.source_text_offset) {
                    (Some(node_path), Some(text_offset)) => Some(ReaderSourcePointV1 {
                        node_path: node_path
                            .into_iter()
                            .map(|part| u32_from_usize(part, "hit source path"))
                            .collect::<Result<Vec<_>, _>>()?,
                        text_offset: u64_from_usize(text_offset, "hit source offset")?,
                    }),
                    _ => None,
                };
                let footnote = target
                    .href
                    .as_deref()
                    .and_then(|href| footnotes.resolve(href));
                Ok(ReaderHitEntryV1 {
                    page_index: u32_from_usize(page_index, "hit page index")?,
                    bounds: reader_rect_at(target.bounds, origin),
                    text: target.text,
                    href: target.href,
                    source_point,
                    image_src: target.image_src,
                    image_alt: target.image_alt,
                    footnote_key: footnote.as_ref().map(|(key, _)| key.clone()),
                    footnote_pending: footnote.is_some_and(|(_, pending)| pending),
                })
            })
            .collect::<Result<Vec<_>, ReaderErrorV1>>()?,
        semantics: page
            .semantic_nodes()
            .into_iter()
            .map(|node| reader_semantic_node(node, origin))
            .collect(),
        text: text.text,
        text_length: u64_from_usize(text.text_length, "page text length")?,
        text_runs: text
            .offsets
            .into_iter()
            .map(|offset| {
                Ok(ReaderTextRunOffsetV1 {
                    start: u64_from_usize(offset.start, "text run start")?,
                    end: u64_from_usize(offset.end, "text run end")?,
                    block_index: u32_from_usize(offset.block_index, "text block index")?,
                    line_index: u32_from_usize(offset.line_index, "text line index")?,
                    run_index: u32_from_usize(offset.run_index, "text run index")?,
                })
            })
            .collect::<Result<Vec<_>, ReaderErrorV1>>()?,
    })
}

fn reader_font_ref(
    font: &crate::runtime::RuntimeRequiredFontFace,
) -> Result<ReaderFontRefV1, ReaderErrorV1> {
    Ok(ReaderFontRefV1 {
        family: font.family.clone(),
        href: font.href.clone(),
        style: font.style.clone(),
        weight: font.weight,
        shape_fingerprint: font.shape_fingerprint.clone(),
        byte_length: u64_from_usize(font.byte_length, "font byte length")?,
    })
}

fn reader_semantic_node(
    value: PageArtifactSemanticNode,
    origin: (f64, f64),
) -> ReaderSemanticNodeV1 {
    ReaderSemanticNodeV1 {
        role: match value.role {
            PageArtifactSemanticRole::Heading => ReaderSemanticRoleV1::Heading,
            PageArtifactSemanticRole::Paragraph => ReaderSemanticRoleV1::Paragraph,
            PageArtifactSemanticRole::List => ReaderSemanticRoleV1::List,
            PageArtifactSemanticRole::ListItem => ReaderSemanticRoleV1::ListItem,
            PageArtifactSemanticRole::Image => ReaderSemanticRoleV1::Image,
            PageArtifactSemanticRole::Link => ReaderSemanticRoleV1::Link,
            PageArtifactSemanticRole::Blockquote => ReaderSemanticRoleV1::Blockquote,
            PageArtifactSemanticRole::Table => ReaderSemanticRoleV1::Table,
            PageArtifactSemanticRole::Generic => ReaderSemanticRoleV1::Generic,
        },
        level: value.level,
        text: value.text,
        alt: value.alt,
        href: value.href,
        bounds: reader_rect_at(value.bounds, origin),
        children: value
            .children
            .into_iter()
            .map(|child| reader_semantic_node(child, origin))
            .collect(),
    }
}

/// Lifts an engine rect (content-box relative, page-local) into the
/// artifact's display-list space.
fn reader_rect_at(value: PageArtifactRect, origin: (f64, f64)) -> ReaderRectV1 {
    ReaderRectV1 {
        x: value.x + origin.0,
        y: value.y + origin.1,
        width: value.width,
        height: value.height,
    }
}

fn engine_error(error: impl std::fmt::Display) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::EngineFailure, error.to_string())
}

fn used_font_families(values: &[String]) -> BTreeSet<String> {
    values
        .iter()
        .flat_map(|family| parse_font_family_list(family))
        .map(|family| family.trim().to_ascii_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::used_font_families;

    #[test]
    fn used_fonts_expand_css_family_lists_case_insensitively() {
        let used = used_font_families(&[
            "\"Author Serif\", serif".to_owned(),
            "Fallback Sans, sans-serif".to_owned(),
        ]);

        assert!(used.contains("author serif"));
        assert!(used.contains("serif"));
        assert!(used.contains("fallback sans"));
        assert!(used.contains("sans-serif"));
    }
}
