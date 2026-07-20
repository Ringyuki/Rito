#![allow(unsafe_code)]

use std::{
    cell::{Cell, UnsafeCell},
    sync::atomic::{AtomicBool, AtomicIsize, Ordering},
};

use selectors::matching::ElementSelectorFlags;
use style::{
    data::{ElementDataMut, ElementDataRef, ElementDataWrapper},
    invalidation::element::restyle_hints::RestyleHint,
};

use crate::device::full_restyle_damage;

/// The only interior-mutability boundary used by Stylo traversal.
///
/// Safety invariant: the owning `StyleDocument` always invokes Stylo with a
/// `None` Rayon pool. A resolve holds `&mut StyleDocument`, no sidecar borrow
/// survives the traversal, and the arena/sidecar cannot be mutated or dropped
/// until traversal completes. Stylo must also drop each `ElementDataRef` or
/// `ElementDataMut` before requesting another borrow of the same slot. Stylo's
/// `ElementDataWrapper` checks that contract in debug builds only; release
/// soundness therefore depends on this adapter preserving the exclusive,
/// non-reentrant traversal call graph. Stress tests exercise that invariant
/// with debug borrow checks enabled.
pub(crate) struct ElementStyleSlot {
    data: UnsafeCell<Option<ElementDataWrapper>>,
    pub(crate) selector_flags: Cell<ElementSelectorFlags>,
    pub(crate) dirty_descendants: AtomicBool,
    pub(crate) snapshot_handled: AtomicBool,
    pub(crate) children_to_process: AtomicIsize,
}

impl Default for ElementStyleSlot {
    fn default() -> Self {
        Self {
            data: UnsafeCell::new(None),
            selector_flags: Cell::new(ElementSelectorFlags::empty()),
            dirty_descendants: AtomicBool::new(true),
            snapshot_handled: AtomicBool::new(false),
            children_to_process: AtomicIsize::new(0),
        }
    }
}

impl ElementStyleSlot {
    pub(crate) fn has_data(&self) -> bool {
        // SAFETY: immutable inspection is allowed outside mutation phases;
        // traversal is sequential and owns the document exclusively.
        unsafe { (&*self.data.get()).is_some() }
    }

    pub(crate) fn borrow(&self) -> Option<ElementDataRef<'_>> {
        // SAFETY: see the type-level traversal invariant.
        unsafe { (&*self.data.get()).as_ref().map(|data| data.borrow()) }
    }

    pub(crate) fn mutate(&self) -> Option<ElementDataMut<'_>> {
        // SAFETY: only Stylo's exclusive sequential traversal calls this.
        unsafe { (&*self.data.get()).as_ref().map(|data| data.borrow_mut()) }
    }

    pub(crate) unsafe fn ensure(&self) -> ElementDataMut<'_> {
        // SAFETY: caller is Stylo's exclusive sequential traversal.
        let storage = self.data.get();
        if unsafe { (&*storage).is_none() } {
            let wrapper = ElementDataWrapper::default();
            wrapper.borrow_mut().damage = full_restyle_damage();
            // SAFETY: no borrow can exist before the slot is initialized.
            unsafe { *storage = Some(wrapper) };
        }
        // SAFETY: initialization above is complete, and the wrapper provides
        // the exclusive borrow used by Stylo. Debug builds dynamically verify
        // the no-overlap invariant described on `ElementStyleSlot`.
        unsafe { (&*storage).as_ref() }
            .expect("style data was initialized")
            .borrow_mut()
    }

    pub(crate) unsafe fn clear(&self) {
        // SAFETY: caller is Stylo's exclusive sequential traversal and no
        // ElementData borrow may survive this method.
        unsafe { *self.data.get() = None };
    }

    pub(crate) fn insert_restyle_hint(&self, hint: RestyleHint) {
        if let Some(mut data) = self.mutate() {
            data.hint.insert(hint);
        }
        self.dirty_descendants.store(true, Ordering::Relaxed);
    }
}
