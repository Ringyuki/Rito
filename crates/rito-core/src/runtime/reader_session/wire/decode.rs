mod artifact;
mod publication;

use super::{
    primitives::{invalid, Reader},
    READER_ADJACENT_REQUEST_WIRE_MAGIC, READER_ARTIFACT_WIRE_MAGIC,
    READER_BACKGROUND_ADVANCE_WIRE_MAGIC, READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC,
    READER_BACKGROUND_HANDOFF_WIRE_MAGIC, READER_BACKGROUND_REQUEST_WIRE_MAGIC,
    READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC, READER_FOREGROUND_HANDOFF_WIRE_MAGIC,
    READER_PUBLICATION_WIRE_MAGIC, READER_REQUEST_WIRE_MAGIC, READER_RESOURCE_WIRE_MAGIC,
    READER_WIRE_VERSION,
};
use crate::runtime::reader_session::{
    reader_resource_bytes_max, ReaderAdjacentDirection, ReaderAdjacentRequest, ReaderArtifact,
    ReaderArtifactRequest, ReaderBackgroundAdvance, ReaderBackgroundHandoff,
    ReaderBackgroundHandoffAck, ReaderBackgroundRequest, ReaderBackgroundState, ReaderError,
    ReaderFootnote, ReaderFootnoteKind, ReaderForegroundHandoff, ReaderForegroundHandoffAck,
    ReaderLayout, ReaderLocator, ReaderPublication, ReaderRect, ReaderResource,
    ReaderSearchRequest, ReaderSearchResponse, ReaderSearchResult, ReaderSourcePoint,
    ReaderSourceRange, ReaderSpreadMode, ReaderTextPosition, ReaderTextRangeGeometry,
    ReaderTextRangeRequest, ReaderTextRect, ReaderTextRenderingProfile,
    READER_PUBLICATION_WIRE_BYTES_MAX,
};

pub(super) fn artifact(bytes: &[u8]) -> Result<ReaderArtifact, ReaderError> {
    let mut reader = Reader::message(bytes, READER_ARTIFACT_WIRE_MAGIC, READER_WIRE_VERSION)?;
    let artifact = artifact::body(&mut reader)?;
    reader.finish("artifact wire message")?;
    Ok(artifact)
}

pub(super) fn request(bytes: &[u8]) -> Result<ReaderArtifactRequest, ReaderError> {
    let mut reader = Reader::message(bytes, READER_REQUEST_WIRE_MAGIC, READER_WIRE_VERSION)?;
    let request = ReaderArtifactRequest {
        session_id: external_id(reader.u64()?, "sessionId")?,
        request_id: external_id(reader.u64()?, "requestId")?,
        layout: layout(&mut reader)?,
        locator: locator(&mut reader)?,
        text_profile: text_profile(reader.u32()?)?,
    };
    reader.finish("request wire message")?;
    Ok(request)
}

pub(super) fn adjacent_request(bytes: &[u8]) -> Result<ReaderAdjacentRequest, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_ADJACENT_REQUEST_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let request = ReaderAdjacentRequest {
        session_id: external_id(reader.u64()?, "sessionId")?,
        request_id: external_id(reader.u64()?, "requestId")?,
        from_artifact_id: external_id(reader.u64()?, "fromArtifactId")?,
        direction: adjacent_direction(reader.u32()?)?,
    };
    reader.finish("adjacent request wire message")?;
    Ok(request)
}

pub(super) fn foreground_handoff(bytes: &[u8]) -> Result<ReaderForegroundHandoff, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_FOREGROUND_HANDOFF_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let handoff = ReaderForegroundHandoff {
        session_id: external_id(reader.u64()?, "sessionId")?,
        expected_visible_artifact_id: optional_external_id(
            &mut reader,
            "expectedVisibleArtifactId",
        )?,
        candidate_artifact_id: external_id(reader.u64()?, "candidateArtifactId")?,
    };
    reader.finish("foreground handoff wire message")?;
    Ok(handoff)
}

pub(super) fn foreground_handoff_ack(
    bytes: &[u8],
) -> Result<ReaderForegroundHandoffAck, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let ack = ReaderForegroundHandoffAck {
        intent_request_id: external_id(reader.u64()?, "intentRequestId")?,
        replaced_artifact_id: optional_external_id(&mut reader, "replacedArtifactId")?,
        visible_artifact_id: external_id(reader.u64()?, "visibleArtifactId")?,
    };
    reader.finish("foreground handoff ack wire message")?;
    Ok(ack)
}

