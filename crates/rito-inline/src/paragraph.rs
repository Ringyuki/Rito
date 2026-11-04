//! Building one paragraph's Parley layout: item styles, family stacks and
//! fallbacks, punctuation trims, ruby spreads, inline atoms — everything
//! the line loop reads back through `ParagraphLayout`.

use crate::*;

impl ParleyInlineContext {
    /// The paragraph at `node` built for the line loop in `space` with the
    /// trims and spreads it has decided so far: kept from an earlier build
    /// that read the same, with its images and inline blocks sized again
    /// when they were sized for another space, or built and kept.
    pub(crate) fn shaped_paragraph(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        edits: ParagraphEdits<'_>,
        cancel: &CancelFlag,
    ) -> Result<ParagraphLayout, LayoutError> {
        let build_space = BuildSpace::new(
            Some(space.inline_size),
            space.fragmentainer_size,
            space.containing_block_size,
        );
        let mut key = ShapeKey::new(tree.fingerprint(), node.0, edits);
        // Not borrowed while atoms are sized: an inline block lays out
        // its own paragraphs through this cache.
        let kept = self.shaped.borrow_mut().get(&mut key, &build_space);
        if let Some(KeptParagraph {
            mut paragraph,
            atoms_sized_elsewhere,
        }) = kept
        {
            if atoms_sized_elsewhere {
                self.resize_atoms(tree, node, &mut paragraph, &build_space, cancel)?;
                self.shaped
                    .borrow_mut()
                    .insert(key, &build_space, &paragraph);
            }
            return Ok(paragraph);
        }
        let mut built = self.build_layout(
            tree,
            node,
            &build_space,
            PercentageImageSizing::Intrinsic,
            edits,
            cancel,
        )?;
        built.reads_space = build_space.was_read();
        #[cfg(test)]
        self.counts.note_build();
        self.shaped.borrow_mut().insert(key, &build_space, &built);
        Ok(built)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build_layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &BuildSpace,
        percentage_images: PercentageImageSizing,
        edits: ParagraphEdits<'_>,
        cancel: &CancelFlag,
    ) -> Result<ParagraphLayout, LayoutError> {
        let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
            return Err(LayoutError::Invalid(format!(
                "parley inline context requires an inline flow, got {:?}",
                tree.node(node).content
            )));
        };
        let styles = tree.styles().ok_or_else(|| {
            LayoutError::Invalid("inline flow tree carries no style tables".to_owned())
        })?;
        if cancel.is_cancelled() {
            return Err(LayoutError::Cancelled);
        }

        let mut text = String::new();
        let mut runs = Vec::with_capacity(items.len());
        let mut shifted_ranges: Vec<(std::ops::Range<usize>, f64)> = Vec::new();
        // Atoms and box edges, in content order (the builder keeps the
        // order of boxes at one index).
        let mut inline_boxes = Vec::new();
        // Laid-out inline-block atoms by item index: the mini paragraph's
        // baseline (its LAST line's, from the box top) and its fragment,
        // emitted at the inline box's position during line assembly.
        let mut inline_block_boxes: std::collections::HashMap<
            u64,
            (f64, rito_fragment::BoxFragment),
        > = std::collections::HashMap::new();
        // The same atoms' baselines by hidden-node id, surviving the
        // per-line emission so the line envelope can read them after the
        // fragment moved into the line.
        let mut inline_block_baselines: std::collections::HashMap<u32, f64> =
            std::collections::HashMap::new();
        let mut image_edge_insets: std::collections::HashMap<u64, (f64, f64)> =
            std::collections::HashMap::new();
        // Childless inline boxes (empty <sup> footnote anchors) by text
        // offset: no advance and no break opportunity, but the open box's
        // leaded envelope around its shifted baseline joins the metrics
        // of whichever line the offset falls on.
        let mut empty_box_struts: Vec<(usize, rito_style_contract::StyleId, f64)> = Vec::new();
        for (item_index, item) in items.iter().enumerate() {
            match item {
                InlineItem::Text {
                    text: item_text,
                    style,
                    baseline_shift_px,
                    ..
                } => {
                    let start = text.len();
                    text.push_str(item_text);
                    if *baseline_shift_px != 0.0 {
                        shifted_ranges.push((start..text.len(), *baseline_shift_px));
                    }
                    let style = styles
                        .inline
                        .style(*style)
                        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
                    runs.push((start..text.len(), style, item_index));
                }
                InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => {
                    let Some(atom) =
                        self.size_atom(tree, node, item, space, percentage_images, cancel)?
                    else {
                        continue;
                    };
                    if let Some(insets) = atom.edge_insets {
                        image_edge_insets.insert(item_index as u64, insets);
                    }
                    if let Some((block_node, baseline, root_box)) = atom.block {
                        inline_block_baselines.insert(block_node, baseline);
                        inline_block_boxes.insert(item_index as u64, (baseline, root_box));
                    }
                    inline_boxes.push(InlineBox {
                        id: item_index as u64,
                        kind: InlineBoxKind::InFlow,
                        index: text.len(),
                        width: atom.width,
                        height: atom.height,
                    });
                }
                InlineItem::EmptyBox {
                    style,
                    baseline_shift_px,
                } => {
                    empty_box_struts.push((text.len(), *style, *baseline_shift_px));
                }
                InlineItem::OpenTag { style } | InlineItem::CloseTag { style } => {
                    let closes = matches!(item, InlineItem::CloseTag { .. });
                    let style = styles
                        .inline
                        .style(*style)
                        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
                    // Blink's open (close) tag takes the box's margin,
                    // border and padding at the edge its lines start (end)
                    // at, percentages against the containing block.
                    let width = style
                        .inline_edge(closes)
                        .size(space.margin_basis().map(|basis| basis as f32));
                    if width != 0.0 {
                        inline_boxes.push(InlineBox {
                            id: TAG_BOX_ID | item_index as u64,
                            kind: if closes {
                                InlineBoxKind::CloseTag
                            } else {
                                InlineBoxKind::OpenTag
                            },
                            index: text.len(),
                            width,
                            height: 0.0,
                        });
                    }
                }
            }
        }

