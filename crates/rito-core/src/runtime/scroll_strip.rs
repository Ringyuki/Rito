//! One chapter laid out as a continuous strip, painted and recorded window
//! by window: the scrolled reading mode's pages of that chapter (see
//! [`crate::fragment_window`]).

use std::{ops::Range, rc::Rc, sync::Arc};

use rito_fragment::{CancelFlag, Fragment};

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::ChapterFormattingTree;
use crate::fragment_pagination::{chapter_is_vertical, layout_chapter_strip, paint_chapter_page};
use crate::fragment_paint::FragmentPaintContext;
use crate::fragment_window::{window_paint_tree, window_record_tree, ScrollWindows};
use crate::layout::LayoutConfig;
use crate::render::contract::{ReaderBlockPaint, ReaderColor};
use crate::render::{display_rect, DisplayCommand};
#[cfg(test)]
use crate::render::{lower, shift, ImageSize, PrimitiveList};

use super::fragment_frame::{paint_rect_command, RuntimeFragmentEngine};
#[cfg(test)]
use super::page_artifact::FragmentPageArtifact;

/// A chapter's strip with what painting and recording its windows reads.
pub(super) struct ChapterStrip {
    built: Rc<ChapterFormattingTree>,
    /// The paint alias of every face the engine shapes with.
    faces: Rc<[Arc<str>]>,
    /// The strip, its root at the content origin; its lines hold their
    /// text when it was laid out with it.
    root: Fragment,
    windows: ScrollWindows,
    page_width: f64,
    content_width: f64,
    strip_length: f64,
    /// The content origin in the chapter: the left and top margins.
    origin: (f64, f64),
}

impl std::fmt::Debug for ChapterStrip {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The strip's fragments are the whole chapter; its windows name it.
        formatter
            .debug_struct("ChapterStrip")
            .field("windows", &self.windows)
            .finish_non_exhaustive()
    }
}

impl ChapterStrip {
    /// Lays the bridged chapter out as one strip under `config`, its windows
    /// a page tall; without `line_text` its lines hold no text fragments,
    /// as a page laid out for pagination holds none.
    pub(super) fn lay_out(
        engine: &RuntimeFragmentEngine,
        faces: Rc<[Arc<str>]>,
        built: Rc<ChapterFormattingTree>,
        config: &LayoutConfig,
        line_text: bool,
    ) -> EpubResult<Self> {
        if chapter_is_vertical(&built.tree) {
            return Err(EpubError::new(
                "a vertical-rl chapter scrolls across its columns: its strip is not laid out yet",
            ));
        }
        let (content_width, content_height) = (config.content_width(), config.content_height());
        if content_width <= 0.0 || content_height <= 0.0 {
            return Err(EpubError::new("page content box is empty"));
        }
        let root = layout_chapter_strip(
            &engine.engine,
            &built.tree,
            content_width,
            content_height,
            line_text,
            &CancelFlag::new(),
        )?;
        let strip_length = root.rect().height;
        let extent = config.margin_top + strip_length + config.margin_bottom;
        Ok(Self {
            built,
            faces,
            root,
            windows: ScrollWindows::new(config.page_height, extent),
            page_width: config.page_width,
            content_width,
            strip_length,
            origin: (config.margin_left, config.margin_top),
        })
    }

    pub(super) fn windows(&self) -> ScrollWindows {
        self.windows
    }

    /// The chapter's device rows the run of windows `windows` covers at
    /// `ratio`.
    fn device_rows(&self, windows: &Range<usize>, ratio: f64) -> Range<f64> {
        self.windows.device_rows(windows.start, ratio).start
            ..self.windows.device_rows(windows.end - 1, ratio).end
    }

