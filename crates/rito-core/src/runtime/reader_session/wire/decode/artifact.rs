use super::{locator, source_point, text_profile};
use crate::runtime::reader_session::wire::primitives::{invalid, Reader, MAX_SEMANTIC_DEPTH};
use crate::runtime::reader_session::{
    ReaderAdjacentAvailability, ReaderArtifact, ReaderDisplayList, ReaderError, ReaderFontRef,
    ReaderHitEntry, ReaderLocatorMatch, ReaderNavigation, ReaderPage, ReaderRect,
    ReaderResourceKind, ReaderResourceRef, ReaderSemanticNode, ReaderSemanticRole,
    ReaderTextRunOffset, READER_PROTOCOL_VERSION,
};

pub(super) fn body(reader: &mut Reader<'_>) -> Result<ReaderArtifact, ReaderError> {
    let protocol_version = reader.u32()?;
    if protocol_version != READER_PROTOCOL_VERSION {
        return Err(invalid(format!(
            "unsupported artifact protocol version: {protocol_version}"
        )));
    }
    Ok(ReaderArtifact {
        protocol_version,
        capability_profile_id: reader.u32()?,
        session_id: external_id(reader.u64()?, "sessionId")?,
        request_id: external_id(reader.u64()?, "requestId")?,
        revision_id: external_id(reader.u64()?, "revisionId")?,
        revision_version: reader.u32()?,
        artifact_id: external_id(reader.u64()?, "artifactId")?,
        locator: locator(reader)?,
        matched_by: locator_match(reader.u32()?)?,
        local_page_index: reader.u32()?,
        local_spread_index: reader.u32()?,
        local_page_indexes: reader.collection("local page indexes", Reader::u32)?,
        width: reader.f64("artifact width")?,
        height: reader.f64("artifact height")?,
        book_page_index: reader.option("book page index", Reader::u32)?,
        book_page_count: reader.option("book page count", Reader::u32)?,
        navigation: ReaderNavigation {
            previous: adjacent_availability(reader.u32()?)?,
            next: adjacent_availability(reader.u32()?)?,
        },
        text_profile: text_profile(reader.u32()?)?,
        display_list: display_list(reader)?,
        resources: resources(reader)?,
        fonts: fonts(reader)?,
        pages: pages(reader)?,
    })
}

fn external_id(value: u64, field: &str) -> Result<u64, ReaderError> {
    crate::runtime::reader_session::wire::primitives::external_id(value, field)
}

fn adjacent_availability(value: u32) -> Result<ReaderAdjacentAvailability, ReaderError> {
    match value {
        0 => Ok(ReaderAdjacentAvailability::Available),
        1 => Ok(ReaderAdjacentAvailability::ChapterBoundary),
        2 => Ok(ReaderAdjacentAvailability::Terminal),
        value => Err(invalid(format!("unknown adjacent availability: {value}"))),
    }
}

fn display_list(reader: &mut Reader<'_>) -> Result<ReaderDisplayList, ReaderError> {
    reader.record("display list", |reader| {
        Ok(ReaderDisplayList {
            format_version: reader.u32()?,
            command_count: reader.u32()?,
            semantic_digest: reader.fixed_bytes("display list digest")?,
            bytes: reader.blob("display list bytes")?,
        })
    })
}

fn resources(reader: &mut Reader<'_>) -> Result<Vec<ReaderResourceRef>, ReaderError> {
    reader.collection("resources", |reader| {
        reader.record("resource", |reader| {
            Ok(ReaderResourceRef {
                kind: resource_kind(reader.u32()?)?,
                href: reader.string("resource href")?,
            })
        })
    })
}

fn fonts(reader: &mut Reader<'_>) -> Result<Vec<ReaderFontRef>, ReaderError> {
    reader.collection("fonts", |reader| {
        reader.record("font", |reader| {
            Ok(ReaderFontRef {
                family: reader.string("font family")?,
                href: reader.string("font href")?,
                style: reader.string("font style")?,
                weight: reader.u16()?,
                shape_fingerprint: reader.string("font shape fingerprint")?,
                byte_length: reader.u64()?,
            })
        })
    })
}

fn pages(reader: &mut Reader<'_>) -> Result<Vec<ReaderPage>, ReaderError> {
    reader.collection("pages", |reader| reader.record("page", page))
}

