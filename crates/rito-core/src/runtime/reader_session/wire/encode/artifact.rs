use super::{locator, text_profile};
use crate::runtime::reader_session::{
    ReaderAdjacentAvailability, ReaderArtifact, ReaderDisplayList, ReaderError, ReaderFontRef,
    ReaderHitEntry, ReaderLocatorMatch, ReaderPage, ReaderRect, ReaderResourceKind,
    ReaderResourceRef, ReaderSemanticNode, ReaderSemanticRole, ReaderTextRunOffset,
};

use crate::runtime::reader_session::wire::primitives::{Writer, MAX_SEMANTIC_DEPTH};

pub(super) fn body(writer: &mut Writer, value: &ReaderArtifact) -> Result<(), ReaderError> {
    crate::runtime::reader_session::wire::primitives::external_id(value.session_id, "sessionId")?;
    crate::runtime::reader_session::wire::primitives::external_id(value.request_id, "requestId")?;
    crate::runtime::reader_session::wire::primitives::external_id(value.revision_id, "revisionId")?;
    crate::runtime::reader_session::wire::primitives::external_id(value.artifact_id, "artifactId")?;
    writer.u32(value.protocol_version);
    writer.u32(value.capability_profile_id);
    writer.u64(value.session_id);
    writer.u64(value.request_id);
    writer.u64(value.revision_id);
    writer.u32(value.revision_version);
    writer.u64(value.artifact_id);
    locator(writer, &value.locator)?;
    writer.u32(locator_match(value.matched_by));
    writer.u32(value.local_page_index);
    writer.u32(value.local_spread_index);
    writer.count(value.local_page_indexes.len(), "local page index count")?;
    for index in &value.local_page_indexes {
        writer.u32(*index);
    }
    writer.f64(value.width, "artifact width")?;
    writer.f64(value.height, "artifact height")?;
    writer.option(value.book_page_index.as_ref(), |writer, index| {
        writer.u32(*index);
        Ok(())
    })?;
    writer.option(value.book_page_count.as_ref(), |writer, count| {
        writer.u32(*count);
        Ok(())
    })?;
    writer.u32(adjacent_availability(value.navigation.previous));
    writer.u32(adjacent_availability(value.navigation.next));
    writer.u32(text_profile(value.text_profile));
    display_list(writer, &value.display_list)?;
    resources(writer, &value.resources)?;
    fonts(writer, &value.fonts)?;
    pages(writer, &value.pages)
}

const fn adjacent_availability(value: ReaderAdjacentAvailability) -> u32 {
    match value {
        ReaderAdjacentAvailability::Available => 0,
        ReaderAdjacentAvailability::ChapterBoundary => 1,
        ReaderAdjacentAvailability::Terminal => 2,
    }
}

fn display_list(writer: &mut Writer, value: &ReaderDisplayList) -> Result<(), ReaderError> {
    writer.record(|writer| {
        writer.u32(value.format_version);
        writer.u32(value.command_count);
        writer.fixed_bytes(&value.semantic_digest, "display list digest")?;
        writer.blob(&value.bytes, "display list bytes")
    })
}

fn resources(writer: &mut Writer, values: &[ReaderResourceRef]) -> Result<(), ReaderError> {
    writer.count(values.len(), "resource count")?;
    for value in values {
        writer.record(|writer| {
            writer.u32(resource_kind(value.kind));
            writer.string(&value.href, "resource href")
        })?;
    }
    Ok(())
}

fn fonts(writer: &mut Writer, values: &[ReaderFontRef]) -> Result<(), ReaderError> {
    writer.count(values.len(), "font count")?;
    for value in values {
        writer.record(|writer| {
            writer.string(&value.family, "font family")?;
            writer.string(&value.href, "font href")?;
            writer.string(&value.style, "font style")?;
            writer.u16(value.weight);
            writer.string(&value.shape_fingerprint, "font shape fingerprint")?;
            writer.u64(value.byte_length);
            Ok(())
        })?;
    }
    Ok(())
}

fn pages(writer: &mut Writer, values: &[ReaderPage]) -> Result<(), ReaderError> {
    writer.count(values.len(), "page count")?;
    for value in values {
        writer.record(|writer| page(writer, value))?;
    }
    Ok(())
}

