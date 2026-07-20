use super::{locator, source_point, text_profile};
use crate::runtime::reader_v1::wire::primitives::{invalid, Reader, MAX_SEMANTIC_DEPTH};
use crate::runtime::reader_v1::{
    ReaderAdjacentAvailabilityV1, ReaderArtifactV1, ReaderDisplayListV1, ReaderErrorV1,
    ReaderFontRefV1, ReaderHitEntryV1, ReaderLocatorMatchV1, ReaderNavigationV1, ReaderPageV1,
    ReaderRectV1, ReaderResourceKindV1, ReaderResourceRefV1, ReaderSemanticNodeV1,
    ReaderSemanticRoleV1, ReaderTextRunOffsetV1, READER_PROTOCOL_VERSION_V1,
};

pub(super) fn body(reader: &mut Reader<'_>) -> Result<ReaderArtifactV1, ReaderErrorV1> {
    let protocol_version = reader.u32()?;
    if protocol_version != READER_PROTOCOL_VERSION_V1 {
        return Err(invalid(format!(
            "unsupported artifact protocol version: {protocol_version}"
        )));
    }
    Ok(ReaderArtifactV1 {
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
        terminal_extent: reader.bool("terminal extent")?,
        navigation: ReaderNavigationV1 {
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

fn external_id(value: u64, field: &str) -> Result<u64, ReaderErrorV1> {
    crate::runtime::reader_v1::wire::primitives::external_id(value, field)
}

fn adjacent_availability(value: u32) -> Result<ReaderAdjacentAvailabilityV1, ReaderErrorV1> {
    match value {
        0 => Ok(ReaderAdjacentAvailabilityV1::Available),
        1 => Ok(ReaderAdjacentAvailabilityV1::Pending),
        2 => Ok(ReaderAdjacentAvailabilityV1::ChapterBoundary),
        3 => Ok(ReaderAdjacentAvailabilityV1::Terminal),
        4 => Ok(ReaderAdjacentAvailabilityV1::Blocked),
        value => Err(invalid(format!("unknown adjacent availability: {value}"))),
    }
}

fn display_list(reader: &mut Reader<'_>) -> Result<ReaderDisplayListV1, ReaderErrorV1> {
    reader.record("display list", |reader| {
        Ok(ReaderDisplayListV1 {
            format_version: reader.u32()?,
            command_count: reader.u32()?,
            semantic_digest: reader.fixed_bytes("display list digest")?,
            bytes: reader.blob("display list bytes")?,
        })
    })
}

fn resources(reader: &mut Reader<'_>) -> Result<Vec<ReaderResourceRefV1>, ReaderErrorV1> {
    reader.collection("resources", |reader| {
        reader.record("resource", |reader| {
            Ok(ReaderResourceRefV1 {
                kind: resource_kind(reader.u32()?)?,
                href: reader.string("resource href")?,
            })
        })
    })
}

fn fonts(reader: &mut Reader<'_>) -> Result<Vec<ReaderFontRefV1>, ReaderErrorV1> {
    reader.collection("fonts", |reader| {
        reader.record("font", |reader| {
            Ok(ReaderFontRefV1 {
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

fn pages(reader: &mut Reader<'_>) -> Result<Vec<ReaderPageV1>, ReaderErrorV1> {
    reader.collection("pages", |reader| reader.record("page", page))
}

fn page(reader: &mut Reader<'_>) -> Result<ReaderPageV1, ReaderErrorV1> {
    Ok(ReaderPageV1 {
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

fn hit_entry(reader: &mut Reader<'_>) -> Result<ReaderHitEntryV1, ReaderErrorV1> {
    Ok(ReaderHitEntryV1 {
        page_index: reader.u32()?,
        bounds: rect(reader)?,
        text: reader.string("hit text")?,
        href: optional_string(reader, "hit href")?,
        source_point: reader.option("hit source point", source_point)?,
        image_src: optional_string(reader, "hit image source")?,
        image_alt: optional_string(reader, "hit image alternative")?,
    })
}

fn semantic_node(
    reader: &mut Reader<'_>,
    depth: u32,
) -> Result<ReaderSemanticNodeV1, ReaderErrorV1> {
    if depth > MAX_SEMANTIC_DEPTH {
        return Err(invalid("semantic tree exceeds the depth limit"));
    }
    reader.record("semantic node", |reader| {
        Ok(ReaderSemanticNodeV1 {
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

fn text_run(reader: &mut Reader<'_>) -> Result<ReaderTextRunOffsetV1, ReaderErrorV1> {
    Ok(ReaderTextRunOffsetV1 {
        start: reader.u64()?,
        end: reader.u64()?,
        block_index: reader.u32()?,
        line_index: reader.u32()?,
        run_index: reader.u32()?,
    })
}

fn rect(reader: &mut Reader<'_>) -> Result<ReaderRectV1, ReaderErrorV1> {
    Ok(ReaderRectV1 {
        x: reader.f64("rectangle x")?,
        y: reader.f64("rectangle y")?,
        width: reader.f64("rectangle width")?,
        height: reader.f64("rectangle height")?,
    })
}

fn optional_string(reader: &mut Reader<'_>, field: &str) -> Result<Option<String>, ReaderErrorV1> {
    reader.option(field, |reader| reader.string(field))
}

fn locator_match(value: u32) -> Result<ReaderLocatorMatchV1, ReaderErrorV1> {
    match value {
        0 => Ok(ReaderLocatorMatchV1::SourceRange),
        1 => Ok(ReaderLocatorMatchV1::SourcePoint),
        2 => Ok(ReaderLocatorMatchV1::Anchor),
        3 => Ok(ReaderLocatorMatchV1::Progression),
        4 => Ok(ReaderLocatorMatchV1::Href),
        value => Err(invalid(format!("unknown locator match: {value}"))),
    }
}

pub(super) fn resource_kind(value: u32) -> Result<ReaderResourceKindV1, ReaderErrorV1> {
    match value {
        0 => Ok(ReaderResourceKindV1::Image),
        1 => Ok(ReaderResourceKindV1::Font),
        2 => Ok(ReaderResourceKindV1::Stylesheet),
        value => Err(invalid(format!("unknown resource kind: {value}"))),
    }
}

fn semantic_role(value: u32) -> Result<ReaderSemanticRoleV1, ReaderErrorV1> {
    match value {
        0 => Ok(ReaderSemanticRoleV1::Heading),
        1 => Ok(ReaderSemanticRoleV1::Paragraph),
        2 => Ok(ReaderSemanticRoleV1::List),
        3 => Ok(ReaderSemanticRoleV1::ListItem),
        4 => Ok(ReaderSemanticRoleV1::Image),
        5 => Ok(ReaderSemanticRoleV1::Link),
        6 => Ok(ReaderSemanticRoleV1::Blockquote),
        7 => Ok(ReaderSemanticRoleV1::Table),
        8 => Ok(ReaderSemanticRoleV1::Generic),
        value => Err(invalid(format!("unknown semantic role: {value}"))),
    }
}