        // `ruby-align: space-around` (the UA initial value): an annotation
        // wider than its base spreads the base the way Chromium's LayoutNG
        // does (ruby_utils.cc GetOverhang / ApplyRubyAlign,
        // justification_utils.cc ApplyJustificationInternal,
        // line_breaker.cc AddRubyColumnResult / CanApplyStartOverhang /
        // CommitPendingEndOverhang). Both widths live on the 1/64 layout
        // grid (the shaped advance ceiled) and the column takes the wider
        // one; the base justifies inside the column: its slack S splits
        // into an inset I = S/(k+1) (k = the base's expansion
        // opportunities; grid integer division) and S − I over the k
        // opportunities, with I/2 (truncated again) at each edge. The
        // annotation overhangs an adjacent TEXT neighbour by min(I/2, half
        // the annotation font size on the grid, half the neighbour's
        // width) when the neighbour's font is no larger than the ruby's;
        // a side that cannot overhang keeps its half inset inside the
        // column (the base shifts right by the start side's, the flow
        // advance grows by both). Measured on a Latin annotation over a
        // two-glyph base: the raw half share put the annotation's origin
        // 1/64 px left of Chromium's and flipped its first glyph's
        // raster phase.
        // The interior shares ride per-boundary letter spacing so line
        // breaking sees the spread advance; the emitted fragment
        // re-applies them as justify spacing and the annotation paints
        // over the grown extent plus the overhangs. Measured here, before
        // the builder takes the font borrow. A justified paragraph
        // spreads identically (measured: a justified wide-annotation ruby
        // is bit-identical to the left-aligned one) — justification then
        // adds NO opportunities inside the spread base (see
        // `line_justify_plan`), only at its outer boundaries.
        let mut ruby_spreads: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        // Per item: the overhang each side of the spread box.
        let mut ruby_spread_overhangs: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        let mut ruby_spread_overhangs_right: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        // Every annotated item's shaped annotation advance, for the
        // split-fit rule: a base segment split onto its own line carries
        // the WHOLE annotation and widens to at least its advance.
        let mut ruby_annotation_widths: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        let mut ruby_spread_edits: Vec<(std::ops::Range<usize>, f32)> = Vec::new();
        // Each spread ruby's edge carrier, priced with and without its start
        // overhang: the line loop drops the overhang of a ruby that opens a
        // line (Blink's CanApplyStartOverhang needs an item before it on
        // the line).
        let mut ruby_carriers: Vec<RubyCarrier> = Vec::new();
        // Per item: the paint-side right shift of the base glyphs inside
        // the column (the start inset that could not overhang).
        let mut ruby_base_shifts: std::collections::HashMap<usize, RubyBaseShift> =
            std::collections::HashMap::new();
        // Every short ruby's base: one unit a line never breaks inside
        // (Blink's `IsMonolithicRuby`: a base of at most four glyphs under
        // an annotation of at most eight).
        let mut monolithic_rubies: Vec<std::ops::Range<usize>> = Vec::new();
        for (range, style, item_index) in &runs {
            let Some(InlineItem::Text {
                ruby_annotation: Some(annotation),
                ..
            }) = items.get(*item_index)
            else {
                continue;
            };
            if range.is_empty() {
                continue;
            }
            let base_text = &text[range.clone()];
            let annotation_size = style.font.size.get() * annotation.size_ratio;
            let annotation_measure =
                self.measure_styled(style, Some(annotation_size), &annotation.text);
            let base_measure = self.measure_styled(style, None, base_text);
            if base_measure.glyphs <= 4 && annotation_measure.glyphs <= 8 {
                monolithic_rubies.push(range.clone());
            }
            if annotation.text.is_empty() {
                continue;
            }
            let annotation_advance = annotation_measure.advance;
            let base_advance = base_measure.advance;
            ruby_annotation_widths.insert(*item_index, annotation_advance);
            let space = layout_unit_ceil(annotation_advance) - layout_unit_ceil(base_advance);
            if space <= 0.0 {
                continue;
            }
            let is_ruby_item = |index: usize| {
                items.get(index).is_some_and(|item| {
                    matches!(
                        item,
                        InlineItem::Text {
                            ruby_annotation: Some(_),
                            ..
                        }
                    )
                })
            };
            let neighbor_run = |byte: Option<usize>| {
                byte.and_then(|byte| runs.iter().find(|(other, _, _)| other.contains(&byte)))
            };
            let prev_byte = text[..range.start]
                .char_indices()
                .next_back()
                .map(|(i, _)| i);
            let next_byte = (range.end < text.len()).then_some(range.end);
            // The base's justification inset: half the per-opportunity
            // share the base line's justification would leave at each
            // edge, on the layout grid at every step.
            let plan = line_justify_plan(base_text, 0..base_text.len(), space, &[], &[], &[]);
            let count = plan.as_ref().map_or(0, |plan| plan.total);
            let inset_full = layout_unit_trunc(space / (f64::from(count) + 1.0));
            let inset = layout_unit_trunc(inset_full / 2.0);
            let share = if count > 0 {
                (space - inset_full) / f64::from(count)
            } else {
                0.0
            };
            // Half the annotation font on Blink's terms: the style's font
            // size is a whole pixel, halved by integer division (an
            // 8.8px annotation caps at 4, not 4.4 — measured on a book
            // whose 0.55em annotations over one-glyph bases moved every
            // following glyph of the line by the difference).
            let half_annotation_font = f64::from(computed_pixel_size(annotation_size) / 2);
            let base_font_size = computed_pixel_size(style.font.size.get());
            // A side overhangs only a text neighbour — never a ruby, an
            // atom, or the flow edge — whose font is no larger than the
            // ruby's, and by no more than half that neighbour's width
            // (the neighbour's on-line inline size before the ruby, its
            // whole shaped width after it), measured only when the
            // neighbour is short enough for the cap to bite.
            let overhang = |byte: Option<usize>, before: bool| -> f64 {
                let Some((other_range, other_style, other_index)) = neighbor_run(byte) else {
                    return 0.0;
                };
                if is_ruby_item(*other_index)
                    || computed_pixel_size(other_style.font.size.get()) > base_font_size
                {
                    return 0.0;
                }
                let mut allowed = inset.min(half_annotation_font);
                let other_text = &text[other_range.clone()];
                if other_text.chars().count() <= 2 {
                    let other_advance = self.measure_styled_advance(other_style, None, other_text);
                    let other_size = if before {
                        layout_unit_ceil(other_advance)
                    } else {
                        layout_unit_trunc(other_advance)
                    };
                    allowed = allowed.min(layout_unit_trunc(other_size / 2.0));
                }
                allowed
            };
            let natural_overhang_left = overhang(prev_byte, true);
            let unhung = edits.unhung_starts.binary_search(item_index).is_ok();
            let overhang_left = if unhung { 0.0 } else { natural_overhang_left };
            let overhang_right = overhang(next_byte, false);
            let author = match style.text_flow.letter_spacing {
                LengthPercentage::Length(px) => px.get(),
                _ => 0.0,
            };
            let char_starts: Vec<usize> = base_text.char_indices().map(|(i, _)| i).collect();
            let last_cluster_start = range.start + char_starts.last().copied().unwrap_or(0);
            if style.text_flow.ruby_align == rito_style_contract::RubyAlign::Center {
                // `ruby-align: center` under a WIDE annotation: the base
                // glyphs pack CENTERED in the column (half the slack on
                // the grid before them), the overhangs follow the same
                // justification-inset law as space-around, and the
                // column's flow advance is the annotation minus the two
                // overhangs — the remainder rides a trailing carrier.
                let delta = space - overhang_left - overhang_right;
                if delta > 0.0 {
                    ruby_spread_edits.push((last_cluster_start..range.end, author + delta as f32));
                }
                ruby_carriers.push(RubyCarrier {
                    item: *item_index,
                    range: last_cluster_start..range.end,
                    author,
                    hung: (space - natural_overhang_left - overhang_right) as f32,
                    unhung: (space - overhang_right) as f32,
                    start_overhang: natural_overhang_left as f32,
                });
                ruby_spreads.insert(*item_index, 0.0);
                ruby_spread_overhangs.insert(*item_index, overhang_left);
                ruby_spread_overhangs_right.insert(*item_index, overhang_right);
                ruby_base_shifts.insert(
                    *item_index,
                    RubyBaseShift {
                        within: layout_unit_trunc(space / 2.0) - overhang_left,
                        at_edges: None,
                    },
                );
                continue;
            }
            // Each opportunity's shares open after the boundary's left
            // character.
            if let Some(plan) = &plan {
                for (boundary, shares) in &plan.counts {
                    let Some(&left) = char_starts.iter().rev().find(|start| **start < *boundary)
                    else {
                        continue;
                    };
                    ruby_spread_edits.push((
                        range.start + left..range.start + *boundary,
                        author + (share * f64::from(*shares)) as f32,
                    ));
                }
            }
            // The column's flow advance is the annotation minus the two
            // overhangs: whatever of the inset stayed inside rides the
            // last cluster.
            let edge_carrier = inset_full - overhang_left - overhang_right;
            if edge_carrier > 0.0 {
                ruby_spread_edits
                    .push((last_cluster_start..range.end, author + edge_carrier as f32));
            }
            ruby_carriers.push(RubyCarrier {
                item: *item_index,
                range: last_cluster_start..range.end,
                author,
                hung: (inset_full - natural_overhang_left - overhang_right) as f32,
                unhung: (inset_full - overhang_right) as f32,
                start_overhang: natural_overhang_left as f32,
            });
            // A justified line's edge pulls the base to it: the whole
            // inset opens past the base at the line's start and before it
            // at the line's end (both edges measured from the column's
            // start, the start overhang back of the flow position).
            ruby_base_shifts.insert(
                *item_index,
                RubyBaseShift {
                    within: inset - overhang_left,
                    at_edges: Some((-overhang_left, 2.0 * inset - overhang_left)),
                },
            );
            ruby_spreads.insert(*item_index, share);
            ruby_spread_overhangs.insert(*item_index, overhang_left);
            ruby_spread_overhangs_right.insert(*item_index, overhang_right);
        }

