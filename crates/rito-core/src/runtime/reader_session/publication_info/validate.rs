use std::collections::BTreeSet;

use crate::epub::is_external_href;

use super::super::{
    ReaderLocator, ReaderPublication, ReaderPublicationSpineItem, ReaderPublicationTocEntry,
    ReaderPublicationTocTarget, READER_PROTOCOL_VERSION, READER_PUBLICATION_TOC_DEPTH_MAX,
    READER_PUBLICATION_TOC_ITEM_MAX,
};

pub(in crate::runtime::reader_session) fn validate_reader_publication(
    publication: &ReaderPublication,
) -> Result<(), String> {
    if publication.protocol_version != READER_PROTOCOL_VERSION {
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

fn validate_spine(spine: &[ReaderPublicationSpineItem]) -> Result<BTreeSet<&str>, String> {
    let mut next_linear_index = 0u32;
    let mut duplicate_hrefs = BTreeSet::new();
    let mut hrefs = BTreeSet::new();
    for (index, item) in spine.iter().enumerate() {
        let expected = u32::try_from(index)
            .map_err(|_| "publication spine index exceeds the reader protocol".to_owned())?;
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
    entries: &[ReaderPublicationTocEntry],
    depth: u32,
    next_toc_id: &mut u32,
    spine: &[ReaderPublicationSpineItem],
    duplicate_hrefs: &BTreeSet<&str>,
) -> Result<(), String> {
    if depth > READER_PUBLICATION_TOC_DEPTH_MAX && !entries.is_empty() {
        return Err("publication TOC exceeds the depth limit".to_owned());
    }
    for entry in entries {
        if *next_toc_id >= READER_PUBLICATION_TOC_ITEM_MAX {
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
    target: &ReaderPublicationTocTarget,
    spine: &[ReaderPublicationSpineItem],
    duplicate_hrefs: &BTreeSet<&str>,
) -> Result<(), String> {
    match target {
        ReaderPublicationTocTarget::Locator {
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
        ReaderPublicationTocTarget::External { href } => {
            if href.is_empty() || !is_external_href(href) {
                return Err("publication external TOC href is invalid".to_owned());
            }
            Ok(())
        }
        ReaderPublicationTocTarget::Unresolved { href } => {
            if is_external_href(href) {
                return Err("publication external TOC href must use the external target".to_owned());
            }
            Ok(())
        }
    }
}

fn validate_toc_locator(
    locator: &ReaderLocator,
    item: &ReaderPublicationSpineItem,
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
