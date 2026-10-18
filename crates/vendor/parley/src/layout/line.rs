// Copyright 2021 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::layout::Style;
use crate::layout::data::BreakReason;
use crate::layout::data::{LayoutItemKind, LineData};
use crate::layout::glyph::Glyph;
use crate::layout::layout::Layout;
use crate::layout::run::Run;
use crate::style::Brush;
use crate::{InlineBox, InlineBoxKind};
use core::ops::Range;

/// Line in a text layout.
#[derive(Copy, Clone)]
pub struct Line<'a, B: Brush> {
    pub(crate) layout: &'a Layout<B>,
    pub(crate) index: u32,
    pub(crate) data: &'a LineData,
}

impl<'a, B: Brush> Line<'a, B> {
    /// Returns the metrics for the line.
    pub fn metrics(&self) -> &LineMetrics {
        &self.data.metrics
    }

    pub fn break_reason(&self) -> BreakReason {
        self.data.break_reason
    }

    /// Rito: the max advances (after the line's indent) at which this line
    /// breaks exactly where it did, as `[floor, ceiling)`.
    pub fn fit_range(&self) -> (f32, f32) {
        (self.data.fit_floor, self.data.fit_ceiling)
    }

    /// Returns the range of text for the line.
    pub fn text_range(&self) -> Range<usize> {
        self.data.text_range.clone()
    }

    /// Returns the number of items in the line.
    pub fn len(&self) -> usize {
        self.data.item_range.len()
    }

    /// Returns `true` if the line is empty.
    pub fn is_empty(&self) -> bool {
        self.data.item_range.is_empty()
    }

    /// Returns the line item at the specified index.
    pub(crate) fn item(&self, index: usize) -> Option<LineItem<'a, B>> {
        let original_index = index;
        let index = self.data.item_range.start + index;
        if index >= self.data.item_range.end {
            return None;
        }
        let item = self.layout.data.line_items.get(index)?;

        Some(match item.kind {
            LayoutItemKind::TextRun => LineItem::Run(Run {
                layout: self.layout,
                line_index: self.index,
                index: original_index as u32,
                data: self.layout.data.runs.get(item.index)?,
                line_data: Some(item),
            }),
            LayoutItemKind::InlineBox => {
                LineItem::InlineBox(self.layout.data.inline_boxes.get(item.index)?)
            }
        })
    }

    /// Returns an iterator over the runs for the line.
    pub fn runs(&self) -> impl Iterator<Item = Run<'a, B>> + 'a + Clone {
        self.items_nonpositioned().filter_map(|item| item.run())
    }

    /// Returns an iterator over the non-glyph runs and inline boxes for the line.
    pub(crate) fn items_nonpositioned(&self) -> impl Iterator<Item = LineItem<'a, B>> + Clone {
        let copy = self.clone();
        let line_items = &copy.layout.data.line_items[self.data.item_range.clone()];
        line_items
            .iter()
            .enumerate()
            .map(move |(item_index, line_data)| match line_data.kind {
                LayoutItemKind::TextRun => LineItem::Run(Run {
                    layout: copy.layout,
                    line_index: copy.index,
                    index: item_index as u32,
                    data: &copy.layout.data.runs[line_data.index],
                    line_data: Some(line_data),
                }),
                LayoutItemKind::InlineBox => {
                    LineItem::InlineBox(&copy.layout.data.inline_boxes[line_data.index])
                }
            })
    }

    /// Rito: the line's glyph runs and inline boxes, split and ordered as
    /// [`Line::items`] splits and orders them, without reading a glyph or
    /// positioning anything. `items` ends a glyph run at the first glyph of
    /// another style; every glyph carries its cluster's style, so a glyph
    /// run here ends at the first cluster of another style that holds a
    /// glyph.
    pub fn style_runs(&self) -> impl Iterator<Item = LineStyleRun<'a, B>> + 'a + Clone {
        StyleRunIter {
            line: self.clone(),
            item_index: 0,
            cluster: 0,
        }
    }

    /// Rito: whether the line holds an inline box.
    pub fn has_inline_box(&self) -> bool {
        self.layout.data.line_items[self.data.item_range.clone()]
            .iter()
            .any(|item| item.kind == LayoutItemKind::InlineBox)
    }

    /// Returns an iterator over the glyph runs for the line.
    pub fn items(&self) -> impl Iterator<Item = PositionedLayoutItem<'a, B>> + 'a + Clone {
        GlyphRunIter {
            line: self.clone(),
            item_index: 0,
            cursor: GlyphCursor::default(),
            offset: 0.,
        }
    }
}

