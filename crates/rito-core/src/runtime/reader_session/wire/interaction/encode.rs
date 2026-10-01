use super::super::{
    encode::{locator, source_point, source_range},
    primitives::{external_id, Writer},
    READER_ANNOTATION_REQUEST_WIRE_MAGIC, READER_ANNOTATION_RESPONSE_WIRE_MAGIC,
    READER_NAVIGATION_REQUEST_WIRE_MAGIC, READER_NAVIGATION_RESPONSE_WIRE_MAGIC,
    READER_TEXT_INTERACTION_REQUEST_WIRE_MAGIC, READER_TEXT_INTERACTION_RESPONSE_WIRE_MAGIC,
    READER_WIRE_VERSION,
};
use super::{
    tag_of, AFFINITIES, ANNOTATION_LEVELS, BOUNDARIES, GRANULARITIES, LOCATOR_MATCHES, MOVEMENTS,
    ORDERINGS, UNAVAILABLE_REASONS,
};
use crate::runtime::reader_session::{
    ReaderAnnotationQuery, ReaderAnnotationRequest, ReaderAnnotationResponse, ReaderCaret,
    ReaderCaretAddress, ReaderError, ReaderLocation, ReaderNavigationQuery,
    ReaderNavigationRequest, ReaderNavigationResult, ReaderTextInteractionQuery,
    ReaderTextInteractionRequest, ReaderTextInteractionResponse, ReaderTextInteractionResult,
    ReaderTextPoint, ReaderTextSelection,
};

pub(in crate::runtime::reader_session::wire) fn text_interaction_request(
    value: &ReaderTextInteractionRequest,
) -> Result<Vec<u8>, ReaderError> {
    external_id(value.session_id, "sessionId")?;
    external_id(value.artifact_id, "artifactId")?;
    let mut writer = Writer::message(
        READER_TEXT_INTERACTION_REQUEST_WIRE_MAGIC,
        READER_WIRE_VERSION,
    );
    writer.u64(value.session_id);
    writer.u64(value.artifact_id);
    match value.query {
        ReaderTextInteractionQuery::Caret { point: at } => {
            writer.u8(0);
            point(&mut writer, at)?;
        }
        ReaderTextInteractionQuery::Range { anchor, focus } => {
            writer.u8(1);
            address(&mut writer, anchor)?;
            address(&mut writer, focus)?;
        }
        ReaderTextInteractionQuery::RangeToPoint { anchor, focus } => {
            writer.u8(2);
            address(&mut writer, anchor)?;
            point(&mut writer, focus)?;
        }
        ReaderTextInteractionQuery::RangeFromPoints {
            anchor,
            focus,
            granularity,
        } => {
            writer.u8(3);
            point(&mut writer, anchor)?;
            point(&mut writer, focus)?;
            writer.u8(tag_of(&GRANULARITIES, &granularity));
        }
        ReaderTextInteractionQuery::Movement {
            anchor,
            focus,
            movement,
            preferred_inline_position,
            preferred_block_position,
        } => {
            writer.u8(4);
            address(&mut writer, anchor)?;
            address(&mut writer, focus)?;
            writer.u8(tag_of(&MOVEMENTS, &movement));
            preferred(
                &mut writer,
                preferred_inline_position,
                preferred_block_position,
            )?;
        }
    }
    writer.finish_message()
}