        let mut fonts = self.fonts.borrow_mut();
        // Computed before the builder takes the font borrow: the trim
        // gate resolves each trimmed character's font to check `halt`.
        let inline_box_bytes: Vec<usize> = inline_boxes
            .iter()
            .filter(|inline_box| inline_box.kind == InlineBoxKind::InFlow)
            .map(|inline_box| inline_box.index)
            .collect();
        // Every pair the paragraph trims while no break separates it; the
        // edits say which a break did.
        let punctuation_trims = compute_cjk_punctuation_trims(
            &mut fonts,
            &self.catalog,
            &mut self.halt_feature_cache.borrow_mut(),
            &text,
            &runs,
            &[],
            &inline_box_bytes,
        );
        // Chromium's break opportunities, each text item read under the
        // ICU rule set its content language and `line-break` select, with
        // its `word-break`.
        let opportunities = BreakOpportunities::new(&text, |offset| {
            let at = runs.partition_point(|(range, _, _)| range.start <= offset);
            let flow = runs
                .get(at.saturating_sub(1))
                .map(|(_, style, _)| &style.text_flow);
            BreakContext {
                rule_set: flow.map_or(RuleSet::Normal, |flow| {
                    RuleSet::for_content(
                        flow.language.as_ref().map(|tag| tag.as_str()),
                        flow.line_break,
                    )
                }),
                word_break: flow.map_or(rito_style_contract::WordBreak::Normal, |flow| {
                    flow.word_break
                }),
                anywhere: flow.is_some_and(|flow| {
                    flow.line_break == rito_style_contract::LineBreak::Anywhere
                }),
                collapses: flow.is_none_or(|flow| {
                    matches!(
                        flow.white_space_collapse,
                        rito_style_contract::WhiteSpaceCollapse::Collapse
                            | rito_style_contract::WhiteSpaceCollapse::PreserveBreaks
                    )
                }),
            }
        });
        let chromium_breaks =
            move |context: parley::LineBreakContext| opportunities.before(context.index);
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = SpacingBuilder::new(layouts.ranged_builder(&mut fonts, &text, 1.0, true));
        builder.set_line_break_override(&chromium_breaks);
        // `text-indent` is the block container's own inherited property and
        // indents its first line whatever sits on it — a line holding only
        // an image included. Reading it off whichever text run happens to
        // start at byte zero would skip every image-only first line.
        let first_line_indent = tree
            .strut_style(node)
            .or_else(|| {
                items.first().map(|item| match item {
                    InlineItem::Text { style, .. }
                    | InlineItem::Image { style, .. }
                    | InlineItem::InlineBlock { style, .. }
                    | InlineItem::EmptyBox { style, .. }
                    | InlineItem::OpenTag { style }
                    | InlineItem::CloseTag { style } => *style,
                })
            })
            .and_then(|style_id| styles.inline.style(style_id).ok())
            .map_or(0.0_f32, resolved_text_indent);
        // Each combined upright item sets as one unit an em down the line,
        // shaped apart from its neighbours as the browser lays it out in a
        // box of its own (an explicitly-off `hwid`, inert, splits the run).
        let mut combined: Vec<(std::ops::Range<usize>, f32)> = Vec::new();
        for (range, style, item_index) in &runs {
            if range.is_empty() {
                continue;
            }
            push_item_styles(&mut builder, &self.catalog, style, &text, range.clone());
            if combines_upright(style) {
                combined.push((range.clone(), combined_advance(style)));
                builder.push(
                    StyleProperty::FontFeatures(parley::FontFeatures::List(
                        std::borrow::Cow::Owned(vec![parley::FontFeature::new(
                            parley::setting::Tag::new(b"hwid"),
                            0,
                        )]),
                    )),
                    range.clone(),
                );
            }
            // Parley merges adjacent resolved styles that compare equal,
            // which would fuse glyph runs across item boundaries whenever
            // neighbouring items differ only in properties Parley never
            // sees (color, decoration, other pure paint). A distinct
            // per-item brush keeps every glyph run inside exactly one
            // source item, so consumers can map a run back to its item —
            // and that item's paint style — by byte range alone.
            builder.push(
                StyleProperty::Brush((*item_index as u32).to_le_bytes()),
                range.clone(),
            );
            // A <ruby> element's edge is a SHAPING boundary in Blink: the
            // base shapes alone, so a kern pair straddling the edge never
            // applies (measured: <ruby>ウ</ruby>，spans the full 加0.08em
            // where plain/span/b ウ，closes it; the b20 Shou line's slack
            // grew 1.216px through exactly that pair). A <span> edge does
            // NOT break shaping. Parley only splits shaped runs where
            // font features (or size/locale/spacing) change, so the base
            // carries a no-op feature — an explicitly-off `halt` (off is
            // its default: zero shaping effect) — to force the split.
            // Alternating with `vhal` (also off, inert in horizontal
            // flow) keeps DIRECTLY adjacent mono-ruby bases from merging
            // with each other.
            let is_ruby = matches!(
                items.get(*item_index),
                Some(InlineItem::Text {
                    ruby_annotation: Some(_),
                    ..
                })
            );
            if is_ruby {
                let tag = if item_index % 2 == 0 {
                    b"halt"
                } else {
                    b"vhal"
                };
                builder.push(
                    StyleProperty::FontFeatures(parley::FontFeatures::List(
                        std::borrow::Cow::Owned(vec![parley::FontFeature::new(
                            parley::setting::Tag::new(tag),
                            0,
                        )]),
                    )),
                    range.clone(),
                );
            }
        }
        for range in monolithic_rubies {
            builder.push_unbreakable(range);
        }
        // A space takes the FIRST family of its stack in the browser
        // (every face covers U+0020), while parley merges a space into
        // the neighbouring script run: a space between a CJK glyph and
        // a latin word shaped with the CJK face's 0.232em space where
        // the browser uses the latin face's 0.25em, and the rest of the
        // line walked 0.27px apart. An inert-off font feature forces a
        // CJK-PRECEDED space into its own shaping run, which then
        // resolves against the stack head. A space whose PRECEDING
        // character is latin inherits the latin run already (stack-head
        // face either way), and must stay merged so the word's trailing
        // kern pair keeps applying — the browser kerns latin+space
        // inside one segment (measured: Tinos A+space carries a -113
        // GPOS pair, and the justified CJK line around `A 班` spread
        // its shares from the kerned natural width; the split-both-ways
        // rule inflated the natural 0.883px and every share with it).
        {
            let chars: Vec<(usize, char)> = text.char_indices().collect();
            for (position, (byte, character)) in chars.iter().enumerate() {
                if *character != ' ' {
                    continue;
                }
                let prev_cjk = position
                    .checked_sub(1)
                    .and_then(|index| chars.get(index))
                    .is_some_and(|(_, prev)| is_cjk_context(*prev));
                if prev_cjk {
                    builder.push(
                        StyleProperty::FontFeatures(parley::FontFeatures::List(
                            std::borrow::Cow::Owned(vec![parley::FontFeature::new(
                                parley::setting::Tag::new(b"smcp"),
                                0,
                            )]),
                        )),
                        *byte..*byte + 1,
                    );
                }
            }
        }