    /// The run of windows `windows` (one, as a reader shows it) painted at
    /// `ratio`, in the chapter's coordinates, and the chapter's device rows
    /// it covers: the page wash, the body's background over the whole strip
    /// (its tiles run on across windows), and the content that reaches the
    /// windows, clipped to their rows.
    pub(super) fn window_frame(
        &self,
        windows: Range<usize>,
        ratio: f64,
    ) -> EpubResult<(Vec<DisplayCommand>, Range<f64>)> {
        let rows = self.device_rows(&windows, ratio);
        let (top, height) = (rows.start / ratio, (rows.end - rows.start) / ratio);
        let (margin_left, margin_top) = self.origin;
        let built = &self.built;
        let mut commands = vec![paint_rect_command(
            0.0,
            top,
            self.page_width,
            height,
            built.page_background.unwrap_or(ReaderColor::WHITE),
        )];
        if let Some(paint) = &built.page_background_image {
            commands.push(DisplayCommand::PaintBlock {
                rect: display_rect(
                    margin_left,
                    margin_top,
                    self.content_width,
                    self.strip_length,
                ),
                paint: Box::new(ReaderBlockPaint {
                    background: Some(paint.clone()),
                    ..ReaderBlockPaint::default()
                }),
                border_box: None,
            });
        }
        commands.push(DisplayCommand::PushState);
        // As on a page, ink left of the root box is cut at the initial
        // containing block and the right bleed is kept to the page edge.
        commands.push(DisplayCommand::ClipRect {
            rect: display_rect(margin_left, top, self.page_width - margin_left, height),
            radius: None,
        });
        commands.extend(self.content(top..top + height, ratio)?);
        commands.push(DisplayCommand::PopState);
        Ok((commands, rows))
    }

    /// The strip's content that reaches the block range `range` (the
    /// chapter's CSS pixels), painted at `ratio` in the chapter's
    /// coordinates.
    fn content(&self, range: Range<f64>, ratio: f64) -> EpubResult<Vec<DisplayCommand>> {
        let (margin_left, margin_top) = self.origin;
        let built = &self.built;
        let reaching = window_paint_tree(
            &built.tree,
            Some(&built.node_paints),
            &self.root,
            margin_top,
            range,
            self.windows.length(),
        );
        paint_chapter_page(
            &built.tree,
            &reaching,
            self.content_width,
            margin_left,
            margin_top,
            FragmentPaintContext {
                faces: Some(&self.faces),
                node_paints: Some(&built.node_paints),
                image_border_paints: Some(&built.image_border_paints),
                list_markers: Some(&built.list_markers),
                ruby_annotation_runs: Some(&built.ruby_annotation_runs),
                vertical_frame: None,
                flow_item_sources: Some(&built.flow_item_sources),
                ratio,
            },
            false,
        )
    }

    /// The content of the run of windows `windows` lowered at `ratio`, in the
    /// chapter's coordinates and without the frame around it.
    #[cfg(test)]
    pub(super) fn lowered_content(
        &self,
        windows: Range<usize>,
        ratio: f64,
        images: &dyn Fn(&str) -> Option<ImageSize>,
    ) -> EpubResult<PrimitiveList> {
        let rows = self.device_rows(&windows, ratio);
        let commands = self.content(rows.start / ratio..rows.end / ratio, ratio)?;
        lower(&commands, ratio, images).map_err(|error| EpubError::new(error.to_string()))
    }

    /// The run of windows `windows` lowered at `ratio` onto its own origin:
    /// its first device row is row 0.
    #[cfg(test)]
    pub(super) fn lowered_window(
        &self,
        windows: Range<usize>,
        ratio: f64,
        images: &dyn Fn(&str) -> Option<ImageSize>,
    ) -> EpubResult<PrimitiveList> {
        let (commands, rows) = self.window_frame(windows, ratio)?;
        let mut lowered =
            lower(&commands, ratio, images).map_err(|error| EpubError::new(error.to_string()))?;
        shift(&mut lowered, 0.0, -rows.start);
        Ok(lowered)
    }

    /// The whole strip's records, as one window over the chapter would hold
    /// them.
    #[cfg(test)]
    pub(super) fn whole_artifact(&self) -> FragmentPageArtifact {
        FragmentPageArtifact::build(0, &self.root, &self.built, self.origin.0, self.origin.1)
    }

    /// Window `window` as a page of the chapter: what it records, with its
    /// root moved up by the window's place in the strip, so its fragments
    /// sit in the window's content box as a page's sit in the page's.
    pub(super) fn window_page_root(&self, window: usize) -> Fragment {
        let range = self.windows.range(window);
        match window_record_tree(&self.root, self.origin.1, range.clone()) {
            Fragment::Box(mut root) => {
                root.rect.y -= range.start;
                Fragment::Box(root)
            }
            other => other,
        }
    }

    /// Window `window`'s records, in CSS pixels from its top-left corner.
    #[cfg(test)]
    pub(super) fn window_artifact(&self, window: usize) -> FragmentPageArtifact {
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