pub(in crate::runtime::reader_session::wire) fn text_interaction_response(
    value: &ReaderTextInteractionResponse,
) -> Result<Vec<u8>, ReaderError> {
    external_id(value.artifact_id, "artifactId")?;
    let mut writer = Writer::message(
        READER_TEXT_INTERACTION_RESPONSE_WIRE_MAGIC,
        READER_WIRE_VERSION,
    );
    writer.u64(value.artifact_id);
    match &value.result {
        ReaderTextInteractionResult::Caret(value) => {
            writer.u8(0);
            caret(&mut writer, value)?;
        }
        ReaderTextInteractionResult::Selection(value) => {
            writer.u8(1);
            writer.option(value.anchor_caret.as_ref(), caret)?;
            writer.option(value.focus_caret.as_ref(), caret)?;
            selection(&mut writer, &value.selection)?;
            preferred(
                &mut writer,
                value.preferred_inline_position,
                value.preferred_block_position,
            )?;
        }
        ReaderTextInteractionResult::Miss => writer.u8(2),
        ReaderTextInteractionResult::Boundary(boundary) => {
            writer.u8(3);
            writer.u8(tag_of(&BOUNDARIES, boundary));
        }
        ReaderTextInteractionResult::Pending(boundary) => {
            writer.u8(4);
            writer.u8(tag_of(&BOUNDARIES, boundary));
        }
        ReaderTextInteractionResult::Unavailable(reason) => {
            writer.u8(5);
            writer.u8(tag_of(&UNAVAILABLE_REASONS, reason));
        }
    }
    writer.finish_message()
}

pub(in crate::runtime::reader_session::wire) fn annotation_request(
    value: &ReaderAnnotationRequest,
) -> Result<Vec<u8>, ReaderError> {
    external_id(value.session_id, "sessionId")?;
    let mut writer = Writer::message(READER_ANNOTATION_REQUEST_WIRE_MAGIC, READER_WIRE_VERSION);
    writer.u64(value.session_id);
    match &value.query {
        ReaderAnnotationQuery::Create { href, range } => {
            writer.u8(0);
            writer.string(href, "annotation href")?;
            source_range(&mut writer, range)?;
        }
        ReaderAnnotationQuery::Resolve { target_json } => {
            writer.u8(1);
            writer.string(target_json, "annotation target")?;
        }
    }
    writer.finish_message()
}

pub(in crate::runtime::reader_session::wire) fn annotation_response(
    value: &ReaderAnnotationResponse,
) -> Result<Vec<u8>, ReaderError> {
    let mut writer = Writer::message(READER_ANNOTATION_RESPONSE_WIRE_MAGIC, READER_WIRE_VERSION);
    writer.u8(tag_of(&ANNOTATION_LEVELS, &value.level));
    writer.option(value.target.as_ref(), |writer, target| {
        writer.record(|writer| {
            writer.string(&target.json, "annotation target")?;
            writer.string(&target.href, "annotation href")?;
            source_range(writer, &target.range)?;
            writer.string(&target.exact, "annotation exact")?;
            writer.string(&target.prefix, "annotation prefix")?;
            writer.string(&target.suffix, "annotation suffix")?;
            writer.u64(target.start);
            writer.u64(target.end);
            writer.u64(target.chapter_length);
            Ok(())
        })
    })?;
    writer.finish_message()
}

pub(in crate::runtime::reader_session::wire) fn navigation_request(
    value: &ReaderNavigationRequest,
) -> Result<Vec<u8>, ReaderError> {
    external_id(value.session_id, "sessionId")?;
    let mut writer = Writer::message(READER_NAVIGATION_REQUEST_WIRE_MAGIC, READER_WIRE_VERSION);
    writer.u64(value.session_id);
    match &value.query {
        ReaderNavigationQuery::TocEntryAtPage {
            artifact_id,
            page_index,
        } => {
            writer.u8(0);
            writer.u64(external_id(*artifact_id, "artifactId")?);
            writer.u32(*page_index);
        }
        ReaderNavigationQuery::TocEntryAtPosition { href, point } => {
            writer.u8(1);
            writer.string(href, "position href")?;
            source_point(&mut writer, point)?;
        }
        ReaderNavigationQuery::Locate {
            artifact_id,
            locator: value,
        } => {
            writer.u8(2);
            writer.u64(external_id(*artifact_id, "artifactId")?);
            locator(&mut writer, value)?;
        }
        ReaderNavigationQuery::Compare {
            first_href,
            first,
            second_href,
            second,
        } => {
            writer.u8(3);
            writer.string(first_href, "first href")?;
            source_point(&mut writer, first)?;
            writer.string(second_href, "second href")?;
            source_point(&mut writer, second)?;
        }
    }
    writer.finish_message()
}