        let plan = SpacingPlan::new(
            punctuation_trims,
            ruby_spread_edits,
            ruby_carriers,
            runs.iter()
                .map(|(range, style, _)| {
                    let author = match style.text_flow.letter_spacing {
                        LengthPercentage::Length(px) => px.get(),
                        _ => 0.0,
                    };
                    PlannedRun {
                        range: range.clone(),
                        author,
                        end_trim: author - 0.5 * shaping_font_size(style.font.size.get()),
                    }
                })
                .collect(),
        );
        let pair_trims: Vec<(usize, usize)> = plan
            .applied_pair_trims(edits)
            .map(|trim| (trim.left_byte, trim.right_byte))
            .collect();
        let opener_halt_trims: Vec<(std::ops::Range<usize>, f64)> = plan
            .applied_pair_trims(edits)
            .filter_map(|trim| match trim.edit {
                PunctuationTrimEdit::OpenerHalt(half) => {
                    Some((trim.edit_range.clone(), f64::from(half)))
                }
                PunctuationTrimEdit::LetterSpacing(_) => None,
            })
            .collect();
        for push in plan.pushes(&text, edits) {
            match push {
                SpacingPush::LetterSpacing(range, spacing) => {
                    builder.push(StyleProperty::LetterSpacing(spacing), range);
                }
                SpacingPush::Halt(range) => {
                    // An opener shaped top to bottom takes its vertical
                    // half width.
                    let vertical = runs
                        .iter()
                        .find(|(run, ..)| run.contains(&range.start))
                        .zip(text.get(range.start..).and_then(|rest| rest.chars().next()))
                        .is_some_and(|((_, style, _), character)| {
                            shapes_top_to_bottom(style, character)
                        });
                    builder.push(
                        StyleProperty::FontFeatures(parley::FontFeatures::List(
                            std::borrow::Cow::Owned(vec![parley::FontFeature::new(
                                parley::setting::Tag::new(halt_tag(vertical)),
                                1,
                            )]),
                        )),
                        range,
                    )
                }
            }
        }
        for inline_box in inline_boxes {
            builder.push_inline_box(inline_box);
        }
        if cancel.is_cancelled() {
            return Err(LayoutError::Cancelled);
        }
        // text-align inherits, so the paragraph's own strut style carries
        // its alignment; a first-item fallback covers strut-less flows.
        // The item fallback must NOT read an inline-block's style: the
        // atom's own text-align (a centered verse card) aligns the atom's
        // CONTENT, not the host line it rides (measured: Blink keeps the
        // card at the host paragraph's left edge).
        let alignment = tree
            .strut_style(node)
            .or_else(|| {
                items.first().map(|item| match item {
                    InlineItem::Text { style, .. }
                    | InlineItem::Image { style, .. }
                    | InlineItem::InlineBlock { style, .. }
                    | InlineItem::EmptyBox { style, .. }
                    | InlineItem::OpenTag { style }
                    | InlineItem::CloseTag { style } => *style,
                })
            })
            .map(|style_id| {
                styles
                    .inline
                    .style(style_id)
                    .map(|style| paragraph_alignment(style.text_flow.text_align))
                    .map_err(|error| LayoutError::Invalid(error.to_string()))
            })
            .transpose()?
            .unwrap_or(parley::Alignment::Start);
        let (mut layout, spacing_edits) = builder.build(&text);
        for (range, advance) in combined {
            layout.combine_upright(range, advance);
        }
        // Parley's own first-line indent: a start-edge margin on the
        // indented line. Reserving the space with an inline box instead
        // would invent a break opportunity that CSS does not have, and an
        // atomic inline too wide for the rest of the line would wrap to a
        // line of its own rather than overflow beside the indent.
        if first_line_indent != 0.0 {
            layout.set_text_indent(first_line_indent, parley::IndentOptions::default());
        }
        Ok(ParagraphLayout {
            layout,
            text,
            alignment,
            spacing_edits,
            shifted_ranges,
            first_line_indent,
            inline_block_boxes,
            inline_block_baselines,
            image_edge_insets,
            empty_box_struts,
            pair_trims,
            opener_halt_trims,
            ruby_spreads,
            ruby_spread_overhangs,
            ruby_spread_overhangs_right,
            ruby_annotation_widths,
            ruby_base_shifts,
            cluster_steps: std::rc::Rc::default(),
            line_end_trims: std::rc::Rc::default(),
            kept_breaks: std::rc::Rc::default(),
            spacing_plan: std::rc::Rc::new(plan),
            kept_decisions: std::rc::Rc::default(),
            reads_space: false,
        })
    }
}

