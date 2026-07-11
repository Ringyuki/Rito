use std::collections::BTreeMap;

use alias::{resolve_map_alias, resolve_slice_alias};
use percent::{resource_alias, source_alias};

mod alias;
mod percent;

#[derive(Debug)]
pub(crate) struct ResourceHrefIndex<T> {
    raw: HrefMaps<T>,
    aliases: HrefMaps<T>,
}

#[derive(Debug)]
pub(super) struct HrefMaps<T> {
    pub(super) by_href: BTreeMap<String, Option<T>>,
    pub(super) by_suffix: BTreeMap<String, Option<T>>,
    pub(super) by_basename: BTreeMap<String, Option<T>>,
}

impl<T: Copy> ResourceHrefIndex<T> {
    pub(crate) fn new<'a>(entries: impl IntoIterator<Item = (&'a str, T)>) -> Self {
        let mut raw = HrefMaps::new();
        let mut aliases = HrefMaps::new();

        for (href, value) in entries {
            if raw.contains_href(href) {
                continue;
            }
            raw.insert_raw(href, value);
            aliases.insert_alias(resource_alias(href).as_ref(), value);
        }

        Self { raw, aliases }
    }

    pub(crate) fn resolve(&self, src: &str) -> Option<T> {
        resolve_candidate(&self.raw, src).or_else(|| {
            let alias = source_alias(src)?;
            resolve_map_alias(&self.aliases, alias.as_ref())
        })
    }
}

impl<T: Copy> HrefMaps<T> {
    fn new() -> Self {
        Self {
            by_href: BTreeMap::new(),
            by_suffix: BTreeMap::new(),
            by_basename: BTreeMap::new(),
        }
    }

    fn contains_href(&self, href: &str) -> bool {
        self.by_href.contains_key(href)
    }

    fn insert_raw(&mut self, href: &str, value: T) {
        self.by_href.insert(href.to_owned(), Some(value));
        self.insert_paths(href, value);
    }

    fn insert_alias(&mut self, href: &str, value: T) {
        insert_unique(&mut self.by_href, href.to_owned(), value);
        self.insert_paths(href, value);
    }

    fn insert_paths(&mut self, href: &str, value: T) {
        let parts = href.split('/').collect::<Vec<_>>();
        for index in 1..parts.len() {
            insert_unique(&mut self.by_suffix, parts[index..].join("/"), value);
        }
        if let Some(basename) = parts.last() {
            insert_unique(&mut self.by_basename, (*basename).to_owned(), value);
        }
    }
}

trait HrefLookup {
    type Output: Copy;

    fn exact(&self, href: &str) -> Option<Self::Output>;
    fn unique_manifest_suffix(&self, suffix: &str) -> Option<Self::Output>;
    fn unique_basename(&self, basename: &str) -> Option<Self::Output>;
}

impl<T: Copy> HrefLookup for HrefMaps<T> {
    type Output = T;

    fn exact(&self, href: &str) -> Option<T> {
        self.by_href.get(href).copied().flatten()
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
    let raw = SliceHrefLookup {
        resources,
        resource_href,
    };
    if let Some(index) = resolve_candidate(&raw, src) {
        return Some(index);
    }
    let alias = source_alias(src)?;
    resolve_slice_alias(resources, resource_href, alias.as_ref())
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
            is_manifest_suffix(href, suffix)
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
        if character == '/' {
            if let Some(value) = lookup.exact(&normalized[index + 1..]) {
                return Some(value);
            }
        }
    }

    lookup.unique_basename(normalized.rsplit('/').next().unwrap_or(normalized))
}

pub(super) fn is_manifest_suffix(href: &str, suffix: &str) -> bool {
    href.len() > suffix.len()
        && href.ends_with(suffix)
        && href.as_bytes().get(href.len() - suffix.len() - 1) == Some(&b'/')
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

pub(super) fn strip_relative_prefix(src: &str) -> &str {
    let mut normalized = src;
    while let Some(rest) = normalized.strip_prefix("../") {
        normalized = rest;
    }
    normalized
}

#[cfg(test)]
mod tests;
