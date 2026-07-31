mod artifact;
mod publication;

use super::{
    primitives::Writer, READER_ADJACENT_REQUEST_WIRE_MAGIC_V1, READER_ARTIFACT_WIRE_MAGIC_V1,
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
    ReaderFootnoteKindV1, ReaderFootnoteV1, ReaderResourceV1, ReaderSourcePointV1,
    ReaderSearchRequestV1, ReaderSearchResponseV1, ReaderTextPositionV1,
    ReaderTextRangeGeometryV1, ReaderTextRangeRequestV1,
    ReaderSourceRangeV1, ReaderSpreadModeV1,
    ReaderTextRenderingProfileV1, ReaderWorkBudgetV1, READER_PROTOCOL_VERSION_V1,
    READER_PUBLICATION_WIRE_BYTES_MAX_V1,
};

pub(super) fn artifact(value: &ReaderArtifactV1) -> Result<Vec<u8>, ReaderErrorV1> {
    if value.protocol_version != READER_PROTOCOL_VERSION_V1 {
        return Err(super::primitives::invalid(format!(
            "unsupported artifact protocol version: {}",
            value.protocol_version
        )));
    }
    let mut writer = Writer::message(READER_ARTIFACT_WIRE_MAGIC_V1, READER_WIRE_VERSION_V1);
    artifact::body(&mut writer, value)?;
    writer.finish_message()
}

pub(super) fn request(value: &ReaderArtifactRequestV1) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.session_id, "sessionId")?;
    super::primitives::external_id(value.request_id, "requestId")?;
    let mut writer = Writer::message(READER_REQUEST_WIRE_MAGIC_V1, READER_WIRE_VERSION_V1);
    writer.u64(value.session_id);
    writer.u64(value.request_id);
    layout(&mut writer, &value.layout)?;
    locator(&mut writer, &value.locator)?;
    work_budget(&mut writer, value.work)?;
    writer.u32(text_profile(value.text_profile));
    writer.finish_message()
}

pub(super) fn adjacent_request(value: &ReaderAdjacentRequestV1) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.session_id, "sessionId")?;
    super::primitives::external_id(value.request_id, "requestId")?;
    super::primitives::external_id(value.from_artifact_id, "fromArtifactId")?;
    let mut writer = Writer::message(
        READER_ADJACENT_REQUEST_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.session_id);
    writer.u64(value.request_id);
    writer.u64(value.from_artifact_id);
    writer.u32(adjacent_direction(value.direction));
    writer.u32(value.work.max_top_level_nodes_per_quantum);
    writer.u32(value.work.max_foreground_quanta);
    writer.u32(value.work.local_page_cap);
    writer.finish_message()
}

pub(super) fn foreground_handoff(
    value: &ReaderForegroundHandoffV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.session_id, "sessionId")?;
    validate_optional_external_id(
        value.expected_visible_artifact_id,
        "expectedVisibleArtifactId",
    )?;
    super::primitives::external_id(value.candidate_artifact_id, "candidateArtifactId")?;
    let mut writer = Writer::message(
        READER_FOREGROUND_HANDOFF_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.session_id);
    optional_external_id(&mut writer, value.expected_visible_artifact_id);
    writer.u64(value.candidate_artifact_id);
    writer.finish_message()
}

pub(super) fn foreground_handoff_ack(
    value: &ReaderForegroundHandoffAckV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.intent_request_id, "intentRequestId")?;
    validate_optional_external_id(value.replaced_artifact_id, "replacedArtifactId")?;
    super::primitives::external_id(value.visible_artifact_id, "visibleArtifactId")?;
    let mut writer = Writer::message(
        READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.intent_request_id);
    optional_external_id(&mut writer, value.replaced_artifact_id);
    writer.u64(value.visible_artifact_id);
    writer.finish_message()
}

