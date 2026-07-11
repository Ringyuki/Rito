use std::collections::BTreeMap;

use super::{is_manifest_suffix, percent::resource_alias, strip_relative_prefix, HrefMaps};

enum AliasMatch<T> {
    Missing,
    Found(T),
    Ambiguous,
}

trait AliasLookup {
    type Output: Copy;

    fn exact(&self, href: &str) -> AliasMatch<Self::Output>;
    fn suffix(&self, suffix: &str) -> AliasMatch<Self::Output>;
    fn basename(&self, basename: &str) -> AliasMatch<Self::Output>;
}

pub(super) fn resolve_map_alias<T: Copy>(maps: &HrefMaps<T>, src: &str) -> Option<T> {
    resolve_alias(maps, src)
}

pub(super) fn resolve_slice_alias<T>(
    resources: &[T],
    resource_href: impl for<'a> Fn(&'a T) -> &'a str + Copy,
    src: &str,
) -> Option<usize> {
    resolve_alias(
        &SliceAliasLookup {
            resources,
            resource_href,
        },
        src,
    )
}

impl<T: Copy> AliasLookup for HrefMaps<T> {
    type Output = T;

    fn exact(&self, href: &str) -> AliasMatch<T> {
        map_match(&self.by_href, href)
    }

    fn suffix(&self, suffix: &str) -> AliasMatch<T> {
        map_match(&self.by_suffix, suffix)
    }

    fn basename(&self, basename: &str) -> AliasMatch<T> {
        map_match(&self.by_basename, basename)
    }
}

struct SliceAliasLookup<'a, T, F> {
    resources: &'a [T],
    resource_href: F,
}

impl<T, F> AliasLookup for SliceAliasLookup<'_, T, F>
where
    F: for<'a> Fn(&'a T) -> &'a str + Copy,
{
    type Output = usize;

    fn exact(&self, href: &str) -> AliasMatch<usize> {
        self.find_unique(|alias| alias == href)
    }

    fn suffix(&self, suffix: &str) -> AliasMatch<usize> {
        self.find_unique(|alias| is_manifest_suffix(alias, suffix))
    }

    fn basename(&self, basename: &str) -> AliasMatch<usize> {
        self.find_unique(|alias| alias.rsplit('/').next() == Some(basename))
    }
}

impl<T, F> SliceAliasLookup<'_, T, F>
where
    F: for<'a> Fn(&'a T) -> &'a str + Copy,
{
    fn find_unique(&self, matches: impl Fn(&str) -> bool) -> AliasMatch<usize> {
        let mut found: Option<(usize, &str)> = None;
        for (index, resource) in self.resources.iter().enumerate() {
            let raw = (self.resource_href)(resource);
            if !matches(resource_alias(raw).as_ref()) {
                continue;
            }
            match found {
                None => found = Some((index, raw)),
                Some((_, found_raw)) if found_raw == raw => {}
                Some(_) => return AliasMatch::Ambiguous,
            }
        }
        found.map_or(AliasMatch::Missing, |(index, _)| AliasMatch::Found(index))
    }
}

fn resolve_alias<L: AliasLookup>(lookup: &L, src: &str) -> Option<L::Output> {
    if let Some(result) = terminal(lookup.exact(src)) {
        return result;
    }

    let normalized = strip_relative_prefix(src);
    if let Some(result) = terminal(lookup.suffix(normalized)) {
        return result;
    }
    if normalized != src {
        if let Some(result) = terminal(lookup.exact(normalized)) {
            return result;
        }
    }

    for (index, character) in normalized.char_indices() {
        if character == '/' {
            if let Some(result) = terminal(lookup.exact(&normalized[index + 1..])) {
                return result;
            }
        }
    }

    match lookup.basename(normalized.rsplit('/').next().unwrap_or(normalized)) {
        AliasMatch::Found(value) => Some(value),
        AliasMatch::Missing | AliasMatch::Ambiguous => None,
    }
}

fn terminal<T>(result: AliasMatch<T>) -> Option<Option<T>> {
    match result {
        AliasMatch::Missing => None,
        AliasMatch::Found(value) => Some(Some(value)),
        AliasMatch::Ambiguous => Some(None),
    }
}

fn map_match<T: Copy>(values: &BTreeMap<String, Option<T>>, key: &str) -> AliasMatch<T> {
    match values.get(key) {
        Some(Some(value)) => AliasMatch::Found(*value),
        Some(None) => AliasMatch::Ambiguous,
        None => AliasMatch::Missing,
    }
}
