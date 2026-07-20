use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    hash::{Hash, Hasher},
    sync::Arc,
};

use rito_style_contract::{BoxShadow, FontFamilies, ResolvedUrlV1, TextShadow, TransformListV1};

use super::ProjectionResult;

/// Projection caches keyed by immutable upstream list storage.
///
/// Stylo style slots retain every backing allocation while a projection runs,
/// so addresses cannot be recycled during this cache's lifetime. The keys are
/// process-local accelerators and never become contract evidence.
#[derive(Default)]
pub(super) struct ProjectionPayloadCaches {
    pub(super) font_families: PayloadCache<FontFamilies>,
    pub(super) text_shadows: PayloadCache<Arc<[TextShadow]>>,
    pub(super) box_shadows: PayloadCache<Arc<[BoxShadow]>>,
    pub(super) background_image_urls: UrlPayloadCache,
    pub(super) transforms: PayloadCache<TransformListV1>,
}

/// Value cache for bounded resolved URLs, keyed by serialized URL content.
///
/// A borrowed content fingerprint plus collision-safe value comparison avoids
/// allocating again for repeated computed URLs held by distinct Stylo style
/// structs. Rejected values are never retained, especially when over budget.
#[derive(Default)]
pub(super) struct UrlPayloadCache {
    values: HashMap<u64, Vec<ResolvedUrlV1>>,
    projection_count: usize,
}

impl UrlPayloadCache {
    pub(super) fn get_or_project(
        &mut self,
        upstream: &str,
        project: impl FnOnce(&str) -> ProjectionResult<ResolvedUrlV1>,
    ) -> ProjectionResult<ResolvedUrlV1> {
        let fingerprint = string_fingerprint(upstream);
        if let Some(values) = self.values.get(&fingerprint) {
            if let Some(value) = values.iter().find(|value| value.as_str() == upstream) {
                return Ok(value.clone());
            }
        }
        self.projection_count += 1;
        let value = project(upstream)?;
        self.values
            .entry(fingerprint)
            .or_default()
            .push(value.clone());
        Ok(value)
    }

    pub(super) fn projection_count(&self) -> usize {
        self.projection_count
    }
}

fn string_fingerprint(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

pub(super) struct PayloadCache<T> {
    values: HashMap<SliceKey, ProjectionResult<T>>,
    projection_count: usize,
    successful_item_count: usize,
}

impl<T> Default for PayloadCache<T> {
    fn default() -> Self {
        Self {
            values: HashMap::new(),
            projection_count: 0,
            successful_item_count: 0,
        }
    }
}

impl<T: Clone> PayloadCache<T> {
    pub(super) fn get_or_project<U>(
        &mut self,
        upstream: &[U],
        project: impl FnOnce() -> ProjectionResult<T>,
    ) -> ProjectionResult<T> {
        let key = SliceKey::new(upstream);
        if let Some(result) = self.values.get(&key) {
            return result.clone();
        }
        self.projection_count += 1;
        let result = project();
        if result.is_ok() {
            self.successful_item_count += upstream.len();
        }
        self.values.insert(key, result.clone());
        result
    }

    pub(super) fn stats(&self) -> (usize, usize) {
        (self.projection_count, self.successful_item_count)
    }
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
struct SliceKey {
    address: usize,
    item_count: usize,
}

impl SliceKey {
    fn new<T>(value: &[T]) -> Self {
        Self {
            address: value.as_ptr() as usize,
            item_count: value.len(),
        }
    }
}
