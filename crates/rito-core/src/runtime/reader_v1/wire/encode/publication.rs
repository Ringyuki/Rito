use crate::runtime::reader_v1::{
    ReaderErrorV1, ReaderPublicationMetadataV1, ReaderPublicationSpineItemV1,
    ReaderPublicationTocEntryV1, ReaderPublicationTocTargetV1, ReaderPublicationV1,
};

use super::super::primitives::Writer;

pub(super) fn body(writer: &mut Writer, value: &ReaderPublicationV1) -> Result<(), ReaderErrorV1> {
    writer.u32(value.protocol_version);
    writer.u64(value.session_id);
    metadata(writer, &value.metadata)?;
    writer.count(value.spine.len(), "publication spine count")?;
    for item in &value.spine {
        spine_item(writer, item)?;
    }
    toc_entries(writer, &value.toc)
}

fn metadata(writer: &mut Writer, value: &ReaderPublicationMetadataV1) -> Result<(), ReaderErrorV1> {
    writer.record(|writer| {
        writer.string(&value.title, "publication title")?;
        writer.string(&value.language, "publication language")?;
        writer.string(&value.identifier, "publication identifier")?;
        writer.option(value.creator.as_ref(), |writer, creator| {
            writer.string(creator, "publication creator")
        })
    })
}

fn spine_item(
    writer: &mut Writer,
    value: &ReaderPublicationSpineItemV1,
) -> Result<(), ReaderErrorV1> {
    writer.record(|writer| {
        writer.u32(value.spine_index);
        writer.option(value.linear_index.as_ref(), |writer, linear_index| {
            writer.u32(*linear_index);
            Ok(())
        })?;
        writer.string(&value.idref, "publication spine idref")?;
        writer.string(&value.href, "publication spine href")
    })
}

fn toc_entries(
    writer: &mut Writer,
    entries: &[ReaderPublicationTocEntryV1],
) -> Result<(), ReaderErrorV1> {
    writer.count(entries.len(), "publication TOC child count")?;
    for entry in entries {
        toc_entry(writer, entry)?;
    }
    Ok(())
}

fn toc_entry(
    writer: &mut Writer,
    value: &ReaderPublicationTocEntryV1,
) -> Result<(), ReaderErrorV1> {
    writer.record(|writer| {
        writer.u32(value.toc_id);
        writer.string(&value.label, "publication TOC label")?;
        toc_target(writer, &value.target)?;
        toc_entries(writer, &value.children)
    })
}

fn toc_target(
    writer: &mut Writer,
    value: &ReaderPublicationTocTargetV1,
) -> Result<(), ReaderErrorV1> {
    match value {
        ReaderPublicationTocTargetV1::Locator {
            spine_index,
            locator,
        } => {
            writer.u8(0);
            writer.u32(*spine_index);
            super::locator(writer, locator)
        }
        ReaderPublicationTocTargetV1::External { href } => {
            writer.u8(1);
            writer.string(href, "publication external TOC href")
        }
        ReaderPublicationTocTargetV1::Unresolved { href } => {
            writer.u8(2);
            writer.string(href, "publication unresolved TOC href")
        }
    }
}
