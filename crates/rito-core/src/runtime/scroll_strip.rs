//! One chapter laid out as a continuous strip, painted and recorded window
//! by window: the scrolled reading mode's pages of that chapter (see
//! [`crate::fragment_window`]).

use std::{ops::Range, rc::Rc, sync::Arc};

use rito_fragment::{CancelFlag, Fragment, LineText};

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::ChapterFormattingTree;
use crate::fragment_pagination::{chapter_is_vertical, layout_chapter_strip, paint_chapter_page};
use crate::fragment_paint::FragmentPaintContext;
use crate::fragment_window::{window_paint_tree, window_record_tree, ScrollAxis, ScrollWindows};
use crate::layout::LayoutConfig;
use crate::render::contract::{ReaderBlockPaint, ReaderColor};
use crate::render::{display_rect, DisplayCommand};

use super::fragment_frame::{paint_rect_command, RuntimeFragmentEngine};

#[cfg(test)]
mod test_views;

/// A chapter's strip with what painting and recording its windows reads.
pub(super) struct ChapterStrip {
    built: Rc<ChapterFormattingTree>,
    /// The paint alias of every face the engine shapes with.
    faces: Rc<[Arc<str>]>,
    /// The strip, its root at the content origin; its lines hold their
    /// text when it was laid out with it, and a window's text is laid out
    /// for it otherwise ([`Self::window_text`]).
    root: Fragment,
    windows: ScrollWindows,
    page_width: f64,
    page_height: f64,
    content_width: f64,
    /// The content box's height on a page, which images and `vh` resolve
    /// against.
    content_height: f64,
    /// The strip's block length: its height, or its width for a chapter
    /// that runs leftwards.
    strip_length: f64,
    /// The content origin in the chapter: the left and top margins.
    origin: (f64, f64),
    /// Where the strip starts along its block axis: the top margin, or the
    /// right margin for a chapter that runs leftwards.
    block_start: f64,
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
    /// a page long along its block axis (down for horizontal text, leftwards
    /// for vertical); without `line_text` its lines hold no text fragments,
    /// as a page laid out for pagination holds none, and each window's are
    /// laid out when it is read ([`Self::window_text`]).
    pub(super) fn lay_out(
        engine: &RuntimeFragmentEngine,
        faces: Rc<[Arc<str>]>,
        built: Rc<ChapterFormattingTree>,
        config: &LayoutConfig,
        line_text: bool,
    ) -> EpubResult<Self> {
        let axis = ScrollAxis::of_chapter(chapter_is_vertical(&built.tree));
        let (content_width, content_height) = (config.content_width(), config.content_height());
        if content_width <= 0.0 || content_height <= 0.0 {
            return Err(EpubError::new("page content box is empty"));
        }
        let root = layout_chapter_strip(
            &engine.engine,
            &built.tree,
            content_width,
            content_height,
            if line_text {
                LineText::All
            } else {
                LineText::Omitted
            },
            &CancelFlag::new(),
        )?;
        // A vertical-rl strip is laid out in the swapped frame: its block
        // length is its width, starting at the right margin.
        let strip_length = root.rect().height;
        let (length, block_start, block_end) = match axis {
            ScrollAxis::Down => (config.page_height, config.margin_top, config.margin_bottom),
            ScrollAxis::Left => (config.page_width, config.margin_right, config.margin_left),
        };
        Ok(Self {
            built,
            faces,
            root,
            windows: ScrollWindows::new(length, block_start + strip_length + block_end, axis),
            page_width: config.page_width,
            page_height: config.page_height,
            content_width,
            content_height,
            strip_length,
            origin: (config.margin_left, config.margin_top),
            block_start,
        })
    }

    pub(super) fn windows(&self) -> ScrollWindows {
        self.windows
    }

    /// Where the strip starts along its block axis: the top margin, or the
    /// right margin for a chapter that runs leftwards.
    pub(super) fn block_start(&self) -> f64 {
        self.block_start
    }

    /// What paints window `window`, laid out again with its text: the strip
    /// cut down to the fragments that reach the window, their lines holding
    /// their text, in the strip's coordinates. Only the lines the cut keeps
    /// are given their text, and the strip's geometry does not depend on
    /// which lines hold it, which the layout is held to.
    pub(super) fn window_text(
        &self,
        engine: &RuntimeFragmentEngine,
        window: usize,
    ) -> EpubResult<Fragment> {
        let windows = window..window + 1;
        // A line holds its text by where it starts, in the strip's own
        // coordinates (the root's); a pixel of slack either side covers
        // boxes that land on the layout grid after their lines decided
        // where they start.
        let line_text = match self.reaching(&self.root, &windows).line_top_span() {
            Some((first, last)) => LineText::Within {
                top: first - 1.0,
                bottom: last + 1.0,
            },
            None => LineText::Omitted,
        };
        Ok(self.reaching(&self.lay_out_text(engine, line_text)?, &windows))
    }

    /// Every window's records with their text, from one layout of the whole
    /// strip with it: what reading every window's text at once costs, as a
    /// search does, without a layout per window.
    pub(super) fn window_record_roots(
        &self,
        engine: &RuntimeFragmentEngine,
    ) -> EpubResult<Vec<Fragment>> {
        let root = self.lay_out_text(engine, LineText::All)?;
        Ok((0..self.windows.count())
            .map(|window| self.record_root(&root, window))
            .collect())
    }