pub(super) fn background_request(
    value: &ReaderBackgroundRequestV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.session_id, "sessionId")?;
    super::primitives::external_id(
        value.expected_visible_artifact_id,
        "expectedVisibleArtifactId",
    )?;
    let mut writer = Writer::message(
        READER_BACKGROUND_REQUEST_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.session_id);
    writer.u64(value.expected_visible_artifact_id);
    writer.u32(value.max_top_level_nodes_per_quantum);
    writer.finish_message()
}

pub(super) fn background_advance(
    value: &ReaderBackgroundAdvanceV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.intent_request_id, "intentRequestId")?;
    super::primitives::external_id(value.replaces_artifact_id, "replacesArtifactId")?;
    let artifact = value
        .artifact
        .as_ref()
        .map(super::encode_reader_artifact_v1)
        .transpose()?;
    let mut writer = Writer::message(
        READER_BACKGROUND_ADVANCE_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u32(background_state(value.state));
    writer.u64(value.intent_request_id);
    writer.u64(value.replaces_artifact_id);
    writer.blob(
        artifact.as_deref().unwrap_or_default(),
        "background artifact",
    )?;
    writer.finish_message()
}

pub(super) fn background_handoff(
    value: &ReaderBackgroundHandoffV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.session_id, "sessionId")?;
    super::primitives::external_id(
        value.expected_visible_artifact_id,
        "expectedVisibleArtifactId",
    )?;
    super::primitives::external_id(value.candidate_artifact_id, "candidateArtifactId")?;
    let mut writer = Writer::message(
        READER_BACKGROUND_HANDOFF_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.session_id);
    writer.u64(value.expected_visible_artifact_id);
    writer.u64(value.candidate_artifact_id);
    writer.finish_message()
}

pub(super) fn background_handoff_ack(
    value: &ReaderBackgroundHandoffAckV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.intent_request_id, "intentRequestId")?;
    super::primitives::external_id(value.replaced_artifact_id, "replacedArtifactId")?;
    super::primitives::external_id(value.visible_artifact_id, "visibleArtifactId")?;
    let mut writer = Writer::message(
        READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.intent_request_id);
    writer.u64(value.replaced_artifact_id);
    writer.u64(value.visible_artifact_id);
    writer.finish_message()
}

pub(super) fn publication(value: &ReaderPublicationV1) -> Result<Vec<u8>, ReaderErrorV1> {
    super::super::publication_info::validate_reader_publication_v1(value)
        .map_err(super::primitives::invalid)?;
    super::primitives::external_id(value.session_id, "sessionId")?;
    let mut writer = Writer::message(READER_PUBLICATION_WIRE_MAGIC_V1, READER_WIRE_VERSION_V1);
    publication::body(&mut writer, value)?;
    let bytes = writer.finish_message()?;
    let byte_length = u64::try_from(bytes.len())
        .map_err(|_| super::primitives::overflow("publication wire byte length"))?;
    if byte_length > READER_PUBLICATION_WIRE_BYTES_MAX_V1 {
        return Err(super::primitives::overflow("publication wire byte limit"));
    }
    Ok(bytes)
}

pub(super) fn search_request(value: &ReaderSearchRequestV1) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.session_id, "sessionId")?;
    super::primitives::external_id(value.artifact_id, "artifactId")?;
    let mut writer = Writer::message(
        super::READER_SEARCH_REQUEST_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.session_id);
    writer.u64(value.artifact_id);
    writer.string(&value.query, "search query")?;
    writer.bool(value.case_sensitive);
    writer.bool(value.whole_word);
    writer.u32(value.limit);
    writer.finish_message()
}

pub(super) fn search_response(value: &ReaderSearchResponseV1) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.artifact_id, "artifactId")?;
    let mut writer = Writer::message(
        super::READER_SEARCH_RESPONSE_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.artifact_id);
    writer.string(&value.query, "search query")?;
    writer.bool(value.truncated);
    writer.count(value.results.len(), "search result count")?;
    for result in &value.results {
        writer.record(|writer| {
            writer.u32(result.page_index);
            writer.u32(result.spread_index);
            text_position(writer, result.start);
            text_position(writer, result.end);
            writer.string(&result.context, "search context")?;
            writer.option(result.locator.as_ref(), locator)
        })?;
    }
    writer.finish_message()
}

