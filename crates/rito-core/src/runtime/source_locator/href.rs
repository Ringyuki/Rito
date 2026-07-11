use crate::{epub::LoadedEpubDocument, resources::ResourceHrefIndex};

use super::{RuntimeSourceLocator, RuntimeSourceLocatorError};

pub(super) struct CanonicalSourceLocator {
    pub(super) chapter_index: usize,
    pub(super) spine_idref: String,
    pub(super) locator: RuntimeSourceLocator,
}

pub(super) fn canonicalize_source_locator(
    document: &LoadedEpubDocument,
    locator: RuntimeSourceLocator,
) -> Result<CanonicalSourceLocator, RuntimeSourceLocatorError> {
    if locator.source_point.is_some() && locator.source_range.is_some() {
        return Err(RuntimeSourceLocatorError::invalid_selector(
            "sourcePoint and sourceRange are mutually exclusive",
        ));
    }
    if locator
        .progression
        .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
    {
        return Err(RuntimeSourceLocatorError::invalid_selector(
            "progression must be a finite value in [0, 1]",
        ));
    }

    let (href_path, legacy_anchor) = split_href_fragment(&locator.href);
    if href_path.is_empty() {
        return Err(RuntimeSourceLocatorError::href_not_found(&locator.href));
    }
    let href_index = ResourceHrefIndex::new(
        document
            .chapters
            .iter()
            .enumerate()
            .map(|(index, chapter)| (chapter.href.as_str(), index)),
    );
    let chapter_index = href_index
        .resolve(href_path)
        .ok_or_else(|| RuntimeSourceLocatorError::href_not_found(&locator.href))?;
    let chapter = &document.chapters[chapter_index];
    let legacy_anchor = legacy_anchor
        .filter(|anchor| !anchor.is_empty())
        .map(decode_fragment);
    if let (Some(explicit), Some(legacy)) = (&locator.anchor_id, &legacy_anchor) {
        if explicit != legacy {
            return Err(RuntimeSourceLocatorError::invalid_selector(
                "anchorId does not match the legacy href fragment",
            ));
        }
    }
    let anchor_id = locator.anchor_id.or(legacy_anchor);
    Ok(CanonicalSourceLocator {
        chapter_index,
        spine_idref: chapter.idref.clone(),
        locator: RuntimeSourceLocator {
            href: chapter.href.clone(),
            anchor_id,
            source_point: locator.source_point,
            source_range: locator.source_range,
            progression: locator.progression,
        },
    })
}

fn split_href_fragment(href: &str) -> (&str, Option<&str>) {
    href.find('#')
        .map(|index| (&href[..index], Some(&href[index + 1..])))
        .unwrap_or((href, None))
}

fn decode_fragment(fragment: &str) -> String {
    let bytes = fragment.as_bytes();
    if !bytes.contains(&b'%') {
        return fragment.to_owned();
    }
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let Some(high) = bytes.get(index + 1).copied().and_then(hex_value) else {
            return fragment.to_owned();
        };
        let Some(low) = bytes.get(index + 2).copied().and_then(hex_value) else {
            return fragment.to_owned();
        };
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| fragment.to_owned())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
