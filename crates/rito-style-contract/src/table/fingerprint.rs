use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::Arc,
};

use crate::InlineFormattingStyleV1;

/// Builds a process-local lookup accelerator after nested payloads have been
/// canonicalized. Pointer identities are never persisted or exposed; equality
/// still decides matches, and first-seen input order still decides style IDs.
pub(super) fn style_fingerprint(style: &InlineFormattingStyleV1) -> u64 {
    let mut hasher = DefaultHasher::new();
    hash_font(style, &mut hasher);
    hash_text_flow(style, &mut hasher);
    style.bidi.hash(&mut hasher);
    style.fragment.hash(&mut hasher);
    hash_paint(style, &mut hasher);
    hasher.finish()
}

fn hash_font(style: &InlineFormattingStyleV1, hasher: &mut impl Hasher) {
    style.font.families.storage_identity().hash(hasher);
    style.font.is_system_font.hash(hasher);
    style.font.is_initial.hash(hasher);
    style.font.size.hash(hasher);
    style.font.weight.hash(hasher);
    style.font.slant.hash(hasher);
    style.font.line_height.hash(hasher);
}

fn hash_text_flow(style: &InlineFormattingStyleV1, hasher: &mut impl Hasher) {
    let text = &style.text_flow;
    text.text_align.hash(hasher);
    text.text_justify.hash(hasher);
    text.text_transform.hash(hasher);
    text.white_space_collapse.hash(hasher);
    text.text_wrap_mode.hash(hasher);
    text.word_break.hash(hasher);
    text.line_break.hash(hasher);
    text.overflow_wrap.hash(hasher);
    text.letter_spacing.hash(hasher);
    text.word_spacing.hash(hasher);
    text.text_indent.hash(hasher);
    text.language
        .as_ref()
        .map(crate::LanguageTag::storage_identity)
        .hash(hasher);
}

fn hash_paint(style: &InlineFormattingStyleV1, hasher: &mut impl Hasher) {
    style.paint.foreground.hash(hasher);
    style.paint.opacity.hash(hasher);
    style.paint.background.hash(hasher);
    match &style.paint.background_image {
        None => 0_u8.hash(hasher),
        Some(image) => {
            1_u8.hash(hasher);
            image.url.storage_identity().hash(hasher);
            image.size.hash(hasher);
            image.repeat.hash(hasher);
            image.position.hash(hasher);
        }
    }
    style.paint.transform.storage_identity().hash(hasher);
    style.paint.text_decoration.hash(hasher);
    arc_slice_identity(&style.paint.text_shadows).hash(hasher);
    arc_slice_identity(&style.paint.box_shadows).hash(hasher);
}

fn arc_slice_identity<T>(value: &Arc<[T]>) -> usize {
    value.as_ptr() as usize
}
