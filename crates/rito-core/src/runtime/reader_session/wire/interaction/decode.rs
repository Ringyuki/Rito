use super::super::{
    decode::{locator, source_point, source_range},
    primitives::{external_id, Reader},
    READER_ANNOTATION_REQUEST_WIRE_MAGIC, READER_ANNOTATION_RESPONSE_WIRE_MAGIC,
    READER_NAVIGATION_REQUEST_WIRE_MAGIC, READER_NAVIGATION_RESPONSE_WIRE_MAGIC,
    READER_TEXT_INTERACTION_REQUEST_WIRE_MAGIC, READER_TEXT_INTERACTION_RESPONSE_WIRE_MAGIC,
    READER_WIRE_VERSION,
};
use super::{
    from_tag, AFFINITIES, ANNOTATION_LEVELS, BOUNDARIES, GRANULARITIES, LOCATOR_MATCHES, MOVEMENTS,
    ORDERINGS, UNAVAILABLE_REASONS,
};
use crate::runtime::reader_session::{
    wire::primitives::invalid, ReaderAnnotationQuery, ReaderAnnotationRequest,
    ReaderAnnotationResponse, ReaderAnnotationTarget, ReaderCaret, ReaderCaretAddress,
    ReaderCaretGeometry, ReaderError, ReaderExactSourceRect, ReaderLocation, ReaderNavigationQuery,
    ReaderNavigationRequest, ReaderNavigationResult, ReaderRect, ReaderSelectionResult,
    ReaderTextInteractionQuery, ReaderTextInteractionRequest, ReaderTextInteractionResponse,
    ReaderTextInteractionResult, ReaderTextPoint, ReaderTextPosition, ReaderTextSelection,
};

pub(in crate::runtime::reader_session::wire) fn text_interaction_request(
    bytes: &[u8],
) -> Result<ReaderTextInteractionRequest, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_TEXT_INTERACTION_REQUEST_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let session_id = external_id(reader.u64()?, "sessionId")?;
    let artifact_id = external_id(reader.u64()?, "artifactId")?;
    let query = match reader.u8()? {
        0 => ReaderTextInteractionQuery::Caret {
            point: point(&mut reader)?,
        },
        1 => ReaderTextInteractionQuery::Range {
            anchor: address(&mut reader)?,
            focus: address(&mut reader)?,
        },
        2 => ReaderTextInteractionQuery::RangeToPoint {
            anchor: address(&mut reader)?,
            focus: point(&mut reader)?,
        },
        3 => ReaderTextInteractionQuery::RangeFromPoints {
            anchor: point(&mut reader)?,
            focus: point(&mut reader)?,
            granularity: from_tag(&GRANULARITIES, reader.u8()?, "selection granularity")?,
        },
        4 => {
            let anchor = address(&mut reader)?;
            let focus = address(&mut reader)?;
            let movement = from_tag(&MOVEMENTS, reader.u8()?, "selection movement")?;
            let (preferred_inline_position, preferred_block_position) = preferred(&mut reader)?;
            ReaderTextInteractionQuery::Movement {
                anchor,
                focus,
                movement,
                preferred_inline_position,
                preferred_block_position,
            }
        }
        tag => {
            return Err(invalid(format!(
                "unknown text interaction query tag: {tag}"
            )))
        }
    };
    reader.finish("text interaction request wire message")?;
    Ok(ReaderTextInteractionRequest {
        session_id,
        artifact_id,
        query,
    })
}

