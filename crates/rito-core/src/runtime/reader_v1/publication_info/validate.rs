use std::collections::BTreeSet;

use crate::epub::is_external_href;

use super::super::{
    ReaderLocatorV1, ReaderPublicationSpineItemV1, ReaderPublicationTocEntryV1,
    ReaderPublicationTocTargetV1, ReaderPublicationV1, READER_PROTOCOL_VERSION_V1,
    READER_PUBLICATION_TOC_DEPTH_MAX_V1, READER_PUBLICATION_TOC_ITEM_MAX_V1,
};

pub(in crate::runtime::reader_v1) fn validate_reader_publication_v1(
    publication: &ReaderPublicationV1,
) -> Result<(), String> {
    if publication.protocol_version != READER_PROTOCOL_VERSION_V1 {
        return Err(format!(
            "unsupported publication protocol version: {}",
            publication.protocol_version
        ));
    }
    let duplicate_hrefs = validate_spine(&publication.spine)?;
    let mut next_toc_id = 0u32;
    validate_toc_entries(
        &publication.toc,
        1,
        &mut next_toc_id,
        &publication.spine,
        &duplicate_hrefs,
    )
}

fn validate_spine(spine: &[ReaderPublicationSpineItemV1]) -> Result<BTreeSet<&str>, String> {
    let mut next_linear_index = 0u32;
    let mut duplicate_hrefs = BTreeSet::new();
    let mut hrefs = BTreeSet::new();
    for (index, item) in spine.iter().enumerate() {
        let expected = u32::try_from(index)
            .map_err(|_| "publication spine index exceeds protocol v1".to_owned())?;
        if item.spine_index != expected {
            return Err("publication spine indexes must be dense and ordered".to_owned());
        }
        if item.idref.is_empty() || item.href.is_empty() {
            return Err("publication spine idref and href must not be empty".to_owned());
        }
        if !hrefs.insert(item.href.as_str()) {
            duplicate_hrefs.insert(item.href.as_str());
        }
        match item.linear_index {
            Some(value) if value == next_linear_index => {
                next_linear_index = next_linear_index
                    .checked_add(1)
                    .ok_or_else(|| "publication linear index overflow".to_owned())?;
            }
            Some(_) => {
                return Err("publication linear indexes must be dense and ordered".to_owned())
            }
            None => {}
        }
    }
    Ok(duplicate_hrefs)
}

fn validate_toc_entries(
    entries: &[ReaderPublicationTocEntryV1],
    depth: u32,
    next_toc_id: &mut u32,
    spine: &[ReaderPublicationSpineItemV1],
    duplicate_hrefs: &BTreeSet<&str>,
) -> Result<(), String> {
    if depth > READER_PUBLICATION_TOC_DEPTH_MAX_V1 && !entries.is_empty() {
        return Err("publication TOC exceeds the depth limit".to_owned());
    }
    for entry in entries {
        if *next_toc_id >= READER_PUBLICATION_TOC_ITEM_MAX_V1 {
            return Err("publication TOC exceeds the item limit".to_owned());
        }
        if entry.toc_id != *next_toc_id {
            return Err("publication TOC IDs must be dense preorder identities".to_owned());
        }
        *next_toc_id = next_toc_id
            .checked_add(1)
            .ok_or_else(|| "publication TOC identity overflow".to_owned())?;
        validate_toc_target(&entry.target, spine, duplicate_hrefs)?;
        validate_toc_entries(
            &entry.children,
            depth.saturating_add(1),
            next_toc_id,
            spine,
            duplicate_hrefs,
        )?;
    }
    Ok(())
}

fn validate_toc_target(
    target: &ReaderPublicationTocTargetV1,
    spine: &[ReaderPublicationSpineItemV1],
    duplicate_hrefs: &BTreeSet<&str>,
) -> Result<(), String> {
    match target {
        ReaderPublicationTocTargetV1::Locator {
            spine_index,
            locator,
        } => {
            let index = usize::try_from(*spine_index)
                .map_err(|_| "publication TOC spine index is not addressable".to_owned())?;
            let item = spine
                .get(index)
                .ok_or_else(|| "publication TOC spine index is out of bounds".to_owned())?;
            validate_toc_locator(locator, item, duplicate_hrefs)
        }
        ReaderPublicationTocTargetV1::External { href } => {
            if href.is_empty() || !is_external_href(href) {
                return Err("publication external TOC href is invalid".to_owned());
            }
            Ok(())
        }
        ReaderPublicationTocTargetV1::Unresolved { href } => {
            if is_external_href(href) {
                return Err("publication external TOC href must use the external target".to_owned());
            }
            Ok(())
        }
    }
}

fn validate_toc_locator(
    locator: &ReaderLocatorV1,
    item: &ReaderPublicationSpineItemV1,
    duplicate_hrefs: &BTreeSet<&str>,
) -> Result<(), String> {
    if locator.href != item.href {
        return Err("publication TOC locator does not match its spine item".to_owned());
    }
    if duplicate_hrefs.contains(locator.href.as_str()) {
        return Err("publication TOC locator href is ambiguous in the spine".to_owned());
    }
    if locator.source_point.is_some()
        || locator.source_range.is_some()
        || locator.progression.is_some()
    {
        return Err("publication TOC locator may only contain href and anchorId".to_owned());
    }
    Ok(())
}