pub(super) fn background_request(bytes: &[u8]) -> Result<ReaderBackgroundRequest, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_BACKGROUND_REQUEST_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let request = ReaderBackgroundRequest {
        session_id: external_id(reader.u64()?, "sessionId")?,
        expected_visible_artifact_id: external_id(reader.u64()?, "expectedVisibleArtifactId")?,
        max_top_level_nodes_per_quantum: reader.u32()?,
    };
    reader.finish("background request wire message")?;
    Ok(request)
}

pub(super) fn background_advance(bytes: &[u8]) -> Result<ReaderBackgroundAdvance, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_BACKGROUND_ADVANCE_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let state = background_state(reader.u32()?)?;
    let intent_request_id = external_id(reader.u64()?, "intentRequestId")?;
    let replaces_artifact_id = external_id(reader.u64()?, "replacesArtifactId")?;
    let moves_visible_content = reader.bool("background moves visible content")?;
    let artifact_bytes = reader.blob_slice("background artifact")?;
    let artifact = if artifact_bytes.is_empty() {
        None
    } else {
        Some(artifact(artifact_bytes)?)
    };
    reader.finish("background advance wire message")?;
    Ok(ReaderBackgroundAdvance {
        state,
        intent_request_id,
        replaces_artifact_id,
        moves_visible_content: moves_visible_content && artifact.is_some(),
        artifact,
    })
}

pub(super) fn background_handoff(bytes: &[u8]) -> Result<ReaderBackgroundHandoff, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_BACKGROUND_HANDOFF_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let handoff = ReaderBackgroundHandoff {
        session_id: external_id(reader.u64()?, "sessionId")?,
        expected_visible_artifact_id: external_id(reader.u64()?, "expectedVisibleArtifactId")?,
        candidate_artifact_id: external_id(reader.u64()?, "candidateArtifactId")?,
    };
    reader.finish("background handoff wire message")?;
    Ok(handoff)
}

pub(super) fn background_handoff_ack(
    bytes: &[u8],
) -> Result<ReaderBackgroundHandoffAck, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let ack = ReaderBackgroundHandoffAck {
        intent_request_id: external_id(reader.u64()?, "intentRequestId")?,
        replaced_artifact_id: external_id(reader.u64()?, "replacedArtifactId")?,
        visible_artifact_id: external_id(reader.u64()?, "visibleArtifactId")?,
    };
    reader.finish("background handoff ack wire message")?;
    Ok(ack)
}

pub(super) fn publication(bytes: &[u8]) -> Result<ReaderPublication, ReaderError> {
    let byte_length = u64::try_from(bytes.len())
        .map_err(|_| invalid("publication wire byte length is not representable"))?;
    if byte_length > READER_PUBLICATION_WIRE_BYTES_MAX {
        return Err(invalid("publication wire exceeds the byte limit"));
    }
    let mut reader = Reader::message(bytes, READER_PUBLICATION_WIRE_MAGIC, READER_WIRE_VERSION)?;
    let publication = publication::body(&mut reader)?;
    reader.finish("publication wire message")?;
    super::super::publication_info::validate_reader_publication(&publication).map_err(invalid)?;
    Ok(publication)
}

pub(super) fn search_request(bytes: &[u8]) -> Result<ReaderSearchRequest, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        super::READER_SEARCH_REQUEST_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let request = ReaderSearchRequest {
        session_id: external_id(reader.u64()?, "sessionId")?,
        artifact_id: external_id(reader.u64()?, "artifactId")?,
        query: reader.string("search query")?,
        case_sensitive: reader.bool("search case sensitive")?,
        whole_word: reader.bool("search whole word")?,
        limit: reader.u32()?,
    };
    reader.finish("search request wire message")?;
    Ok(request)
}