/// Metrics information for a line.
#[derive(Copy, Clone, Default, Debug, PartialEq)]
pub struct LineMetrics {
    /// Typographic ascent.
    pub ascent: f32,
    /// Typographic descent.
    pub descent: f32,
    /// Typographic leading.
    pub leading: f32,
    /// The absolute line height (in layout units).
    pub line_height: f32,
    /// Offset to the baseline.
    pub baseline: f32,
    /// Offset for alignment.
    pub offset: f32,
    /// Full advance of the line, including trailing whitespace.
    pub advance: f32,
    /// Advance of trailing whitespace.
    pub trailing_whitespace: f32,
    /// Minimum coordinate in the line direction.
    ///
    /// For horizontal text, this would be the left of the line.
    pub inline_min_coord: f32,
    /// Maximum coordinate in the line direction.
    ///
    /// For horizontal text, this would be the right of the line.
    pub inline_max_coord: f32,
    /// Minimum coordinate in the direction orthogonal to line
    /// direction.
    ///
    /// For horizontal text, this would be the top of the line.
    pub block_min_coord: f32,
    /// Maximum coordinate in the direction orthogonal to line
    /// direction.
    ///
    /// For horizontal text, this would be the bottom of the line.
    pub block_max_coord: f32,
}

impl LineMetrics {
    /// Returns the size of the line
    pub fn size(&self) -> f32 {
        self.line_height
    }
}

/// A line item and its corresponding data (a run or inline box). Unlike a
/// [`PositionedLayoutItem`], runs are not guaranteed to be split by style.
pub(crate) enum LineItem<'a, B: Brush> {
    Run(Run<'a, B>),
    InlineBox(&'a InlineBox),
}

impl<'a, B: Brush> LineItem<'a, B> {
    pub(crate) fn run(self) -> Option<Run<'a, B>> {
        match self {
            LineItem::Run(run) => Some(run),
            _ => None,
        }
    }
}

/// Rito: a glyph run of a line, by its run and style, or an inline box,
/// neither positioned.
#[derive(Clone)]
pub enum LineStyleRun<'a, B: Brush> {
    Glyphs {
        run: Run<'a, B>,
        style: &'a Style<B>,
    },
    InlineBox(&'a InlineBox),
}

#[derive(Clone)]
struct StyleRunIter<'a, B: Brush> {
    line: Line<'a, B>,
    item_index: usize,
    /// The next cluster of the current run, in visual order.
    cluster: usize,
}

