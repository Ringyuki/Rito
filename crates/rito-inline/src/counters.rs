//! What the line loop did while laying a paragraph out, counted for the
//! tests that pin its cost: a paragraph is built (shaped) and broken into
//! lines a bounded number of times, however many line edges it decides.

use std::cell::Cell;

#[derive(Default)]
pub(crate) struct LineLoopCounts {
    /// Paragraphs built because no kept build read the same.
    pub(crate) builds: Cell<u64>,
    /// Line breakings run because no kept breaking matched.
    pub(crate) breaks: Cell<u64>,
    /// Passes deciding a paragraph's line edges.
    pub(crate) passes: Cell<u64>,
}

impl LineLoopCounts {
    pub(crate) fn note_build(&self) {
        self.builds.set(self.builds.get() + 1);
    }

    pub(crate) fn note_break(&self) {
        self.breaks.set(self.breaks.get() + 1);
    }

    pub(crate) fn note_pass(&self) {
        self.passes.set(self.passes.get() + 1);
    }
}
