//! Detection of properties an element declares for itself.
//!
//! The computed-value contract deliberately carries no cascade provenance.
//! One consumer semantic still needs it: the retired resolver's style map
//! inherited `line-height` as an opaque pair (ratio plus pixels), so an
//! element that does not declare `line-height` keeps its ancestor's ratio
//! even when its own font size differs. Computed values alone cannot
//! distinguish that from a declaration that resolves to the same pixels, so
//! the projection reports the one bit the cascade knows.

use style::properties::{LonghandId, PropertyDeclarationId};
use style::shared_lock::SharedRwLock;
use style::shared_lock::StylesheetGuards;

use style::properties::ComputedValues;

/// Reports whether `line-height` is declared by a rule matching this element
/// or by its style attribute, as opposed to being inherited.
pub(super) fn declares_line_height(styles: &ComputedValues, lock: &SharedRwLock) -> bool {
    let guard = lock.read();
    // The adapter parses every origin under one shared lock.
    let guards = StylesheetGuards::same(&guard);
    let target = PropertyDeclarationId::Longhand(LonghandId::LineHeight);
    let Some(rules) = styles.rules.as_ref() else {
        return false;
    };
    rules.self_and_ancestors().any(|node| {
        node.style_source().is_some_and(|source| {
            source
                .read(node.cascade_level().guard(&guards))
                .get(target)
                .is_some()
        })
    })
}
