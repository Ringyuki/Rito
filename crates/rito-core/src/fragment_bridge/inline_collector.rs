//! `InlineCollector`'s accumulation rules. Styled text, images, forced
//! breaks and childless boxes of one inline flow are appended with CSS
//! white-space collapsing applied across item boundaries, same-styled text
//! merged into a single shaping run, and each item's interaction provenance
//! (source node, enclosing link, item-to-source text mapping) recorded.

use rito_fragment::InlineItem;
use rito_style_contract::StyleId;

use super::{FlowItemSource, InlineCollector, SourceSegment};

impl InlineCollector {
    /// Records a run of collapsible white space with no content of its own.
    pub(super) fn push_collapsible_whitespace(&mut self, style: StyleId) {
        if self.has_content {
            self.pending_space = true;
            self.pending_space_style = Some(style);
        }
    }

    /// Appends one text node's content. A collapsed space belongs to the
    /// run that produced it (the CSS "first space of the sequence wins"
    /// rule), so a space pending from earlier nodes lands at the end of the
    /// previous item, while this node's own interior spaces stay here.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn push_text(
        &mut self,
        text: &str,
        style: StyleId,
        baseline_shift_px: f64,
        collapse: bool,
        ruby_annotation: Option<rito_fragment::RubyAnnotation>,
        source_index: Option<usize>,
        source_path: Option<Vec<usize>>,
    ) {
        let source = FlowItemSource {
            source_index,
            source_path,
            href: self.current_link.clone(),
            image_alt: None,
            segments: Vec::new(),
        };
        if !collapse {
            // `white-space: pre-wrap` — every space and segment break
            // lands verbatim (Blink keeps a calibre story's four-space
            // paragraph indents; the collapsing path erased them and
            // shifted every line of the chapter). A space pending from a
            // collapse-mode neighbour still materializes first.
            if text.is_empty() {
                return;
            }
            let utf16 = |value: &str| value.encode_utf16().count() as u32;
            let mut verbatim = String::with_capacity(text.len() + 1);
            if self.pending_space {
                verbatim.push(' ');
                self.pending_space = false;
                self.pending_space_style = None;
            }
            let lead = utf16(&verbatim);
            verbatim.push_str(text);
            let segments = vec![SourceSegment {
                item_start: lead,
                source_start: 0,
                len: utf16(text),
            }];
            self.has_content = true;
            self.append_text_item(
                verbatim,
                segments,
                source,
                style,
                baseline_shift_px,
                ruby_annotation,
            );
            return;
        }
        let is_space = |ch: char| matches!(ch, ' ' | '\t' | '\n' | '\r');
        let mut rest = text;
        // A collapsible space at the start of a line is removed (CSS Text
        // §4.1.3), and after a forced break the line start is knowable at
        // collection time: whether the space arrived as an inter-element
        // run (pending) or as this node's own leading white space, it
        // vanishes instead of shifting the line (measured: a chapter head
        // whose source indents the text after `<br/>` sat 0.25em right of
        // Blink's).
        if matches!(
            self.items.last(),
            Some(InlineItem::Text { text, .. }) if text.ends_with('\n')
        ) {
            self.pending_space = false;
            self.pending_space_style = None;
            rest = rest.trim_start_matches(is_space);
        }
        if self.pending_space {
            // The space belongs to an earlier node; this node's leading
            // white space folds into it and disappears. An inter-element
            // space whose style differs from the previous item's stands
            // alone: appending it would stretch that item's inline box
            // past the span's real end (measured: a boxed span's border
            // painted after the following space).
            // A space pending after a ruby base also stands alone: the
            // base item cannot absorb it (its annotation attaches to
            // exactly the base's extent), and silently dropping it erased
            // the base's own trailing collapsed space (b11: 原初之火
            // followed by ！ sat 0.25em left of the browser's line).
            let after_ruby = matches!(
                self.items.last(),
                Some(InlineItem::Text {
                    ruby_annotation: Some(_),
                    ..
                })
            );
            let standalone = after_ruby
                || match (self.pending_space_style, self.items.last()) {
                    (
                        Some(space_style),
                        Some(InlineItem::Text {
                            style: last_style, ..
                        }),
                    ) => *last_style != space_style,
                    (Some(_), _) => true,
                    (None, _) => false,
                };
            if standalone {
                let space_style = self
                    .pending_space_style
                    .or_else(|| match self.items.last() {
                        Some(InlineItem::Text { style, .. }) => Some(*style),
                        _ => None,
                    });
                if let Some(space_style) = space_style {
                    self.items.push(InlineItem::Text {
                        text: " ".to_owned(),
                        style: space_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    });
                    self.sources.push(FlowItemSource {
                        source_index: None,
                        source_path: None,
                        href: self.current_link.clone(),
                        image_alt: None,
                        segments: Vec::new(),
                    });
                }
            } else if let Some(InlineItem::Text {
                text: last,
                ruby_annotation: None,
                ..
            }) = self.items.last_mut()
            {
                last.push(' ');
            }
            self.pending_space = false;
            self.pending_space_style = None;
            rest = rest.trim_start_matches(is_space);
        } else if self.has_content {
            let trimmed = rest.trim_start_matches(is_space);
            if trimmed.len() != rest.len() {
                // This node's own leading space, after earlier content.
                rest = trimmed;
                if !rest.is_empty() {
                    // Materialized below with the first character.
                    self.pending_space = true;
                }
            }
        } else {
            // Flow-leading white space collapses away entirely.
            rest = rest.trim_start_matches(is_space);
        }

        let mut collapsed = String::with_capacity(rest.len());
        if self.pending_space && !rest.is_empty() {
            collapsed.push(' ');
            self.pending_space = false;
        }
        // Track the piecewise-linear item→source mapping while copying:
        // every skipped or synthesized space closes the open stretch.
        let utf16 = |value: &str| value.encode_utf16().count() as u32;
        let mut segments: Vec<SourceSegment> = Vec::new();
        let mut source_position = utf16(text) - utf16(rest);
        let mut collapsed_units = utf16(&collapsed);
        let mut open: Option<(u32, u32)> = None;
        let close = |open: &mut Option<(u32, u32)>,
                     segments: &mut Vec<SourceSegment>,
                     collapsed_units: u32| {
            if let Some((item_start, source_start)) = open.take() {
                segments.push(SourceSegment {
                    item_start,
                    source_start,
                    len: collapsed_units - item_start,
                });
            }
        };
        let mut interior_space = false;
        let mut trailing_space = false;
        for ch in rest.chars() {
            let units = ch.len_utf16() as u32;
            if is_space(ch) {
                close(&mut open, &mut segments, collapsed_units);
                source_position += units;
                interior_space = true;
                trailing_space = true;
                continue;
            }
            if interior_space {
                collapsed.push(' ');
                collapsed_units += 1;
                interior_space = false;
            }
            if open.is_none() {
                open = Some((collapsed_units, source_position));
            }
            trailing_space = false;
            collapsed.push(ch);
            collapsed_units += units;
            source_position += units;
            self.has_content = true;
        }
        close(&mut open, &mut segments, collapsed_units);
        if !collapsed.is_empty() {
            self.append_text_item(
                collapsed,
                segments,
                source,
                style,
                baseline_shift_px,
                ruby_annotation,
            );
        }
        if trailing_space && self.has_content {
            // This node ends in white space; it lands here if any content
            // follows, and collapses away at the end of the flow.
            self.pending_space = true;
            self.pending_space_style = None;
        }
    }

    /// Appends one prepared text run, merging into the previous item when
    /// the style and shift are unchanged so a paragraph of plain text
    /// stays a single shaping run. A ruby base never merges with its
    /// neighbours: its annotation attaches to exactly this run's laid-out
    /// extent. Merge identity ignores the mapping segments: two pushes of
    /// the same source node extend one item, their segments concatenating
    /// shifted by the existing item length.
    fn append_text_item(
        &mut self,
        collapsed: String,
        segments: Vec<SourceSegment>,
        source: FlowItemSource,
        style: StyleId,
        baseline_shift_px: f64,
        ruby_annotation: Option<rito_fragment::RubyAnnotation>,
    ) {
        let utf16 = |value: &str| value.encode_utf16().count() as u32;
        let same_source = self.sources.last().is_some_and(|last| {
            last.source_index == source.source_index
                && last.source_path == source.source_path
                && last.href == source.href
                && last.image_alt == source.image_alt
        });
        if let Some(InlineItem::Text {
            text: last,
            style: last_style,
            baseline_shift_px: last_shift,
            ruby_annotation: last_ruby,
        }) = self.items.last_mut()
        {
            if *last_style == style
                && *last_shift == baseline_shift_px
                && last_ruby.is_none()
                && ruby_annotation.is_none()
                && same_source
            {
                let shift = utf16(last);
                last.push_str(&collapsed);
                if let Some(last_source) = self.sources.last_mut() {
                    last_source
                        .segments
                        .extend(segments.iter().map(|segment| SourceSegment {
                            item_start: segment.item_start + shift,
                            ..*segment
                        }));
                }
                return;
            }
        }
        let mut source = source;
        source.segments = segments;
        self.items.push(InlineItem::Text {
            text: collapsed,
            style,
            baseline_shift_px,
            ruby_annotation,
        });
        self.sources.push(source);
    }

    /// Appends a forced line break as a preserved newline in the flow text.
    ///
    /// The break keeps its own inherited style: a `<br>` is an inline
    /// element whose font participates in the envelope of the line it
    /// ends (measured on b39's id210: a 16px-span's leading <br> after a
    /// 12px line grows that line's box from 20.2031 to 21.2031 — folding
    /// the newline into the previous 12px item lost the pixel and shifted
    /// the whole rest of the page). Same-styled breaks still fold into
    /// the previous run so the common case stays one item.
    pub(super) fn push_hard_break(&mut self, style: StyleId, baseline_shift_px: f64) {
        self.pending_space = false;
        if let Some(InlineItem::Text {
            text: last,
            ruby_annotation: None,
            style: last_style,
            ..
        }) = self.items.last_mut()
        {
            if *last_style == style {
                last.push('\n');
                self.has_content = true;
                return;
            }
        }
        {
            self.sources.push(FlowItemSource {
                source_index: None,
                source_path: None,
                href: self.current_link.clone(),
                image_alt: None,
                segments: Vec::new(),
            });
            self.items.push(InlineItem::Text {
                text: "\n".to_owned(),
                style,
                baseline_shift_px,
                ruby_annotation: None,
            });
        }
        self.has_content = true;
    }

    /// Appends an atomic image item. A space pending from earlier text
    /// lands on that text; a space pending between two images collapses
    /// away (an accepted gap until mixed image runs need it).
    pub(super) fn push_image(
        &mut self,
        item: InlineItem,
        source_index: usize,
        source_path: Vec<usize>,
        alt: &str,
    ) {
        if self.pending_space {
            if let Some(InlineItem::Text {
                text: last,
                ruby_annotation: None,
                ..
            }) = self.items.last_mut()
            {
                last.push(' ');
            }
            self.pending_space = false;
        }
        self.sources.push(FlowItemSource {
            source_index: Some(source_index),
            source_path: Some(source_path),
            href: self.current_link.clone(),
            image_alt: (!alt.is_empty()).then(|| alt.to_owned()),
            segments: Vec::new(),
        });
        self.items.push(item);
        self.has_content = true;
    }

    /// Records a childless inline box: no advance, no content, but the
    /// open box's leaded envelope still joins its line's metrics. A
    /// collapsed space pending from earlier nodes settles into the
    /// PREVIOUS text run first — the box would otherwise sit between
    /// the space and its owner and the attach would miss ("catalogued
    /// for" fused into "cataloguedfor" across a mid-sentence empty
    /// anchor, reflowing a whole calibre book).
    pub(super) fn push_empty_box(
        &mut self,
        style: StyleId,
        baseline_shift_px: f64,
        source_index: usize,
    ) {
        if self.pending_space {
            if let Some(InlineItem::Text {
                text: last,
                ruby_annotation: None,
                ..
            }) = self.items.last_mut()
            {
                last.push(' ');
                self.pending_space = false;
            }
        }
        self.sources.push(FlowItemSource {
            source_index: Some(source_index),
            source_path: None,
            href: self.current_link.clone(),
            image_alt: None,
            segments: Vec::new(),
        });
        self.items.push(InlineItem::EmptyBox {
            style,
            baseline_shift_px,
        });
    }

    pub(super) fn finish(self) -> (Vec<InlineItem>, Vec<FlowItemSource>) {
        // Trailing pending space is dropped: flow-final white space
        // collapses away.
        debug_assert_eq!(self.items.len(), self.sources.len());
        (self.items, self.sources)
    }
}