/// The Parley builder with every letter-spacing push on record. Spacing
/// reaches the shaper folded into cluster advances; the browser keeps it
/// outside its fixed-point glyph advances, so the line loop needs to know
/// how much spacing each cluster carries to step the way the browser's
/// pen does.
pub(crate) struct SpacingBuilder<'a> {
    inner: RangedBuilder<'a, [u8; 4]>,
    edits: SpacingEdits,
}

/// The spacing layout folded into cluster advances, recorded as the
/// builder pushed it (a later push over the same bytes wins): letter
/// spacing on every cluster, word spacing on space clusters. The cluster
/// origins subtract these before the fixed-point round trip and add them
/// back after, the way the browser adds spacing to shaped advances in
/// float.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct SpacingEdits {
    pub letter: Vec<(std::ops::Range<usize>, f32)>,
    pub word: Vec<(std::ops::Range<usize>, f32)>,
}

impl<'a> SpacingBuilder<'a> {
    pub(crate) fn new(inner: RangedBuilder<'a, [u8; 4]>) -> Self {
        Self {
            inner,
            edits: SpacingEdits::default(),
        }
    }

    pub(crate) fn push<'p>(
        &mut self,
        property: impl Into<StyleProperty<'p, [u8; 4]>>,
        range: std::ops::Range<usize>,
    ) {
        let property = property.into();
        match &property {
            StyleProperty::LetterSpacing(spacing) => {
                self.edits.letter.push((range.clone(), *spacing));
            }
            StyleProperty::WordSpacing(spacing) => {
                self.edits.word.push((range.clone(), *spacing));
            }
            _ => {}
        }
        self.inner.push(property, range);
    }

    pub(crate) fn push_inline_box(&mut self, inline_box: InlineBox) {
        self.inner.push_inline_box(inline_box);
    }

    pub(crate) fn push_unbreakable(&mut self, range: std::ops::Range<usize>) {
        self.inner.push_unbreakable(range);
    }

    pub(crate) fn set_line_break_override(&mut self, overrides: &'a parley::LineBreakOverrideFn) {
        self.inner.set_line_break_override(Some(overrides));
    }

    /// The layout and the spacing pushes it was built with.
    pub(crate) fn build(self, text: &str) -> (parley::Layout<[u8; 4]>, SpacingEdits) {
        (self.inner.build(text), self.edits)
    }
}

/// One paragraph's built Parley layout plus the metadata the fragment
/// assembly needs.
/// Where a wide-annotation ruby's base glyphs paint inside its column,
/// past the flow position of the base's first glyph (Blink's ruby base
/// insets, `ApplyRubyAlign`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RubyBaseShift {
    /// Away from a justified line's edges.
    pub(crate) within: f64,
    /// At a justified paragraph's line start and a justified line's end,
    /// where `space-around` aligns the base to the line's edge
    /// (css-ruby line-edge alignment); `None` for `ruby-align: center`,
    /// which keeps the base centered there too.
    pub(crate) at_edges: Option<(f64, f64)>,
}

impl RubyBaseShift {
    /// The shift for a base spanning `base` on a line whose in-flow content
    /// starts at `line_start` and, on a justified line, ends at `line_end`
    /// (`None` off a justified paragraph, or where an atom takes the edge).
    pub(crate) fn on_line(
        &self,
        base: &std::ops::Range<usize>,
        line_start: Option<usize>,
        line_end: Option<usize>,
    ) -> f64 {
        let Some((at_start, at_end)) = self.at_edges else {
            return self.within;
        };
        match (line_start == Some(base.start), line_end == Some(base.end)) {
            (true, false) => at_start,
            (false, true) => at_end,
            // A ruby alone on a justified line spreads over the whole line,
            // which is not modelled.
            _ => self.within,
        }
    }
}