pub(in crate::runtime::reader_session::wire) fn text_interaction_response(
    bytes: &[u8],
) -> Result<ReaderTextInteractionResponse, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_TEXT_INTERACTION_RESPONSE_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let artifact_id = external_id(reader.u64()?, "artifactId")?;
    let result = match reader.u8()? {
        0 => ReaderTextInteractionResult::Caret(caret(&mut reader)?),
        1 => {
            let anchor_caret = reader.option("anchor caret", caret)?;
            let focus_caret = reader.option("focus caret", caret)?;
            let selection = selection(&mut reader)?;
            let (preferred_inline_position, preferred_block_position) = preferred(&mut reader)?;
            ReaderTextInteractionResult::Selection(Box::new(ReaderSelectionResult {
                anchor_caret,
                focus_caret,
                selection,
                preferred_inline_position,
                preferred_block_position,
            }))
        }
        2 => ReaderTextInteractionResult::Miss,
        3 => ReaderTextInteractionResult::Boundary(from_tag(
            &BOUNDARIES,
            reader.u8()?,
            "selection boundary",
        )?),
        4 => ReaderTextInteractionResult::Pending(from_tag(
            &BOUNDARIES,
            reader.u8()?,
            "selection boundary",
        )?),
        5 => ReaderTextInteractionResult::Unavailable(from_tag(
            &UNAVAILABLE_REASONS,
            reader.u8()?,
            "text interaction unavailable reason",
        )?),
        tag => {
            return Err(invalid(format!(
                "unknown text interaction result tag: {tag}"
            )))
        }
    };
    reader.finish("text interaction response wire message")?;
    Ok(ReaderTextInteractionResponse {
        artifact_id,
        result,
    })
}

pub(in crate::runtime::reader_session::wire) fn annotation_request(
    bytes: &[u8],
) -> Result<ReaderAnnotationRequest, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_ANNOTATION_REQUEST_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let session_id = external_id(reader.u64()?, "sessionId")?;
    let query = match reader.u8()? {
        0 => ReaderAnnotationQuery::Create {
            href: reader.string("annotation href")?,
            range: source_range(&mut reader)?,
        },
        1 => ReaderAnnotationQuery::Resolve {
            target_json: reader.string("annotation target")?,
        },
        tag => return Err(invalid(format!("unknown annotation query tag: {tag}"))),
    };
    reader.finish("annotation request wire message")?;
    Ok(ReaderAnnotationRequest { session_id, query })
}

pub(in crate::runtime::reader_session::wire) fn annotation_response(
    bytes: &[u8],
) -> Result<ReaderAnnotationResponse, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_ANNOTATION_RESPONSE_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let response = ReaderAnnotationResponse {
        level: from_tag(&ANNOTATION_LEVELS, reader.u8()?, "annotation level")?,
        target: reader.option("annotation target", |reader| {
            reader.record("annotation target", |reader| {
                Ok(ReaderAnnotationTarget {
                    json: reader.string("annotation target")?,
                    href: reader.string("annotation href")?,
                    range: source_range(reader)?,
                    exact: reader.string("annotation exact")?,
                    prefix: reader.string("annotation prefix")?,
                    suffix: reader.string("annotation suffix")?,
                    start: reader.u64()?,
                    end: reader.u64()?,
                    chapter_length: reader.u64()?,
                })
            })
        })?,
    };
    reader.finish("annotation response wire message")?;
    Ok(response)
}

pub(in crate::runtime::reader_session::wire) fn navigation_request(
    bytes: &[u8],
) -> Result<ReaderNavigationRequest, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_NAVIGATION_REQUEST_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let session_id = external_id(reader.u64()?, "sessionId")?;
    let query = match reader.u8()? {
        0 => ReaderNavigationQuery::TocEntryAtPage {
            artifact_id: external_id(reader.u64()?, "artifactId")?,
            page_index: reader.u32()?,
        },
        1 => ReaderNavigationQuery::TocEntryAtPosition {
            href: reader.string("position href")?,
            point: source_point(&mut reader)?,
        },
        2 => ReaderNavigationQuery::Locate {
            artifact_id: external_id(reader.u64()?, "artifactId")?,
            locator: locator(&mut reader)?,
        },
        3 => ReaderNavigationQuery::Compare {
            first_href: reader.string("first href")?,
            first: source_point(&mut reader)?,
            second_href: reader.string("second href")?,
            second: source_point(&mut reader)?,
        },
        tag => return Err(invalid(format!("unknown navigation query tag: {tag}"))),
    };
    reader.finish("navigation request wire message")?;
    Ok(ReaderNavigationRequest { session_id, query })
}

