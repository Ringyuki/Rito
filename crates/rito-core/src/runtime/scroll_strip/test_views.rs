//! What tests read of a strip: the strip itself, its windows lowered, and
//! its records whole and window by window.

use std::ops::Range;

use rito_fragment::Fragment;

use super::ChapterStrip;
use crate::epub::{EpubError, EpubResult};
use crate::render::{lower, shift, ImageSize, PrimitiveList};
use crate::runtime::page_artifact::FragmentPageArtifact;

impl ChapterStrip {
    /// The strip as it was laid out, with its text when it was laid out
    /// with it.
    pub(in crate::runtime) fn whole(&self) -> &Fragment {
        &self.root
    }

    /// The content of the run of windows `windows` lowered at `ratio`, in the
    /// chapter's coordinates and without the frame around it.
    pub(in crate::runtime) fn lowered_content(
        &self,
        windows: Range<usize>,
        ratio: f64,
        images: &dyn Fn(&str) -> Option<ImageSize>,
    ) -> EpubResult<PrimitiveList> {
        let commands = self.content(&self.root, &windows, ratio)?;
        lower(&commands, ratio, images).map_err(|error| EpubError::new(error.to_string()))
    }

    /// The run of windows `windows` lowered at `ratio` onto its own origin:
    /// its first device row is row 0.
    pub(in crate::runtime) fn lowered_window(
        &self,
        windows: Range<usize>,
        ratio: f64,
        images: &dyn Fn(&str) -> Option<ImageSize>,
    ) -> EpubResult<PrimitiveList> {
        let (commands, rows) = self.window_frame(&self.root, windows, ratio)?;
        let mut lowered =
            lower(&commands, ratio, images).map_err(|error| EpubError::new(error.to_string()))?;
        shift(&mut lowered, 0.0, -rows.start);
        Ok(lowered)
    }

    /// The whole strip's records, as one window over the chapter would hold
    /// them.
    pub(in crate::runtime) fn whole_artifact(&self) -> FragmentPageArtifact {
        FragmentPageArtifact::build(0, &self.root, &self.built, self.origin.0, self.origin.1)
    }

    /// Window `window`'s records, in CSS pixels from its top-left corner.
    pub(in crate::runtime) fn window_artifact(&self, window: usize) -> FragmentPageArtifact {
        let (margin_left, margin_top) = self.origin;
        FragmentPageArtifact::build(
            window,
            &self.window_page_root(window),
            &self.built,
            margin_left,
            margin_top,
        )
    }
}
