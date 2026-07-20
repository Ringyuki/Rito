use std::{collections::HashSet, hash::Hash, sync::Arc};

use crate::{
    BoxShadow, FontFamilies, InlineFormattingStyleV1, LanguageTag, ResolvedUrlV1, TextShadow,
    TransformListV1,
};

#[derive(Default)]
pub(super) struct PayloadInterners {
    font_families: PayloadInterner<FontFamilies>,
    languages: PayloadInterner<LanguageTag>,
    text_shadows: PayloadInterner<Arc<[TextShadow]>>,
    box_shadows: PayloadInterner<Arc<[BoxShadow]>>,
    resolved_urls: PayloadInterner<ResolvedUrlV1>,
    transforms: PayloadInterner<TransformListV1>,
}

impl PayloadInterners {
    pub(super) fn canonicalize(
        &mut self,
        mut style: InlineFormattingStyleV1,
    ) -> InlineFormattingStyleV1 {
        style.font.families = self
            .font_families
            .intern(style.font.families, FontFamilies::storage_identity);
        style.text_flow.language = style
            .text_flow
            .language
            .map(|value| self.languages.intern(value, LanguageTag::storage_identity));
        style.paint.text_shadows = self
            .text_shadows
            .intern(style.paint.text_shadows, arc_slice_identity);
        style.paint.box_shadows = self
            .box_shadows
            .intern(style.paint.box_shadows, arc_slice_identity);
        if let Some(image) = &mut style.paint.background_image {
            image.url = self
                .resolved_urls
                .intern(image.url.clone(), ResolvedUrlV1::storage_identity);
        }
        style.paint.transform = self
            .transforms
            .intern(style.paint.transform, TransformListV1::storage_identity);
        style
    }
}

struct PayloadInterner<T> {
    values: HashSet<T>,
    canonical_addresses: HashSet<usize>,
}

impl<T> Default for PayloadInterner<T> {
    fn default() -> Self {
        Self {
            values: HashSet::new(),
            canonical_addresses: HashSet::new(),
        }
    }
}

impl<T> PayloadInterner<T>
where
    T: Clone + Eq + Hash,
{
    fn intern(&mut self, value: T, identity: fn(&T) -> usize) -> T {
        let address = identity(&value);
        if self.canonical_addresses.contains(&address) {
            return value;
        }
        if let Some(existing) = self.values.get(&value) {
            return existing.clone();
        }
        self.canonical_addresses.insert(address);
        self.values.insert(value.clone());
        value
    }
}

fn arc_slice_identity<T>(value: &Arc<[T]>) -> usize {
    value.as_ptr() as usize
}
