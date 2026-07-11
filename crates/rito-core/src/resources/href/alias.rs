use std::{borrow::Cow, collections::BTreeMap};

use super::{is_manifest_suffix, strip_relative_prefix, HrefMaps};

pub(super) enum CanonicalMatch<T> {
    Missing,
    Found(T),
    Ambiguous,
}

type ResourceCanonicalizer = for<'a> fn(&'a str) -> Cow<'a, str>;

trait CanonicalLookup {
    type Output: Copy;

    fn exact(&self, href: &str) -> CanonicalMatch<Self::Output>;
    fn suffix(&self, suffix: &str) -> CanonicalMatch<Self::Output>;
    fn basename(&self, basename: &str) -> CanonicalMatch<Self::Output>;
}

pub(super) fn resolve_map_canonical<T: Copy>(maps: &HrefMaps<T>, src: &str) -> CanonicalMatch<T> {
    resolve_canonical(maps, src)
}

pub(super) fn resolve_slice_canonical<T>(
    resources: &[T],
    resource_href: impl for<'a> Fn(&'a T) -> &'a str + Copy,
    canonicalize: ResourceCanonicalizer,
    src: &str,
) -> CanonicalMatch<usize> {
    resolve_canonical(
        &SliceCanonicalLookup {
            resources,
            resource_href,
            canonicalize,
        },
        src,
    )
}

impl<T: Copy> CanonicalLookup for HrefMaps<T> {
    type Output = T;

    fn exact(&self, href: &str) -> CanonicalMatch<T> {
        map_match(&self.by_href, href)
    }

    fn suffix(&self, suffix: &str) -> CanonicalMatch<T> {
        map_match(&self.by_suffix, suffix)
    }

    fn basename(&self, basename: &str) -> CanonicalMatch<T> {
        map_match(&self.by_basename, basename)
    }
}

struct SliceCanonicalLookup<'a, T, F> {
    resources: &'a [T],
    resource_href: F,
    canonicalize: ResourceCanonicalizer,
}

impl<T, F> CanonicalLookup for SliceCanonicalLookup<'_, T, F>
where
    F: for<'a> Fn(&'a T) -> &'a str + Copy,
{
    type Output = usize;

    fn exact(&self, href: &str) -> CanonicalMatch<usize> {
        self.find_unique(|canonical| canonical == href)
    }

    fn suffix(&self, suffix: &str) -> CanonicalMatch<usize> {
        self.find_unique(|canonical| is_manifest_suffix(canonical, suffix))
    }

    fn basename(&self, basename: &str) -> CanonicalMatch<usize> {
        self.find_unique(|canonical| canonical.rsplit('/').next() == Some(basename))
    }
}

impl<T, F> SliceCanonicalLookup<'_, T, F>
where
    F: for<'a> Fn(&'a T) -> &'a str + Copy,
{
    fn find_unique(&self, matches: impl Fn(&str) -> bool) -> CanonicalMatch<usize> {
        let mut found: Option<(usize, &str)> = None;
        for (index, resource) in self.resources.iter().enumerate() {
            let raw = (self.resource_href)(resource);
            if !matches((self.canonicalize)(raw).as_ref()) {
                continue;
            }
            match found {
                None => found = Some((index, raw)),
                Some((_, found_raw)) if found_raw == raw => {}
                Some(_) => return CanonicalMatch::Ambiguous,
            }
        }
        found.map_or(CanonicalMatch::Missing, |(index, _)| {
            CanonicalMatch::Found(index)
        })
    }
}

fn resolve_canonical<L: CanonicalLookup>(lookup: &L, src: &str) -> CanonicalMatch<L::Output> {
    match lookup.exact(src) {
        CanonicalMatch::Missing => {}
        result => return result,
    }

    let normalized = strip_relative_prefix(src);
    if normalized != src {
        match lookup.exact(normalized) {
            CanonicalMatch::Missing => {}
            result => return result,
        }
    }
    match lookup.suffix(normalized) {
        CanonicalMatch::Missing => {}
        result => return result,
    }

    for (index, character) in normalized.char_indices() {
        if character != '/' {
            continue;
        }
        match lookup.exact(&normalized[index + 1..]) {
            CanonicalMatch::Missing => {}
            result => return result,
        }
    }

    lookup.basename(normalized.rsplit('/').next().unwrap_or(normalized))
}

fn map_match<T: Copy>(values: &BTreeMap<String, Option<T>>, key: &str) -> CanonicalMatch<T> {
    match values.get(key) {
        Some(Some(value)) => CanonicalMatch::Found(*value),
        Some(None) => CanonicalMatch::Ambiguous,
        None => CanonicalMatch::Missing,
    }
}
