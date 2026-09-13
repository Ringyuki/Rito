use crate::runtime::reader_session::{
    ReaderError, ReaderPublication, ReaderPublicationMetadata, ReaderPublicationSpineItem,
    ReaderPublicationTocEntry, ReaderPublicationTocTarget, READER_PROTOCOL_VERSION,
    READER_PUBLICATION_TOC_DEPTH_MAX, READER_PUBLICATION_TOC_ITEM_MAX,
};

use super::super::primitives::{invalid, Reader};

const INITIAL_TOC_CAPACITY: usize = 4_096;

pub(super) fn body(reader: &mut Reader<'_>) -> Result<ReaderPublication, ReaderError> {
    let protocol_version = reader.u32()?;
    if protocol_version != READER_PROTOCOL_VERSION {
        return Err(invalid(format!(
            "unsupported publication protocol version: {protocol_version}"
        )));
    }
    let session_id = super::external_id(reader.u64()?, "sessionId")?;
    let metadata = metadata(reader)?;
    let spine = reader.collection("publication spine", spine_item)?;
    let mut toc_item_count = 0u32;
    let toc = toc_entries(reader, 1, &mut toc_item_count)?;
    Ok(ReaderPublication {
        protocol_version,
        session_id,
        metadata,
        spine,
        toc,
    })
}

fn metadata(reader: &mut Reader<'_>) -> Result<ReaderPublicationMetadata, ReaderError> {
    reader.record("publication metadata", |reader| {
        Ok(ReaderPublicationMetadata {
            title: reader.string("publication title")?,
            language: reader.string("publication language")?,
            identifier: reader.string("publication identifier")?,
            creator: reader.option("publication creator", |reader| {
                reader.string("publication creator")
            })?,
        })
    })
}

fn spine_item(reader: &mut Reader<'_>) -> Result<ReaderPublicationSpineItem, ReaderError> {
    reader.record("publication spine item", |reader| {
        Ok(ReaderPublicationSpineItem {
            spine_index: reader.u32()?,
            linear_index: reader.option("publication linear index", Reader::u32)?,
            idref: reader.string("publication spine idref")?,
            href: reader.string("publication spine href")?,
        })
    })
}

fn toc_entries(
    reader: &mut Reader<'_>,
    depth: u32,
    item_count: &mut u32,
) -> Result<Vec<ReaderPublicationTocEntry>, ReaderError> {
    let count = reader.count("publication TOC child count")?;
    if depth > READER_PUBLICATION_TOC_DEPTH_MAX && count != 0 {
        return Err(invalid("publication TOC exceeds the depth limit"));
    }
    let next_count = item_count
        .checked_add(count)
        .ok_or_else(|| invalid("publication TOC item count overflow"))?;
    if next_count > READER_PUBLICATION_TOC_ITEM_MAX {
        return Err(invalid("publication TOC exceeds the item limit"));
    }
    *item_count = next_count;
    let initial = usize::try_from(count)
        .unwrap_or(INITIAL_TOC_CAPACITY)
        .min(INITIAL_TOC_CAPACITY);
    let mut entries = Vec::with_capacity(initial);
    for _ in 0..count {
        entries.push(toc_entry(reader, depth, item_count)?);
    }
    Ok(entries)
}

fn toc_entry(
    reader: &mut Reader<'_>,
    depth: u32,
    item_count: &mut u32,
) -> Result<ReaderPublicationTocEntry, ReaderError> {
    reader.record("publication TOC entry", |reader| {
        Ok(ReaderPublicationTocEntry {
            toc_id: reader.u32()?,
            label: reader.string("publication TOC label")?,
            target: toc_target(reader)?,
            children: toc_entries(reader, depth.saturating_add(1), item_count)?,
        })
    })
}

fn toc_target(reader: &mut Reader<'_>) -> Result<ReaderPublicationTocTarget, ReaderError> {
    match reader.u8()? {
        0 => Ok(ReaderPublicationTocTarget::Locator {
            spine_index: reader.u32()?,
            locator: super::locator(reader)?,
        }),
        1 => Ok(ReaderPublicationTocTarget::External {
            href: reader.string("publication external TOC href")?,
        }),
        2 => Ok(ReaderPublicationTocTarget::Unresolved {
            href: reader.string("publication unresolved TOC href")?,
        }),
        tag => Err(invalid(format!(
            "unknown publication TOC target tag: {tag}"
        ))),
    }
}