pub(super) fn search_response(bytes: &[u8]) -> Result<ReaderSearchResponse, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        super::READER_SEARCH_RESPONSE_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let response = ReaderSearchResponse {
        artifact_id: external_id(reader.u64()?, "artifactId")?,
        query: reader.string("search query")?,
        truncated: reader.bool("search truncated")?,
        searched_page_count: reader.u32()?,
        results: reader.collection("search results", |reader| {
            reader.record("search result", |reader| {
                Ok(ReaderSearchResult {
                    page_index: reader.u32()?,
                    spread_index: reader.u32()?,
                    start: text_position(reader)?,
                    end: text_position(reader)?,
                    context: reader.string("search context")?,
                    locator: reader.option("search locator", locator)?,
                })
            })
        })?,
    };
    reader.finish("search response wire message")?;
    Ok(response)
}

pub(super) fn text_range_request(bytes: &[u8]) -> Result<ReaderTextRangeRequest, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        super::READER_TEXT_RANGE_REQUEST_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let request = ReaderTextRangeRequest {
        session_id: external_id(reader.u64()?, "sessionId")?,
        artifact_id: external_id(reader.u64()?, "artifactId")?,
        page_index: reader.u32()?,
        start: text_position(&mut reader)?,
        end: text_position(&mut reader)?,
    };
    reader.finish("text range request wire message")?;
    Ok(request)
}

fn text_position(reader: &mut Reader<'_>) -> Result<ReaderTextPosition, ReaderError> {
    Ok(ReaderTextPosition {
        block_index: reader.u32()?,
        line_index: reader.u32()?,
        run_index: reader.u32()?,
        char_index: reader.u32()?,
    })
}

pub(super) fn text_range_geometry(bytes: &[u8]) -> Result<ReaderTextRangeGeometry, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        super::READER_TEXT_RANGE_GEOMETRY_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let geometry = ReaderTextRangeGeometry {
        artifact_id: external_id(reader.u64()?, "artifactId")?,
        page_index: reader.u32()?,
        rects: reader.collection("text range rects", |reader| {
            reader.record("text range rect", |reader| {
                Ok(ReaderTextRect {
                    bounds: ReaderRect {
                        x: reader.f64("text rect x")?,
                        y: reader.f64("text rect y")?,
                        width: reader.f64("text rect width")?,
                        height: reader.f64("text rect height")?,
                    },
                    block_index: reader.u32()?,
                    line_index: reader.u32()?,
                    run_index: reader.u32()?,
                    start_char_index: reader.u32()?,
                    end_char_index: reader.u32()?,
                })
            })
        })?,
    };
    reader.finish("text range geometry wire message")?;
    Ok(geometry)
}

pub(super) fn footnote(bytes: &[u8]) -> Result<ReaderFootnote, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        super::READER_FOOTNOTE_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let footnote = ReaderFootnote {
        artifact_id: external_id(reader.u64()?, "artifactId")?,
        key: reader.string("footnote key")?,
        kind: footnote_kind(reader.u32()?)?,
        text: reader.string("footnote text")?,
        html: reader.string("footnote html")?,
    };
    reader.finish("footnote wire message")?;
    Ok(footnote)
}

fn footnote_kind(value: u32) -> Result<ReaderFootnoteKind, ReaderError> {
    match value {
        0 => Ok(ReaderFootnoteKind::Footnote),
        1 => Ok(ReaderFootnoteKind::Endnote),
        2 => Ok(ReaderFootnoteKind::Rearnote),
        3 => Ok(ReaderFootnoteKind::Note),
        tag => Err(invalid(format!("unknown footnote kind: {tag}"))),
    }
}

pub(super) fn resource(bytes: &[u8]) -> Result<ReaderResource, ReaderError> {
    let mut reader = Reader::message(bytes, READER_RESOURCE_WIRE_MAGIC, READER_WIRE_VERSION)?;
    let artifact_id = external_id(reader.u64()?, "artifactId")?;
    let kind = artifact::resource_kind(reader.u32()?)?;
    let href = reader.string("resource href")?;
    let media_type = reader.string("resource media type")?;
    let resource_bytes =
        reader.blob_slice_with_limit("resource bytes", reader_resource_bytes_max(kind))?;
    let resource = ReaderResource {
        artifact_id,
        kind,
        href,
        media_type,
        bytes: resource_bytes.to_vec(),
        width: reader.option("resource width", Reader::u32)?,
        height: reader.option("resource height", Reader::u32)?,
    };
    reader.finish("resource wire message")?;
    Ok(resource)
}

