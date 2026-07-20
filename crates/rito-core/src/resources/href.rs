use std::collections::BTreeMap;

use alias::{resolve_map_canonical, resolve_slice_canonical, CanonicalMatch};
use percent::{resource_alias, resource_path, source_alias, source_path};

mod alias;
mod percent;

#[derive(Debug, Clone)]
pub(crate) struct ResourceHrefIndex<T> {
    raw_exact: BTreeMap<String, T>,
    paths: HrefMaps<T>,
    aliases: HrefMaps<T>,
}

#[derive(Debug, Clone)]
pub(super) struct HrefMaps<T> {
    pub(super) by_href: BTreeMap<String, Option<T>>,
    pub(super) by_suffix: BTreeMap<String, Option<T>>,
    pub(super) by_basename: BTreeMap<String, Option<T>>,
}

impl<T: Copy> ResourceHrefIndex<T> {
    pub(crate) fn new<'a>(entries: impl IntoIterator<Item = (&'a str, T)>) -> Self {
        let mut index = Self {
            raw_exact: BTreeMap::new(),
            paths: HrefMaps::new(),
            aliases: HrefMaps::new(),
        };
        for (href, value) in entries {
            index.insert(href, value);
        }
        index
    }

    pub(crate) fn insert(&mut self, href: &str, value: T) {
        if self.raw_exact.contains_key(href) {
            return;
        }
        self.raw_exact.insert(href.to_owned(), value);
        self.paths
            .insert_canonical(resource_path(href).as_ref(), value);
        self.aliases
            .insert_canonical(resource_alias(href).as_ref(), value);
    }

    pub(crate) fn resolve(&self, src: &str) -> Option<T> {
        if let Some(value) = self.raw_exact.get(src) {
            return Some(*value);
        }
        match resolve_map_canonical(&self.paths, source_path(src)) {
            CanonicalMatch::Found(value) => return Some(value),
            CanonicalMatch::Ambiguous => return None,
            CanonicalMatch::Missing => {}
        }
        let alias = source_alias(src)?;
        canonical_value(resolve_map_canonical(&self.aliases, alias.as_ref()))
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

    fn insert_canonical(&mut self, href: &str, value: T) {
        insert_unique(&mut self.by_href, href.to_owned(), value);
        let parts = href.split('/').collect::<Vec<_>>();
        for index in 1..parts.len() {
            insert_unique(&mut self.by_suffix, parts[index..].join("/"), value);
        }
        if let Some(basename) = parts.last() {
            insert_unique(&mut self.by_basename, (*basename).to_owned(), value);
        }
    }
}

pub(crate) fn resolve_resource_href_index<T>(
    resources: &[T],
    src: &str,
    resource_href: impl for<'a> Fn(&'a T) -> &'a str + Copy,
) -> Option<usize> {
    if let Some(index) = resources
        .iter()
        .position(|resource| resource_href(resource) == src)
    {
        return Some(index);
    }
    match resolve_slice_canonical(resources, resource_href, resource_path, source_path(src)) {
        CanonicalMatch::Found(index) => return Some(index),
        CanonicalMatch::Ambiguous => return None,
        CanonicalMatch::Missing => {}
    }
    let alias = source_alias(src)?;
    canonical_value(resolve_slice_canonical(
        resources,
        resource_href,
        resource_alias,
        alias.as_ref(),
    ))
}

fn canonical_value<T>(result: CanonicalMatch<T>) -> Option<T> {
    match result {
        CanonicalMatch::Found(value) => Some(value),
        CanonicalMatch::Missing | CanonicalMatch::Ambiguous => None,
    }
}

pub(super) fn is_manifest_suffix(href: &str, suffix: &str) -> bool {
    href.len() > suffix.len()
        && href.ends_with(suffix)
        && href.as_bytes().get(href.len() - suffix.len() - 1) == Some(&b'/')
}

fn insert_unique<T: Copy>(values: &mut BTreeMap<String, Option<T>>, key: String, value: T) {
    use std::collections::btree_map::Entry;

    match values.entry(key) {
        Entry::Vacant(entry) => {
            entry.insert(Some(value));
        }
        Entry::Occupied(mut entry) => {
            entry.insert(None);
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