impl<'a, B: Brush> Iterator for StyleRunIter<'a, B> {
    type Item = LineStyleRun<'a, B>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            match self.line.item(self.item_index)? {
                LineItem::InlineBox(inline_box) => {
                    self.item_index += 1;
                    self.cluster = 0;
                    return Some(LineStyleRun::InlineBox(inline_box));
                }
                LineItem::Run(run) => {
                    let range = run.cluster_range();
                    let len = range.len();
                    let rtl = run.is_rtl();
                    if !rtl {
                        // From the next cluster holding a glyph to the
                        // run's next style break, or the line's end.
                        let clusters = &run.layout.data.clusters;
                        let mut at = range.start + self.cluster;
                        while at < range.end && clusters[at].glyph_len == 0 {
                            at += 1;
                        }
                        if at < range.end {
                            let breaks =
                                &run.layout.data.style_breaks[run.data.style_breaks.clone()];
                            let next = breaks.partition_point(|index| *index as usize <= at);
                            let end = breaks
                                .get(next)
                                .map_or(range.end, |index| range.end.min(*index as usize));
                            self.cluster = end - range.start;
                            let style_index = clusters[at].style_index;
                            let style = run.layout.data.styles.get(usize::from(style_index))?;
                            return Some(LineStyleRun::Glyphs { run, style });
                        }
                        self.item_index += 1;
                        self.cluster = 0;
                        continue;
                    }
                    let clusters = &run.layout.data.clusters[range];
                    let at = |visual: usize| &clusters[if rtl { len - 1 - visual } else { visual }];
                    while self.cluster < len && at(self.cluster).glyph_len == 0 {
                        self.cluster += 1;
                    }
                    if self.cluster < len {
                        let style_index = at(self.cluster).style_index;
                        self.cluster += 1;
                        while self.cluster < len {
                            let cluster = at(self.cluster);
                            if cluster.glyph_len != 0 && cluster.style_index != style_index {
                                break;
                            }
                            self.cluster += 1;
                        }
                        let style = run.layout.data.styles.get(usize::from(style_index))?;
                        return Some(LineStyleRun::Glyphs { run, style });
                    }
                    self.item_index += 1;
                    self.cluster = 0;
                }
            }
        }
    }
}

/// The computed result of an item (glyph run or inline box) within a layout
#[derive(Clone)]
pub enum PositionedLayoutItem<'a, B: Brush> {
    GlyphRun(GlyphRun<'a, B>),
    InlineBox(PositionedInlineBox),
}

/// The computed position of an inline box within a layout
#[derive(Debug, Clone)]
pub struct PositionedInlineBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub id: u64,
    pub kind: InlineBoxKind,
}

/// Sequence of fully positioned glyphs with the same style.
#[derive(Clone)]
pub struct GlyphRun<'a, B: Brush> {
    run: Run<'a, B>,
    style: &'a Style<B>,
    /// Where the glyph run starts among the run's clusters: its glyphs are
    /// read from there instead of counted off from the run's start.
    start: GlyphCursor,
    glyph_count: usize,
    offset: f32,
    baseline: f32,
    advance: f32,
}

impl<'a, B: Brush> GlyphRun<'a, B> {
    /// Returns the underlying run.
    pub fn run(&self) -> &Run<'a, B> {
        &self.run
    }

    /// Returns the associated style.
    pub fn style(&self) -> &Style<B> {
        self.style
    }

    /// Returns the offset to the baseline.
    pub fn baseline(&self) -> f32 {
        self.baseline
    }

    /// Returns the offset to the first glyph along the baseline.
    pub fn offset(&self) -> f32 {
        self.offset
    }

    /// Returns the total advance of the run.
    pub fn advance(&self) -> f32 {
        self.advance
    }

    /// Returns an iterator over the glyphs in the run.
    pub fn glyphs(&'a self) -> impl Iterator<Item = Glyph> + 'a + Clone {
        VisualGlyphs {
            run: self.run.clone(),
            cursor: self.start,
        }
        .map(|(glyph, _)| glyph)
        .take(self.glyph_count)
    }

    /// Returns an iterator over the fully positioned glyphs in the run.
    pub fn positioned_glyphs(&'a self) -> impl Iterator<Item = Glyph> + 'a + Clone {
        let mut offset = self.offset;
        let baseline = self.baseline;
        self.glyphs().map(move |mut g| {
            g.x += offset;
            g.y += baseline;
            offset += g.advance;
            g
        })
    }
}

#[derive(Clone)]
struct GlyphRunIter<'a, B: Brush> {
    line: Line<'a, B>,
    item_index: usize,
    /// Where the next glyph run starts in the current run: each resumes
    /// here, where counting its glyphs off from the run's start made a run
    /// that changes style often quadratic in its length.
    cursor: GlyphCursor,
    offset: f32,
}

