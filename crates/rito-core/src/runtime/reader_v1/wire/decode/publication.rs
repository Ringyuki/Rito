use crate::runtime::reader_v1::{
    ReaderErrorV1, ReaderPublicationMetadataV1, ReaderPublicationSpineItemV1,
    ReaderPublicationTocEntryV1, ReaderPublicationTocTargetV1, ReaderPublicationV1,
    READER_PROTOCOL_VERSION_V1, READER_PUBLICATION_TOC_DEPTH_MAX_V1,
    READER_PUBLICATION_TOC_ITEM_MAX_V1,
};

use super::super::primitives::{invalid, Reader};

const INITIAL_TOC_CAPACITY: usize = 4_096;

pub(super) fn body(reader: &mut Reader<'_>) -> Result<ReaderPublicationV1, ReaderErrorV1> {
    let protocol_version = reader.u32()?;
    if protocol_version != READER_PROTOCOL_VERSION_V1 {
        return Err(invalid(format!(
            "unsupported publication protocol version: {protocol_version}"
        )));
    }
    let session_id = super::external_id(reader.u64()?, "sessionId")?;
    let metadata = metadata(reader)?;
    let spine = reader.collection("publication spine", spine_item)?;
    let mut toc_item_count = 0u32;
    let toc = toc_entries(reader, 1, &mut toc_item_count)?;
    Ok(ReaderPublicationV1 {
        protocol_version,
        session_id,
        metadata,
        spine,
        toc,
    })
}

fn metadata(reader: &mut Reader<'_>) -> Result<ReaderPublicationMetadataV1, ReaderErrorV1> {
    reader.record("publication metadata", |reader| {
        Ok(ReaderPublicationMetadataV1 {
            title: reader.string("publication title")?,
            language: reader.string("publication language")?,
            identifier: reader.string("publication identifier")?,
            creator: reader.option("publication creator", |reader| {
                reader.string("publication creator")
            })?,
        })
    })
}

fn spine_item(reader: &mut Reader<'_>) -> Result<ReaderPublicationSpineItemV1, ReaderErrorV1> {
    reader.record("publication spine item", |reader| {
        Ok(ReaderPublicationSpineItemV1 {
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
) -> Result<Vec<ReaderPublicationTocEntryV1>, ReaderErrorV1> {
    let count = reader.count("publication TOC child count")?;
    if depth > READER_PUBLICATION_TOC_DEPTH_MAX_V1 && count != 0 {
        return Err(invalid("publication TOC exceeds the depth limit"));
    }
    let next_count = item_count
        .checked_add(count)
        .ok_or_else(|| invalid("publication TOC item count overflow"))?;
    if next_count > READER_PUBLICATION_TOC_ITEM_MAX_V1 {
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
) -> Result<ReaderPublicationTocEntryV1, ReaderErrorV1> {
    reader.record("publication TOC entry", |reader| {
        Ok(ReaderPublicationTocEntryV1 {
            toc_id: reader.u32()?,
            label: reader.string("publication TOC label")?,
            target: toc_target(reader)?,
            children: toc_entries(reader, depth.saturating_add(1), item_count)?,
        })
    })
}

fn toc_target(reader: &mut Reader<'_>) -> Result<ReaderPublicationTocTargetV1, ReaderErrorV1> {
    match reader.u8()? {
        0 => Ok(ReaderPublicationTocTargetV1::Locator {
            spine_index: reader.u32()?,
            locator: super::locator(reader)?,
        }),
        1 => Ok(ReaderPublicationTocTargetV1::External {
            href: reader.string("publication external TOC href")?,
        }),
        2 => Ok(ReaderPublicationTocTargetV1::Unresolved {
            href: reader.string("publication unresolved TOC href")?,
        }),
        tag => Err(invalid(format!(
            "unknown publication TOC target tag: {tag}"
        ))),
    }
}