#[derive(Clone)]
pub(crate) struct ParagraphLayout {
    /// Whether the build read the space it was built in (an image or an
    /// inline block sized in it, a percentage margin): such a paragraph's
    /// lines hold for its exact inline size alone.
    pub(crate) reads_space: bool,
    /// Every cluster's width-independent step, read after the first line
    /// breaking and shared by every copy of this build (see
    /// [`ClusterSteps`]).
    pub(crate) cluster_steps: std::rc::Rc<std::cell::OnceCell<ClusterSteps>>,
    /// Whether any line could take a line-end trim or its rewind at some
    /// width (see [`line_end_trims_possible`]), read after the first line
    /// breaking and shared like `cluster_steps`.
    pub(crate) line_end_trims: std::rc::Rc<std::cell::OnceCell<bool>>,
    /// The lines this build was last broken into, shared like
    /// `cluster_steps` (see [`KeptBreaks`]).
    pub(crate) kept_breaks: std::rc::Rc<KeptBreaks>,
    /// The spacing the build pushed on top of its runs' styles, apart from
    /// the edits it was built with (see [`SpacingPlan`]).
    pub(crate) spacing_plan: std::rc::Rc<SpacingPlan>,
    /// The line edges decided on this build, by the space they were
    /// decided in (see [`KeptDecisions`]).
    pub(crate) kept_decisions: std::rc::Rc<KeptDecisions>,
    pub(crate) layout: parley::Layout<[u8; 4]>,
    pub(crate) text: String,
    pub(crate) alignment: parley::Alignment,
    /// Every letter-spacing push the builder received, in order (a
    /// later push overrides an earlier one on the bytes they share):
    /// author spacing, punctuation trims, box gaps, uncovered-character
    /// advances, ruby spreads, line-end trims. A cluster's shaped advance
    /// carries the spacing that applied to it; the line loop subtracts
    /// it to recover the bare glyph advance the browser's fixed-point
    /// pen steps by.
    pub(crate) spacing_edits: SpacingEdits,
    /// Byte ranges of the flow text whose runs carry a baseline shift
    /// (positive raises), in content order.
    pub(crate) shifted_ranges: Vec<(std::ops::Range<usize>, f64)>,
    /// The `text-indent` margin Parley reserves on the first line, which
    /// narrows that line's available advance for fit decisions.
    pub(crate) first_line_indent: f32,
    /// Every applied punctuation pair trim as (left char byte, right char
    /// byte): the trim is only valid while both sit on one line, so the
    /// layout loop suppresses any pair a line break separates and re-lays.
    pub(crate) pair_trims: Vec<(usize, usize)>,
    /// Byte ranges shaped with the opener-side `halt` trim and the half
    /// width each removed — the painter draws the untrimmed glyph shifted
    /// left by that amount so its ink lands where the halt variant sits.
    pub(crate) opener_halt_trims: Vec<(std::ops::Range<usize>, f64)>,
    /// Per item index: the `ruby-align: space-around` interior gap a
    /// wide annotation opens between its base's clusters. The gap is
    /// already injected as letter spacing on every base cluster but the
    /// last, so line breaking sees the spread advance; the emitted
    /// fragment re-applies it as justify spacing so the painter spreads
    /// identically, and the annotation paints over the grown extent
    /// plus one half-gap of overhang on each side.
    pub(crate) ruby_spreads: std::collections::HashMap<usize, f64>,
    /// Per spread item: the LEFT overhang (edge share capped at half the
    /// annotation size, zero against a blocked side) — the annotation
    /// rect grows by it while `ruby_spreads` carries the interior gap.
    pub(crate) ruby_spread_overhangs: std::collections::HashMap<usize, f64>,
    /// Per spread item: the RIGHT overhang (same law as the left; the
    /// two differ when only one side may overhang).
    pub(crate) ruby_spread_overhangs_right: std::collections::HashMap<usize, f64>,
    /// Per annotated item index: the shaped advance of its annotation.
    /// A base segment SPLIT onto its own line carries the whole
    /// annotation and widens to at least this advance, which is what the
    /// split-fit rewind checks.
    pub(crate) ruby_annotation_widths: std::collections::HashMap<usize, f64>,
    /// Per wide-annotation item: where its base glyphs paint inside the
    /// column.
    pub(crate) ruby_base_shifts: std::collections::HashMap<usize, RubyBaseShift>,
    /// Laid-out inline-block atoms by item index: the mini paragraph's
    /// baseline (its LAST line's, from the box top) and its fragment,
    /// emitted at the inline box's position during line assembly.
    pub(crate) inline_block_boxes:
        std::collections::HashMap<u64, (f64, rito_fragment::BoxFragment)>,
    /// The same atoms' baselines by hidden-node id, surviving the
    /// per-line emission so the line envelope can read them after the
    /// fragment moved into the line.
    pub(crate) inline_block_baselines: std::collections::HashMap<u32, f64>,
    /// Per image atom id: the (left, right) edge insets from the image
    /// element's own border, absorbed as padding by the bridge. The atom's
    /// advance spans them; the raster paints inside (measured on the b60
    /// cover's 1px flank borders — dropping them shifted the whole plate
    /// one pixel against Blink).
    pub(crate) image_edge_insets: std::collections::HashMap<u64, (f64, f64)>,
    /// Childless inline boxes (empty <sup> footnote anchors) by text
    /// offset: no advance, no break opportunity, but the open box's
    /// leaded envelope around its shifted baseline joins the metrics of
    /// whichever line the offset falls on.
    pub(crate) empty_box_struts: Vec<(usize, rito_style_contract::StyleId, f64)>,
}

/// Key of one line-metric entry: (family key, size bits, line shape).
pub(crate) type LineMetricKey = (u32, u64, LineBaseline, LineProbe);

/// The browser shapes at the computed font size truncated toward zero
/// onto the 1/100 px grid, and the product is an F32 MULTIPLY — the
/// browser's font cache key is saturated_cast<unsigned>(font_size *
/// 100.0f) on the f32 computed size. The f32 product's own rounding is
/// the whole rule: 15.2 * 100 rounds up to exactly 1520.0 and passes
/// through, while 18.72 * 100 lands at 1871.99988 and truncates to
/// 18.71 (Range-measured: a lone 18.72px ideograph advances 1197.4394
/// = 1/64ths of fixed-point 18.71, and 9.36 -> 9.35, 37.44 -> 37.43,
/// 18.8 -> 18.79; 15.9999/15.999/15.995 -> 15.99, 15.9375 -> 15.93,
/// 17.06667 -> 17.06, and 15.2/12.16/16.01 pass through unchanged). An
/// f64 product orders 18.72 the other way (1871.99993, within any
/// hand-tuned snap tolerance), so the multiply must stay in f32.
pub(crate) fn shaping_font_size(size: f32) -> f32 {
    let hundredths = size * 100.0_f32;
    hundredths.trunc() / 100.0_f32
}

