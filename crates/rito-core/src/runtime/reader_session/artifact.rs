use std::collections::BTreeSet;

use crate::{
    epub::parse_font_family_list,
    layout::LayoutConfig,
    render::{encode_reader_primitive_list, lower},
    runtime::{
        page_artifact::{
            PageArtifact, PageArtifactFrame, PageArtifactRect, PageArtifactSemanticNode,
            PageArtifactSemanticRole,
        },
        RuntimeChapterLocalRevisionHandle, RuntimeDocument, RuntimeRevision, RuntimeRevisionHandle,
        RuntimeSourceLocator, RuntimeSourceLocatorMatchedBy, RuntimeSourcePoint,
    },
};

use super::{
    convert::{reader_locator, u32_from_usize, u64_from_usize},
    ReaderArtifact, ReaderDisplayList, ReaderError, ReaderErrorKind, ReaderFontRef, ReaderHitEntry,
    ReaderNavigation, ReaderPage, ReaderRect, ReaderResourceKind, ReaderResourceRef,
    ReaderSemanticNode, ReaderSemanticRole, ReaderSourcePoint, ReaderTextRenderingProfile,
    ReaderTextRunOffset, READER_CAPABILITY_PROFILE_STRING_TEXT, READER_PROTOCOL_VERSION,
};

#[derive(Debug, Clone)]
pub(super) enum ResolvedArtifactOwner {
    ChapterLocal(RuntimeChapterLocalRevisionHandle),
    Publication(RuntimeRevisionHandle),
}

impl ResolvedArtifactOwner {
    pub(super) const fn revision_version(&self) -> u32 {
        match self {
            Self::ChapterLocal(owner) => owner.revision_version,
            Self::Publication(owner) => owner.revision_version,
        }
    }
}

pub(super) struct ResolvedArtifactTarget {
    pub(super) owner: ResolvedArtifactOwner,
    pub(super) locator: RuntimeSourceLocator,
    pub(super) matched_by: RuntimeSourceLocatorMatchedBy,
    pub(super) local_page_index: usize,
    pub(super) local_spread_index: usize,
}

pub(super) struct ArtifactIdentity {
    pub(super) session_id: u64,
    pub(super) request_id: u64,
    pub(super) revision_id: u64,
    pub(super) artifact_id: u64,
}

pub(super) fn build_reader_artifact(
    document: &mut RuntimeDocument,
    identity: ArtifactIdentity,
    target: &ResolvedArtifactTarget,
    navigation: ReaderNavigation,
    render_ratio: f64,
) -> Result<ReaderArtifact, ReaderError> {
    // The frame first: its display commands name the images the lowering
    // sizes background images by, and their dimensions load on the
    // document before the revision is borrowed again to build the rest.
    let frame = {
        let revision = resolve_artifact_revision(document, &target.owner)?;
        published_frame(revision, target.local_spread_index, render_ratio)?
    };
    document
        .ensure_frame_image_sizes(&frame.commands)
        .map_err(engine_error)?;
    let revision = resolve_artifact_revision(document, &target.owner)?;
    build_reader_artifact_from_revision(
        document,
        revision,
        frame,
        identity,
        target,
        navigation,
        render_ratio,
    )
}

fn resolve_artifact_revision<'a>(
    document: &'a RuntimeDocument,
    owner: &ResolvedArtifactOwner,
) -> Result<&'a RuntimeRevision, ReaderError> {
    match owner {
        ResolvedArtifactOwner::ChapterLocal(owner) => document
            .require_chapter_local_owner(owner)
            .map_err(engine_error),
        ResolvedArtifactOwner::Publication(owner) => {
            document
                .validate_revision_handle(owner)
                .map_err(engine_error)?;
            document.revisions.get(&owner.revision_id).ok_or_else(|| {
                ReaderError::new(
                    ReaderErrorKind::EngineFailure,
                    "publication revision ownership is missing",
                )
            })
        }
    }
}

fn published_frame(
    revision: &RuntimeRevision,
    local_spread_index: usize,
    render_ratio: f64,
) -> Result<PageArtifactFrame, ReaderError> {
    revision
        .chapter_engine_session()
        .frame(local_spread_index, render_ratio)
        .map_err(engine_error)?
        .ok_or_else(|| {
            ReaderError::new(
                ReaderErrorKind::TargetNotPublished,
                "resolved target frame is not published",
            )
        })
}

