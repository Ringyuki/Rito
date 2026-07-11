use std::collections::BTreeMap;

#[derive(Debug)]
pub(crate) struct ResourceHrefIndex<T> {
    by_href: BTreeMap<String, T>,
    by_suffix: BTreeMap<String, Option<T>>,
    by_basename: BTreeMap<String, Option<T>>,
}

impl<T: Copy> ResourceHrefIndex<T> {
    pub(crate) fn new<'a>(entries: impl IntoIterator<Item = (&'a str, T)>) -> Self {
        let mut by_href = BTreeMap::new();
        let mut by_suffix = BTreeMap::new();
        let mut by_basename = BTreeMap::new();

        for (href, value) in entries {
            if by_href.contains_key(href) {
                continue;
            }
            by_href.insert(href.to_owned(), value);
            let parts = href.split('/').collect::<Vec<_>>();
            for index in 1..parts.len() {
                insert_unique(&mut by_suffix, parts[index..].join("/"), value);
            }
            if let Some(basename) = parts.last() {
                insert_unique(&mut by_basename, (*basename).to_owned(), value);
            }
        }

        Self {
            by_href,
            by_suffix,
            by_basename,
        }
    }

    pub(crate) fn resolve(&self, src: &str) -> Option<T> {
        resolve_href(self, src)
    }
}

trait HrefLookup {
    type Output: Copy;

    fn exact(&self, href: &str) -> Option<Self::Output>;
    fn unique_manifest_suffix(&self, suffix: &str) -> Option<Self::Output>;
    fn unique_basename(&self, basename: &str) -> Option<Self::Output>;
}

impl<T: Copy> HrefLookup for ResourceHrefIndex<T> {
    type Output = T;

    fn exact(&self, href: &str) -> Option<T> {
        self.by_href.get(href).copied()
    }

    fn unique_manifest_suffix(&self, suffix: &str) -> Option<T> {
        self.by_suffix.get(suffix).copied().flatten()
    }

    fn unique_basename(&self, basename: &str) -> Option<T> {
        self.by_basename.get(basename).copied().flatten()
    }
}

pub(crate) fn resolve_resource_href_index<T>(
    resources: &[T],
    src: &str,
    resource_href: impl for<'a> Fn(&'a T) -> &'a str + Copy,
) -> Option<usize> {
    resolve_href(
        &SliceHrefLookup {
            resources,
            resource_href,
        },
        src,
    )
}

struct SliceHrefLookup<'a, T, F> {
    resources: &'a [T],
    resource_href: F,
}

impl<T, F> HrefLookup for SliceHrefLookup<'_, T, F>
where
    F: for<'a> Fn(&'a T) -> &'a str + Copy,
{
    type Output = usize;

    fn exact(&self, href: &str) -> Option<usize> {
        self.resources
            .iter()
            .position(|resource| (self.resource_href)(resource) == href)
    }

    fn unique_manifest_suffix(&self, suffix: &str) -> Option<usize> {
        find_unique_resource(self.resources, self.resource_href, |href| {
            href.len() > suffix.len()
                && href.ends_with(suffix)
                && href.as_bytes().get(href.len() - suffix.len() - 1) == Some(&b'/')
        })
    }

    fn unique_basename(&self, basename: &str) -> Option<usize> {
        find_unique_resource(self.resources, self.resource_href, |href| {
            href.rsplit('/').next() == Some(basename)
        })
    }
}

fn find_unique_resource<T>(
    resources: &[T],
    resource_href: impl for<'a> Fn(&'a T) -> &'a str,
    matches: impl Fn(&str) -> bool,
) -> Option<usize> {
    let mut found: Option<(usize, &str)> = None;
    for (index, resource) in resources.iter().enumerate() {
        let href = resource_href(resource);
        if !matches(href) {
            continue;
        }
        match found {
            None => found = Some((index, href)),
            Some((_, found_href)) if found_href == href => {}
            Some(_) => return None,
        }
    }
    found.map(|(index, _)| index)
}