pub(in crate::runtime::reader_session::wire) fn navigation_result(
    bytes: &[u8],
) -> Result<ReaderNavigationResult, ReaderError> {
    let mut reader = Reader::message(
        bytes,
        READER_NAVIGATION_RESPONSE_WIRE_MAGIC,
        READER_WIRE_VERSION,
    )?;
    let result = match reader.u8()? {
        0 => ReaderNavigationResult::TocEntry(reader.option("toc entry", Reader::u32)?),
        1 => ReaderNavigationResult::Location(match reader.u8()? {
            0 => ReaderLocation::Page {
                page_index: reader.u32()?,
                drawn: reader.bool("page drawn")?,
                matched_by: from_tag(&LOCATOR_MATCHES, reader.u8()?, "locator match")?,
            },
            1 => ReaderLocation::NotLaidOut,
            2 => ReaderLocation::Unavailable,
            tag => return Err(invalid(format!("unknown location tag: {tag}"))),
        }),
        2 => ReaderNavigationResult::Order(from_tag(&ORDERINGS, reader.u8()?, "order")?),
        tag => return Err(invalid(format!("unknown navigation result tag: {tag}"))),
    };
    reader.finish("navigation response wire message")?;
    Ok(result)
}

fn point(reader: &mut Reader<'_>) -> Result<ReaderTextPoint, ReaderError> {
    reader.record("text point", |reader| {
        Ok(ReaderTextPoint {
            page_index: reader.u32()?,
            x: reader.f64("text point x")?,
            y: reader.f64("text point y")?,
        })
    })
}

fn address(reader: &mut Reader<'_>) -> Result<ReaderCaretAddress, ReaderError> {
    reader.record("caret address", |reader| {
        Ok(ReaderCaretAddress {
            page_index: reader.u32()?,
            position: ReaderTextPosition {
                block_index: reader.u32()?,
                line_index: reader.u32()?,
                run_index: reader.u32()?,
                char_index: reader.u32()?,
            },
            affinity: from_tag(&AFFINITIES, reader.u8()?, "caret affinity")?,
        })
    })
}

fn caret(reader: &mut Reader<'_>) -> Result<ReaderCaret, ReaderError> {
    reader.record("caret", |reader| {
        Ok(ReaderCaret {
            address: address(reader)?,
            geometry: reader.option("caret geometry", |reader| {
                Ok(ReaderCaretGeometry {
                    x: reader.f64("caret x")?,
                    y: reader.f64("caret y")?,
                    height: reader.f64("caret height")?,
                })
            })?,
            href: reader.string("caret href")?,
            source_point: source_point(reader)?,
        })
    })
}

fn selection(reader: &mut Reader<'_>) -> Result<ReaderTextSelection, ReaderError> {
    reader.record("selection", |reader| {
        Ok(ReaderTextSelection {
            anchor: address(reader)?,
            focus: address(reader)?,
            start: address(reader)?,
            end: address(reader)?,
            selected_text: reader.string("selected text")?,
            source_start_href: reader.string("selection start href")?,
            source_start: source_point(reader)?,
            source_end_href: reader.string("selection end href")?,
            source_end: source_point(reader)?,
            rects: reader.collection("selection rects", |reader| {
                reader.record("selection rect", |reader| {
                    Ok(ReaderExactSourceRect {
                        page_index: reader.u32()?,
                        bounds: ReaderRect {
                            x: reader.f64("selection rect x")?,
                            y: reader.f64("selection rect y")?,
                            width: reader.f64("selection rect width")?,
                            height: reader.f64("selection rect height")?,
                        },
                        block_index: reader.u32()?,
                        line_index: reader.u32()?,
                        run_index: reader.u32()?,
                        start_char_index: reader.u32()?,
                        end_char_index: reader.u32()?,
                    })
                })
            })?,
        })
    })
}

fn preferred(reader: &mut Reader<'_>) -> Result<(Option<f64>, Option<f64>), ReaderError> {
    Ok((
        reader.option("preferred inline position", |reader| {
            reader.f64("preferred inline position")
        })?,
        reader.option("preferred block position", |reader| {
            reader.f64("preferred block position")
        })?,
    ))
}
