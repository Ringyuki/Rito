//! The lines a paragraph build was broken into, kept with the build: a
//! layout that breaks a copy of it alike — the page laid out again with its
//! text after pagination broke the paragraph, a turn back to it — puts them
//! back instead of breaking the paragraph again, as the browser breaks a
//! paragraph once per width.

use std::cell::RefCell;

use rito_fragment::{ConstraintSpace, FloatBand};

/// How many differently broken copies of one build are kept: the line
/// loop breaks a build again only with lines it forces, a few at most.
const KEPT_BREAKS: usize = 4;

/// Everything a build's line breaking reads besides the build: the space it
/// lays out in (which also sized its images and inline blocks), the float
/// band its lines wrap around and the lines the loop forced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BreakKey {
    space: [Option<u64>; 3],
    band: Option<[u64; 3]>,
    forced: Vec<(usize, u32)>,
}

impl BreakKey {
    pub(crate) fn new(
        space: &ConstraintSpace,
        band: Option<FloatBand>,
        forced: &[(usize, u32)],
    ) -> Self {
        Self {
            space: [
                Some(space.inline_size),
                space.fragmentainer_size,
                space.containing_block_size,
            ]
            .map(|size| size.map(f64::to_bits)),
            band: band
                .map(|band| [band.left_inset, band.right_inset, band.bottom].map(f64::to_bits)),
            forced: forced.to_vec(),
        }
    }
}

/// The breaks kept for one build, shared by every copy of it.
#[derive(Default)]
pub(crate) struct KeptBreaks {
    kept: RefCell<Vec<(BreakKey, parley::LineBreaks)>>,
}

impl KeptBreaks {
    /// Puts the lines kept under `key` into `layout`, or breaks it with
    /// `breaking` and keeps what that left.
    pub(crate) fn break_or_restore(
        &self,
        layout: &mut parley::Layout<[u8; 4]>,
        key: BreakKey,
        breaking: impl FnOnce(&mut parley::Layout<[u8; 4]>),
    ) {
        let mut kept = self.kept.borrow_mut();
        if let Some(index) = kept.iter().position(|(kept_key, _)| *kept_key == key) {
            let entry = kept.remove(index);
            layout.restore_line_breaks(&entry.1);
            kept.push(entry);
            return;
        }
        breaking(layout);
        // The oldest kept breaks make room, their buffers reused.
        let mut breaks = if kept.len() == KEPT_BREAKS {
            kept.remove(0).1
        } else {
            parley::LineBreaks::default()
        };
        layout.keep_line_breaks(&mut breaks);
        kept.push((key, breaks));
    }
}