fn resolve_href<L: HrefLookup>(lookup: &L, src: &str) -> Option<L::Output> {
    if let Some(value) = resolve_candidate(lookup, src) {
        return Some(value);
    }
    let decoded = percent_decode_utf8(src)?;
    if decoded == src {
        return None;
    }
    resolve_candidate(lookup, &decoded)
}

fn resolve_candidate<L: HrefLookup>(lookup: &L, src: &str) -> Option<L::Output> {
    if let Some(value) = lookup.exact(src) {
        return Some(value);
    }

    let normalized = strip_relative_prefix(src);
    if let Some(value) = lookup.unique_manifest_suffix(normalized) {
        return Some(value);
    }
    if normalized != src {
        if let Some(value) = lookup.exact(normalized) {
            return Some(value);
        }
    }

    for (index, character) in normalized.char_indices() {
        if character != '/' {
            continue;
        }
        if let Some(value) = lookup.exact(&normalized[index + 1..]) {
            return Some(value);
        }
    }

    lookup.unique_basename(normalized.rsplit('/').next().unwrap_or(normalized))
}

fn insert_unique<T: Copy>(values: &mut BTreeMap<String, Option<T>>, key: String, value: T) {
    use std::collections::btree_map::Entry;

    match values.entry(key) {
        Entry::Occupied(mut entry) => {
            entry.insert(None);
        }
        Entry::Vacant(entry) => {
            entry.insert(Some(value));
        }
    }
}

fn strip_relative_prefix(src: &str) -> &str {
    let mut normalized = src;
    while let Some(rest) = normalized.strip_prefix("../") {
        normalized = rest;
    }
    normalized
}

fn percent_decode_utf8(value: &str) -> Option<String> {
    if !value.as_bytes().contains(&b'%') {
        return None;
    }
    let source = value.as_bytes();
    let mut decoded = Vec::with_capacity(source.len());
    let mut index = 0;
    while index < source.len() {
        if source[index] != b'%' {
            decoded.push(source[index]);
            index += 1;
            continue;
        }
        let high = source.get(index + 1).copied().and_then(hex_value)?;
        let low = source.get(index + 2).copied().and_then(hex_value)?;
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_resource_href_index, ResourceHrefIndex};

    #[test]
    fn preserves_raw_exact_precedence_before_percent_decoding() {
        assert_resolves(
            &["Images/My%20Pic.png", "Images/My Pic.png"],
            "Images/My%20Pic.png",
            Some(0),
        );
    }

    #[test]
    fn resolves_percent_encoded_sources_to_literal_resource_hrefs() {
        let hrefs = ["Images/My Pic.png", "Images/中.png"];
        assert_resolves(&hrefs, "../Images/My%20Pic.png", Some(0));
        assert_resolves(&hrefs, "Images/%e4%b8%ad.png", Some(1));
    }

    #[test]
    fn resolves_longest_exact_manifest_tail_from_source_paths() {
        assert_resolves(
            &["pic.png", "Images/pic.png"],
            "OPS/Images/pic.png",
            Some(1),
        );
    }

    #[test]
    fn rejects_ambiguous_suffixes_and_basenames() {
        let hrefs = ["OPS/a/Images/pic.png", "OPS/b/Images/pic.png"];
        assert_resolves(&hrefs, "Images/pic.png", None);
        assert_resolves(&hrefs, "pic.png", None);
    }

    #[test]
    fn malformed_or_non_utf8_percent_escapes_do_not_panic() {
        let hrefs = ["Images/100%.png"];
        assert_resolves(&hrefs, "Images/100%.png", Some(0));
        assert_resolves(&hrefs, "Images/%ff.png", None);
    }

    fn assert_resolves(hrefs: &[&str], src: &str, expected: Option<usize>) {
        let hrefs = hrefs
            .iter()
            .map(|href| (*href).to_owned())
            .collect::<Vec<_>>();
        let index = ResourceHrefIndex::new(
            hrefs
                .iter()
                .enumerate()
                .map(|(index, href)| (href.as_str(), index)),
        );

        assert_eq!(index.resolve(src), expected, "prebuilt index: {src}");
        assert_eq!(
            resolve_resource_href_index(&hrefs, src, String::as_str),
            expected,
            "linear lookup: {src}"
        );
    }
}