    /// The strip laid out again with the text `line_text` names, its
    /// geometry held to the strip's.
    fn lay_out_text(
        &self,
        engine: &RuntimeFragmentEngine,
        line_text: LineText,
    ) -> EpubResult<Fragment> {
        let root = layout_chapter_strip(
            &engine.engine,
            &self.built.tree,
            self.content_width,
            self.content_height,
            line_text,
            &CancelFlag::new(),
        )?;
        if root.rect().height != self.strip_length {
            return Err(EpubError::new(
                "a chapter strip laid out with its text runs where it did not without",
            ));
        }
        Ok(root)
    }

    /// `root`, a layout of the strip, cut down to what can ink the run of
    /// windows `windows`: whatever comes within a window of them.
    fn reaching(&self, root: &Fragment, windows: &Range<usize>) -> Fragment {
        window_paint_tree(
            &self.built.tree,
            Some(&self.built.node_paints),
            root,
            self.block_start,
            self.windows.range(windows.start).start..self.windows.range(windows.end - 1).end,
            self.windows.length(),
        )
    }

    /// The run of windows `windows` (one, as a reader shows it) painted at
    /// `ratio` from `text`, a layout of the strip that holds their lines'
    /// text, in the chapter's coordinates, and where the run's top-left
    /// corner sits in the chapter, in device pixels: the page wash, the
    /// body's background over the whole strip (its tiles run on across
    /// windows), and the content that reaches the windows, clipped to them.
    pub(super) fn window_frame(
        &self,
        text: &Fragment,
        windows: Range<usize>,
        ratio: f64,
    ) -> EpubResult<(Vec<DisplayCommand>, (f64, f64))> {
        let length = (self.windows.device_rows(windows.end - 1, ratio).end
            - self.windows.device_rows(windows.start, ratio).start)
            / ratio;
        // A leftward run's top-left corner is its last window's.
        let origin = match self.windows.axis() {
            ScrollAxis::Down => self.windows.device_origin(windows.start, ratio),
            ScrollAxis::Left => self.windows.device_origin(windows.end - 1, ratio),
        };
        let (x, y) = (origin.0 / ratio, origin.1 / ratio);
        let (margin_left, margin_top) = self.origin;
        // As on a page, ink before the root box's inline start is cut at the
        // initial containing block and the inline end bleeds to the page
        // edge; along the block axis the run's own edges clip.
        let (wash, body, clip) = match self.windows.axis() {
            ScrollAxis::Down => (
                (0.0, y, self.page_width, length),
                (
                    margin_left,
                    margin_top,
                    self.content_width,
                    self.strip_length,
                ),
                (margin_left, y, self.page_width - margin_left, length),
            ),
            ScrollAxis::Left => (
                (x, 0.0, length, self.page_height),
                (
                    margin_left + self.content_width - self.strip_length,
                    margin_top,
                    self.strip_length,
                    self.content_height,
                ),
                (x, margin_top, length, self.page_height - margin_top),
            ),
        };
        let built = &self.built;
        let mut commands = vec![paint_rect_command(
            wash.0,
            wash.1,
            wash.2,
            wash.3,
            built.page_background.unwrap_or(ReaderColor::WHITE),
        )];
        if let Some(paint) = &built.page_background_image {
            commands.push(DisplayCommand::PaintBlock {
                rect: display_rect(body.0, body.1, body.2, body.3),
                paint: Box::new(ReaderBlockPaint {
                    background: Some(paint.clone()),
                    ..ReaderBlockPaint::default()
                }),
                border_box: None,
            });
        }
        commands.push(DisplayCommand::PushState);
        commands.push(DisplayCommand::ClipRect {
            rect: display_rect(clip.0, clip.1, clip.2, clip.3),
            radius: None,
        });
        commands.extend(self.content(text, &windows, ratio)?);
        commands.push(DisplayCommand::PopState);
        Ok((commands, origin))
    }

    /// What of `text` reaches the run of windows `windows`, painted at
    /// `ratio` in the chapter's coordinates.
    fn content(
        &self,
        text: &Fragment,
        windows: &Range<usize>,
        ratio: f64,
    ) -> EpubResult<Vec<DisplayCommand>> {
        let (margin_left, margin_top) = self.origin;
        let built = &self.built;
        paint_chapter_page(
            &built.tree,
            &self.reaching(text, windows),
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
            self.windows.axis() == ScrollAxis::Left,
        )
    }

    /// Window `window` as a page of the chapter: what it records, with its
    /// root moved up by the window's place in the strip, so its fragments
    /// sit in the window's content box as a page's sit in the page's. Its
    /// lines hold their text when the strip was laid out with it.
    pub(super) fn window_page_root(&self, window: usize) -> Fragment {
        self.record_root(&self.root, window)
    }

    /// [`Self::window_page_root`] from `text`, a layout of the strip that
    /// holds the window's lines' text ([`Self::window_text`]).
    pub(super) fn window_text_page_root(&self, text: &Fragment, window: usize) -> Fragment {
        self.record_root(text, window)
    }

    fn record_root(&self, root: &Fragment, window: usize) -> Fragment {
        let range = self.windows.range(window);
        match window_record_tree(root, self.block_start, range.clone()) {
            Fragment::Box(mut root) => {
                root.rect.y -= range.start;
                Fragment::Box(root)
            }
            other => other,
        }
    }
}