fn build_reader_artifact_from_revision(
    document: &RuntimeDocument,
    revision: &RuntimeRevision,
    frame: PageArtifactFrame,
    identity: ArtifactIdentity,
    target: &ResolvedArtifactTarget,
    navigation: ReaderNavigation,
    render_ratio: f64,
) -> Result<ReaderArtifact, ReaderError> {
    let engine = revision.chapter_engine_session();
    // The display list the artifact carries is the frame lowered to the
    // host's device grid: every raster decision resolved here, the host
    // only blits.
    let lowered = lower(&frame.commands, render_ratio, &|href| {
        document.image_size(href)
    })
    .map_err(engine_error)?;
    let encoded = encode_reader_primitive_list(&lowered).map_err(engine_error)?;
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
                ReaderError::new(
                    ReaderErrorKind::TargetNotPublished,
                    format!("published frame references unknown page {page_index}"),
                )
            })?;
            reader_page(
                document,
                revision,
                *page_index,
                page.as_ref(),
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
        .map(|href| ReaderResourceRef {
            kind: ReaderResourceKind::Image,
            href,
        })
        .collect::<Vec<_>>();
    resources.extend(fonts.iter().map(|font| ReaderResourceRef {
        kind: ReaderResourceKind::Font,
        href: font.href.clone(),
    }));

    Ok(ReaderArtifact {
        protocol_version: READER_PROTOCOL_VERSION,
        capability_profile_id: READER_CAPABILITY_PROFILE_STRING_TEXT,
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
            .then(|| u32_from_usize(revision.extent.page_count, "book page count"))
            .transpose()?,
        navigation,
        text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
        display_list: ReaderDisplayList {
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
) -> Result<ResolvedArtifactTarget, ReaderError> {
    let revision = document
        .require_chapter_local_owner(owner)
        .map_err(engine_error)?;
    let engine = revision.chapter_engine_session();
    let page_indexes = engine.spread_pages(local_spread_index).ok_or_else(|| {
        ReaderError::new(
            ReaderErrorKind::TargetNotPublished,
            format!("adjacent spread {local_spread_index} is not published"),
        )
    })?;
    let local_page_index = page_indexes.first().copied().ok_or_else(|| {
        ReaderError::new(
            ReaderErrorKind::TargetNotPublished,
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
        owner: ResolvedArtifactOwner::ChapterLocal(owner.clone()),
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
pub(super) fn page_origin(config: &LayoutConfig, slot: usize) -> (f64, f64) {
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
) -> Result<ReaderPage, ReaderError> {
    let metadata = page.metadata();
    let targets = page.targets();
    // Classified through the same resolver `get_page_targets` uses, so
    // the artifact's hits and the runtime's page targets never disagree
    // about which hrefs are footnotes or under which key they are held.
    let footnotes = document.footnote_hit_resolver(revision, page_index);
    let text = page.text_positions();
    Ok(ReaderPage {
        page_index: u32_from_usize(page_index, "page index")?,
        width: metadata.width,
        height: metadata.height,
        hits: targets
            .entries
            .into_iter()
            .map(|target| {
                let source_point = match (target.source_path, target.source_text_offset) {
                    (Some(node_path), Some(text_offset)) => Some(ReaderSourcePoint {
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
                Ok(ReaderHitEntry {
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
            .collect::<Result<Vec<_>, ReaderError>>()?,
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
                Ok(ReaderTextRunOffset {
                    start: u64_from_usize(offset.start, "text run start")?,
                    end: u64_from_usize(offset.end, "text run end")?,
                    block_index: u32_from_usize(offset.block_index, "text block index")?,
                    line_index: u32_from_usize(offset.line_index, "text line index")?,
                    run_index: u32_from_usize(offset.run_index, "text run index")?,
                })
            })
            .collect::<Result<Vec<_>, ReaderError>>()?,
    })
}

fn reader_font_ref(
    font: &crate::runtime::RuntimeRequiredFontFace,
) -> Result<ReaderFontRef, ReaderError> {
    Ok(ReaderFontRef {
        family: font.family.clone(),
        href: font.href.clone(),
        style: font.style.clone(),
        weight: font.weight,
        shape_fingerprint: font.shape_fingerprint.clone(),
        byte_length: u64_from_usize(font.byte_length, "font byte length")?,
    })
}

fn reader_semantic_node(value: PageArtifactSemanticNode, origin: (f64, f64)) -> ReaderSemanticNode {
    ReaderSemanticNode {
        role: match value.role {
            PageArtifactSemanticRole::Heading => ReaderSemanticRole::Heading,
            PageArtifactSemanticRole::Paragraph => ReaderSemanticRole::Paragraph,
            PageArtifactSemanticRole::List => ReaderSemanticRole::List,
            PageArtifactSemanticRole::ListItem => ReaderSemanticRole::ListItem,
            PageArtifactSemanticRole::Image => ReaderSemanticRole::Image,
            PageArtifactSemanticRole::Link => ReaderSemanticRole::Link,
            PageArtifactSemanticRole::Blockquote => ReaderSemanticRole::Blockquote,
            PageArtifactSemanticRole::Table => ReaderSemanticRole::Table,
            PageArtifactSemanticRole::Generic => ReaderSemanticRole::Generic,
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
fn reader_rect_at(value: PageArtifactRect, origin: (f64, f64)) -> ReaderRect {
    ReaderRect {
        x: value.x + origin.0,
        y: value.y + origin.1,
        width: value.width,
        height: value.height,
    }
}

fn engine_error(error: impl std::fmt::Display) -> ReaderError {
    ReaderError::new(ReaderErrorKind::EngineFailure, error.to_string())
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
