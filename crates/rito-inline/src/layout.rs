//! The formatting-context entry points: laying a paragraph out into line
//! and text fragments, and its intrinsic inline sizes.

use crate::*;

impl FormattingContext for ParleyInlineContext {
    fn layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&rito_fragment::BreakToken>,
        cancel: &CancelFlag,
    ) -> Result<LayoutOutcome, LayoutError> {
        if token.is_some() {
            return Err(LayoutError::Invalid(
                "inline flows resume through their block container, not a break token".to_owned(),
            ));
        }
        if space.fragmentainer_remaining.is_some() {
            return Err(LayoutError::Invalid(
                "inline flows fragment through their block container; continuous space only"
                    .to_owned(),
            ));
        }
        let root = node;
        // Float exclusion: lines inside the band are broken at the reduced
        // width and shifted past the left inset; the flow returns to the
        // full inline size below the band. CSS shortens line boxes around
        // a float rather than moving the block box.
        let band = space
            .float_band
            .filter(|band| band.bottom > 0.0 && (band.left_inset > 0.0 || band.right_inset > 0.0));
        // Lines break through one manual loop so a specific line index can
        // be FORCED to hold an exact cluster count: the browser's rejected
        // line-end trim extension rewinds the whole overflowing item to
        // the next line (measured: a razor-fit note line breaks as
        // [span ①][whole text item] where greedy would split the text),
        // and `break_next_with_length` reproduces that rewind.
        // Blink accepts a line that overflows its available width by up to
        // one LayoutUnit: NGLineBreaker::CanFitOnLine compares against
        // available_width_.AddEpsilon(). Measured on the Tinos body idiom:
        // a 626.695-wide line fits a 626.6875 column (threshold scanned to
        // the 1/64), so a strict compare here wrapped one word early and
        // drifted whole paragraphs. The epsilon widens only the FIT — the
        // justify target below keeps the true width, exactly as Blink
        // justifies to the unwidened line box.
        const LINE_FIT_EPSILON: f64 = 1.0 / 64.0;
        let break_lines = |layout: &mut parley::Layout<[u8; 4]>, forced: &[(usize, u32)]| {
            if band.is_none() && forced.is_empty() {
                layout.break_all_lines(Some((space.inline_size + LINE_FIT_EPSILON) as f32));
                return;
            }
            let mut breaker = layout.break_lines();
            breaker
                .state_mut()
                .set_layout_max_advance((space.inline_size + LINE_FIT_EPSILON) as f32);
            let mut index = 0usize;
            loop {
                // Every line gets its advance set explicitly: a forced
                // break leaves breaker state the next natural break must
                // not inherit.
                if let Some(band) = band {
                    let band_inline_size =
                        (space.inline_size - band.left_inset - band.right_inset).max(0.0);
                    let inside = f64::from(breaker.committed_y() as f32) < band.bottom;
                    let (advance, offset) = if inside {
                        (band_inline_size, band.left_inset)
                    } else {
                        (space.inline_size, 0.0)
                    };
                    let state = breaker.state_mut();
                    state.set_line_max_advance((advance + LINE_FIT_EPSILON) as f32);
                    state.set_line_x(offset as f32);
                } else {
                    breaker
                        .state_mut()
                        .set_line_max_advance((space.inline_size + LINE_FIT_EPSILON) as f32);
                }
                let forced_count = forced
                    .iter()
                    .find(|(line, _)| *line == index)
                    .map(|(_, count)| *count);
                let progressed = match forced_count {
                    Some(count) => breaker.break_next_with_length(count).is_some(),
                    None => breaker.break_next().is_some(),
                };
                if !progressed {
                    break;
                }
                index += 1;
            }
            breaker.finish();
        };
        // The max advance the breaker gave a line, reconstructed from the
        // same rule the loop above applied: band width while the line's top
        // sits inside the band, the full inline size below it.
        let line_max_advance = |line_top: f64| match band {
            Some(band) if line_top < band.bottom => {
                (space.inline_size - band.left_inset - band.right_inset).max(0.0) as f32
            }
            _ => space.inline_size as f32,
        };
        // Conditional line-end trim, to a fixpoint: find the first soft
        // break Chromium would have extended past a trimmed closing glyph,
        // apply that trim, re-lay, and keep it only if the line then breaks
        // exactly after the trimmed closer — parley's own fitting and break
        // rules stay the authority over what an accepted trim produces.
        // Each accepted trim finalizes one more line, so the loop is
        // bounded by the line count (plus one rebuild per rejection).
        // Byte range each item occupies in the flow text (images occupy
        // none). Hoisted above the layout loop: the rewind detection maps
        // an overflowing character back to its item.
        let item_text_ranges: Vec<std::ops::Range<usize>> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => {
                let mut cursor = 0usize;
                items
                    .iter()
                    .map(|item| match item {
                        InlineItem::Text { text, .. } => {
                            let start = cursor;
                            cursor += text.len();
                            start..cursor
                        }
                        InlineItem::Image { .. }
                        | InlineItem::InlineBlock { .. }
                        | InlineItem::EmptyBox { .. } => cursor..cursor,
                    })
                    .collect()
            }
            _ => Vec::new(),
        };
        // Flow-text positions of in-flow atomic inlines (images, inline
        // blocks): they occupy no flow bytes, but Blink counts them as
        // ideographs on both sides when enumerating justification
        // opportunities, and their justified x rides the shares before
        // them like any glyph.
        let atom_positions: Vec<usize> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .zip(item_text_ranges.iter())
                .filter(|(item, _)| {
                    matches!(
                        item,
                        InlineItem::Image { .. } | InlineItem::InlineBlock { .. }
                    )
                })
                .map(|(_, range)| range.start)
                .collect(),
            _ => Vec::new(),
        };
        let mut end_trims: Vec<usize> = Vec::new();
        let mut rejected_trims: Vec<usize> = Vec::new();
        let mut suppressed_pair_trims: Vec<usize> = Vec::new();
        let mut forced_line_breaks: Vec<(usize, u32)> = Vec::new();
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
            mut inline_block_boxes,
            inline_block_baselines,
            image_edge_insets,
            empty_box_struts,
            spacing_edits,
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
                } = self.build_layout(
                    tree,
                    root,
                    Some(space.inline_size),
                    space.fragmentainer_size,
                    space.containing_block_size,
                    PercentageImageSizing::Intrinsic,
                    &end_trims,
                    &suppressed_pair_trims,
                    &split_spread_edits,
                    cancel,
                )?;
                break_lines(&mut layout, &forced_line_breaks);
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
                        if natural - segment_advance + segment_box <= max_advance {
                            continue;
                        }
                        if item_start <= range.start {
                            continue;
                        }
                        let Some(count) = text
                            .get(range.start..item_start)
                            .map(|held| held.chars().count())
                            .filter(|count| *count > 0)
                            .and_then(|count| u32::try_from(count).ok())
                        else {
                            continue;
                        };
                        forced_line_breaks.push((index, count));
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
                let mut line_top = 0.0_f64;
                let candidate = (0..layout.len().saturating_sub(1)).find_map(|index| {
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
                        &layout,
                        &text,
                        index,
                        max_advance,
                        &end_trims,
                        &rejected_trims,
                        &suppressed_openers,
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
                            let Some(count) = rewind_break_count(
                                &layout,
                                &text,
                                index,
                                max_advance,
                                &item_text_ranges,
                            ) else {
                                continue;
                            };
                            forced_line_breaks.push((index, count));
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
                        );
                    }
                }
            }
        };
        let mut layout = layout;
        // Always align, `Start` included: alignment is where Parley applies
        // the first-line indent's start-edge offset, so skipping it for the
        // default alignment would leave indented lines flush.
        //
        // Justified paragraphs align to the start edge here: Parley's own
        // justification expands whitespace clusters only, while the line
        // loop below spreads each line's slack across Blink's expansion
        // opportunities (CJK boundaries included) itself.
        let justify = alignment == parley::Alignment::Justify;
        layout.align(
            if justify {
                parley::Alignment::Start
            } else {
                alignment
            },
            parley::AlignmentOptions::default(),
        );
        let strut_height = self.resolved_strut_height(tree, root)?;
        let item_shifts: Vec<f64> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .map(|item| match item {
                    InlineItem::Text {
                        baseline_shift_px, ..
                    }
                    | InlineItem::Image {
                        baseline_shift_px, ..
                    }
                    | InlineItem::InlineBlock {
                        baseline_shift_px, ..
                    }
                    | InlineItem::EmptyBox {
                        baseline_shift_px, ..
                    } => *baseline_shift_px,
                })
                .collect(),
            _ => Vec::new(),
        };
        // Per item: a declared line-height resolves to a fixed height; a
        // `normal` item defers to host-measured metrics chosen per line by
        // CJK content. Indexed like `item_text_ranges`.
        /// One text item's line-height inputs: the style whose host
        /// metrics size its content area, and its declared line-height
        /// when it has one (`None` for `normal`).
        struct ItemLineHeight {
            style: rito_style_contract::StyleId,
            declared: Option<f64>,
        }
        let style_tables = tree.styles();
        let flow_text: String = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .map(|item| match item {
                    InlineItem::Text { text, .. } => text.as_str(),
                    InlineItem::Image { .. }
                    | InlineItem::InlineBlock { .. }
                    | InlineItem::EmptyBox { .. } => "",
                })
                .collect(),
            _ => String::new(),
        };
        let item_line_heights: Vec<Option<ItemLineHeight>> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .map(|item| match item {
                    InlineItem::Text { style, .. } => {
                        let resolved = style_tables?.inline.style(*style).ok()?;
                        Some(ItemLineHeight {
                            style: *style,
                            declared: used_declared_line_height(
                                resolved.font.line_height,
                                f64::from(resolved.font.size.get()),
                            ),
                        })
                    }
                    // An image carries its own style so a line holding
                    // only images can still find the host metrics that
                    // size the space around it; an inline-block the same.
                    InlineItem::Image { style, .. }
                    | InlineItem::InlineBlock { style, .. }
                    | InlineItem::EmptyBox { style, .. } => Some(ItemLineHeight {
                        style: *style,
                        declared: None,
                    }),
                })
                .collect(),
            _ => Vec::new(),
        };
        let shift_for_range = |range: &std::ops::Range<usize>| -> f64 {
            shifted_ranges
                .iter()
                .find(|(shifted, _)| shifted.start < range.end && range.start < shifted.end)
                .map(|(_, shift)| *shift)
                .unwrap_or(0.0)
        };
        if cancel.is_cancelled() {
            return Err(LayoutError::Cancelled);
        }

        // Outside list marker: Blink derives the disc from the list item's
        // primary font and hangs it off the first line (see
        // `list_marker_geometry`).
        let list_marker = list_marker_geometry(
            &mut self.fonts.borrow_mut(),
            &self.registered_families,
            tree,
            root,
        );
        let mut lines = Vec::new();
        // Line boxes stack by their CSS line height: the box model the
        // browser's per-character range rects expose. Parley's block
        // min/max coordinates track ink extents, which drift from the
        // line-height stack by rounding and leading distribution, so the
        // block position comes from accumulation instead.
        let mut running_top = 0.0_f64;
        // The previous line's leading below its text, spent by a ruby
        // annotation on the next line before the line has to grow.
        let mut prev_ruby_below: Option<f64> = None;
        // The distinct fonts that shaped the previous line's glyph runs.
        // The browser's under-edge allowance depends on the previous
        // line's font composition (measured: one Latin glyph — a space
        // included — shrinks the gap a following annotation may reuse by
        // one pixel at 16px), so the reuse probe must match it.
        let mut prev_line_fonts: Vec<(u64, u32)> = Vec::new();
        for line in layout.lines() {
            let metrics = line.metrics();
            let line_top = running_top;
            let has_inline_box = line
                .items()
                .any(|item| matches!(&item, PositionedLayoutItem::InlineBox(_)));
            // Env-gated line forensics for the native probe binary (wasm
            // has no env; the flag simply never sets there).
            // Flow-text ranges of the spread ruby bases: justification must
            // not open interior opportunities inside them.
            let spread_ranges: Vec<std::ops::Range<usize>> = ruby_spreads
                .keys()
                .filter_map(|index| item_text_ranges.get(*index).cloned())
                .collect();
            let line_debug = std::env::var_os("RITO_LINE_DEBUG").is_some();
            let mut debug_misses: Vec<String> = Vec::new();
            let ink_top = f64::from(metrics.block_min_coord);
            // css-text: trailing white space HANGS at the line end and is
            // excluded from alignment (while intrinsic/table sizing keeps
            // it — measured, u3000-hang oracle: a shrink-to-fit table box
            // keeps three trailing U+3000 but the centered line inside it
            // drops them, inking dead-centre). Parley's own exclusion
            // covers only its whitespace class (ASCII spaces) — the
            // ideographic space slips through and shifted b52's centered
            // title left by half its run. The uncovered hang is the
            // Unicode-whitespace tail minus what parley already excluded.
            let (hang_uncovered, trailing_nbsp_kept) = {
                let range = line.text_range();
                let content = flow_text.get(range.clone()).unwrap_or_default();
                let mut hang = 0.0_f64;
                // A trailing U+00A0 is NOT hangable white space: the
                // browser keeps its advance inside the aligned line
                // (b11's right-aligned link ends with two of them and
                // sits their width in from the edge), while parley's
                // trailing-whitespace class drops it — the kept sum
                // pulls the aligned start back.
                let mut nbsp_kept = 0.0_f64;
                let mut byte = range.end;
                for character in content.chars().rev() {
                    if !character.is_whitespace() {
                        break;
                    }
                    byte -= character.len_utf8();
                    if let Some(cluster) = parley::layout::Cluster::from_byte_index(&layout, byte) {
                        hang += f64::from(cluster.advance());
                        if character == '\u{a0}' {
                            nbsp_kept += f64::from(cluster.advance());
                        }
                    }
                }
                (
                    (hang - f64::from(metrics.trailing_whitespace)).max(0.0),
                    nbsp_kept,
                )
            };
            // A span opening this forced-break line indents it by its box
            // lead (margins/padding/border of a post-<br/> span land on
            // the span's own line).
            let forced_indent = forced_line_indents
                .get(&line.text_range().start)
                .copied()
                .unwrap_or(0.0);
            let parley_line_x = f64::from(metrics.offset);
            // The hang shift moves the PAINTED line: children below are
            // relativized against parley's own aligned offset so the
            // shift survives into net positions (the first landing
            // relativized against the shifted value and cancelled itself
            // to a pixel-null — asserted by the paint-position test).
            // The 1/64 fit tolerance added to the BREAKING width leaks
            // into parley's free space, shifting every end-aligned line
            // right by 1/64 and every centered one by 1/128 (measured:
            // b12's right-aligned closing line started at 411.625 where
            // the browser's Range put it at 411.609375, and the browser
            // keeps alignment offsets unquantized). Subtract it back
            // whenever parley actually applied the alignment (free space
            // at the padded width positive).
            let alignment_epsilon = {
                let free_padded = f64::from(line_max_advance(line_top)) + LINE_FIT_EPSILON
                    - (f64::from(metrics.advance) - f64::from(metrics.trailing_whitespace));
                if free_padded > 0.0 {
                    match alignment {
                        parley::Alignment::End | parley::Alignment::Right => LINE_FIT_EPSILON,
                        parley::Alignment::Center => LINE_FIT_EPSILON / 2.0,
                        _ => 0.0,
                    }
                } else {
                    0.0
                }
            };
            // An alignment offset lands on the LayoutUnit grid by
            // FLOORING (Range-measured: a right-aligned 4-glyph 15.2px
            // line starts at 579.1875 = floor64(579.2), the .8 fraction
            // discriminating floor from round; centering behaves alike).
            // Start-aligned lines carry no offset and keep raw floats.
            let line_x = {
                let raw = parley_line_x - alignment_epsilon
                    + forced_indent
                    + match alignment {
                        parley::Alignment::Center => (hang_uncovered - trailing_nbsp_kept) / 2.0,
                        parley::Alignment::End | parley::Alignment::Right => {
                            hang_uncovered - trailing_nbsp_kept
                        }
                        _ => 0.0,
                    };
                match alignment {
                    parley::Alignment::Center
                    | parley::Alignment::End
                    | parley::Alignment::Right => (raw * 64.0).floor() / 64.0,
                    _ => raw,
                }
            };
            // A justified line spreads its slack equally across Blink's
            // expansion opportunities (see `line_justify_plan`); the
            // paragraph's last line and forced breaks keep the start edge.
            let justify_plan = if justify
                && matches!(
                    line.break_reason(),
                    parley::layout::BreakReason::Regular | parley::layout::BreakReason::Emergency
                ) {
                let range = line.text_range();
                let indent = if range.start == 0 {
                    first_line_indent
                } else {
                    0.0
                };
                let target =
                    f64::from(line_max_advance(line_top)) - f64::from(indent) - forced_indent;
                // The hanging U+3000 tail leaves the measure like parley's
                // own trailing whitespace does: Blink justifies the line's
                // content to the full measure with the spaces hung outside.
                // The line width joins the slack as the sum of its STYLE
                // ITEMS' advances, each rounded UP onto the 1/64 grid
                // (DOM-measured: a 14+13+10-glyph three-span 15.2px line
                // justifies at share (590.765625 - Σ ceil64(item))/36
                // with zero pixel diff, while both the raw float width
                // and ceil64 of the whole advance leave glyphs one
                // raster phase off; a font-fallback split inside ONE
                // element does not round — the next run continues at the
                // float advance, caret floor64(15.19998) = 15.1875).
                // (key, advance, ceils) per piece: an atomic inline's used
                // width is already a LayoutUnit value and joins the sum
                // as-is — rounding it up moved every following glyph on
                // the noteref-image lines one grid phase right of the
                // browser; only shaped text widths round up.
                let mut item_advances: Vec<(u32, f64, bool)> = Vec::new();
                for item in line.items() {
                    let (key, width, ceils) = match item {
                        PositionedLayoutItem::GlyphRun(glyph_run) => (
                            u32::from_le_bytes(glyph_run.style().brush),
                            f64::from(glyph_run.advance()),
                            true,
                        ),
                        PositionedLayoutItem::InlineBox(inline_box) => (
                            u32::MAX - inline_box.id as u32,
                            f64::from(inline_box.width),
                            false,
                        ),
                    };
                    match item_advances.last_mut() {
                        Some((last, sum, _)) if *last == key => *sum += width,
                        _ => item_advances.push((key, width, ceils)),
                    }
                }
                // Trailing whitespace and the hanging tail sit on the
                // line's last item; they leave before the rounding.
                if let Some((_, sum, _)) = item_advances.last_mut() {
                    *sum -= f64::from(metrics.trailing_whitespace) + hang_uncovered;
                }
                // A line break is a shaping boundary: the browser
                // re-measures the broken line, so a kern pair straddling
                // the break never applies and the line-final cluster
                // keeps its base advance (measured: SourceHan ン+ス
                // carries a -29/1000 kern pair; the paragraph-shaped ン
                // leaked that kern into the line's justified natural
                // width, inflating the slack 0.416px and phasing every
                // share-driven glyph mid-line).
                {
                    use skrifa::raw::TableProvider as _;
                    use skrifa::MetadataProvider as _;
                    let content = flow_text
                        .get(range.clone())
                        .map(str::trim_end)
                        .unwrap_or("");
                    if let Some(last_char) = content.chars().next_back().filter(|last| {
                        // Only the MEASURED domain takes the delta: a
                        // kana or ideograph line end (SourceHan pair
                        // kerns live there). Fullwidth punctuation runs
                        // the trim/hang machinery — the delta
                        // double-counted a trailing 、's compression —
                        // and a latin or fullwidth-symbol line end
                        // (~, letters) moved a credits line off the
                        // truth when the delta was applied wholesale.
                        matches!(u32::from(*last),
                            0x3041..=0x30FF
                            | 0x3400..=0x9FFF
                            | 0xF900..=0xFAFF
                            | 0x20000..=0x2FA1F)
                    }) {
                        let last_byte = range.start + content.len() - last_char.len_utf8();
                        if let Some(cluster) =
                            parley::layout::Cluster::from_byte_index(&layout, last_byte)
                        {
                            let shaped = f64::from(cluster.advance());
                            let run = cluster.run();
                            let font = run.font();
                            if let Ok(font_ref) =
                                skrifa::FontRef::from_index(font.data.as_ref(), font.index)
                            {
                                // Unscaled font units scaled in f64:
                                // skrifa's pre-scaled metrics quantize
                                // the scale factor and return 14.3907
                                // for a 1000-unit glyph at 14.4px — a
                                // phantom -0.0093 delta on every
                                // ideograph line end.
                                let upem = font_ref
                                    .head()
                                    .map(|head| f64::from(head.units_per_em()))
                                    .unwrap_or(1000.0);
                                let upem = if upem > 0.0 { upem } else { 1000.0 };
                                let glyph_metrics = font_ref.glyph_metrics(
                                    skrifa::instance::Size::unscaled(),
                                    skrifa::instance::LocationRef::default(),
                                );
                                let scale = f64::from(run.font_size()) / upem;
                                let base: f64 = cluster
                                    .glyphs()
                                    .map(|glyph| {
                                        glyph_metrics
                                            .advance_width(skrifa::GlyphId::new(glyph.id))
                                            .map(|units| f64::from(units) * scale)
                                            .unwrap_or(f64::from(glyph.advance))
                                    })
                                    .sum();
                                let delta = base - shaped;
                                // Only a REAL pair adjustment: kern
                                // pairs move whole font units (1/128px
                                // and up), while float dust between the
                                // shaper's f32 sum and the metrics read
                                // is ~1e-5 — letting dust through pushed
                                // an ideograph-final line's advance over
                                // the ceil64 margin and dropped its
                                // slack a whole 1/64. Features that
                                // legitimately resize a glyph (halved
                                // ruby punctuation via halt) move half
                                // an em or more and stay shaped.
                                if std::env::var_os("RITO_BRK_DEBUG").is_some() {
                                    eprintln!(
                                        "[brk] last='{last_char}' shaped={shaped:.6} base={base:.6} delta={delta:.6}"
                                    );
                                }
                                if delta.abs() > 1.0 / 128.0
                                    && delta.abs() < f64::from(run.font_size()) * 0.25
                                {
                                    if let Some((_, sum, _)) = item_advances.last_mut() {
                                        *sum += delta;
                                    }
                                }
                            }
                        }
                    }
                }
                let advance: f64 = item_advances
                    .iter()
                    .map(|(_, sum, ceils)| {
                        if *ceils {
                            // The shaper's advances carry a small positive
                            // dust (measured: a 40-glyph 15.2px line whose
                            // exact width is 608 sums to 608.000183, about
                            // +5e-6 per glyph), while the browser's width
                            // for the same line stays at-or-below the
                            // grid; ceiling the raw sum bumped such lines
                            // a whole 1/64 and their smaller share drifted
                            // glyphs across raster half-buckets mid-line.
                            // The margin only changes sums within ~1e-3
                            // ABOVE a grid point — real off-grid widths
                            // sit ≥ 1/128 away and keep their ceil.
                            ((sum - 1.0 / 1024.0) * 64.0).ceil() / 64.0
                        } else {
                            *sum
                        }
                    })
                    .sum();
                line_justify_plan(
                    &flow_text,
                    range,
                    target - advance,
                    &spread_ranges,
                    &atom_positions,
                )
            } else {
                None
            };
            if std::env::var_os("RITO_JUST_DEBUG").is_some() {
                let range = line.text_range();
                let prefix: String = flow_text
                    .get(range.clone())
                    .unwrap_or_default()
                    .chars()
                    .take(8)
                    .collect();
                eprintln!(
                    "[just-debug] '{prefix}' reason={:?} max={} indent={} advance={} trailing={} justified={}",
                    line.break_reason(),
                    line_max_advance(line_top),
                    first_line_indent,
                    metrics.advance,
                    metrics.trailing_whitespace,
                    justify_plan.is_some(),
                );
            }
            // Expansion shares consumed at boundaries before the walk's
            // current position; each share moves everything after it.
            let mut justify_shares_used = 0u32;
            // (item index, truth item start, engine item start) for the
            // LayoutUnit item cursor on justified lines.
            let mut justify_item_track: Option<(usize, f64, f64)> = None;
            // The same LayoutUnit item cursor for UNJUSTIFIED lines at
            // OFF-GRID font sizes: a style-item boundary re-anchors the
            // next item's start at the ceiling of the running float end
            // on the 1/64 grid (Range-measured: adjacent 15.2px spans
            // put the second run at 45.609375 = ceil64(45.6), where the
            // raw float continuation sits at 45.6); interiors keep the
            // float accumulation from the anchored start. Integer sizes
            // stay on the raw floats — their advances already sit on
            // the grid and re-anchoring there moved verified rows.
            let mut natural_item_track: Option<(usize, f64, f64, f64)> = None;
            // Collect the line's content first, remembering each child's
            // baseline shift, so the line box can grow by however far
            // shifted content rises above the strut before positions are
            // finalized (a browser's line box contains its risen content).
            let mut children: Vec<(Fragment, f64)> = Vec::new();
            let mut max_rise = 0.0_f64;
            // Ordinal per flow position for atoms sharing a byte (two
            // adjacent images), so each looks up its own share count.
            let mut atom_ordinals: std::collections::HashMap<usize, usize> =
                std::collections::HashMap::new();
            // The justified x offset of an atomic inline: Parley places
            // the box at its NATURAL advance; the shares consumed before
            // the atom (its left boundary included) shift it right, the
            // same way every glyph's advance carries its expansion —
            // measured on b20's note badge, which painted 5.67px (run1's
            // whole expansion) left of Blink until this ride-along.
            let mut atom_justify = |id: u64| -> f64 {
                let (Some(plan), Some(range)) = (&justify_plan, item_text_ranges.get(id as usize))
                else {
                    return 0.0;
                };
                let ordinal = atom_ordinals.entry(range.start).or_insert(0);
                let shares = plan.atom_shares_at(range.start, *ordinal);
                *ordinal += 1;
                shares.map_or(0.0, |shares| plan.share * f64::from(shares))
            };
            // Every text run on this line, as (inline item, sample
            // character for the font shaping resolved). A run whose
            // characters the declared family cannot serve resolves to a
            // fallback font with its own metrics, and the host must be
            // asked about that font — not about the declared family.
            let mut line_run_samples: Vec<(usize, String)> = Vec::new();
            for item in line.items() {
                match item {
                    PositionedLayoutItem::GlyphRun(glyph_run) => {
                        let shaping_range = glyph_run.run().text_range();
                        let item_index = u32::from_le_bytes(glyph_run.style().brush) as usize;
                        let item_range =
                            item_text_ranges.get(item_index).cloned().ok_or_else(|| {
                                LayoutError::Invalid(format!(
                                    "glyph run brush names item {item_index} outside the flow"
                                ))
                            })?;
                        // A glyph run never crosses a brush (item) boundary,
                        // and one shaping run holds at most one glyph run
                        // per item, so this intersection is the run's exact
                        // byte range.
                        let run_range = shaping_range.start.max(item_range.start)
                            ..shaping_range.end.min(item_range.end);
                        if run_range.start >= run_range.end {
                            return Err(LayoutError::Invalid(format!(
                                "glyph run range {shaping_range:?} does not intersect its \
                                 item's range {item_range:?}"
                            )));
                        }
                        if let Some(style) = style_tables.and_then(|tables| {
                            item_line_heights
                                .get(item_index)
                                .and_then(|entry| entry.as_ref())
                                .and_then(|entry| tables.inline.style(entry.style).ok())
                        }) {
                            // One sample per script inside the run, not just
                            // the run's first character: the host resolves
                            // fallback per character, so a run the engine
                            // shapes with one font can be two fonts there.
                            let mut seen_scripts: Vec<u16> = Vec::new();
                            // An ideographic space is a GLYPH here, not
                            // white space: its resolved (CJK) font sizes
                            // the line in Blink — a "　　1" heading line
                            // measures 23, the CJK strut, not the Latin
                            // digit's 18 (measured on the shinmai article
                            // books, where dropping it shifted every
                            // chapter 4px from the second block on).
                            for character in flow_text
                                .get(run_range.clone())
                                .unwrap_or_default()
                                .chars()
                                .filter(|c| !c.is_whitespace() || *c == '\u{3000}')
                            {
                                let script = char_script(character);
                                if seen_scripts.contains(&script) {
                                    continue;
                                }
                                seen_scripts.push(script);
                                let sample =
                                    self.run_sample(style, glyph_run.run().font(), character);
                                if !line_run_samples
                                    .iter()
                                    .any(|(index, seen)| *index == item_index && *seen == sample)
                                {
                                    line_run_samples.push((item_index, sample));
                                }
                            }
                        }
                        let shift = shift_for_range(&run_range);
                        max_rise = max_rise.max(shift);
                        let run_x = f64::from(glyph_run.offset()) - parley_line_x;
                        // A run inside a bordered/padded span carries the
                        // box's raster anchor: the browser snaps the
                        // decorated box to its own device row and hangs
                        // the baseline off it (integer primary-font
                        // ascent below the rounded top edge), instead of
                        // the bare-text line-box snap.
                        let run_box_snap = style_tables.and_then(|tables| {
                            let entry = item_line_heights.get(item_index)?.as_ref()?;
                            let resolved = tables.inline.style(entry.style).ok()?;
                            let metric = self.host_normal_line_peek(resolved, "");
                            item_box_snap(resolved, metric)
                        });
                        // The run's font box (grid ascent/descent) rides
                        // every text fragment: selection rects span it,
                        // never the line box (Chromium Range semantics).
                        // The box belongs to the run's USED font — a
                        // fallback-served CJK run in a Latin-pinned style
                        // takes the CJK grid — so the one-char sample key
                        // leads and records a request when unmeasured;
                        // the style's strut stands in until it arrives.
                        // Declared line-height math never consumes these
                        // metrics, so the request is layout-neutral.
                        let run_font_grid = style_tables.and_then(|tables| {
                            let entry = item_line_heights.get(item_index)?.as_ref()?;
                            let resolved = tables.inline.style(entry.style).ok()?;
                            let sample_char = flow_text
                                .get(run_range.clone())
                                .unwrap_or_default()
                                .chars()
                                .find(|c| !c.is_whitespace() || *c == '\u{3000}');
                            let sampled = sample_char.and_then(|character| {
                                let sample =
                                    self.run_sample(resolved, glyph_run.run().font(), character);
                                self.host_normal_line(resolved, &sample)
                            });
                            sampled
                                .or_else(|| self.host_normal_line_peek(resolved, ""))?
                                .grid
                        });
                        // A ruby spread's interior gap re-applies at paint
                        // as extra letter spacing (like justify spacing,
                        // but kept apart: the annotation extent derives
                        // from it while justify shares never widen the
                        // annotation).
                        let ruby_gap = ruby_spreads.get(&item_index).copied().unwrap_or(0.0);
                        let ruby_overhang = ruby_spread_overhangs
                            .get(&item_index)
                            .copied()
                            .unwrap_or(0.0);
                        let ruby_overhang_right = ruby_spread_overhangs_right
                            .get(&item_index)
                            .copied()
                            .unwrap_or(ruby_overhang);
                        let opener_halt_trims = &opener_halt_trims;
                        // The painter keeps word spacing as its own step
                        // after each space, so a spaced run never takes
                        // the grid law (measured only on unspaced runs).
                        let run_word_spacing = style_tables
                            .and_then(|tables| {
                                let item_style = match &tree.node(root).content {
                                    FormattingNodeContent::InlineFlow { items } => {
                                        items.get(item_index).map(|item| match item {
                                            InlineItem::Text { style, .. }
                                            | InlineItem::Image { style, .. }
                                            | InlineItem::InlineBlock { style, .. }
                                            | InlineItem::EmptyBox { style, .. } => *style,
                                        })
                                    }
                                    _ => None,
                                }?;
                                tables.inline.style(item_style).ok()
                            })
                            .is_some_and(|resolved| {
                                matches!(resolved.text_flow.word_spacing, LengthPercentage::Length(px) if px.get() != 0.0)
                            });
                        let spacing_edits = &spacing_edits;
                        let layout_ref = &layout;
                        let flow_text_ref: &str = &flow_text;
                        let mut emit = |range: std::ops::Range<usize>,
                                        x: f64,
                                        width: f64,
                                        justify_px: f64| {
                            let opener_trim_px = opener_halt_trims
                                .iter()
                                .find(|(halt, _)| halt.start < range.end && range.start < halt.end)
                                .map_or(0.0, |(_, half)| *half);
                            let piece = piece_clusters(
                                layout_ref,
                                flow_text_ref,
                                range.clone(),
                                spacing_edits,
                                justify_px,
                                opener_halt_trims,
                                run_word_spacing,
                            );
                            children.push((
                                Fragment::Text(TextFragment {
                                    source: root,
                                    rect: FragmentRect {
                                        x,
                                        y: 0.0,
                                        width,
                                        height: 0.0,
                                    },
                                    text_start: range.start as u32,
                                    text_end: range.end as u32,
                                    justify_px,
                                    ruby_gap_px: ruby_gap,
                                    ruby_overhang_px: ruby_overhang,
                                    ruby_overhang_right_px: ruby_overhang_right,
                                    opener_trim_px,
                                    box_snap: run_box_snap,
                                    font_grid: run_font_grid,
                                    ruby_center_shift_px: ruby_center_shifts
                                        .get(&item_index)
                                        .copied()
                                        .unwrap_or(0.0),
                                    clusters: piece.positions,
                                    cluster_grid: piece.grid,
                                }),
                                shift,
                            ));
                        };
                        // The advance a box gap parked on this run's last
                        // cluster: shed it so the rect stays ink-sized.
                        let box_shed = if run_range.end == item_range.end {
                            item_box_sheds.get(&item_index).copied().unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        match &justify_plan {
                            None => {
                                // The canvas shapes each fillText call on
                                // its own: its space advances 4.0 where the
                                // pinned face's is 510/2048 (3.984375), and
                                // it skips space-adjacent kern pairs the
                                // browser applies (Tinos `r A` closes
                                // 0.859px) — every word painted after a
                                // space drifts right of the browser's ink.
                                // Splitting the run at space boundaries
                                // re-anchors each word at the shaped
                                // position, and no canvas call crosses a
                                // space. (Justified lines already split
                                // there: a space boundary carries a share.)
                                // Every style-item boundary re-anchors:
                                // the browser holds each ITEM's shaped
                                // width on the LayoutUnit grid (a
                                // truncated 11.99px superscript span
                                // starts its 14px successor at +12.0 =
                                // ceil64 of the span's width), while
                                // inter-item gaps (span margins, inline
                                // boxes) and the chain's own fractional
                                // origin pass through untouched — a
                                // mixed-size title whose items are all
                                // grid-exact keeps its float origin
                                // (position-ceiling it moved a 24px
                                // title word 0.4/64 right of the
                                // browser). The width ceil carries the
                                // shaper-dust margin so an on-grid item
                                // width plus float dust stays a no-op.
                                let run_advance = f64::from(glyph_run.advance());
                                let run_x = match &mut natural_item_track {
                                    slot @ None => {
                                        *slot = Some((item_index, run_x, run_x, run_advance));
                                        run_x
                                    }
                                    Some((item, truth_start, engine_start, item_width)) => {
                                        if *item != item_index {
                                            let delta = run_x - *engine_start;
                                            let gap = delta - *item_width;
                                            let ceiled =
                                                ((*item_width - 1.0 / 1024.0) * 64.0).ceil() / 64.0;
                                            // Only a genuinely off-grid item
                                            // width anchors; a grid width
                                            // plus shaper dust keeps the
                                            // engine's float chain (title
                                            // spans with exact 24px glyphs
                                            // matched the browser bit-for-
                                            // bit before any anchoring).
                                            let width = if ceiled - *item_width > 1.0 / 1024.0 {
                                                ceiled
                                            } else {
                                                *item_width
                                            };
                                            let truth = *truth_start + width + gap;
                                            *item = item_index;
                                            *truth_start = truth;
                                            *engine_start = run_x;
                                            *item_width = run_advance;
                                            truth
                                        } else {
                                            let truth = *truth_start + (run_x - *engine_start);
                                            *item_width += run_advance;
                                            truth
                                        }
                                    }
                                };
                                let has_space = flow_text
                                    .get(run_range.clone())
                                    .is_some_and(|text| text.contains(' '));
                                // A kern pair inside a CJK run (SourceHan
                                // kana pairs) pulls the following clusters
                                // off the 1/64 grid even at an INTEGER
                                // font size; the browser still floors
                                // every glyph's cumulative onto the grid,
                                // while one whole-run canvas call
                                // accumulates the float advances raw and
                                // the glyphs after the pair raster one
                                // device column away (measured: サダメ at
                                // 16px, pair -0.8, second glyph +1px).
                                // Splitting at the off-grid boundaries
                                // re-anchors each stretch at floor64 of
                                // its shaped position.
                                // Ruby carriers keep their single run:
                                // the annotation gap/center-shift fields
                                // ride ONE fragment, and splitting the
                                // base re-applied them per piece (b20's
                                // name-pun ruby pages grew when the
                                // split first landed unguarded).
                                let run_has_ruby = match &tree.node(root).content {
                                    FormattingNodeContent::InlineFlow { items } => {
                                        items.get(item_index).is_some_and(|item| {
                                            matches!(
                                                item,
                                                InlineItem::Text {
                                                    ruby_annotation: Some(_),
                                                    ..
                                                }
                                            )
                                        })
                                    }
                                    _ => false,
                                };
                                // A shadowed run also keeps one piece:
                                // its glyphs render through the shadow
                                // scratch bitmap, whose fractional-phase
                                // handling is per PIECE — splitting a
                                // decorated line re-phased every
                                // segment's shadow edge (b42's outlined
                                // caption pages grew ~100px each under
                                // the unguarded split).
                                let run_has_shadow = style_tables
                                    .and_then(|tables| {
                                        let item_style = match &tree.node(root).content {
                                            FormattingNodeContent::InlineFlow { items } => {
                                                items.get(item_index).map(|item| match item {
                                                    InlineItem::Text { style, .. }
                                                    | InlineItem::Image { style, .. }
                                                    | InlineItem::InlineBlock { style, .. }
                                                    | InlineItem::EmptyBox { style, .. } => *style,
                                                })
                                            }
                                            _ => None,
                                        }?;
                                        tables.inline.style(item_style).ok()
                                    })
                                    .is_some_and(|resolved| {
                                        !resolved.paint.text_shadows.is_empty()
                                    });
                                // The browser's pen advances on 16.16
                                // fixed-point pixels (see
                                // `hb_fixed_cluster_advance`); the
                                // spacing layout folded into a cluster —
                                // author spacing, a trim, a ruby share —
                                // is that cluster's own, added outside
                                // the fixed-point glyph advance (unfolding
                                // a spread ruby base's shares with the
                                // FOLLOWING run's author spacing
                                // round-tripped the shares through font
                                // units and pushed the run's anchor off
                                // the grid).
                                let hb_cluster_advance =
                                    |current: &parley::layout::Cluster<'_, _>| -> f64 {
                                        hb_fixed_cluster_advance(
                                            current,
                                            folded_spacing(spacing_edits, current),
                                        )
                                    };
                                let (cjk_kern_splits, cjk_anchor_correction, cjk_hb_total): (
                                    Vec<(usize, f64)>,
                                    f64,
                                    f64,
                                ) = if !has_space
                                    && !run_has_ruby
                                    && !run_has_shadow
                                    && flow_text.get(run_range.clone()).is_some_and(|text| {
                                        !text.is_empty()
                                            && text.chars().all(|ch| {
                                                matches!(u32::from(ch),
                                                        0xB7
                                                        | 0x2E80..=0x9FFF
                                                        | 0xF900..=0xFAFF
                                                        | 0xFF00..=0xFFEF
                                                        | 0x20000..=0x3FFFF)
                                            })
                                    }) {
                                    // The run anchor is parley's raw f32
                                    // cumulative from the line start;
                                    // re-express the prefix in the
                                    // fixed-point domain so the absolute
                                    // positions the splits floor onto
                                    // match the browser's pen (measured
                                    // on a pinned-Chromium contents line:
                                    // a raw anchor 2.9e-5 high tipped the
                                    // next cluster across its 1/64 cell).
                                    // This split path never runs on a
                                    // justified line, so no share joins
                                    // the prefix; inline boxes are not
                                    // clusters and their widths agree in
                                    // both domains.
                                    let mut anchor_correction = 0.0_f64;
                                    let mut prefix = parley::layout::Cluster::from_byte_index(
                                        &layout,
                                        line.text_range().start,
                                    );
                                    while let Some(current) = prefix {
                                        let byte = current.text_range().start;
                                        if byte >= run_range.start {
                                            break;
                                        }
                                        anchor_correction += hb_cluster_advance(&current)
                                            - f64::from(current.advance());
                                        prefix = current.next_logical();
                                    }
                                    let mut splits = Vec::new();
                                    let mut cumulative = 0.0_f64;
                                    let mut cluster = parley::layout::Cluster::from_byte_index(
                                        &layout,
                                        run_range.start,
                                    );
                                    while let Some(current) = cluster {
                                        let byte = current.text_range().start;
                                        if byte >= run_range.end {
                                            break;
                                        }
                                        if byte > run_range.start {
                                            let scaled = (anchor_correction + cumulative) * 64.0;
                                            if (scaled - scaled.round()).abs() > 1e-3 {
                                                splits.push((byte, cumulative));
                                            }
                                        }
                                        cumulative += hb_cluster_advance(&current);
                                        cluster = current.next_logical();
                                    }
                                    (splits, anchor_correction, cumulative)
                                } else {
                                    (Vec::new(), 0.0, 0.0)
                                };
                                if !has_space && !cjk_kern_splits.is_empty() {
                                    let mut seg_start = run_range.start;
                                    let mut seg_offset = 0.0_f64;
                                    for (byte, cumulative) in cjk_kern_splits
                                        .into_iter()
                                        .chain(std::iter::once((run_range.end, cjk_hb_total)))
                                    {
                                        if byte > seg_start {
                                            emit(
                                                seg_start..byte,
                                                run_x + cjk_anchor_correction + seg_offset,
                                                cumulative
                                                    - seg_offset
                                                    - if byte == run_range.end {
                                                        box_shed
                                                    } else {
                                                        0.0
                                                    },
                                                0.0,
                                            );
                                            seg_start = byte;
                                            seg_offset = cumulative;
                                        }
                                    }
                                } else if !has_space {
                                    emit(
                                        run_range,
                                        run_x,
                                        f64::from(glyph_run.advance()) - box_shed,
                                        0.0,
                                    );
                                } else {
                                    let mut seg_start = run_range.start;
                                    let mut seg_x = run_x;
                                    let mut natural_x = run_x;
                                    let mut previous_space = false;
                                    let mut cluster = parley::layout::Cluster::from_byte_index(
                                        &layout,
                                        run_range.start,
                                    );
                                    while let Some(current) = cluster {
                                        let byte = current.text_range().start;
                                        if byte >= run_range.end {
                                            break;
                                        }
                                        if previous_space && byte > seg_start {
                                            emit(seg_start..byte, seg_x, natural_x - seg_x, 0.0);
                                            seg_start = byte;
                                            seg_x = natural_x;
                                        }
                                        previous_space = flow_text
                                            .get(byte..current.text_range().end)
                                            == Some(" ");
                                        natural_x += f64::from(current.advance());
                                        cluster = current.next_logical();
                                    }
                                    if seg_start < run_range.end {
                                        emit(
                                            seg_start..run_range.end,
                                            seg_x,
                                            run_x + f64::from(glyph_run.advance())
                                                - seg_x
                                                - box_shed,
                                            0.0,
                                        );
                                    }
                                }
                            }
                            Some(plan) => {
                                // Shares at the boundary against the
                                // previous run shift this whole run; shares
                                // inside it ride the run's letter spacing
                                // while their count stays uniform, and cut
                                // the run into separately placed stretches
                                // where it changes (a deferred double
                                // share, a latin word's zero-share gaps).
                                justify_shares_used += plan.count_at(run_range.start);
                                // A justified run's anchor rides the
                                // fixed-point prefix too: the natural part
                                // of its position is the sum of every
                                // preceding cluster's HB 16.16 advance,
                                // not parley's raw f32 cumulative (a mixed
                                // line's latin page-reference put the
                                // following CJK run 0.0117px right of the
                                // browser's pen while the share plan
                                // matched exactly).
                                let run_x = {
                                    let mut correction = 0.0_f64;
                                    let mut prefix = parley::layout::Cluster::from_byte_index(
                                        &layout,
                                        line.text_range().start,
                                    );
                                    while let Some(current) = prefix {
                                        let byte = current.text_range().start;
                                        if byte >= run_range.start {
                                            break;
                                        }
                                        // A whitespace prefix keeps the raw
                                        // anchor: the space's advance rides
                                        // word-spacing and justification
                                        // machinery outside the glyph
                                        // round-trip (fixing across one
                                        // moved a spaced dialog line a
                                        // fifth of a pixel).
                                        if flow_text
                                            .get(byte..current.text_range().end)
                                            .is_some_and(|t| t.chars().any(char::is_whitespace))
                                        {
                                            correction = 0.0;
                                            break;
                                        }
                                        correction += hb_fixed_cluster_advance(
                                            &current,
                                            folded_spacing(spacing_edits, &current),
                                        ) - f64::from(current.advance());
                                        prefix = current.next_logical();
                                    }
                                    run_x + correction
                                };
                                // The browser holds every inline item's
                                // justified advance on the LayoutUnit
                                // grid: the next style item starts at
                                // ceil64 of the running sum (probed: a
                                // 12px superscript span's 12.5671875
                                // advance starts its successor at
                                // +12.578125). Runs re-anchor on that
                                // cursor so a postil span doesn't leave
                                // the rest of its line a fraction adrift
                                // of the browser's raster ties.
                                let justified_x =
                                    run_x + plan.share * f64::from(justify_shares_used);
                                // Shaper-dust margin like the natural
                                // cursor: an on-grid item end plus float
                                // dust must not bump a whole 1/64.
                                let ceil64 =
                                    |value: f64| ((value - 1.0 / 1024.0) * 64.0).ceil() / 64.0;
                                let run_x = run_x
                                    + match &mut justify_item_track {
                                        slot @ None => {
                                            *slot = Some((item_index, justified_x, justified_x));
                                            0.0
                                        }
                                        Some((item, truth_start, engine_start)) => {
                                            if *item != item_index {
                                                let advance = justified_x - *engine_start;
                                                let truth = ceil64(*truth_start + advance);
                                                *item = item_index;
                                                *truth_start = truth;
                                                *engine_start = justified_x;
                                                truth - justified_x
                                            } else {
                                                *truth_start - *engine_start
                                            }
                                        }
                                    };
                                let mut stretch_start = run_range.start;
                                // A CJK character right after a non-CJK one
                                // paints its INK one share right of its
                                // advance position (Blink adds the
                                // deferred "before" share to the glyph
                                // offset too); the stretch starting there
                                // shifts its rect without touching the
                                // advance accounting, so neighbours stay.
                                let mut stretch_x = run_x
                                    + plan.share * f64::from(justify_shares_used)
                                    + if plan.before_share_at(run_range.start) {
                                        plan.share
                                    } else {
                                        0.0
                                    };
                                let mut stretch_natural = 0.0_f64;
                                let mut stretch_shares = 0u32;
                                let mut uniform: Option<u32> = None;
                                let mut natural_x = run_x;
                                let mut cluster = parley::layout::Cluster::from_byte_index(
                                    &layout,
                                    run_range.start,
                                );
                                while let Some(current) = cluster {
                                    let byte = current.text_range().start;
                                    if byte >= run_range.end {
                                        break;
                                    }
                                    if byte > stretch_start {
                                        let count = plan.count_at(byte);
                                        let ink_shift = plan.before_share_at(byte);
                                        // A cut must not land INSIDE a
                                        // joined punctuation sequence
                                        // (dash/ellipsis pairs shape as one
                                        // rule): cut at the sequence's
                                        // entry boundary instead, so the
                                        // whole sequence stays in one
                                        // canvas call and re-forms its
                                        // joined glyphs.
                                        let joined_entry = flow_text
                                            .get(current.text_range())
                                            .and_then(|text| text.chars().next())
                                            .is_some_and(|character| {
                                                joins_with_identical_neighbor(character)
                                                    && flow_text
                                                        .get(
                                                            current.text_range().end..run_range.end,
                                                        )
                                                        .and_then(|text| text.chars().next())
                                                        == Some(character)
                                                    && flow_text
                                                        .get(run_range.start..byte)
                                                        .and_then(|text| text.chars().next_back())
                                                        != Some(character)
                                            });
                                        if !ink_shift
                                            && count <= 1
                                            && uniform.is_none_or(|value| value == count)
                                            && !joined_entry
                                        {
                                            uniform = Some(count);
                                            stretch_shares += count;
                                            justify_shares_used += count;
                                        } else {
                                            emit(
                                                stretch_start..byte,
                                                stretch_x,
                                                stretch_natural
                                                    + plan.share * f64::from(stretch_shares),
                                                plan.share * f64::from(uniform.unwrap_or(0)),
                                            );
                                            justify_shares_used += count;
                                            stretch_start = byte;
                                            stretch_x = natural_x
                                                + plan.share * f64::from(justify_shares_used)
                                                + if ink_shift { plan.share } else { 0.0 };
                                            stretch_natural = 0.0;
                                            stretch_shares = 0;
                                            uniform = None;
                                        }
                                    }
                                    stretch_natural += f64::from(current.advance());
                                    natural_x += f64::from(current.advance());
                                    cluster = current.next_logical();
                                }
                                if stretch_start < run_range.end {
                                    emit(
                                        stretch_start..run_range.end,
                                        stretch_x,
                                        stretch_natural + plan.share * f64::from(stretch_shares)
                                            - box_shed,
                                        plan.share * f64::from(uniform.unwrap_or(0)),
                                    );
                                }
                            }
                        }
                    }
                    PositionedLayoutItem::InlineBox(inline_box) => {
                        // An atomic inline item — an image, or a laid-out
                        // inline-block. Its vertical position is measured
                        // in Parley's ink coordinates, so it maps into the
                        // line box through the ink top.
                        let shift = item_shifts
                            .get(inline_box.id as usize)
                            .copied()
                            .unwrap_or(0.0);
                        max_rise = max_rise.max(shift);
                        if let Some((baseline, mini)) = inline_block_boxes.remove(&inline_box.id) {
                            // Parley rests the box bottom on the text
                            // baseline; an inline-block instead hangs its
                            // LAST line's baseline there (CSS §10.8.1),
                            // so the box drops by its own descent.
                            let height = f64::from(inline_box.height);
                            let justified = atom_justify(inline_box.id);
                            children.push((
                                Fragment::Box(rito_fragment::BoxFragment {
                                    source: mini.source,
                                    rect: FragmentRect {
                                        // A justified atom holds the
                                        // LayoutUnit grid like any inline
                                        // item boundary: its shifted
                                        // position lands on ceil64
                                        // (Range-measured: cum 49.579
                                        // paints the atom at 49.59375).
                                        x: if justify_plan.is_some() {
                                            ((f64::from(inline_box.x) - parley_line_x + justified)
                                                * 64.0)
                                                .ceil()
                                                / 64.0
                                        } else {
                                            f64::from(inline_box.x) - parley_line_x + justified
                                        },
                                        y: f64::from(inline_box.y) - ink_top + (height - baseline),
                                        width: f64::from(inline_box.width),
                                        height,
                                    },
                                    children: mini.children,
                                }),
                                shift,
                            ));
                        } else {
                            // The atom's advance spans the element's flank
                            // borders; the raster rect sits inside them.
                            let (inset_left, inset_right) = image_edge_insets
                                .get(&inline_box.id)
                                .copied()
                                .unwrap_or((0.0, 0.0));
                            let justified = atom_justify(inline_box.id);
                            // A justified atom holds the LayoutUnit grid
                            // like any inline item boundary: its shifted
                            // position lands on ceil64 (Range-measured:
                            // cum 49.579 paints the atom at 49.59375).
                            let atom_x =
                                f64::from(inline_box.x) - parley_line_x + inset_left + justified;
                            let atom_x = if justify_plan.is_some() {
                                (atom_x * 64.0).ceil() / 64.0
                            } else {
                                atom_x
                            };
                            children.push((
                                Fragment::Image(rito_fragment::ImageFragment {
                                    source: root,
                                    rect: FragmentRect {
                                        x: atom_x,
                                        y: f64::from(inline_box.y) - ink_top,
                                        width: f64::from(inline_box.width)
                                            - inset_left
                                            - inset_right,
                                        height: f64::from(inline_box.height),
                                    },
                                    item_index: inline_box.id as u32,
                                }),
                                shift,
                            ));
                        }
                    }
                }
            }
            // Text-only lines take Parley's line height (the CSS strut).
            // A line holding an atomic inline is sized by the CSS envelope
            // instead: baseline-aligned content ascent plus descent, never
            // smaller than the strut — Parley's own line height inflates
            // beyond what a browser gives such lines. Risen content grows
            // the box above the strut by its overflow.
            // Host-measured normal line height: the line's `normal` runs
            // contribute the host's strut or CJK-lifted metric (chosen by
            // whether the line carries any CJK glyph), declared runs keep
            // their fixed heights, and the line takes the max — the model
            // the reference browser was observed to follow.
            let line_text_range = children
                .iter()
                .filter_map(|(fragment, _)| match fragment {
                    Fragment::Text(text) => {
                        Some((text.text_start as usize, text.text_end as usize))
                    }
                    _ => None,
                })
                .fold(None::<(usize, usize)>, |acc, (start, end)| {
                    Some(match acc {
                        Some((lo, hi)) => (lo.min(start), hi.max(end)),
                        None => (start, end),
                    })
                })
                // An empty line (a lone forced break) has no text
                // fragments, but the break that ends it still sizes its
                // box (measured on b39 id210: the 16px <br><br> empty
                // line is 20.2031, not the bare 19.2031 strut) — fall
                // back to the layout line's own byte range so the
                // break-item predicate below can find it.
                .or_else(|| {
                    let range = line.text_range();
                    Some((range.start, range.end))
                });
            // Host font metrics for this line: the content height
            // (ascent + descent) and ascent the host's scaler grid-fits
            // for the line's dominant style, in the script case the line
            // falls into. Both `normal` and declared line-heights derive
            // from this pair, exactly as CSS computes leading.
            // The line's dominant style (largest font) and the tallest
            // declared line-height among the runs on it.
            let mut line_declared_height: Option<f64> = None;
            // Items on this line: text runs by byte range, atomic inlines
            // by item index. Either can carry the style whose host metrics
            // size the line.
            let line_image_items: Vec<usize> = children
                .iter()
                .filter_map(|(fragment, _)| match fragment {
                    Fragment::Image(image) => Some(image.item_index as usize),
                    _ => None,
                })
                .collect();
            // The line box, built the way CSS builds one: every inline box
            // on the line contributes its own font's metrics, every text
            // run contributes the metrics of the font shaping resolved for
            // it, and the line takes the greatest ascent and the greatest
            // descent among them. `None` means at least one contributor is
            // still unmeasured — the host is asked, and the shaped
            // fallback covers this pass.
            let mut contributors: Vec<(rito_style_contract::StyleId, &str)> = Vec::new();
            for (index, range) in item_text_ranges.iter().enumerate() {
                // The ending forced break contributes too (see the
                // entries loop below): a <br>'s style sizes the line it
                // ends even though Parley's line range stops before it.
                let on_line = line_image_items.contains(&index)
                    || line_text_range.is_some_and(|(start, end)| {
                        (range.start < end && start < range.end)
                            || (range.start <= end
                                && end < range.end
                                && flow_text
                                    .get(end..)
                                    .is_some_and(|rest| rest.starts_with('\n')))
                    });
                if !on_line {
                    continue;
                }
                let Some(Some(item)) = item_line_heights.get(index) else {
                    continue;
                };
                if let Some(declared) = item.declared {
                    line_declared_height =
                        Some(line_declared_height.map_or(declared, |best: f64| best.max(declared)));
                    continue;
                }
                // The inline box's own strut, then each of its runs' fonts.
                contributors.push((item.style, ""));
                for (run_item, sample) in &line_run_samples {
                    if *run_item == index {
                        contributors.push((item.style, sample.as_str()));
                    }
                }
            }
            let host_line = if contributors.is_empty() {
                None
            } else {
                let mut ascent = 0.0_f64;
                let mut descent = 0.0_f64;
                let mut complete = true;
                for (style_id, sample) in contributors {
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(style_id).ok())
                    else {
                        complete = false;
                        continue;
                    };
                    match self.host_normal_line(resolved, sample) {
                        Some(metric) => {
                            ascent = ascent.max(metric.ascent());
                            descent = descent.max(metric.descent());
                        }
                        None => complete = false,
                    }
                }
                (complete && ascent + descent > 0.0).then_some((ascent + descent, ascent))
            };
            // CSS 2.1 §10.8 for a line holding an atomic inline: every
            // inline-level contributor sets its own (above, below) around
            // the shared baseline — a text run its half-leaded strut
            // (floored half-leading over its declared-or-normal line
            // height, shifted by its vertical-align), an atomic inline its
            // box over the baseline plus its raise — and the line box is
            // max(above) + max(below), baseline at max(above). Measured on
            // the footnote-marker idiom (16px/19.2px text, a 14.4px sup
            // image raised 6.33): Chromium sizes the line img-above 20.72
            // + strut-below 3.2 = 23.92, not the normal-metric envelope.
            // A flattened empty inline (a <sup> holding only the image)
            // loses its own strut here; the atomic box dominates it in
            // every corpus shape measured. Any unmeasured host metric
            // falls back to the envelope path below, keeping the
            // measure → inject → reflow loop converging.
            let tree_items: &[InlineItem] = match &tree.node(root).content {
                FormattingNodeContent::InlineFlow { items } => items,
                _ => &[],
            };
            let contributions = if has_inline_box || line_declared_height.is_some() {
                let mut complete = true;
                // (resolved style, sample, shift) per text-strut
                // contributor: the container's strut, then every on-line
                // text item's declared-family strut plus each font its
                // runs actually resolved to — the latter only under
                // `line-height: normal`, where the browser lets the
                // fallback font grow the line. Under a fixed line-height
                // the browser sizes and places the line from the strut
                // font alone (measured: 19.2px over Tinos+SourceHan puts
                // the baseline at 15 for empty, Latin and CJK samples
                // alike).
                let mut entries: Vec<(&InlineFormattingStyle, &str, f64, bool)> = Vec::new();
                let mut strut_resolved: Option<&InlineFormattingStyle> = None;
                match tree.strut_style(root).or_else(|| {
                    item_line_heights
                        .iter()
                        .flatten()
                        .next()
                        .map(|item| item.style)
                }) {
                    Some(strut_style_id) => match style_tables
                        .and_then(|tables| tables.inline.style(strut_style_id).ok())
                    {
                        Some(resolved) => {
                            strut_resolved = Some(resolved);
                            entries.push((resolved, "", 0.0, false));
                        }
                        None => {
                            complete = false;
                            if line_debug {
                                debug_misses.push("strut style resolve".to_owned());
                            }
                        }
                    },
                    None => {
                        complete = false;
                        if line_debug {
                            debug_misses.push("no strut style".to_owned());
                        }
                    }
                }
                // A super/sub-shifted span's line envelope is MEASURED, not
                // derived: Blink quantizes the shifted box's above-baseline
                // contribution onto whole pixels through interplay no font
                // table exposes (a 64-configuration oracle matrix refused
                // every closed form; the raise itself IS floor64(S/3)+1,
                // identical to ours — only the envelope term diverges, +2
                // on b74's 0.8em bold ① marker). The U+E00C/U+E00D probes
                // measure the exact paragraph idiom — strut font and
                // line-height with the span raised inside — so the metric's
                // baseline/height ARE the line's (above, below) with the
                // raise already embedded.
                let sup_samples: Vec<(usize, String)> = strut_resolved
                    .map(|strut| {
                        let strut_size = f64::from(strut.font.size.get());
                        item_shifts
                            .iter()
                            .enumerate()
                            .filter(|(_, shift)| **shift != 0.0)
                            .filter_map(|(index, shift)| {
                                let item = item_line_heights.get(index)?.as_ref()?;
                                let resolved = style_tables?.inline.style(item.style).ok()?;
                                // A span that DECLARES its own line-height
                                // keeps the fixed-box path (measured exact on
                                // b1's .postil-b1, line-height 1.2); the probe
                                // models only the inherited-line-height idiom.
                                if resolved.font.line_height_is_declared {
                                    return None;
                                }
                                let ratio = f64::from(resolved.font.size.get()) / strut_size;
                                let sentinel = if *shift > 0.0 { '\u{E00C}' } else { '\u{E00D}' };
                                let line_height =
                                    used_declared_line_height(strut.font.line_height, strut_size)
                                        .map_or_else(|| "n".to_owned(), |px| format!("{px}"));
                                Some((index, format!("{sentinel}{ratio:.4}:{line_height}")))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                for (index, range) in item_text_ranges.iter().enumerate() {
                    // A forced break belongs to the line it ENDS: Parley's
                    // line range stops before the newline, but the <br>'s
                    // own style still sizes that line's box in Blink
                    // (measured on b39 id210: a 16px span's leading <br>
                    // after a 12px line grows the box 20.2031 → 21.2031,
                    // and the EMPTY line its second <br> forms is 20.2031
                    // tall, not the bare strut) — so an item also joins
                    // when it holds the newline sitting at the line's end.
                    let on_line = line_text_range.is_some_and(|(start, end)| {
                        (range.start < end && start < range.end)
                            || (range.start <= end
                                && end < range.end
                                && flow_text
                                    .get(end..)
                                    .is_some_and(|rest| rest.starts_with('\n')))
                    });
                    if !on_line || range.is_empty() {
                        continue;
                    }
                    let Some(Some(item)) = item_line_heights.get(index) else {
                        continue;
                    };
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(item.style).ok())
                    else {
                        complete = false;
                        if line_debug {
                            debug_misses.push(format!("item {index} style resolve"));
                        }
                        continue;
                    };
                    let shift = item_shifts.get(index).copied().unwrap_or(0.0);
                    if shift != 0.0 {
                        if let Some((strut, key)) = strut_resolved.zip(
                            sup_samples
                                .iter()
                                .find(|(sample_index, _)| *sample_index == index)
                                .map(|(_, key)| key.as_str()),
                        ) {
                            entries.push((strut, key, 0.0, false));
                            if self.host_normal_line_peek(strut, key).is_some() {
                                // The measured envelope replaces the computed
                                // fallback entirely — the fallback's normal-line
                                // ascent overshoots Blink's quantized term.
                                continue;
                            }
                        }
                    }
                    entries.push((resolved, "", shift, false));
                    // Run-font samples join the entries under `normal`
                    // line-height, and for SHIFTED items too: a raised
                    // marker contributes the envelope of the font its
                    // glyphs actually resolved to (a CJK circled digit
                    // the Latin pin cannot serve rides the CJK face's
                    // taller ascent). Shifted samples are OPTIONAL —
                    // until the host measures the new key the strut
                    // entry stands, instead of the whole line falling
                    // back to the shaped envelope.
                    // A span that DECLARES its own line-height keeps a
                    // content-independent fixed box even when shifted
                    // (measured: CJK and Latin superscripts in a
                    // declared-1.2 span size identically); only an
                    // INHERITED line-height defers to the run font.
                    let optional_sample = shift != 0.0 && !resolved.font.line_height_is_declared;
                    if matches!(resolved.font.line_height, LineHeight::Normal) || optional_sample {
                        for (run_item, sample) in &line_run_samples {
                            if *run_item == index {
                                entries.push((resolved, sample.as_str(), shift, optional_sample));
                            }
                        }
                    }
                }
                // A childless inline box (an empty <sup> footnote anchor)
                // has no run and an empty text range, but the open box
                // still joins the line its offset falls on: its font's
                // integer envelope around its shifted baseline, through
                // the same declared/normal split as any entry. No glyphs
                // means no used-font terms — the closed form is exact
                // (measured on a 12px/1.2 empty sup in a 16px/1.3
                // paragraph: Blink grows the line to above 17.328125 =
                // integer ascent 11 + raise 6.328125, page ink verified).
                for (offset, style_id, shift) in &empty_box_struts {
                    let on_line = line_text_range.is_some_and(|(start, end)| {
                        (*offset >= start && *offset < end)
                            || (*offset == end && end == flow_text.len())
                    });
                    if !on_line {
                        continue;
                    }
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(*style_id).ok())
                    else {
                        complete = false;
                        continue;
                    };
                    entries.push((resolved, "", *shift, false));
                }
                // Max over contributors, allowing NEGATIVE halves: a
                // declared line-height smaller than the strut's grid
                // envelope puts the baseline BELOW the line box bottom
                // (h1 at an inherited 19.2px: Blink's box is 19.203125
                // tall with the baseline 20 down — below is −0.797).
                // Starting the accumulators at 0.0 silently clamped that
                // to 0 and grew the line by a pixel, shifting everything
                // under the heading (measured on the cover colophon).
                let mut above = f64::NEG_INFINITY;
                let mut below = f64::NEG_INFINITY;
                for (resolved, sample, shift, optional) in entries {
                    let Some(metric) = self.host_normal_line(resolved, sample) else {
                        if optional {
                            continue;
                        }
                        complete = false;
                        if line_debug {
                            debug_misses.push(format!(
                                "entry metric {}@{}\"{}\"",
                                host_family_key(resolved),
                                resolved.font.size.get(),
                                sample
                            ));
                        }
                        continue;
                    };
                    let (asc, desc) = (metric.ascent(), metric.descent());
                    // A super/sub-shifted inline box contributes its
                    // FONT's normal envelope around its raised baseline,
                    // not its line-height box: a 12px superscript inside
                    // a 20.8px fixed-height paragraph grows the line to
                    // normal-ascent 14 + raise, where the fixed-height
                    // model overshot by two rows (measured; totals agreed
                    // and only the baseline moved).
                    let (item_above, item_below) =
                        if sample.starts_with('\u{E00C}') || sample.starts_with('\u{E00D}') {
                            // Host-measured super/sub line envelope: the probe's
                            // baseline/height are the line's above/below with the
                            // raise already embedded (shift is 0 on this entry).
                            (asc, desc)
                        } else if shift != 0.0 && !resolved.font.line_height_is_declared {
                            (asc, desc)
                        } else {
                            match used_declared_line_height(
                                resolved.font.line_height,
                                f64::from(resolved.font.size.get()),
                            ) {
                                None => (asc, desc),
                                Some(height) => {
                                    let a = metric.fixed_baseline(height);
                                    (a, height - a)
                                }
                            }
                        };
                    above = above.max(item_above + shift);
                    below = below.max(item_below - shift);
                }
                // Every atomic inline: its box above the baseline plus its
                // raise; a sub-shifted box hangs below by its drop. The
                // atom's INHERITED strut contributes too — CSS 2.1 §10.8
                // gives every enclosing inline box its leading, and the
                // atom's inherited style carries exactly that box's font
                // (measured: a footnote marker image alone inside a
                // 12px <sup> still grows the line by the sup strut raised
                // with it, 0.6px above what the image box alone gives).
                let mut top_aligned_heights: Vec<f64> = Vec::new();
                for (fragment, shift) in &children {
                    if let Fragment::Image(image) = fragment {
                        let align_top =
                            tree_items
                                .get(image.item_index as usize)
                                .is_some_and(|item| {
                                    matches!(
                                        item,
                                        InlineItem::Image {
                                            align_top: true,
                                            ..
                                        }
                                    )
                                });
                        if align_top {
                            // A top-aligned box sits outside the baseline
                            // envelope; it only grows the line DOWNWARD
                            // when taller than it (handled after the max).
                            top_aligned_heights.push(image.rect.height);
                        } else {
                            above = above.max(image.rect.height + shift);
                            below = below.max(-shift);
                        }
                        let item =
                            tree_items
                                .get(image.item_index as usize)
                                .and_then(|item| match item {
                                    InlineItem::Image { style, .. } => Some(*style),
                                    _ => None,
                                });
                        let resolved = item.and_then(|style_id| {
                            style_tables.and_then(|tables| tables.inline.style(style_id).ok())
                        });
                        let Some(resolved) = resolved else {
                            if line_debug {
                                debug_misses.push("atom style resolve".to_owned());
                            }
                            continue;
                        };
                        let Some(metric) = self.host_normal_line(resolved, "") else {
                            complete = false;
                            if line_debug {
                                debug_misses.push(format!(
                                    "atom metric {}@{}",
                                    host_family_key(resolved),
                                    resolved.font.size.get()
                                ));
                            }
                            continue;
                        };
                        let (asc, desc) = (metric.ascent(), metric.descent());
                        let (item_above, item_below) = match used_declared_line_height(
                            resolved.font.line_height,
                            f64::from(resolved.font.size.get()),
                        ) {
                            None => (asc, desc),
                            Some(height) => {
                                let a = metric.fixed_baseline(height);
                                (a, height - a)
                            }
                        };
                        above = above.max(item_above + shift);
                        below = below.max(item_below - shift);
                    }
                }
                // An inline-block atom: its box straddles the baseline —
                // its LAST line's baseline rests on the shared one, so it
                // contributes (baseline, height − baseline) around it,
                // plus its inherited strut like any enclosing inline box.
                for (fragment, shift) in &children {
                    let Fragment::Box(atom) = fragment else {
                        continue;
                    };
                    let baseline = inline_block_baselines
                        .get(&atom.source.0)
                        .copied()
                        .unwrap_or(atom.rect.height);
                    above = above.max(baseline + shift);
                    below = below.max((atom.rect.height - baseline) - shift);
                    let item_style = tree_items.iter().find_map(|item| match item {
                        InlineItem::InlineBlock { node, style, .. } if node.0 == atom.source.0 => {
                            Some(*style)
                        }
                        _ => None,
                    });
                    let resolved = item_style.and_then(|style_id| {
                        style_tables.and_then(|tables| tables.inline.style(style_id).ok())
                    });
                    let Some(resolved) = resolved else {
                        continue;
                    };
                    let Some(metric) = self.host_normal_line(resolved, "") else {
                        complete = false;
                        continue;
                    };
                    let (asc, desc) = (metric.ascent(), metric.descent());
                    let (item_above, item_below) = match used_declared_line_height(
                        resolved.font.line_height,
                        f64::from(resolved.font.size.get()),
                    ) {
                        None => (asc, desc),
                        Some(height) => {
                            let a = metric.fixed_baseline(height);
                            (a, height - a)
                        }
                    };
                    above = above.max(item_above + shift);
                    below = below.max(item_below - shift);
                }
                // A `vertical-align: top` box hangs from the line-box top
                // and grows the line DOWNWARD only when taller than the
                // baseline envelope (the badge stays inside the sup-strut
                // envelope; a tall top-aligned plate would extend below).
                for top_height in &top_aligned_heights {
                    let line_height = above + below;
                    if *top_height > line_height {
                        below += top_height - line_height;
                    }
                }
                (complete && above + below > 0.0).then_some((above, below))
            } else {
                None
            };
            // CSS 2.1 §10.8: the paragraph's `normal` strut is one more
            // contributor around the shared baseline — its host ascent
            // above, its host descent below — and the line box takes
            // max(above) + max(below) with the baseline at max(above).
            // Centering the content envelope inside the strut height
            // instead sank sub-sized runs' baselines: a 16px paragraph of
            // 0.75em spans paints baselines at the strut's 14, not the
            // centered 12 (measured on the calibre colophon idiom, where
            // every publisher line sat two rows high of the browser). A
            // DECLARED line-height keeps the centering model — the
            // browser sizes and places fixed lines from the strut box
            // (committed rule) — so the envelope only covers `normal`.
            let strut_envelope: Option<(f64, f64)> = tree
                .strut_style(root)
                .or_else(|| {
                    item_line_heights
                        .iter()
                        .flatten()
                        .next()
                        .map(|item| item.style)
                })
                .and_then(|id| style_tables.and_then(|tables| tables.inline.style(id).ok()))
                .filter(|resolved| matches!(resolved.font.line_height, LineHeight::Normal))
                .and_then(|resolved| self.host_normal_line(resolved, ""))
                .map(|metric| (metric.ascent(), metric.descent()));
            let base_height = if let Some((above, below)) = contributions {
                above + below
            } else if has_inline_box {
                // An atomic inline sits on the baseline, so the line still
                // reserves the strut's space below it — a browser's line
                // box around an image is the image plus that descent, not
                // the image alone. Above the baseline the taller of the
                // two wins.
                let (above, below) = match host_line {
                    Some((content_height, ascent)) => (ascent, content_height - ascent),
                    None => (0.0, 0.0),
                };
                let envelope =
                    f64::from(metrics.ascent).max(above) + f64::from(metrics.descent).max(below);
                envelope.max(strut_height.unwrap_or(0.0))
            } else if let Some(declared) = line_declared_height {
                declared.max(strut_height.unwrap_or(0.0))
            } else if let Some((host, host_ascent)) = host_line {
                match strut_envelope {
                    Some((strut_ascent, strut_descent)) => {
                        host_ascent.max(strut_ascent) + (host - host_ascent).max(strut_descent)
                    }
                    None => host.max(strut_height.unwrap_or(0.0)),
                }
            } else if children.is_empty() {
                // An empty line (a forced break with no content) is sized
                // by the strut alone; the shaped fallback metric only
                // covers flows whose strut could not resolve.
                strut_height.unwrap_or(f64::from(metrics.line_height))
            } else {
                // Every line box includes the strut: the container's own
                // line-height floors lines whose runs declare less.
                f64::from(metrics.line_height).max(strut_height.unwrap_or(0.0))
            };
            // A contributions-sized line already contains every raise
            // inside its (above, below); adding max_rise on top of it
            // again is exactly the overshoot the model replaced.
            let line_height = if contributions.is_some() {
                base_height
            } else {
                base_height + max_rise
            };
            running_top += line_height;
            // The host's measured baseline wins whenever its metric sized
            // the line: where the baseline sits inside a `normal` line is
            // grid-fitted by the host's scaler, not derivable from the
            // shaped ascent. Shaped half-leading covers every other line.
            // CSS leading, over host-fitted metrics: half the difference
            // between the line box and the content area sits above the
            // baseline. The host floors that half-leading (its scaler
            // works in whole pixels), which is what places glyphs on the
            // same rows the reference browser uses.
            let baseline = if let Some((above, _)) = contributions {
                above
            } else if has_inline_box {
                // The envelope of an atomic-inline line is already exactly
                // ascent + descent, so its baseline sits at that ascent —
                // there is no leading to redistribute around it.
                max_rise + f64::from(metrics.ascent).max(host_line.map_or(0.0, |(_, a)| a))
            } else {
                match host_line {
                    Some((content_height, ascent)) => match strut_envelope {
                        Some((strut_ascent, _)) => max_rise + ascent.max(strut_ascent),
                        None => max_rise + ((base_height - content_height) / 2.0).floor() + ascent,
                    },
                    None => {
                        let half_leading =
                            (base_height - f64::from(metrics.ascent) - f64::from(metrics.descent))
                                / 2.0;
                        max_rise + half_leading + f64::from(metrics.ascent)
                    }
                }
            };
            // Ruby annotations grow the line. Measured to exactness (24/24
            // configurations: two fonts x three line-heights x two sizes x
            // first/subsequent lines): the browser places the annotation's
            // BASELINE one pixel above the base font's typographic-ascent
            // edge, so the line's baseline must sit at least
            //   annotation grid ascent + 1 + floor(sTypoAscender x size)
            // below the line top. A later line may also spend the gap the
            // PREVIOUS line leaves under its own typographic-descent edge
            // (its below-baseline extent minus ceil(sTypoDescender x
            // size)). Whatever the baseline still lacks becomes growth.
            let base_typo =
                |range: &std::ops::Range<usize>, fs: f64| -> Option<(f64, f64, (u64, u32))> {
                    use skrifa::raw::TableProvider as _;
                    for item in line.items() {
                        let PositionedLayoutItem::GlyphRun(glyph_run) = item else {
                            continue;
                        };
                        let run = glyph_run.run();
                        let shaped = run.text_range();
                        if shaped.start >= range.end || range.start >= shaped.end {
                            continue;
                        }
                        let font = run.font();
                        let font_key = (font.data.id(), font.index);
                        let font_ref =
                            skrifa::FontRef::from_index(font.data.as_ref(), font.index).ok()?;
                        let os2 = font_ref.os2().ok()?;
                        let upem = f64::from(font_ref.head().ok()?.units_per_em());
                        let asc = f64::from(os2.s_typo_ascender()) / upem * fs;
                        let desc = f64::from(-i32::from(os2.s_typo_descender())) / upem * fs;
                        return Some((asc, desc, font_key));
                    }
                    None
                };
            // A vertical-rl flow's annotation shares NO half-leading with
            // its base the way a horizontal line's does: the annotation
            // column needs its own width beyond the base's half-leading
            // (measured matrix, 4 line-heights x 3 font sizes x 2 rt
            // ratios x 3 annotation lengths: growth = rt size minus the
            // half-leading, floored at zero, independent of annotation
            // length, the whole growth landing on the line's right).
            let vertical_flow = tree
                .styles()
                .and_then(|tables| {
                    let strut = tree.strut_style(root)?;
                    tables.inline.style(strut).ok()
                })
                .is_some_and(|strut| {
                    strut.bidi.writing_mode == rito_style_contract::WritingMode::VerticalRightToLeft
                });
            let ruby_growth = if vertical_flow {
                let mut growth = 0.0_f64;
                for (index, range) in item_text_ranges.iter().enumerate() {
                    let on_line = line_text_range
                        .is_some_and(|(start, end)| range.start < end && start < range.end);
                    if !on_line || range.is_empty() {
                        continue;
                    }
                    let Some(InlineItem::Text {
                        ruby_annotation: Some(annotation),
                        style,
                        ..
                    }) = tree_items.get(index)
                    else {
                        continue;
                    };
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(*style).ok())
                    else {
                        continue;
                    };
                    let fs = f64::from(resolved.font.size.get());
                    let annotation_size = fs * f64::from(annotation.size_ratio);
                    // The annotation column asks for its font size plus a
                    // half pixel under the pinned CJK serif (matrix:
                    // rt 6/8/10/14 across four line-heights and three
                    // base sizes all measure need = rt + 0.5).
                    growth =
                        growth.max((annotation_size + 0.5 - (line_height - fs) / 2.0).max(0.0));
                }
                growth
            } else {
                let mut growth = 0.0_f64;
                for (index, range) in item_text_ranges.iter().enumerate() {
                    let on_line = line_text_range
                        .is_some_and(|(start, end)| range.start < end && start < range.end);
                    if !on_line || range.is_empty() {
                        continue;
                    }
                    let Some(InlineItem::Text {
                        ruby_annotation: Some(annotation),
                        style,
                        ..
                    }) = tree_items.get(index)
                    else {
                        continue;
                    };
                    // A split base grows only the lines whose segment is
                    // allocated annotation words (character-midpoint
                    // rule): 正|规勇者 under "Legal Brave" grows both
                    // lines, 黄金妖|精 under Leprechaun grows only the
                    // first.
                    if let Some((line_start, line_end)) = line_text_range {
                        let seg_start = range.start.max(line_start);
                        let seg_end = range.end.min(line_end);
                        let total_chars = flow_text
                            .get(range.clone())
                            .map_or(0.0, |base| base.chars().count() as f64);
                        if total_chars > 0.0 && (seg_start > range.start || seg_end < range.end) {
                            let before = flow_text
                                .get(range.start..seg_start)
                                .map_or(0.0, |prefix| prefix.chars().count() as f64);
                            let through = flow_text
                                .get(range.start..seg_end)
                                .map_or(0.0, |prefix| prefix.chars().count() as f64);
                            let allocated = rito_fragment::allocate_ruby_annotation(
                                &annotation.text,
                                before / total_chars,
                                if seg_end >= range.end {
                                    f64::INFINITY
                                } else {
                                    through / total_chars
                                },
                            );
                            if allocated.is_empty() {
                                continue;
                            }
                        }
                    }
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(*style).ok())
                    else {
                        continue;
                    };
                    let fs = f64::from(resolved.font.size.get());
                    let ratio = f64::from(annotation.size_ratio);
                    // The browser's ruby geometry is measured, not derived:
                    // the U+E000 host probe is a one-line ruby whose
                    // baseline IS the minimum baseline the annotation
                    // demands (verified invariant: independent of
                    // line-height, 32/32 configurations), and the U+E001
                    // two-line probe exposes how much of the previous
                    // line's under-edge the annotation may reuse. Font
                    // tables cannot substitute: three fonts yielded three
                    // inconsistent hhea/OS-2 decompositions.
                    // The probe key carries the annotation's size ratio so
                    // the host measures the ruby with the rt size the
                    // cascade actually produced — and the probe's CONTENT
                    // mirrors two font bits the geometry depends on
                    // (measured matrix, fs16/rt50%: each shifts growth by
                    // one pixel, additively): the annotation's script
                    // picks the rt face, and the PREVIOUS line's font
                    // composition (any non-CJK glyph, a space included)
                    // shrinks its reusable under-edge.
                    let (typo_asc, typo_desc, base_font) = base_typo(range, fs)
                        .map_or((fs * 0.88, fs * 0.12, None), |(asc, desc, font)| {
                            (asc, desc, Some(font))
                        });
                    let is_cjk = |ch: char| {
                        matches!(u32::from(ch), 0x2E80..=0x9FFF | 0xF900..=0xFAFF
                            | 0xFF00..=0xFFEF | 0x20000..=0x3FFFF)
                    };
                    let anno_cjk =
                        !annotation.text.is_empty() && annotation.text.chars().all(is_cjk);
                    // The BASE's script picks the probed base face too: a
                    // pure-latin base resolves the latin pin, whose
                    // annotation stack sits one pixel lower than the CJK
                    // face's (measured on the b96 long-base ruby: Blink's
                    // latin-base paragraph is 26px where a CJK base gets
                    // 27). E006-E00B mirror E000-E005 with a latin rb.
                    let base_latin = flow_text
                        .get(range.clone())
                        .is_some_and(|base| !base.chars().any(is_cjk));
                    let prev_mixed = !prev_line_fonts.is_empty()
                        && base_font
                            .is_some_and(|base| prev_line_fonts.iter().any(|key| *key != base));
                    let one_sentinel = match (base_latin, anno_cjk) {
                        (false, false) => '\u{E000}',
                        (false, true) => '\u{E002}',
                        (true, false) => '\u{E006}',
                        (true, true) => '\u{E007}',
                    };
                    let two_sentinel = match (base_latin, anno_cjk, prev_mixed) {
                        (false, false, false) => '\u{E001}',
                        (false, true, false) => '\u{E003}',
                        (false, false, true) => '\u{E004}',
                        (false, true, true) => '\u{E005}',
                        (true, false, false) => '\u{E008}',
                        (true, true, false) => '\u{E009}',
                        (true, false, true) => '\u{E00A}',
                        (true, true, true) => '\u{E00B}',
                    };
                    // The probe's rt carries the annotation's ACTUAL text:
                    // the annotation stack height depends on which face
                    // the family list resolves for those characters, and
                    // a script-class sample can land on a different face
                    // (measured on b9's FZBWKS: the Han-only book face
                    // covers the real 破坏神 annotation but not the あ
                    // class sample, whose SourceHan fallback stack sits
                    // one pixel taller — every ruby opener overgrew by
                    // that pixel and shifted the rest of the page).
                    let one_key = format!("{one_sentinel}{ratio:.4}:{}", annotation.text);
                    let two_key = format!("{two_sentinel}{ratio:.4}:{}", annotation.text);
                    let ruby_one = self.host_normal_line_sized(resolved, fs, &one_key);
                    let ruby_two = self.host_normal_line_sized(resolved, fs, &two_key);
                    // The reuse derivation subtracts the two-line probe's
                    // FIRST-line baseline, and that line is the probe's own
                    // CJK text — so the term must be the CJK-sample metric,
                    // not the empty-sample strut (a Latin-first family made
                    // them differ by four pixels and the derived allowance
                    // swallowed the whole reuse).
                    let plain = self.host_normal_line_sized(resolved, fs, "\u{4E2D}");
                    let annotation_ascent = self
                        .host_normal_line_sized(resolved, fs * ratio, "")
                        .map_or(fs * ratio, |metric| metric.ascent());
                    let required = ruby_one.map_or_else(
                        // Fallback until the host answers: the table law
                        // (exact for Source Han and FZBWKS, one px off for
                        // fonts whose tables disagree with the scaler).
                        || typo_asc.floor() + annotation_ascent + (typo_desc * 0.5).round(),
                        |metric| metric.ascent(),
                    );
                    let reuse = match (plain, ruby_one, ruby_two) {
                        (Some(plain), Some(one), Some(two)) => {
                            // below-edge allowance = below extent minus the
                            // measured second-line reduction.
                            (two.height - one.height - plain.ascent()).max(0.0)
                        }
                        _ => typo_desc.round(),
                    };
                    let prev_gap = prev_ruby_below.map_or(0.0, |below| (below - reuse).max(0.0));
                    growth = growth.max((required - baseline - prev_gap).max(0.0));
                }
                // The browser pushes a growing FIRST line down
                // by a WHOLE pixel count — ceil of the baseline deficit —
                // while an interior line's growth keeps its analytic
                // value. Measured (pins verified, four line-heights at
                // fs 15.2 / rt 0.7 latin): opener pushes 10/9/8/6 at lh
                // 19.765625/22/24/28.109375 == ceil(25 − natural baseline)
                // 4/4, while the lh-19.765625 INTERIOR line measures
                // 7.234375 exactly — un-ceiled (the only fractional
                // interior case in the matrix). b20's un-ceiled openers
                // sat 0.55px high and binned to −1 rows on half the
                // dialog lines.
                if prev_ruby_below.is_none() {
                    // The paragraph's own padding-top absorbs a FIRST
                    // line's annotation growth: the annotation overflows
                    // upward into the padding and the line keeps its
                    // natural height (padding oracle: an 8px pad absorbs
                    // the whole 6px growth, a 4px pad absorbs 4; b52's
                    // contents rows sat 8px low when the growth ignored
                    // their 0.9em padding). Percentages have no basis
                    // here and absorb nothing.
                    let padding_absorb = tree
                        .styles()
                        .and_then(|tables| tables.layout.style(tree.node(root).style).ok())
                        .map_or(0.0, |style| match style.padding.top.value() {
                            rito_style_contract::LengthPercentage::Length(px) => {
                                f64::from(px.get())
                            }
                            _ => 0.0,
                        });
                    (growth - padding_absorb).max(0.0).ceil()
                } else {
                    growth
                }
            };
            let line_height = line_height + ruby_growth;
            let baseline = baseline + ruby_growth;
            running_top += ruby_growth;
            prev_ruby_below = Some((line_height - baseline).max(0.0));
            prev_line_fonts.clear();
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(glyph_run) = item {
                    let font = glyph_run.run().font();
                    let key = (font.data.id(), font.index);
                    if !prev_line_fonts.contains(&key) {
                        prev_line_fonts.push(key);
                    }
                }
            }
            if line_debug && (has_inline_box || item_shifts.iter().any(|shift| *shift != 0.0)) {
                eprintln!(
                    "[line-debug] contributions={contributions:?} host_line={host_line:?} \
                     baseline={baseline} height={line_height} max_rise={max_rise} \
                     misses={debug_misses:?}"
                );
            }
            // A spread base's per-range letter spacing splits its glyph
            // run at the last cluster (the one cluster without a gap).
            // Painted apart, each piece would repeat the annotation over
            // its own extent; merged back, one fragment with the gap as
            // justify spacing paints every cluster at its shaped position
            // — the trailing gap after the last cluster falls outside the
            // rect and the canvas never draws it.
            if !ruby_spreads.is_empty() {
                merge_ruby_spread_fragments(&mut children, &item_text_ranges, &ruby_spreads);
            }
            let children: Vec<Fragment> = children
                .into_iter()
                .map(|(mut fragment, shift)| {
                    let adjust = max_rise - shift + ruby_growth;
                    match &mut fragment {
                        Fragment::Text(text) => {
                            text.rect.y = adjust;
                            text.rect.height = base_height;
                        }
                        // An atomic inline sits on the line's baseline:
                        // its bottom margin edge rests there, however tall
                        // the line's own strut is. Parley's ink-relative
                        // position only agrees while the image is the
                        // tallest thing on the line; whenever the strut
                        // reaches higher, the image has to come down.
                        Fragment::Image(image) => {
                            let align_top =
                                tree_items
                                    .get(image.item_index as usize)
                                    .is_some_and(|item| {
                                        matches!(
                                            item,
                                            InlineItem::Image {
                                                align_top: true,
                                                ..
                                            }
                                        )
                                    });
                            image.rect.y = if align_top {
                                // `vertical-align: top` aligns to the line
                                // box top as if nothing were shifted, but
                                // an enclosing super/sub chain still
                                // displaces the box afterwards — the
                                // browser aligns the pending box from its
                                // unshifted metrics and the ancestor's
                                // baseline shift has already moved the
                                // fragment (measured: a footnote badge
                                // inside a 16px paragraph's <sup> inks its
                                // top 6.328125px ABOVE the line box top =
                                // trunc64(16/3) + 1, line-height
                                // independent).
                                -shift
                            } else {
                                baseline - shift - image.rect.height
                            };
                        }
                        // An inline-block atom hangs its own baseline —
                        // its LAST line's (CSS §10.8.1) — on the line
                        // baseline, so its top sits that far above it.
                        Fragment::Box(atom) => {
                            let mini_baseline = inline_block_baselines
                                .get(&atom.source.0)
                                .copied()
                                .unwrap_or(atom.rect.height);
                            atom.rect.y = baseline - shift - mini_baseline;
                        }
                        _ => {}
                    }
                    fragment
                })
                .collect();
            let marker = if lines.is_empty() {
                list_marker.map(|(diameter, x_flow, rise)| rito_fragment::MarkerFragment {
                    x: x_flow - line_x,
                    y: baseline - rise - diameter / 2.0,
                    diameter,
                })
            } else {
                None
            };
            lines.push(Fragment::Line(LineFragment {
                source: root,
                rect: FragmentRect {
                    x: line_x,
                    y: line_top,
                    width: f64::from(metrics.advance),
                    height: line_height,
                },
                baseline,
                trailing_whitespace: f64::from(metrics.trailing_whitespace),
                ruby_growth,
                marker,
                children,
            }));
        }
        // A forced break at the very end of the flow leaves one empty
        // trailing line; a browser generates no line box for a block-final
        // <br> unless it is the block's only content.
        if lines.len() > 1 {
            if let Some(Fragment::Line(last)) = lines.last() {
                if last.children.is_empty() {
                    running_top -= last.rect.height;
                    lines.pop();
                }
            }
        }
        Ok(LayoutOutcome {
            fragments: FragmentTree {
                root: Fragment::Box(BoxFragment {
                    source: root,
                    rect: FragmentRect {
                        x: 0.0,
                        y: 0.0,
                        width: space.inline_size,
                        height: running_top,
                    },
                    children: lines,
                }),
            },
            continuation: None,
            escaped_floats: Vec::new(),
        })
    }

    fn intrinsic_inline_sizes(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
    ) -> Result<IntrinsicInlineSizes, LayoutError> {
        if node.0 as usize >= tree.len() {
            return Err(LayoutError::Invalid(format!(
                "intrinsic-size query for out-of-bounds node {}",
                node.0
            )));
        }
        // A percentage-sized replaced element can shrink to anything, so
        // it contributes nothing to the minimum, while the maximum keeps
        // its intrinsic size — the two passes below are exactly that
        // distinction, and it is what lets a table cell with a specified
        // width hold a `width: 100%` image without the column inflating
        // to the image's natural width.
        let shrunk = self.build_layout(
            tree,
            node,
            None,
            None,
            None,
            PercentageImageSizing::Shrunk,
            &[],
            &[],
            &[],
            &CancelFlag::new(),
        )?;
        let intrinsic = self.build_layout(
            tree,
            node,
            None,
            None,
            None,
            PercentageImageSizing::Intrinsic,
            &[],
            &[],
            &[],
            &CancelFlag::new(),
        )?;
        // text-indent joins the first line's intrinsic contribution, as in
        // Chromium: a table cell whose one line carries a 2em indent
        // measures indent + text, and a column sized without the indent
        // wraps that line (b20 contents: a 9-ideograph title broke after
        // its 7th character because the column took only the text width).
        // The negative side stays out of min-content so a hanging indent
        // cannot squeeze a column below its widest unbreakable unit.
        // ONLY the CSS text-indent counts: the layout-time first-line
        // indent also folds in a leading inline box's padding/border,
        // which the measured run widths already include — adding that
        // component again double-counts it (a padded leading box on the
        // b52 title page grew its table column and rescaled the cell's
        // image).
        let min_text = f64::from(shrunk.layout.calculate_content_widths().min);
        let max_text = f64::from(intrinsic.layout.calculate_content_widths().max);
        let css_indent = tree
            .strut_style(node)
            .or_else(|| match &tree.node(node).content {
                FormattingNodeContent::InlineFlow { items } => {
                    items.first().map(|item| match item {
                        InlineItem::Text { style, .. }
                        | InlineItem::Image { style, .. }
                        | InlineItem::InlineBlock { style, .. }
                        | InlineItem::EmptyBox { style, .. } => *style,
                    })
                }
                _ => None,
            })
            .and_then(|style_id| {
                tree.styles()
                    .and_then(|styles| styles.inline.style(style_id).ok())
            })
            .map_or(0.0_f32, resolved_text_indent);
        let indent = if intrinsic.text.is_empty() && max_text <= 0.0 {
            0.0
        } else {
            f64::from(css_indent)
        };
        // The browser stores preferred widths as LayoutUnits, CEILING the
        // shaped float sum onto the 1/64 grid (measured: a lone '1' cell
        // measures 21.4921875 shaped but sizes its table column 21.5, and
        // the half-pixel landed the neighbouring image cell on the other
        // side of a whole-pixel snap).
        let ceil64 = |value: f64| (value * 64.0).ceil() / 64.0;
        let min_content = ceil64(min_text + indent.max(0.0));
        Ok(IntrinsicInlineSizes {
            min_content,
            max_content: ceil64(max_text + indent).max(min_content),
        })
    }
}
