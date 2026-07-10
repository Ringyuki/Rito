use crate::epub::{EpubError, LoadedBinaryResource, LoadedTextResource};

use super::{RuntimeFrameResourceWarmPlan, RuntimeResource, RuntimeResourceKind};

const FRAME_RESOURCE_WARM_OFFSETS: [isize; 5] = [0, 1, -1, 2, -2];

impl super::RuntimeDocument {
    pub fn frame_resource_warm_plan(
        &self,
        revision_id: &str,
        center_spread_index: usize,
    ) -> Result<RuntimeFrameResourceWarmPlan, EpubError> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        let spread_count = revision
            .layout
            .summary
            .pagination_flow
            .display_list_flow
            .spread_count;
        let spread_indexes = warm_spread_indexes(center_spread_index, spread_count);
        Ok(RuntimeFrameResourceWarmPlan {
            revision_id: revision_id.to_owned(),
            center_spread_index,
            display_spread_index: center_spread_index,
            spread_indexes,
        })
    }
}

fn warm_spread_indexes(center: usize, spread_count: usize) -> Vec<usize> {
    let max = spread_count.saturating_sub(1);
    FRAME_RESOURCE_WARM_OFFSETS
        .iter()
        .filter_map(|offset| center.checked_add_signed(*offset))
        .filter(|index| *index <= max)
        .fold(Vec::new(), |mut indexes, index| {
            if !indexes.contains(&index) {
                indexes.push(index);
            }
            indexes
        })
}

pub(super) fn find_binary_resource<'a>(
    resources: &'a [LoadedBinaryResource],
    href: &str,
) -> Option<&'a LoadedBinaryResource> {
    find_resource_by_href(resources.iter(), href, |resource| resource.href.as_str())
}

pub(super) fn find_text_resource<'a>(
    resources: &'a [LoadedTextResource],
    href: &str,
) -> Option<&'a LoadedTextResource> {
    find_resource_by_href(resources.iter(), href, |resource| resource.href.as_str())
}

pub(super) fn runtime_binary_resource(
    revision_id: &str,
    kind: RuntimeResourceKind,
    resource: &LoadedBinaryResource,
    bytes: Vec<u8>,
) -> RuntimeResource {
    RuntimeResource {
        revision_id: revision_id.to_owned(),
        kind,
        href: resource.href.clone(),
        media_type: resource.media_type.clone(),
        bytes,
        width: resource.width,
        height: resource.height,
    }
}

pub(super) fn runtime_text_resource(
    revision_id: &str,
    kind: RuntimeResourceKind,
    resource: &LoadedTextResource,
) -> RuntimeResource {
    RuntimeResource {
        revision_id: revision_id.to_owned(),
        kind,
        href: resource.href.clone(),
        media_type: "text/css".to_owned(),
        bytes: resource.text.as_bytes().to_vec(),
        width: None,
        height: None,
    }
}

pub(super) fn resource_not_found(kind: RuntimeResourceKind, href: &str) -> EpubError {
    EpubError::new(format!("resource not found: {kind:?} {href}"))
}

fn find_resource_by_href<'a, T>(
    resources: impl Iterator<Item = &'a T> + Clone,
    href: &str,
    resource_href: impl Fn(&T) -> &str + Copy,
) -> Option<&'a T> {
    if let Some(resource) = find_exact_resource(resources.clone(), href, resource_href) {
        return Some(resource);
    }

    let normalized = strip_relative_prefix(href);
    if normalized != href {
        if let Some(resource) = find_exact_resource(resources.clone(), normalized, resource_href) {
            return Some(resource);
        }
    }

    let suffix = format!("/{normalized}");
    let mut matches = resources.filter(|resource| resource_href(resource).ends_with(&suffix));
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

fn find_exact_resource<'a, T>(
    resources: impl Iterator<Item = &'a T>,
    href: &str,
    resource_href: impl Fn(&T) -> &str,
) -> Option<&'a T> {
    resources
        .into_iter()
        .find(|resource| resource_href(resource) == href)
}

fn strip_relative_prefix(href: &str) -> &str {
    let mut result = href;
    while let Some(rest) = result.strip_prefix("../") {
        result = rest;
    }
    result
}