pub(in crate::runtime::reader_session::wire) fn navigation_result(
    value: &ReaderNavigationResult,
) -> Result<Vec<u8>, ReaderError> {
    let mut writer = Writer::message(READER_NAVIGATION_RESPONSE_WIRE_MAGIC, READER_WIRE_VERSION);
    match value {
        ReaderNavigationResult::TocEntry(entry) => {
            writer.u8(0);
            writer.option(entry.as_ref(), |writer, entry| {
                writer.u32(*entry);
                Ok(())
            })?;
        }
        ReaderNavigationResult::Location(location) => {
            writer.u8(1);
            match location {
                ReaderLocation::Page {
                    page_index,
                    drawn,
                    matched_by,
                } => {
                    writer.u8(0);
                    writer.u32(*page_index);
                    writer.bool(*drawn);
                    writer.u8(tag_of(&LOCATOR_MATCHES, matched_by));
                }
                ReaderLocation::NotLaidOut => writer.u8(1),
                ReaderLocation::Unavailable => writer.u8(2),
            }
        }
        ReaderNavigationResult::Order(order) => {
            writer.u8(2);
            writer.u8(tag_of(&ORDERINGS, order));
        }
    }
    writer.finish_message()
}

fn point(writer: &mut Writer, value: ReaderTextPoint) -> Result<(), ReaderError> {
    writer.record(|writer| {
        writer.u32(value.page_index);
        writer.f64(value.x, "text point x")?;
        writer.f64(value.y, "text point y")
    })
}

fn address(writer: &mut Writer, value: ReaderCaretAddress) -> Result<(), ReaderError> {
    writer.record(|writer| {
        writer.u32(value.page_index);
        writer.u32(value.position.block_index);
        writer.u32(value.position.line_index);
        writer.u32(value.position.run_index);
        writer.u32(value.position.char_index);
        writer.u8(tag_of(&AFFINITIES, &value.affinity));
        Ok(())
    })
}

fn caret(writer: &mut Writer, value: &ReaderCaret) -> Result<(), ReaderError> {
    writer.record(|writer| {
        address(writer, value.address)?;
        writer.option(value.geometry.as_ref(), |writer, geometry| {
            writer.f64(geometry.x, "caret x")?;
            writer.f64(geometry.y, "caret y")?;
            writer.f64(geometry.height, "caret height")
        })?;
        writer.string(&value.href, "caret href")?;
        source_point(writer, &value.source_point)
    })
}

fn selection(writer: &mut Writer, value: &ReaderTextSelection) -> Result<(), ReaderError> {
    writer.record(|writer| {
        for endpoint in [value.anchor, value.focus, value.start, value.end] {
            address(writer, endpoint)?;
        }
        writer.string(&value.selected_text, "selected text")?;
        writer.string(&value.source_start_href, "selection start href")?;
        source_point(writer, &value.source_start)?;
        writer.string(&value.source_end_href, "selection end href")?;
        source_point(writer, &value.source_end)?;
        writer.count(value.rects.len(), "selection rect count")?;
        for rect in &value.rects {
            writer.record(|writer| {
                writer.u32(rect.page_index);
                writer.f64(rect.bounds.x, "selection rect x")?;
                writer.f64(rect.bounds.y, "selection rect y")?;
                writer.f64(rect.bounds.width, "selection rect width")?;
                writer.f64(rect.bounds.height, "selection rect height")?;
                writer.u32(rect.block_index);
                writer.u32(rect.line_index);
                writer.u32(rect.run_index);
                writer.u32(rect.start_char_index);
                writer.u32(rect.end_char_index);
                Ok(())
            })?;
        }
        Ok(())
    })
}

fn preferred(
    writer: &mut Writer,
    inline: Option<f64>,
    block: Option<f64>,
) -> Result<(), ReaderError> {
    writer.option(inline.as_ref(), |writer, value| {
        writer.f64(*value, "preferred inline position")
    })?;
    writer.option(block.as_ref(), |writer, value| {
        writer.f64(*value, "preferred block position")
    })
}
