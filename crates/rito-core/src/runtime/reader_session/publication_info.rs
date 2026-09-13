use std::collections::{btree_map::Entry, BTreeMap};

use crate::{
    epub::{is_external_href, TocEntry},
    runtime::{
        source_locator::RuntimeSourceLocatorCanonicalizer, RuntimeDocument, RuntimeSourceLocator,
    },
};

use super::{
    convert::{reader_locator, u32_from_usize},
    ReaderError, ReaderErrorKind, ReaderPublication, ReaderPublicationMetadata,
    ReaderPublicationSpineItem, ReaderPublicationTocEntry, ReaderPublicationTocTarget,
    READER_PROTOCOL_VERSION, READER_PUBLICATION_TOC_DEPTH_MAX, READER_PUBLICATION_TOC_ITEM_MAX,
};

mod validate;

pub(super) use validate::validate_reader_publication;

pub(super) fn build_reader_publication(
    session_id: u64,
    document: &RuntimeDocument,
) -> Result<ReaderPublication, ReaderError> {
    let loaded = document.document();
    let package = &loaded.package;
    let mut linear_index = 0u32;
    let mut href_to_spine = BTreeMap::new();
    let mut spine = Vec::with_capacity(package.spine.len());

    for (index, item) in package.spine.iter().enumerate() {
        let manifest = package.manifest_item(&item.idref).ok_or_else(|| {
            publication_error(format!(
                "spine item '{}' has no matching manifest item",
                item.idref
            ))
        })?;
        let spine_index = u32_from_usize(index, "publication spine index")?;
        let item_linear_index = if item.linear {
            let current = linear_index;
            linear_index = linear_index
                .checked_add(1)
                .ok_or_else(|| publication_overflow("publication linear spine index"))?;
            Some(current)
        } else {
            None
        };
        record_unique_href(&mut href_to_spine, &manifest.href, spine_index);
        spine.push(ReaderPublicationSpineItem {
            spine_index,
            linear_index: item_linear_index,
            idref: item.idref.clone(),
            href: manifest.href.clone(),
        });
    }

    let canonicalizer = RuntimeSourceLocatorCanonicalizer::new(loaded);
    let mut next_toc_id = 0u32;
    let toc = build_toc_entries(
        &package.toc,
        1,
        &mut next_toc_id,
        loaded,
        &canonicalizer,
        &href_to_spine,
    )?;
    let publication = ReaderPublication {
        protocol_version: READER_PROTOCOL_VERSION,
        session_id,
        metadata: ReaderPublicationMetadata {
            title: package.metadata.title.clone(),
            language: package.metadata.language.clone(),
            identifier: package.metadata.identifier.clone(),
            creator: package.metadata.creator.clone(),
        },
        spine,
        toc,
    };
    validate_reader_publication(&publication).map_err(publication_error)?;
    Ok(publication)
}

fn record_unique_href(
    href_to_spine: &mut BTreeMap<String, Option<u32>>,
    href: &str,
    spine_index: u32,
) {
    match href_to_spine.entry(href.to_owned()) {
        Entry::Vacant(entry) => {
            entry.insert(Some(spine_index));
        }
        Entry::Occupied(mut entry) => {
            entry.insert(None);
        }
    }
}

fn build_toc_entries(
    entries: &[TocEntry],
    depth: u32,
    next_toc_id: &mut u32,
    document: &crate::epub::LoadedEpubDocument,
    canonicalizer: &RuntimeSourceLocatorCanonicalizer,
    href_to_spine: &BTreeMap<String, Option<u32>>,
) -> Result<Vec<ReaderPublicationTocEntry>, ReaderError> {
    if depth > READER_PUBLICATION_TOC_DEPTH_MAX && !entries.is_empty() {
        return Err(publication_overflow("publication TOC depth"));
    }
    let mut result = Vec::with_capacity(entries.len());
    for entry in entries {
        if *next_toc_id >= READER_PUBLICATION_TOC_ITEM_MAX {
            return Err(publication_overflow("publication TOC item count"));
        }
        let toc_id = *next_toc_id;
        *next_toc_id = next_toc_id
            .checked_add(1)
            .ok_or_else(|| publication_overflow("publication TOC identity"))?;
        let target = canonical_toc_target(&entry.href, document, canonicalizer, href_to_spine)?;
        let children = build_toc_entries(
            &entry.children,
            depth.saturating_add(1),
            next_toc_id,
            document,
            canonicalizer,
            href_to_spine,
        )?;
        result.push(ReaderPublicationTocEntry {
            toc_id,
            label: entry.label.clone(),
            target,
            children,
        });
    }
    Ok(result)
}

fn canonical_toc_target(
    href: &str,
    document: &crate::epub::LoadedEpubDocument,
    canonicalizer: &RuntimeSourceLocatorCanonicalizer,
    href_to_spine: &BTreeMap<String, Option<u32>>,
) -> Result<ReaderPublicationTocTarget, ReaderError> {
    if is_external_href(href) {
        return Ok(ReaderPublicationTocTarget::External {
            href: href.to_owned(),
        });
    }
    let locator = canonicalizer
        .canonicalize_locator(
            document,
            RuntimeSourceLocator {
                href: href.to_owned(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
        )
        .ok();
    let Some(locator) = locator else {
        return Ok(unresolved_toc_target(href));
    };
    let Some(Some(spine_index)) = href_to_spine.get(&locator.href) else {
        return Ok(unresolved_toc_target(href));
    };
    Ok(ReaderPublicationTocTarget::Locator {
        spine_index: *spine_index,
        locator: reader_locator(locator)?,
    })
}

fn unresolved_toc_target(href: &str) -> ReaderPublicationTocTarget {
    ReaderPublicationTocTarget::Unresolved {
        href: href.to_owned(),
    }
}

fn publication_error(message: impl Into<String>) -> ReaderError {
    ReaderError::new(ReaderErrorKind::EngineFailure, message)
}

fn publication_overflow(field: &str) -> ReaderError {
    ReaderError::new(
        ReaderErrorKind::NumericOverflow,
        format!("{field} exceeds protocol limits"),
    )
}

#[cfg(test)]
mod tests;