pub(crate) fn push_item_styles(
    builder: &mut SpacingBuilder<'_>,
    catalog: &FontCatalog,
    style: &InlineFormattingStyle,
    text: &str,
    range: std::ops::Range<usize>,
) {
    // A vertical line's upright characters shape top to bottom, as Blink
    // shapes a vertical line's upright runs; the rest shape as horizontal
    // text, laid sideways, and so does a combined upright unit's.
    if style.bidi.writing_mode != WritingMode::HorizontalTopToBottom && !combines_upright(style) {
        if let Some(item_text) = text.get(range.clone()) {
            for upright in upright_ranges(style.bidi.text_orientation, item_text) {
                builder.push(
                    StyleProperty::VerticalUpright(true),
                    range.start + upright.start..range.start + upright.end,
                );
            }
        }
    }
    let stack = catalog.resolve(style);
    builder.push(
        StyleProperty::FontFamily(parley::FontFamily::Source(Cow::Owned(stack.source.clone()))),
        range.clone(),
    );
    builder.push(StyleProperty::Locale(stack.locale), range.clone());
    builder.push(
        StyleProperty::FontSize(shaping_font_size(style.font.size.get())),
        range.clone(),
    );
    builder.push(
        StyleProperty::FontWeight(parley::FontWeight::new(style.font.weight.get())),
        range.clone(),
    );
    match style.font.slant {
        FontSlant::Normal => {}
        FontSlant::Italic => {
            builder.push(
                StyleProperty::FontStyle(parley::FontStyle::Italic),
                range.clone(),
            );
        }
        FontSlant::Oblique(angle) => {
            builder.push(
                StyleProperty::FontStyle(parley::FontStyle::Oblique(Some(angle.degrees()))),
                range.clone(),
            );
        }
    }
    match style.font.line_height {
        LineHeight::Normal => {}
        LineHeight::Number(number) => {
            builder.push(
                StyleProperty::LineHeight(parley::LineHeight::FontSizeRelative(number.get())),
                range.clone(),
            );
        }
        LineHeight::Length(px) => {
            builder.push(
                StyleProperty::LineHeight(parley::LineHeight::Absolute(px.get())),
                range.clone(),
            );
        }
    }
    if let LengthPercentage::Length(px) = style.text_flow.letter_spacing {
        if px.get() != 0.0 {
            builder.push(StyleProperty::LetterSpacing(px.get()), range.clone());
        }
    }
    if let LengthPercentage::Length(px) = style.text_flow.word_spacing {
        if px.get() != 0.0 {
            builder.push(StyleProperty::WordSpacing(px.get()), range.clone());
        }
    }
    match style.text_flow.word_break {
        rito_style_contract::WordBreak::Normal => {}
        rito_style_contract::WordBreak::BreakAll => {
            builder.push(
                StyleProperty::WordBreak(parley::WordBreak::BreakAll),
                range.clone(),
            );
        }
        rito_style_contract::WordBreak::KeepAll => {
            builder.push(
                StyleProperty::WordBreak(parley::WordBreak::KeepAll),
                range.clone(),
            );
        }
    }
    match style.text_flow.overflow_wrap {
        rito_style_contract::OverflowWrap::Normal => {}
        rito_style_contract::OverflowWrap::Anywhere => {
            builder.push(
                StyleProperty::OverflowWrap(parley::OverflowWrap::Anywhere),
                range.clone(),
            );
        }
        rito_style_contract::OverflowWrap::BreakWord => {
            builder.push(
                StyleProperty::OverflowWrap(parley::OverflowWrap::BreakWord),
                range.clone(),
            );
        }
    }
    match style.text_flow.text_wrap_mode {
        rito_style_contract::TextWrapMode::Wrap => {}
        rito_style_contract::TextWrapMode::NoWrap => {
            builder.push(
                StyleProperty::TextWrapMode(parley::TextWrapMode::NoWrap),
                range,
            );
        }
    }
}

/// Points every generic family and every script's fallback at the given
/// registered families (by name), in order.
///
/// With the platform font database excluded, the collection starts with no
/// generic mappings and no fallback entries at all; a stack ending in
/// `serif`, or a run of text no stack family covers, would otherwise
/// resolve to nothing and silently drop its glyphs. Han gets its tracked
/// locale-specific entries too, so `ja`/`ko`/regional-Chinese content
/// falls back the same way default Chinese does.
pub(crate) fn install_universal_fallbacks(
    collection: &mut parley::fontique::Collection,
    names: &[String],
) {
    use parley::fontique::{FallbackKey, GenericFamily, Script, ScriptExt as _};
    let families = names
        .iter()
        .filter_map(|name| collection.family_id(name))
        .collect::<Vec<_>>();
    const GENERICS: &[GenericFamily] = &[
        GenericFamily::Serif,
        GenericFamily::SansSerif,
        GenericFamily::Monospace,
        GenericFamily::Cursive,
        GenericFamily::Fantasy,
        GenericFamily::SystemUi,
        GenericFamily::UiSerif,
        GenericFamily::UiSansSerif,
        GenericFamily::UiMonospace,
        GenericFamily::UiRounded,
        GenericFamily::Emoji,
        GenericFamily::Math,
        GenericFamily::FangSong,
    ];
    for generic in GENERICS {
        collection.set_generic_families(*generic, families.iter().copied());
    }
    for (script, _) in Script::all_samples() {
        collection.set_fallbacks(FallbackKey::new(*script, None), families.iter().copied());
    }
    let han = Script::from_str_unchecked("Hani");
    for locale in ["ja", "ko", "zh-TW", "zh-HK", "zh-MO", "zh-SG"] {
        collection.set_fallbacks((han, locale), families.iter().copied());
    }
}

/// The id bit of an inline box that is a box's start or end size rather
/// than an atom (whose id is its item index).
pub(crate) const TAG_BOX_ID: u64 = 1 << 40;

