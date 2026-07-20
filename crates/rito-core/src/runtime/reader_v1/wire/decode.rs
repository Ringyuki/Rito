mod artifact;
mod publication;

use super::{
    primitives::{invalid, Reader},
    READER_ADJACENT_REQUEST_WIRE_MAGIC_V1, READER_ARTIFACT_WIRE_MAGIC_V1,
    READER_BACKGROUND_ADVANCE_WIRE_MAGIC_V1, READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC_V1,
    READER_BACKGROUND_HANDOFF_WIRE_MAGIC_V1, READER_BACKGROUND_REQUEST_WIRE_MAGIC_V1,
    READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC_V1, READER_FOREGROUND_HANDOFF_WIRE_MAGIC_V1,
    READER_PUBLICATION_WIRE_MAGIC_V1, READER_REQUEST_WIRE_MAGIC_V1, READER_RESOURCE_WIRE_MAGIC_V1,
    READER_WIRE_VERSION_V1,
};
use crate::runtime::reader_v1::{
    reader_resource_bytes_max_v1, ReaderAdjacentDirectionV1, ReaderAdjacentRequestV1,
    ReaderArtifactRequestV1, ReaderArtifactV1, ReaderBackgroundAdvanceV1,
    ReaderBackgroundHandoffAckV1, ReaderBackgroundHandoffV1, ReaderBackgroundRequestV1,
    ReaderBackgroundStateV1, ReaderErrorV1, ReaderForegroundHandoffAckV1,
    ReaderForegroundHandoffV1, ReaderLayoutV1, ReaderLocatorV1, ReaderPublicationV1,
    ReaderResourceV1, ReaderSourcePointV1, ReaderSourceRangeV1, ReaderSpreadModeV1,
    ReaderTextRenderingProfileV1, ReaderWorkBudgetV1, READER_PUBLICATION_WIRE_BYTES_MAX_V1,
};

pub(super) fn artifact(bytes: &[u8]) -> Result<ReaderArtifactV1, ReaderErrorV1> {
    let mut reader = Reader::message(bytes, READER_ARTIFACT_WIRE_MAGIC_V1, READER_WIRE_VERSION_V1)?;
    let artifact = artifact::body(&mut reader)?;
    reader.finish("artifact wire message")?;
    Ok(artifact)
}

pub(super) fn request(bytes: &[u8]) -> Result<ReaderArtifactRequestV1, ReaderErrorV1> {
    let mut reader = Reader::message(bytes, READER_REQUEST_WIRE_MAGIC_V1, READER_WIRE_VERSION_V1)?;
    let request = ReaderArtifactRequestV1 {
        session_id: external_id(reader.u64()?, "sessionId")?,
        request_id: external_id(reader.u64()?, "requestId")?,
        layout: layout(&mut reader)?,
        locator: locator(&mut reader)?,
        work: work_budget(&mut reader)?,
        text_profile: text_profile(reader.u32()?)?,
    };
    reader.finish("request wire message")?;
    Ok(request)
}

pub(super) fn adjacent_request(bytes: &[u8]) -> Result<ReaderAdjacentRequestV1, ReaderErrorV1> {
    let mut reader = Reader::message(
        bytes,
        READER_ADJACENT_REQUEST_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    )?;
    let request = ReaderAdjacentRequestV1 {
        session_id: external_id(reader.u64()?, "sessionId")?,
        request_id: external_id(reader.u64()?, "requestId")?,
        from_artifact_id: external_id(reader.u64()?, "fromArtifactId")?,
        direction: adjacent_direction(reader.u32()?)?,
        work: ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: reader.u32()?,
            max_foreground_quanta: reader.u32()?,
            local_page_cap: reader.u32()?,
        },
    };
    reader.finish("adjacent request wire message")?;
    Ok(request)
}