fn layout(reader: &mut Reader<'_>) -> Result<ReaderLayout, ReaderError> {
    reader.record("layout", |reader| {
        Ok(ReaderLayout {
            viewport_width: reader.f64("viewport width")?,
            viewport_height: reader.f64("viewport height")?,
            margin_top: reader.f64("top margin")?,
            margin_right: reader.f64("right margin")?,
            margin_bottom: reader.f64("bottom margin")?,
            margin_left: reader.f64("left margin")?,
            spread_mode: spread_mode(reader.u32()?)?,
            first_page_alone: reader.bool("first page alone")?,
            spread_gap: reader.f64("spread gap")?,
            root_font_size: reader.f64("root font size")?,
            line_height_override: reader
                .option("line height", |reader| reader.f64("line height override"))?,
            font_family_override: reader.option("font family override", |reader| {
                reader.string("font family override")
            })?,
            render_ratio: reader.f64("render ratio")?,
        })
    })
}

pub(super) fn locator(reader: &mut Reader<'_>) -> Result<ReaderLocator, ReaderError> {
    reader.record("locator", |reader| {
        Ok(ReaderLocator {
            href: reader.string("locator href")?,
            anchor_id: reader.option("locator anchor", |reader| reader.string("locator anchor"))?,
            source_point: reader.option("source point", source_point)?,
            source_range: reader.option("source range", source_range)?,
            progression: reader.option("locator progression", |reader| {
                reader.f64("locator progression")
            })?,
        })
    })
}

pub(super) fn source_point(reader: &mut Reader<'_>) -> Result<ReaderSourcePoint, ReaderError> {
    reader.record("source point", |reader| {
        Ok(ReaderSourcePoint {
            node_path: reader.collection("source point path", Reader::u32)?,
            text_offset: reader.u64()?,
        })
    })
}

fn source_range(reader: &mut Reader<'_>) -> Result<ReaderSourceRange, ReaderError> {
    reader.record("source range", |reader| {
        Ok(ReaderSourceRange {
            start: source_point(reader)?,
            end: source_point(reader)?,
        })
    })
}

pub(super) fn spread_mode(value: u32) -> Result<ReaderSpreadMode, ReaderError> {
    match value {
        0 => Ok(ReaderSpreadMode::Single),
        1 => Ok(ReaderSpreadMode::Double),
        value => Err(invalid(format!("unknown spread mode: {value}"))),
    }
}

pub(super) fn text_profile(value: u32) -> Result<ReaderTextRenderingProfile, ReaderError> {
    match value {
        0 => Ok(ReaderTextRenderingProfile::PlatformStringRuns),
        1 => Ok(ReaderTextRenderingProfile::PositionedGlyphRuns),
        value => Err(invalid(format!("unknown text profile: {value}"))),
    }
}

fn adjacent_direction(value: u32) -> Result<ReaderAdjacentDirection, ReaderError> {
    match value {
        0 => Ok(ReaderAdjacentDirection::Previous),
        1 => Ok(ReaderAdjacentDirection::Next),
        value => Err(invalid(format!("unknown adjacent direction: {value}"))),
    }
}

fn background_state(value: u32) -> Result<ReaderBackgroundState, ReaderError> {
    match value {
        0 => Ok(ReaderBackgroundState::Started),
        1 => Ok(ReaderBackgroundState::Advanced),
        2 => Ok(ReaderBackgroundState::Reused),
        3 => Ok(ReaderBackgroundState::CandidatePending),
        4 => Ok(ReaderBackgroundState::Complete),
        5 => Ok(ReaderBackgroundState::Indexing),
        value => Err(invalid(format!("unknown background state: {value}"))),
    }
}

fn external_id(value: u64, field: &str) -> Result<u64, ReaderError> {
    super::primitives::external_id(value, field)
}

fn optional_external_id(reader: &mut Reader<'_>, field: &str) -> Result<Option<u64>, ReaderError> {
    let tag = reader.u32()?;
    let value = reader.u64()?;
    match (tag, value) {
        (0, 0) => Ok(None),
        (0, _) => Err(invalid(format!(
            "{field} none tag must carry a zero payload"
        ))),
        (1, value) => external_id(value, field).map(Some),
        (tag, _) => Err(invalid(format!("unknown {field} option tag: {tag}"))),
    }
}