/// A plain-text paragraph style: the given font stack and size, `normal`
/// line height and weight, no decoration, spacing, or transforms, and an
/// optional first-line indent. This is the style of an undecorated body
/// paragraph; harnesses and tests use it to isolate line breaking from the
/// rest of the inline contract.
pub fn plain_paragraph_style(
    families: rito_style_contract::FontFamilies,
    font_size_px: f32,
    first_line_indent_px: f32,
) -> InlineFormattingStyle {
    use rito_style_contract::{
        AbsoluteColor, AbsoluteColorSpace, AlignmentBaseline, BaselineShift, BaselineSource,
        BorderEdge, BorderEdges, BorderRadii, BorderStyle, ColorNoneFlags, CornerRadius, CssPx,
        Direction, FontStyle, FontWeight, InlineBidi, InlineFragmentStyle, InlinePaintStyle,
        InlineTextFlow, LengthPercentageOrAuto, LineBreak, NonNegativeCssPx,
        NonNegativeLengthPercentage, OverflowWrap, PhysicalSides, RubyAlign, TextAlign,
        TextDecoration, TextDecorationLines, TextDecorationStyle, TextIndent, TextJustify,
        TextTransform, TextTransformCase, TextWrapMode, TransformList, UnicodeBidi, UnitInterval,
        WhiteSpaceCollapse, WordBreak, WritingMode,
    };
    use std::sync::Arc;

    let zero = CssPx::new(0.0).expect("zero length is finite");
    let zero_length = LengthPercentage::Length(zero);
    let black = AbsoluteColor::new(
        AbsoluteColorSpace::Srgb,
        [0.0, 0.0, 0.0],
        1.0,
        ColorNoneFlags::new(false, false, false, false),
    )
    .expect("black is finite");
    let transparent = AbsoluteColor::new(
        AbsoluteColorSpace::Srgb,
        [0.0, 0.0, 0.0],
        0.0,
        ColorNoneFlags::new(false, false, false, false),
    )
    .expect("transparent is finite");
    let border = BorderEdge {
        resolved_width: NonNegativeCssPx::new(0.0).expect("zero width"),
        style: BorderStyle::None,
        color: black.into(),
    };
    let radius = CornerRadius {
        horizontal: NonNegativeLengthPercentage::new(zero_length),
        vertical: NonNegativeLengthPercentage::new(zero_length),
    };
    fn sides<T: Copy>(value: T) -> PhysicalSides<T> {
        PhysicalSides {
            top: value,
            right: value,
            bottom: value,
            left: value,
        }
    }
    InlineFormattingStyle {
        font: FontStyle {
            families,
            is_system_font: false,
            is_initial: false,
            size: NonNegativeCssPx::new(font_size_px).expect("font size is non-negative"),
            weight: FontWeight::new(400.0).expect("normal weight is valid"),
            slant: FontSlant::Normal,
            line_height: LineHeight::Normal,
            line_height_is_declared: false,
        },
        text_flow: InlineTextFlow {
            text_align: TextAlign::Start,
            text_justify: TextJustify::Auto,
            text_transform: TextTransform {
                case: TextTransformCase::None,
                full_width: false,
                full_size_kana: false,
            },
            white_space_collapse: WhiteSpaceCollapse::Collapse,
            text_wrap_mode: TextWrapMode::Wrap,
            word_break: WordBreak::Normal,
            line_break: LineBreak::Auto,
            overflow_wrap: OverflowWrap::Normal,
            letter_spacing: zero_length,
            word_spacing: zero_length,
            text_indent: TextIndent {
                value: LengthPercentage::Length(
                    CssPx::new(first_line_indent_px).expect("indent is finite"),
                ),
                hanging: false,
                each_line: false,
            },
            ruby_align: RubyAlign::SpaceAround,
            text_emphasis: None,
            language: None,
        },
        bidi: InlineBidi {
            direction: Direction::LeftToRight,
            unicode_bidi: UnicodeBidi::Normal,
            writing_mode: WritingMode::HorizontalTopToBottom,
            text_orientation: rito_style_contract::TextOrientation::Mixed,
            text_combine_upright: rito_style_contract::TextCombineUpright::None,
        },
        fragment: InlineFragmentStyle {
            margin: sides(LengthPercentageOrAuto::Value(zero_length)),
            padding: sides(NonNegativeLengthPercentage::new(zero_length)),
            border: BorderEdges {
                top: border,
                right: border,
                bottom: border,
                left: border,
            },
            border_radii: BorderRadii {
                top_left: radius,
                top_right: radius,
                bottom_right: radius,
                bottom_left: radius,
            },
            alignment_baseline: AlignmentBaseline::Baseline,
            baseline_source: BaselineSource::Auto,
            baseline_shift: BaselineShift::Offset(zero_length),
        },
        paint: InlinePaintStyle {
            foreground: black,
            opacity: UnitInterval::new(1.0).expect("opacity is bounded"),
            background: transparent.into(),
            background_image: None,
            transform: TransformList::none(),
            text_decoration: TextDecoration {
                lines: TextDecorationLines::new(false, false, false, false),
                style: TextDecorationStyle::Solid,
                color: black.into(),
            },
            text_shadows: Arc::from(Vec::new()),
            box_shadows: Arc::from(Vec::new()),
        },
    }
}

/// Maps the computed `text-align` onto Parley's line alignment. The
/// Servo-internal `-moz-*` values behave as their physical counterparts.
pub(crate) fn paragraph_alignment(value: TextAlign) -> parley::Alignment {
    match value {
        TextAlign::Start => parley::Alignment::Start,
        TextAlign::End => parley::Alignment::End,
        TextAlign::Left | TextAlign::MozLeft => parley::Alignment::Left,
        TextAlign::Right | TextAlign::MozRight => parley::Alignment::Right,
        TextAlign::Center | TextAlign::MozCenter => parley::Alignment::Center,
        TextAlign::Justify => parley::Alignment::Justify,
    }
}

/// The first-line indent this style asks for, in CSS px. Percentages need a
/// containing-block basis the inline context does not have; they fail to
/// zero here and must be resolved by the block container before reaching
/// this provider. Negative values pass through: a hanging indent
/// (`text-indent: -1em; padding-left: 1em`) out-dents the first line
/// into the padding and widens its advance by the same amount, exactly
/// parley's linear indent math (measured on b19's `.po` footnotes:
/// first line one em left of the continuation lines).
///
/// The used first-line indent on Blink's LayoutUnit grid, TRUNCATED
/// toward zero exactly like the padding path (LayoutUnit's float
/// constructor truncates): a 2em indent at 15.2px is 30.4 in CSS
/// arithmetic but 30.390625 in every Blink line position (measured on
/// b20 p018: truth glyph x 39.8125 = base 9.421875 + 30.390625, while
/// the engine's float 30.4 started 0.009375 right — every glyph's
/// subpixel phase shifted and the whole line lit up as AA diff).
pub(crate) fn resolved_text_indent(style: &InlineFormattingStyle) -> f32 {
    match style.text_flow.text_indent.value {
        LengthPercentage::Length(px) => layout_unit_trunc(f64::from(px.get())) as f32,
        _ => 0.0,
    }
}