pub(super) fn foreground_handoff(bytes: &[u8]) -> Result<ReaderForegroundHandoffV1, ReaderErrorV1> {
    let mut reader = Reader::message(
        bytes,
        READER_FOREGROUND_HANDOFF_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    )?;
    let handoff = ReaderForegroundHandoffV1 {
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
) -> Result<ReaderForegroundHandoffAckV1, ReaderErrorV1> {
    let mut reader = Reader::message(
        bytes,
        READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    )?;
    let ack = ReaderForegroundHandoffAckV1 {
        intent_request_id: external_id(reader.u64()?, "intentRequestId")?,
        replaced_artifact_id: optional_external_id(&mut reader, "replacedArtifactId")?,
        visible_artifact_id: external_id(reader.u64()?, "visibleArtifactId")?,
    };
    reader.finish("foreground handoff ack wire message")?;
    Ok(ack)
}

pub(super) fn background_request(bytes: &[u8]) -> Result<ReaderBackgroundRequestV1, ReaderErrorV1> {
    let mut reader = Reader::message(
        bytes,
        READER_BACKGROUND_REQUEST_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    )?;
    let request = ReaderBackgroundRequestV1 {
        session_id: external_id(reader.u64()?, "sessionId")?,
        expected_visible_artifact_id: external_id(reader.u64()?, "expectedVisibleArtifactId")?,
        max_top_level_nodes_per_quantum: reader.u32()?,
    };
    reader.finish("background request wire message")?;
    Ok(request)
}

pub(super) fn background_advance(bytes: &[u8]) -> Result<ReaderBackgroundAdvanceV1, ReaderErrorV1> {
    let mut reader = Reader::message(
        bytes,
        READER_BACKGROUND_ADVANCE_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    )?;
    let state = background_state(reader.u32()?)?;
    let intent_request_id = external_id(reader.u64()?, "intentRequestId")?;
    let replaces_artifact_id = external_id(reader.u64()?, "replacesArtifactId")?;
    let artifact_bytes = reader.blob_slice("background artifact")?;
    let artifact = if artifact_bytes.is_empty() {
        None
    } else {
        Some(artifact(artifact_bytes)?)
    };
    reader.finish("background advance wire message")?;
    Ok(ReaderBackgroundAdvanceV1 {
        state,
        intent_request_id,
        replaces_artifact_id,
        artifact,
    })
}

pub(super) fn background_handoff(bytes: &[u8]) -> Result<ReaderBackgroundHandoffV1, ReaderErrorV1> {
    let mut reader = Reader::message(
        bytes,
        READER_BACKGROUND_HANDOFF_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    )?;
    let handoff = ReaderBackgroundHandoffV1 {
        session_id: external_id(reader.u64()?, "sessionId")?,
        expected_visible_artifact_id: external_id(reader.u64()?, "expectedVisibleArtifactId")?,
        candidate_artifact_id: external_id(reader.u64()?, "candidateArtifactId")?,
    };
    reader.finish("background handoff wire message")?;
    Ok(handoff)
}

pub(super) fn background_handoff_ack(
    bytes: &[u8],
) -> Result<ReaderBackgroundHandoffAckV1, ReaderErrorV1> {
    let mut reader = Reader::message(
        bytes,
        READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    )?;
    let ack = ReaderBackgroundHandoffAckV1 {
        intent_request_id: external_id(reader.u64()?, "intentRequestId")?,
        replaced_artifact_id: external_id(reader.u64()?, "replacedArtifactId")?,
        visible_artifact_id: external_id(reader.u64()?, "visibleArtifactId")?,
    };
    reader.finish("background handoff ack wire message")?;
    Ok(ack)
}

pub(super) fn publication(bytes: &[u8]) -> Result<ReaderPublicationV1, ReaderErrorV1> {
    let byte_length = u64::try_from(bytes.len())
        .map_err(|_| invalid("publication wire byte length is not representable"))?;
    if byte_length > READER_PUBLICATION_WIRE_BYTES_MAX_V1 {
        return Err(invalid("publication wire exceeds the byte limit"));
    }
    let mut reader = Reader::message(
        bytes,
        READER_PUBLICATION_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    )?;
    let publication = publication::body(&mut reader)?;
    reader.finish("publication wire message")?;
    super::super::publication_info::validate_reader_publication_v1(&publication)
        .map_err(invalid)?;
    Ok(publication)
}

pub(super) fn resource(bytes: &[u8]) -> Result<ReaderResourceV1, ReaderErrorV1> {
    let mut reader = Reader::message(bytes, READER_RESOURCE_WIRE_MAGIC_V1, READER_WIRE_VERSION_V1)?;
    let artifact_id = external_id(reader.u64()?, "artifactId")?;
    let kind = artifact::resource_kind(reader.u32()?)?;
    let href = reader.string("resource href")?;
    let media_type = reader.string("resource media type")?;
    let resource_bytes =
        reader.blob_slice_with_limit("resource bytes", reader_resource_bytes_max_v1(kind))?;
    let resource = ReaderResourceV1 {
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

fn layout(reader: &mut Reader<'_>) -> Result<ReaderLayoutV1, ReaderErrorV1> {
    reader.record("layout", |reader| {
        Ok(ReaderLayoutV1 {
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
        })
    })
}

pub(super) fn locator(reader: &mut Reader<'_>) -> Result<ReaderLocatorV1, ReaderErrorV1> {
    reader.record("locator", |reader| {
        Ok(ReaderLocatorV1 {
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

pub(super) fn source_point(reader: &mut Reader<'_>) -> Result<ReaderSourcePointV1, ReaderErrorV1> {
    reader.record("source point", |reader| {
        Ok(ReaderSourcePointV1 {
            node_path: reader.collection("source point path", Reader::u32)?,
            text_offset: reader.u64()?,
        })
    })
}

fn source_range(reader: &mut Reader<'_>) -> Result<ReaderSourceRangeV1, ReaderErrorV1> {
    reader.record("source range", |reader| {
        Ok(ReaderSourceRangeV1 {
            start: source_point(reader)?,
            end: source_point(reader)?,
        })
    })
}

fn work_budget(reader: &mut Reader<'_>) -> Result<ReaderWorkBudgetV1, ReaderErrorV1> {
    reader.record("work budget", |reader| {
        Ok(ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: reader.u32()?,
            max_foreground_quanta: reader.u32()?,
            local_page_cap: reader.u32()?,
        })
    })
}

pub(super) fn spread_mode(value: u32) -> Result<ReaderSpreadModeV1, ReaderErrorV1> {
    match value {
        0 => Ok(ReaderSpreadModeV1::Single),
        1 => Ok(ReaderSpreadModeV1::Double),
        value => Err(invalid(format!("unknown spread mode: {value}"))),
    }
}

pub(super) fn text_profile(value: u32) -> Result<ReaderTextRenderingProfileV1, ReaderErrorV1> {
    match value {
        0 => Ok(ReaderTextRenderingProfileV1::PlatformStringRuns),
        1 => Ok(ReaderTextRenderingProfileV1::PositionedGlyphRuns),
        value => Err(invalid(format!("unknown text profile: {value}"))),
    }
}

fn adjacent_direction(value: u32) -> Result<ReaderAdjacentDirectionV1, ReaderErrorV1> {
    match value {
        0 => Ok(ReaderAdjacentDirectionV1::Previous),
        1 => Ok(ReaderAdjacentDirectionV1::Next),
        value => Err(invalid(format!("unknown adjacent direction: {value}"))),
    }
}

fn background_state(value: u32) -> Result<ReaderBackgroundStateV1, ReaderErrorV1> {
    match value {
        0 => Ok(ReaderBackgroundStateV1::Started),
        1 => Ok(ReaderBackgroundStateV1::Advanced),
        2 => Ok(ReaderBackgroundStateV1::Reused),
        3 => Ok(ReaderBackgroundStateV1::CandidatePending),
        4 => Ok(ReaderBackgroundStateV1::Complete),
        5 => Ok(ReaderBackgroundStateV1::Indexing),
        value => Err(invalid(format!("unknown background state: {value}"))),
    }
}

fn external_id(value: u64, field: &str) -> Result<u64, ReaderErrorV1> {
    super::primitives::external_id(value, field)
}

fn optional_external_id(
    reader: &mut Reader<'_>,
    field: &str,
) -> Result<Option<u64>, ReaderErrorV1> {
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