fn page(reader: &mut Reader<'_>) -> Result<ReaderPage, ReaderError> {
    Ok(ReaderPage {
        page_index: reader.u32()?,
        width: reader.f64("page width")?,
        height: reader.f64("page height")?,
        hits: reader.collection("page hits", |reader| reader.record("hit", hit_entry))?,
        semantics: reader.collection("page semantics", |reader| semantic_node(reader, 0))?,
        text: reader.string("page text")?,
        text_length: reader.u64()?,
        text_runs: reader.collection("page text runs", |reader| {
            reader.record("text run", text_run)
        })?,
    })
}

fn hit_entry(reader: &mut Reader<'_>) -> Result<ReaderHitEntry, ReaderError> {
    Ok(ReaderHitEntry {
        page_index: reader.u32()?,
        bounds: rect(reader)?,
        text: reader.string("hit text")?,
        href: optional_string(reader, "hit href")?,
        source_point: reader.option("hit source point", source_point)?,
        image_src: optional_string(reader, "hit image source")?,
        image_alt: optional_string(reader, "hit image alternative")?,
        footnote_key: optional_string(reader, "hit footnote key")?,
        footnote_pending: reader.bool("hit footnote pending")?,
    })
}

fn semantic_node(reader: &mut Reader<'_>, depth: u32) -> Result<ReaderSemanticNode, ReaderError> {
    if depth > MAX_SEMANTIC_DEPTH {
        return Err(invalid("semantic tree exceeds the depth limit"));
    }
    reader.record("semantic node", |reader| {
        Ok(ReaderSemanticNode {
            role: semantic_role(reader.u32()?)?,
            level: reader.option("semantic level", Reader::u8)?,
            text: optional_string(reader, "semantic text")?,
            alt: optional_string(reader, "semantic alternative")?,
            href: optional_string(reader, "semantic href")?,
            bounds: rect(reader)?,
            children: reader.collection("semantic children", |reader| {
                semantic_node(reader, depth + 1)
            })?,
        })
    })
}

fn text_run(reader: &mut Reader<'_>) -> Result<ReaderTextRunOffset, ReaderError> {
    Ok(ReaderTextRunOffset {
        start: reader.u64()?,
        end: reader.u64()?,
        block_index: reader.u32()?,
        line_index: reader.u32()?,
        run_index: reader.u32()?,
    })
}

fn rect(reader: &mut Reader<'_>) -> Result<ReaderRect, ReaderError> {
    Ok(ReaderRect {
        x: reader.f64("rectangle x")?,
        y: reader.f64("rectangle y")?,
        width: reader.f64("rectangle width")?,
        height: reader.f64("rectangle height")?,
    })
}

fn optional_string(reader: &mut Reader<'_>, field: &str) -> Result<Option<String>, ReaderError> {
    reader.option(field, |reader| reader.string(field))
}

fn locator_match(value: u32) -> Result<ReaderLocatorMatch, ReaderError> {
    match value {
        0 => Ok(ReaderLocatorMatch::SourceRange),
        1 => Ok(ReaderLocatorMatch::SourcePoint),
        2 => Ok(ReaderLocatorMatch::Anchor),
        3 => Ok(ReaderLocatorMatch::Progression),
        4 => Ok(ReaderLocatorMatch::Href),
        value => Err(invalid(format!("unknown locator match: {value}"))),
    }
}

pub(super) fn resource_kind(value: u32) -> Result<ReaderResourceKind, ReaderError> {
    match value {
        0 => Ok(ReaderResourceKind::Image),
        1 => Ok(ReaderResourceKind::Font),
        2 => Ok(ReaderResourceKind::Stylesheet),
        value => Err(invalid(format!("unknown resource kind: {value}"))),
    }
}

fn semantic_role(value: u32) -> Result<ReaderSemanticRole, ReaderError> {
    match value {
        0 => Ok(ReaderSemanticRole::Heading),
        1 => Ok(ReaderSemanticRole::Paragraph),
        2 => Ok(ReaderSemanticRole::List),
        3 => Ok(ReaderSemanticRole::ListItem),
        4 => Ok(ReaderSemanticRole::Image),
        5 => Ok(ReaderSemanticRole::Link),
        6 => Ok(ReaderSemanticRole::Blockquote),
        7 => Ok(ReaderSemanticRole::Table),
        8 => Ok(ReaderSemanticRole::Generic),
        value => Err(invalid(format!("unknown semantic role: {value}"))),
    }
}