/// A place among a run's glyphs in visual order: the visual cluster, and
/// the glyph within it.
#[derive(Clone, Copy, Default)]
struct GlyphCursor {
    cluster: usize,
    glyph: usize,
}

/// A run's glyphs in visual order from a cursor, each with the cursor just
/// past it.
#[derive(Clone)]
struct VisualGlyphs<'a, B: Brush> {
    run: Run<'a, B>,
    cursor: GlyphCursor,
}

impl<B: Brush> Iterator for VisualGlyphs<'_, B> {
    type Item = (Glyph, GlyphCursor);

    /// Reads the run's cluster and glyph arrays in place: the glyphs a
    /// cluster's `glyphs()` yields, without building a cluster per glyph.
    fn next(&mut self) -> Option<Self::Item> {
        let range = self.run.cluster_range();
        let len = range.len();
        let rtl = self.run.is_rtl();
        let data = &self.run.layout.data;
        loop {
            if self.cursor.cluster >= len {
                return None;
            }
            let logical = if rtl {
                len - 1 - self.cursor.cluster
            } else {
                self.cursor.cluster
            };
            let cluster = data.clusters.get(range.start + logical)?;
            let glyph = if cluster.glyph_len == 0xFF {
                (self.cursor.glyph == 0).then_some(Glyph {
                    id: cluster.glyph_offset,
                    style_index: cluster.style_index,
                    x: 0.,
                    y: 0.,
                    advance: cluster.advance,
                })
            } else if self.cursor.glyph < cluster.glyph_len as usize {
                let start = self.run.data.glyph_start + cluster.glyph_offset as usize;
                data.glyphs.get(start + self.cursor.glyph).copied()
            } else {
                None
            };
            if let Some(glyph) = glyph {
                self.cursor.glyph += 1;
                return Some((glyph, self.cursor));
            }
            self.cursor = GlyphCursor {
                cluster: self.cursor.cluster + 1,
                glyph: 0,
            };
        }
    }
}

impl<'a, B: Brush> Iterator for GlyphRunIter<'a, B> {
    type Item = PositionedLayoutItem<'a, B>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let item = self.line.item(self.item_index)?;
            match item {
                LineItem::InlineBox(inline_box) => {
                    let x = self.offset
                        + self.line.data.metrics.inline_min_coord
                        + self.line.data.metrics.offset;

                    self.item_index += 1;
                    self.cursor = GlyphCursor::default();
                    if inline_box.kind == InlineBoxKind::InFlow {
                        self.offset += inline_box.width;
                    }
                    return Some(PositionedLayoutItem::InlineBox(PositionedInlineBox {
                        x,
                        y: self.line.data.metrics.baseline - inline_box.height,
                        width: inline_box.width,
                        height: inline_box.height,
                        id: inline_box.id,
                        kind: inline_box.kind,
                    }));
                }
                LineItem::Run(run) => {
                    let start = self.cursor;
                    let mut iter = VisualGlyphs {
                        run: run.clone(),
                        cursor: start,
                    };

                    if let Some((first, mut after)) = iter.next() {
                        let mut advance = first.advance;
                        let style_index = first.style_index();
                        let mut glyph_count = 1;
                        // The first glyph of another style starts the next
                        // glyph run: it is not consumed.
                        for (glyph, cursor) in iter {
                            if glyph.style_index() != style_index {
                                break;
                            }
                            glyph_count += 1;
                            advance += glyph.advance;
                            after = cursor;
                        }
                        let style = run.layout.data.styles.get(style_index)?;
                        self.cursor = after;
                        let offset = self.offset;
                        self.offset += advance;
                        return Some(PositionedLayoutItem::GlyphRun(GlyphRun {
                            run,
                            style,
                            start,
                            glyph_count,
                            offset: offset
                                + self.line.data.metrics.inline_min_coord
                                + self.line.data.metrics.offset,
                            baseline: self.line.data.metrics.baseline,
                            advance,
                        }));
                    }
                    self.item_index += 1;
                    self.cursor = GlyphCursor::default();
                }
            }
        }
    }
}