fn page(writer: &mut Writer, value: &ReaderPage) -> Result<(), ReaderError> {
    writer.u32(value.page_index);
    writer.f64(value.width, "page width")?;
    writer.f64(value.height, "page height")?;
    writer.count(value.hits.len(), "page hit count")?;
    for hit in &value.hits {
        writer.record(|writer| hit_entry(writer, hit))?;
    }
    writer.count(value.semantics.len(), "page semantic count")?;
    for semantic in &value.semantics {
        semantic_node(writer, semantic, 0)?;
    }
    writer.string(&value.text, "page text")?;
    writer.u64(value.text_length);
    writer.count(value.text_runs.len(), "page text run count")?;
    for run in &value.text_runs {
        writer.record(|writer| text_run(writer, *run))?;
    }
    Ok(())
}

fn hit_entry(writer: &mut Writer, value: &ReaderHitEntry) -> Result<(), ReaderError> {
    writer.u32(value.page_index);
    rect(writer, value.bounds)?;
    writer.string(&value.text, "hit text")?;
    optional_string(writer, value.href.as_deref(), "hit href")?;
    writer.option(value.source_point.as_ref(), super::source_point)?;
    optional_string(writer, value.image_src.as_deref(), "hit image source")?;
    optional_string(writer, value.image_alt.as_deref(), "hit image alternative")?;
    optional_string(writer, value.footnote_key.as_deref(), "hit footnote key")?;
    writer.bool(value.footnote_pending);
    Ok(())
}

fn semantic_node(
    writer: &mut Writer,
    value: &ReaderSemanticNode,
    depth: u32,
) -> Result<(), ReaderError> {
    if depth > MAX_SEMANTIC_DEPTH {
        return Err(crate::runtime::reader_session::wire::primitives::overflow(
            "semantic tree depth",
        ));
    }
    writer.record(|writer| {
        writer.u32(semantic_role(value.role));
        writer.option(value.level.as_ref(), |writer, value| {
            writer.u8(*value);
            Ok(())
        })?;
        optional_string(writer, value.text.as_deref(), "semantic text")?;
        optional_string(writer, value.alt.as_deref(), "semantic alternative")?;
        optional_string(writer, value.href.as_deref(), "semantic href")?;
        rect(writer, value.bounds)?;
        writer.count(value.children.len(), "semantic child count")?;
        for child in &value.children {
            semantic_node(writer, child, depth + 1)?;
        }
        Ok(())
    })
}

fn text_run(writer: &mut Writer, value: ReaderTextRunOffset) -> Result<(), ReaderError> {
    writer.u64(value.start);
    writer.u64(value.end);
    writer.u32(value.block_index);
    writer.u32(value.line_index);
    writer.u32(value.run_index);
    Ok(())
}

fn rect(writer: &mut Writer, value: ReaderRect) -> Result<(), ReaderError> {
    writer.f64(value.x, "rectangle x")?;
    writer.f64(value.y, "rectangle y")?;
    writer.f64(value.width, "rectangle width")?;
    writer.f64(value.height, "rectangle height")
}

fn optional_string(
    writer: &mut Writer,
    value: Option<&str>,
    field: &str,
) -> Result<(), ReaderError> {
    writer.option(value, |writer, value| writer.string(value, field))
}

const fn locator_match(value: ReaderLocatorMatch) -> u32 {
    match value {
        ReaderLocatorMatch::SourceRange => 0,
        ReaderLocatorMatch::SourcePoint => 1,
        ReaderLocatorMatch::Anchor => 2,
        ReaderLocatorMatch::Progression => 3,
        ReaderLocatorMatch::Href => 4,
    }
}

pub(super) const fn resource_kind(value: ReaderResourceKind) -> u32 {
    match value {
        ReaderResourceKind::Image => 0,
        ReaderResourceKind::Font => 1,
        ReaderResourceKind::Stylesheet => 2,
    }
}

const fn semantic_role(value: ReaderSemanticRole) -> u32 {
    match value {
        ReaderSemanticRole::Heading => 0,
        ReaderSemanticRole::Paragraph => 1,
        ReaderSemanticRole::List => 2,
        ReaderSemanticRole::ListItem => 3,
        ReaderSemanticRole::Image => 4,
        ReaderSemanticRole::Link => 5,
        ReaderSemanticRole::Blockquote => 6,
        ReaderSemanticRole::Table => 7,
        ReaderSemanticRole::Generic => 8,
    }
}