pub(super) fn text_range_request(
    value: &ReaderTextRangeRequestV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.session_id, "sessionId")?;
    super::primitives::external_id(value.artifact_id, "artifactId")?;
    let mut writer = Writer::message(
        super::READER_TEXT_RANGE_REQUEST_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.session_id);
    writer.u64(value.artifact_id);
    writer.u32(value.page_index);
    text_position(&mut writer, value.start);
    text_position(&mut writer, value.end);
    writer.finish_message()
}

fn text_position(writer: &mut Writer, value: ReaderTextPositionV1) {
    writer.u32(value.block_index);
    writer.u32(value.line_index);
    writer.u32(value.run_index);
    writer.u32(value.char_index);
}

pub(super) fn text_range_geometry(
    value: &ReaderTextRangeGeometryV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.artifact_id, "artifactId")?;
    let mut writer = Writer::message(
        super::READER_TEXT_RANGE_GEOMETRY_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.artifact_id);
    writer.u32(value.page_index);
    writer.count(value.rects.len(), "text range rect count")?;
    for rect in &value.rects {
        writer.record(|writer| {
            writer.f64(rect.bounds.x, "text rect x")?;
            writer.f64(rect.bounds.y, "text rect y")?;
            writer.f64(rect.bounds.width, "text rect width")?;
            writer.f64(rect.bounds.height, "text rect height")?;
            writer.u32(rect.block_index);
            writer.u32(rect.line_index);
            writer.u32(rect.run_index);
            writer.u32(rect.start_char_index);
            writer.u32(rect.end_char_index);
            Ok(())
        })?;
    }
    writer.finish_message()
}

pub(super) fn footnote(value: &ReaderFootnoteV1) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.artifact_id, "artifactId")?;
    let mut writer = Writer::message(
        super::READER_FOOTNOTE_WIRE_MAGIC_V1,
        READER_WIRE_VERSION_V1,
    );
    writer.u64(value.artifact_id);
    writer.string(&value.key, "footnote key")?;
    writer.u32(footnote_kind(value.kind));
    writer.string(&value.text, "footnote text")?;
    writer.string(&value.html, "footnote html")?;
    writer.finish_message()
}

const fn footnote_kind(value: ReaderFootnoteKindV1) -> u32 {
    match value {
        ReaderFootnoteKindV1::Footnote => 0,
        ReaderFootnoteKindV1::Endnote => 1,
        ReaderFootnoteKindV1::Rearnote => 2,
        ReaderFootnoteKindV1::Note => 3,
    }
}

pub(super) fn resource(value: &ReaderResourceV1) -> Result<Vec<u8>, ReaderErrorV1> {
    super::primitives::external_id(value.artifact_id, "artifactId")?;
    let byte_length = u64::try_from(value.bytes.len())
        .map_err(|_| super::primitives::overflow("resource byte length"))?;
    if byte_length > reader_resource_bytes_max_v1(value.kind) {
        return Err(super::primitives::invalid(
            "resource bytes exceed the resource-kind byte limit",
        ));
    }
    let mut writer = Writer::message(READER_RESOURCE_WIRE_MAGIC_V1, READER_WIRE_VERSION_V1);
    writer.u64(value.artifact_id);
    writer.u32(artifact::resource_kind(value.kind));
    writer.string(&value.href, "resource href")?;
    writer.string(&value.media_type, "resource media type")?;
    writer.blob(&value.bytes, "resource bytes")?;
    writer.option(value.width.as_ref(), |writer, value| {
        writer.u32(*value);
        Ok(())
    })?;
    writer.option(value.height.as_ref(), |writer, value| {
        writer.u32(*value);
        Ok(())
    })?;
    writer.finish_message()
}

