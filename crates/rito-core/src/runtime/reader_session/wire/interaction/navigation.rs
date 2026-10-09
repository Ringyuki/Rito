//! `RITONVQ1` reading-position questions and their `RITONVR1` answers.

use super::super::{
    decode::{locator as read_locator, source_point as read_source_point},
    encode::{locator as write_locator, source_point as write_source_point},
    primitives::{external_id, invalid, Reader, Writer},
    READER_NAVIGATION_REQUEST_WIRE_MAGIC, READER_NAVIGATION_RESPONSE_WIRE_MAGIC,
    READER_WIRE_VERSION,
};
use super::{from_tag, tag_of, LOCATOR_MATCHES, ORDERINGS};
use crate::runtime::reader_session::{
    ReaderChapterPages, ReaderError, ReaderLocation, ReaderNavigationQuery,
    ReaderNavigationRequest, ReaderNavigationResult, ReaderRevisionLayout, ReaderSpreadPages,
    ReaderTocTargetPage,
};

pub(in crate::runtime::reader_session::wire) fn encode_request(
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
            write_source_point(&mut writer, point)?;
        }
        ReaderNavigationQuery::Locate {
            artifact_id,
            locator,
        } => {
            writer.u8(2);
            writer.u64(external_id(*artifact_id, "artifactId")?);
            write_locator(&mut writer, locator)?;
        }
        ReaderNavigationQuery::Compare {
            first_href,
            first,
            second_href,
            second,
        } => {
            writer.u8(3);
            writer.string(first_href, "first href")?;
            write_source_point(&mut writer, first)?;
            writer.string(second_href, "second href")?;
            write_source_point(&mut writer, second)?;
        }
        ReaderNavigationQuery::Layout { artifact_id } => {
            writer.u8(4);
            writer.u64(external_id(*artifact_id, "artifactId")?);
        }
    }
    writer.finish_message()
}

pub(in crate::runtime::reader_session::wire) fn decode_request(
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
            point: read_source_point(&mut reader)?,
        },
        2 => ReaderNavigationQuery::Locate {
            artifact_id: external_id(reader.u64()?, "artifactId")?,
            locator: read_locator(&mut reader)?,
        },
        3 => ReaderNavigationQuery::Compare {
            first_href: reader.string("first href")?,
            first: read_source_point(&mut reader)?,
            second_href: reader.string("second href")?,
            second: read_source_point(&mut reader)?,
        },
        4 => ReaderNavigationQuery::Layout {
            artifact_id: external_id(reader.u64()?, "artifactId")?,
        },
        tag => return Err(invalid(format!("unknown navigation query tag: {tag}"))),
    };
    reader.finish("navigation request wire message")?;
    Ok(ReaderNavigationRequest { session_id, query })
}

pub(in crate::runtime::reader_session::wire) fn encode_result(
    value: &ReaderNavigationResult,
) -> Result<Vec<u8>, ReaderError> {
    let mut writer = Writer::message(READER_NAVIGATION_RESPONSE_WIRE_MAGIC, READER_WIRE_VERSION);
    match value {
        ReaderNavigationResult::TocEntry(entry) => {
            writer.u8(0);
            write_optional_u32(&mut writer, *entry)?;
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
        ReaderNavigationResult::Layout(layout) => {
            writer.u8(3);
            write_layout(&mut writer, layout)?;
        }
    }
    writer.finish_message()
}

pub(in crate::runtime::reader_session::wire) fn decode_result(
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
        3 => ReaderNavigationResult::Layout(read_layout(&mut reader)?),
        tag => return Err(invalid(format!("unknown navigation result tag: {tag}"))),
    };
    reader.finish("navigation response wire message")?;
    Ok(result)
}

fn write_layout(writer: &mut Writer, value: &ReaderRevisionLayout) -> Result<(), ReaderError> {
    writer.u32(value.page_count);
    writer.count(value.spreads.len(), "layout spread count")?;
    for spread in &value.spreads {
        writer.u32(spread.left_page_index);
        write_optional_u32(writer, spread.right_page_index)?;
    }
    writer.count(value.chapters.len(), "layout chapter count")?;
    for chapter in &value.chapters {
        writer.u32(chapter.spine_index);
        writer.u32(chapter.start_page);
        writer.u32(chapter.end_page);
    }
    writer.count(value.toc_targets.len(), "layout toc target count")?;
    for target in &value.toc_targets {
        writer.u32(target.toc_id);
        writer.u32(target.page_index);
    }
    writer.count(
        value.active_toc_entry_by_page.len(),
        "layout page toc entry count",
    )?;
    for entry in &value.active_toc_entry_by_page {
        write_optional_u32(writer, *entry)?;
    }
    Ok(())
}

fn read_layout(reader: &mut Reader<'_>) -> Result<ReaderRevisionLayout, ReaderError> {
    Ok(ReaderRevisionLayout {
        page_count: reader.u32()?,
        spreads: reader.collection("layout spreads", |reader| {
            Ok(ReaderSpreadPages {
                left_page_index: reader.u32()?,
                right_page_index: reader.option("spread right page", Reader::u32)?,
            })
        })?,
        chapters: reader.collection("layout chapters", |reader| {
            Ok(ReaderChapterPages {
                spine_index: reader.u32()?,
                start_page: reader.u32()?,
                end_page: reader.u32()?,
            })
        })?,
        toc_targets: reader.collection("layout toc targets", |reader| {
            Ok(ReaderTocTargetPage {
                toc_id: reader.u32()?,
                page_index: reader.u32()?,
            })
        })?,
        active_toc_entry_by_page: reader.collection("layout page toc entries", |reader| {
            reader.option("page toc entry", Reader::u32)
        })?,
    })
}

fn write_optional_u32(writer: &mut Writer, value: Option<u32>) -> Result<(), ReaderError> {
    writer.option(value.as_ref(), |writer, value| {
        writer.u32(*value);
        Ok(())
    })
}
