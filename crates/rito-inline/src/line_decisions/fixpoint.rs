//! Conditional line-end trim, to a fixpoint: find the first soft
//! break Chromium would have extended past a trimmed closing glyph,
//! apply that trim, re-lay, and keep it only if the line then breaks
//! exactly after the trimmed closer — parley's own fitting and break
//! rules stay the authority over what an accepted trim produces.
//! Each accepted trim finalizes one more line, so the loop is
//! bounded by the line count (plus one rebuild per rejection).
//!
//! Every decision builds the paragraph again and breaks all its lines,
//! so a paragraph pays its whole build once per decision.

use super::*;

impl ParleyInlineContext {
    pub(crate) fn fixpoint_line_edges(
        &self,
        inputs: &LineEdgeInputs<'_>,
        bounds: &mut WidthBounds,
    ) -> Result<(DecidedParagraph, DecidedEdits), LayoutError> {
        let LineEdgeInputs {
            tree,
            root,
            space,
            band,
            item_text_ranges,
            cancel,
        } = *inputs;
        let break_lines = |layout: &mut parley::Layout<[u8; 4]>, forced: &[(usize, usize)]| {
            break_paragraph_lines(layout, space, band, forced);
        };
        let line_max_advance = |line_top: f64| line_max_advance(space, band, line_top);
        let mut end_trims: Vec<usize> = Vec::new();
        let mut rejected_trims: Vec<usize> = Vec::new();
        let mut suppressed_pair_trims: Vec<usize> = Vec::new();
        let mut forced_line_breaks: Vec<(usize, usize)> = Vec::new();
        let mut pending_trim: Option<usize> = None;
        let (
            layout,
            alignment,
            shifted_ranges,
            first_line_indent,
            item_box_sheds,
            forced_line_indents,
            ruby_spreads,
            ruby_spread_overhangs,
            ruby_spread_overhangs_right,
            ruby_center_shifts,
            opener_halt_trims,
            inline_block_boxes,
            inline_block_baselines,
            image_edge_insets,
            empty_box_struts,
            spacing_edits,
            cluster_steps,
        ) = {
            let mut split_spread_edits: Vec<(std::ops::Range<usize>, f32)> = Vec::new();
            let mut split_spread_rounds = 0u32;
            loop {
                if cancel.is_cancelled() {
                    return Err(LayoutError::Cancelled);
                }
                let ParagraphLayout {
                    mut layout,
                    alignment,
                    shifted_ranges,
                    text,
                    spacing_edits,
                    first_line_indent,
                    pair_trims,
                    opener_halt_trims,
                    item_box_sheds,
                    forced_line_indents,
                    ruby_spreads,
                    ruby_spread_overhangs,
                    ruby_spread_overhangs_right,
                    ruby_annotation_widths,
                    ruby_center_shifts,
                    inline_block_boxes,
                    inline_block_baselines,
                    image_edge_insets,
                    empty_box_struts,
                    cluster_steps,
                    line_end_trims,
                    kept_breaks,
                    spacing_plan: _,
                    kept_decisions: _,
                    reads_space,
                } = self.shaped_paragraph(
                    tree,
                    root,
                    space,
                    ParagraphEdits {
                        end_trims: &end_trims,
                        suppressed_pair_trims: &suppressed_pair_trims,
                        split_spreads: &split_spread_edits,
                    },
                    cancel,
                )?;
                // A copy of this build broken alike before takes its lines
                // back rather than breaking again.
                kept_breaks.break_or_restore(
                    &mut layout,
                    BreakKey::new(space, band, &forced_line_breaks),
                    |layout| {
                        #[cfg(test)]
                        self.counts.note_break();
                        break_lines(layout, &forced_line_breaks);
                    },
                );
                if reads_space {
                    bounds.pin();
                }
                // Every line's fit, against the max advance the breaker gave
                // it: the inline size plus the fit tolerance, less a float
                // band's insets inside the band and the indent on the first
                // line.
                let mut line_top = 0.0_f64;
                for (index, line) in layout.lines().enumerate() {
                    let indent = if index == 0 { first_line_indent } else { 0.0 };
                    let inside_band = band.is_some_and(|band| line_top < band.bottom);
                    if let (true, Some(band)) = (inside_band, band) {
                        if space.inline_size - band.left_inset - band.right_inset <= 0.0 {
                            bounds.pin();
                        }
                    }
                    let limit =
                        (f64::from(line_max_advance(line_top)) + LINE_FIT_EPSILON) as f32 - indent;
                    let (floor, ceiling) = line.fit_range();
                    bounds.fit_range(f64::from(floor), f64::from(ceiling), f64::from(limit));
                    line_top += f64::from(line.metrics().line_height);
                }
                // A pair trim is only real while both glyphs share a line
                // (measured: a line-final comma keeps its full width when its
                // partner bracket opens the next line, and the line's justify
                // slack follows). Suppress every straddled pair and re-lay to
                // a fixpoint; suppression only widens lines, so breaks only
                // move earlier and the loop is bounded by the pair count.
                {
                    let mut straddled = false;
                    for (left_byte, right_byte) in &pair_trims {
                        if layout
                            .lines()
                            .any(|line| line.text_range().start == *right_byte)
                            && !suppressed_pair_trims.contains(left_byte)
                        {
                            suppressed_pair_trims.push(*left_byte);
                            straddled = true;
                        }
                    }
                    if straddled {
                        forced_line_breaks.clear();
                        continue;
                    }
                }
                if let Some(byte) = pending_trim.take() {
                    let trimmed_end = byte + text[byte..].chars().next().map_or(1, char::len_utf8);
                    let confirmed = layout
                        .lines()
                        .any(|line| line.text_range().end == trimmed_end);
                    if !confirmed {
                        end_trims.retain(|&trim| trim != byte);
                        rejected_trims.push(byte);
                        continue;
                    }
                }
                // Ruby split-fit, before any trim reasoning: a soft break
                // inside a ruby base is legal only while the first segment
                // still fits carrying its WHOLE annotation — the segment
                // widens to at least the annotation's advance (measured:
                // 608px of text plus 异 at 16px fit a 627.2px line, but the
                // segment carries Talent at 23px and Blink sends the ruby
                // down; 黄金妖|精 stays split because 黄金妖 at 48px covers
                // Leprechaun's 44px). An overflowing split rewinds the line
                // to the item start and re-lays.
                if !ruby_annotation_widths.is_empty() {
                    let mut rewound_ruby = false;
                    let mut line_top = 0.0_f64;
                    for index in 0..layout.len().saturating_sub(1) {
                        let indent = if index == 0 { first_line_indent } else { 0.0 };
                        let max_advance =
                            f64::from(line_max_advance(line_top) - indent) + LINE_FIT_EPSILON;
                        line_top += layout
                            .get(index)
                            .map_or(0.0, |line| f64::from(line.metrics().line_height));
                        if forced_line_breaks.iter().any(|(line, _)| *line == index) {
                            continue;
                        }
                        let Some(line) = layout.get(index) else {
                            continue;
                        };
                        if line.break_reason() != parley::layout::BreakReason::Regular {
                            continue;
                        }
                        let range = line.text_range();
                        let Some((item_start, annotation_width)) = item_text_ranges
                            .iter()
                            .enumerate()
                            .find_map(|(item, item_range)| {
                                (item_range.start < range.end && range.end < item_range.end)
                                    .then(|| {
                                        ruby_annotation_widths
                                            .get(&item)
                                            .map(|width| (item_range.start, *width))
                                    })
                                    .flatten()
                            })
                        else {
                            continue;
                        };
                        // The split's first segment must START on this line;
                        // a base already split earlier has nothing to rewind.
                        if item_start < range.start {
                            continue;
                        }
                        let mut segment_advance = 0.0_f64;
                        let mut cluster =
                            parley::layout::Cluster::from_byte_index(&layout, item_start);
                        while let Some(current) = cluster {
                            if current.text_range().start >= range.end {
                                break;
                            }
                            segment_advance += f64::from(current.advance());
                            cluster = current.next_logical();
                        }
                        // A multi-word annotation splits at its spaces and
                        // only the words allocated to THIS segment (by
                        // character-midpoint position) must fit over it —
                        // 正|规勇者 under "Legal Brave" keeps the split
                        // because 正 carries only Legal (measured matrix).
                        let segment_annotation_width = {
                            let item_index = item_text_ranges
                                .iter()
                                .position(|candidate| candidate.start == item_start);
                            let annotation =
                                item_index.and_then(|index| match &tree.node(root).content {
                                    FormattingNodeContent::InlineFlow { items } => {
                                        match items.get(index) {
                                            Some(InlineItem::Text {
                                                ruby_annotation: Some(annotation),
                                                ..
                                            }) => Some(annotation.text.clone()),
                                            _ => None,
                                        }
                                    }
                                    _ => None,
                                });
                            let item_range =
                                item_index.map(|index| item_text_ranges[index].clone());
                            let total_chars = item_range
                                .as_ref()
                                .and_then(|item| text.get(item.clone()))
                                .map_or(0, |base| base.chars().count());
                            let segment_chars = text
                                .get(item_start..range.end)
                                .map_or(0, |segment| segment.chars().count());
                            match annotation {
                                Some(annotation) if total_chars > 0 => {
                                    let ratio = segment_chars as f64 / total_chars as f64;
                                    let allocated = rito_fragment::allocate_ruby_annotation(
                                        &annotation,
                                        0.0,
                                        ratio,
                                    );
                                    if allocated == annotation {
                                        annotation_width
                                    } else if allocated.is_empty() {
                                        0.0
                                    } else {
                                        // Approximate the allocated words'
                                        // advance by character share — exact
                                        // enough for the fit decision, and
                                        // both ends stay measurement-free.
                                        annotation_width * allocated.chars().count() as f64
                                            / annotation.chars().count().max(1) as f64
                                    }
                                }
                                _ => annotation_width,
                            }
                        };
                        // The segment's box presses its allocated
                        // annotation's advance on the line, minus the RUBY's
                        // own spread overhang — an unspread ruby (annotation
                        // narrower than the whole base) overhangs nothing, so
                        // its full allocated advance presses (measured:
                        // 异/Talent rewinds at 19.875 where the segment-local
                        // half-excess would have squeaked by; spread
                        // 咒/Thaumaturgy keeps its split at 42.95 − 2.74).
                        let segment_box = {
                            let overhang = item_text_ranges
                                .iter()
                                .position(|candidate| candidate.start == item_start)
                                .and_then(|index| ruby_spread_overhangs.get(&index))
                                .copied()
                                .unwrap_or(0.0);
                            (segment_annotation_width - overhang).max(segment_advance)
                        };
                        if segment_box <= segment_advance + LINE_FIT_EPSILON {
                            continue;
                        }
                        let metrics = line.metrics();
                        let natural =
                            f64::from(metrics.advance) - f64::from(metrics.trailing_whitespace);
                        if bounds.fits(natural - segment_advance + segment_box, max_advance) {
                            continue;
                        }
                        if item_start <= range.start {
                            continue;
                        }
                        forced_line_breaks.push((index, item_start));
                        rewound_ruby = true;
                        break;
                    }
                    if rewound_ruby {
                        continue;
                    }
                }
                // A ruby base SPLIT across lines spreads each on-line
                // segment to its allocated annotation words' advance
                // (measured on a walk-mirrored page: 'Leprechaun' over the
                // split 黄金|妖精 spreads the first segment's 黄 to a
                // 21.77px box — 16 + excess/(2·n) space-around shares —
                // while the whole-base test saw a narrow annotation and
                // left it packed). Once per layout round, capped at two
                // rounds: the widening itself can move the break.
                if split_spread_rounds < 2 && !ruby_annotation_widths.is_empty() {
                    let mut new_edits: Vec<(std::ops::Range<usize>, f32)> = Vec::new();
                    for index in 0..layout.len() {
                        let Some(line) = layout.get(index) else {
                            continue;
                        };
                        let line_range = line.text_range();
                        for (item, item_range) in item_text_ranges.iter().enumerate() {
                            let Some(annotation_width) = ruby_annotation_widths.get(&item).copied()
                            else {
                                continue;
                            };
                            // Only a SPLIT base qualifies; whole bases took
                            // the shaping-time spread law already.
                            let split = item_range.start < line_range.end
                                && line_range.start < item_range.end
                                && (item_range.start < line_range.start
                                    || item_range.end > line_range.end);
                            if !split {
                                continue;
                            }
                            let seg_start = item_range.start.max(line_range.start);
                            let seg_end = item_range.end.min(line_range.end);
                            if seg_end <= seg_start {
                                continue;
                            }
                            if split_spread_edits
                                .iter()
                                .chain(new_edits.iter())
                                .any(|(range, _)| range.start == seg_start)
                            {
                                continue;
                            }
                            let annotation_text = match &tree.node(root).content {
                                FormattingNodeContent::InlineFlow { items } => {
                                    match items.get(item) {
                                        Some(InlineItem::Text {
                                            ruby_annotation: Some(annotation),
                                            ..
                                        }) => annotation.text.clone(),
                                        _ => continue,
                                    }
                                }
                                _ => continue,
                            };
                            let total_chars = text
                                .get(item_range.clone())
                                .map_or(0, |base| base.chars().count());
                            if total_chars == 0 {
                                continue;
                            }
                            let before = text
                                .get(item_range.start..seg_start)
                                .map_or(0.0, |t| t.chars().count() as f64);
                            let through = text
                                .get(item_range.start..seg_end)
                                .map_or(0.0, |t| t.chars().count() as f64);
                            let allocated = rito_fragment::allocate_ruby_annotation(
                                &annotation_text,
                                before / total_chars as f64,
                                if seg_end >= item_range.end {
                                    f64::INFINITY
                                } else {
                                    through / total_chars as f64
                                },
                            );
                            if allocated.is_empty() {
                                continue;
                            }
                            let allocated_width = annotation_width
                                * allocated.chars().count() as f64
                                / annotation_text.chars().count().max(1) as f64;
                            let mut segment_advance = 0.0_f64;
                            let mut cluster =
                                parley::layout::Cluster::from_byte_index(&layout, seg_start);
                            while let Some(current) = cluster {
                                if current.text_range().start >= seg_end {
                                    break;
                                }
                                segment_advance += f64::from(current.advance());
                                cluster = current.next_logical();
                            }
                            let excess = allocated_width - segment_advance;
                            if excess <= 0.01 {
                                continue;
                            }
                            let seg_chars = text
                                .get(seg_start..seg_end)
                                .map_or(0, |t| t.chars().count());
                            if seg_chars == 0 {
                                continue;
                            }
                            let n = seg_chars as f64;
                            let gap = excess / n;
                            let last_cluster_start = text
                                .get(seg_start..seg_end)
                                .and_then(|t| t.char_indices().next_back())
                                .map_or(seg_start, |(offset, _)| seg_start + offset);
                            if seg_chars >= 2 && last_cluster_start > seg_start {
                                new_edits.push((seg_start..last_cluster_start, gap as f32));
                            }
                            // Edge share carried by the segment's last
                            // cluster (half a share per side).
                            new_edits
                                .push((last_cluster_start..seg_end, (excess / (2.0 * n)) as f32));
                        }
                    }
                    if !new_edits.is_empty() {
                        split_spread_edits.extend(new_edits);
                        split_spread_rounds += 1;
                        continue;
                    }
                }
                // The straddle pass above holds pairs a line break separated
                // at full width. For the line-end extension those openers
                // must be measured back in their mid-line (trimmed) form —
                // collect (opener byte, pair left byte) for every suppressed
                // opener-halt pair.
                let suppressed_openers: Vec<(usize, usize)> = suppressed_pair_trims
                    .iter()
                    .filter_map(|&left_byte| {
                        let left = text[left_byte..].chars().next()?;
                        let right_byte = left_byte + left.len_utf8();
                        let right = text[right_byte..].chars().next()?;
                        (cjk_punctuation_trim(left, right) == Some(TrimmedGlyph::Right))
                            .then_some((right_byte, left_byte))
                    })
                    .collect();
                // Both the line-end trim and the rewind need an eligible
                // closer in a `halt` face to overflow; a paragraph without
                // one cannot take either at any width, so neither scan runs.
                let scanned_lines = if *line_end_trims
                    .get_or_init(|| line_end_trims_possible(&self.catalog, &layout, &text))
                {
                    layout.len().saturating_sub(1)
                } else {
                    0
                };
                let mut line_top = 0.0_f64;
                let candidate = (0..scanned_lines).find_map(|index| {
                    // The text-indent margin narrows the first line's
                    // available advance exactly as it narrowed Parley's fit.
                    let indent = if index == 0 { first_line_indent } else { 0.0 };
                    // The trim candidate models the breaker's fit, so it sees
                    // the same epsilon-widened advance the breaker used.
                    let max_advance = line_max_advance(line_top) + LINE_FIT_EPSILON as f32 - indent;
                    line_top += layout
                        .get(index)
                        .map_or(0.0, |line| f64::from(line.metrics().line_height));
                    // An engine-forced break (a rewind, a ruby split) is not a
                    // fit decision, but parley stamps it BreakReason::Regular
                    // all the same — extending past one would fabricate a
                    // candidate out of the very content the rewind pushed
                    // down and then unwind the rewind (measured: b1's
                    // razor-fit ① note line re-merged this way).
                    if forced_line_breaks.iter().any(|(line, _)| *line == index) {
                        return None;
                    }
                    line_end_trim_candidate(
                        &self.catalog,
                        &layout,
                        &text,
                        index,
                        max_advance,
                        |byte| end_trims.contains(&byte) || rejected_trims.contains(&byte),
                        &suppressed_openers,
                        &mut *bounds,
                    )
                });
                match candidate {
                    Some((byte, unsuppress)) => {
                        end_trims.push(byte);
                        suppressed_pair_trims.retain(|left| !unsuppress.contains(left));
                        pending_trim = Some(byte);
                        forced_line_breaks.clear();
                    }
                    None => {
                        // Rejected-extension rewind: when the line-end trim
                        // extension would fit but the line crosses an element
                        // boundary (the single-item gate), the browser sends
                        // the WHOLE overflowing item to the next line instead
                        // of breaking greedily inside it. Force that line to
                        // hold exactly the clusters before the item and
                        // re-lay; one rewind per pass keeps earlier line
                        // indices stable.
                        let mut line_top = 0.0_f64;
                        let mut rewound = false;
                        for index in 0..scanned_lines {
                            let indent = if index == 0 { first_line_indent } else { 0.0 };
                            let max_advance =
                                f64::from(line_max_advance(line_top) - indent) + LINE_FIT_EPSILON;
                            line_top += layout
                                .get(index)
                                .map_or(0.0, |line| f64::from(line.metrics().line_height));
                            if forced_line_breaks.iter().any(|(line, _)| *line == index) {
                                continue;
                            }
                            let Some(end) = rewind_break_end(
                                &self.catalog,
                                &layout,
                                &text,
                                index,
                                max_advance,
                                item_text_ranges,
                                &mut *bounds,
                            ) else {
                                continue;
                            };
                            forced_line_breaks.push((index, end));
                            rewound = true;
                            break;
                        }
                        if rewound {
                            continue;
                        }
                        break (
                            layout,
                            alignment,
                            shifted_ranges,
                            first_line_indent,
                            item_box_sheds,
                            forced_line_indents,
                            ruby_spreads,
                            ruby_spread_overhangs,
                            ruby_spread_overhangs_right,
                            ruby_center_shifts,
                            opener_halt_trims,
                            inline_block_boxes,
                            inline_block_baselines,
                            image_edge_insets,
                            empty_box_struts,
                            spacing_edits,
                            cluster_steps,
                        );
                    }
                }
            }
        };
        let edits = DecidedEdits {
            end_trims,
            suppressed_pair_trims,
            forced: forced_line_breaks,
        };
        Ok((
            DecidedParagraph {
                layout,
                alignment,
                shifted_ranges,
                first_line_indent,
                item_box_sheds,
                forced_line_indents,
                ruby_spreads,
                ruby_spread_overhangs,
                ruby_spread_overhangs_right,
                ruby_center_shifts,
                opener_halt_trims,
                inline_block_boxes,
                inline_block_baselines,
                image_edge_insets,
                empty_box_struts,
                spacing_edits,
                cluster_steps,
            },
            edits,
        ))
    }
}