fn layout(writer: &mut Writer, value: &ReaderLayoutV1) -> Result<(), ReaderErrorV1> {
    writer.record(|writer| {
        writer.f64(value.viewport_width, "viewport width")?;
        writer.f64(value.viewport_height, "viewport height")?;
        writer.f64(value.margin_top, "top margin")?;
        writer.f64(value.margin_right, "right margin")?;
        writer.f64(value.margin_bottom, "bottom margin")?;
        writer.f64(value.margin_left, "left margin")?;
        writer.u32(spread_mode(value.spread_mode));
        writer.bool(value.first_page_alone);
        writer.f64(value.spread_gap, "spread gap")?;
        writer.f64(value.root_font_size, "root font size")?;
        writer.option(value.line_height_override.as_ref(), |writer, value| {
            writer.f64(*value, "line height override")
        })?;
        writer.option(value.font_family_override.as_ref(), |writer, value| {
            writer.string(value, "font family override")
        })
    })
}

pub(super) fn locator(writer: &mut Writer, value: &ReaderLocatorV1) -> Result<(), ReaderErrorV1> {
    writer.record(|writer| {
        writer.string(&value.href, "locator href")?;
        writer.option(value.anchor_id.as_ref(), |writer, value| {
            writer.string(value, "locator anchor")
        })?;
        writer.option(value.source_point.as_ref(), source_point)?;
        writer.option(value.source_range.as_ref(), source_range)?;
        writer.option(value.progression.as_ref(), |writer, value| {
            writer.f64(*value, "locator progression")
        })
    })
}

fn source_point(writer: &mut Writer, value: &ReaderSourcePointV1) -> Result<(), ReaderErrorV1> {
    writer.record(|writer| {
        writer.count(value.node_path.len(), "source point path count")?;
        for part in &value.node_path {
            writer.u32(*part);
        }
        writer.u64(value.text_offset);
        Ok(())
    })
}

fn source_range(writer: &mut Writer, value: &ReaderSourceRangeV1) -> Result<(), ReaderErrorV1> {
    writer.record(|writer| {
        source_point(writer, &value.start)?;
        source_point(writer, &value.end)
    })
}

fn work_budget(writer: &mut Writer, value: ReaderWorkBudgetV1) -> Result<(), ReaderErrorV1> {
    writer.record(|writer| {
        writer.u32(value.max_top_level_nodes_per_quantum);
        writer.u32(value.max_foreground_quanta);
        writer.u32(value.local_page_cap);
        Ok(())
    })
}

pub(super) const fn spread_mode(value: ReaderSpreadModeV1) -> u32 {
    match value {
        ReaderSpreadModeV1::Single => 0,
        ReaderSpreadModeV1::Double => 1,
    }
}

pub(super) const fn text_profile(value: ReaderTextRenderingProfileV1) -> u32 {
    match value {
        ReaderTextRenderingProfileV1::PlatformStringRuns => 0,
        ReaderTextRenderingProfileV1::PositionedGlyphRuns => 1,
    }
}

const fn adjacent_direction(value: ReaderAdjacentDirectionV1) -> u32 {
    match value {
        ReaderAdjacentDirectionV1::Previous => 0,
        ReaderAdjacentDirectionV1::Next => 1,
    }
}

const fn background_state(value: ReaderBackgroundStateV1) -> u32 {
    match value {
        ReaderBackgroundStateV1::Indexing => 5,
        ReaderBackgroundStateV1::Started => 0,
        ReaderBackgroundStateV1::Advanced => 1,
        ReaderBackgroundStateV1::Reused => 2,
        ReaderBackgroundStateV1::CandidatePending => 3,
        ReaderBackgroundStateV1::Complete => 4,
    }
}

fn validate_optional_external_id(value: Option<u64>, field: &str) -> Result<(), ReaderErrorV1> {
    value
        .map(|value| super::primitives::external_id(value, field))
        .transpose()
        .map(|_| ())
}

fn optional_external_id(writer: &mut Writer, value: Option<u64>) {
    match value {
        Some(value) => {
            writer.u32(1);
            writer.u64(value);
        }
        None => {
            writer.u32(0);
            writer.u64(0);
        }
    }
}
