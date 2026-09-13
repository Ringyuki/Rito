//! Building one paragraph's Parley layout: item styles, family stacks and
//! fallbacks, punctuation trims, ruby spreads, inline atoms — everything
//! the line loop reads back through `ParagraphLayout`.

use crate::*;

impl ParleyInlineContext {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build_layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        available_inline_size: Option<f64>,
        available_block_size: Option<f64>,
        containing_block_size: Option<f64>,
        percentage_images: PercentageImageSizing,
        end_trims: &[usize],
        suppressed_pair_trims: &[usize],
        split_spread_edits: &[(std::ops::Range<usize>, f32)],
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
        let mut image_boxes = Vec::new();
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
        // Blink consults its pair-preference table only under
        // `word-break: normal`; `break-all`/`keep-all` change the break
        // opportunities the table would otherwise veto.
        let mut chromium_tailoring = true;
        let mut break_all = false;
        let mut strict_kinsoku = false;
        let mut break_anywhere = false;
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
                    if style.text_flow.word_break != rito_style_contract::WordBreak::Normal {
                        chromium_tailoring = false;
                    }
                    if style.text_flow.word_break == rito_style_contract::WordBreak::BreakAll {
                        break_all = true;
                    }
                    if style.text_flow.line_break == rito_style_contract::LineBreak::Strict {
                        strict_kinsoku = true;
                    }
                    if style.text_flow.line_break == rito_style_contract::LineBreak::Anywhere {
                        break_anywhere = true;
                    }
                    runs.push((start..text.len(), style, item_index));
                }
                InlineItem::Image {
                    intrinsic_width,
                    intrinsic_height,
                    layout_style,
                    viewport,
                    ..
                } => {
                    let layout_style = styles
                        .layout
                        .style(*layout_style)
                        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
                    let (width, height) = image_display_size(
                        *intrinsic_width,
                        *intrinsic_height,
                        layout_style,
                        available_inline_size,
                        available_block_size,
                        containing_block_size,
                        percentage_images,
                        *viewport,
                    )?;
                    // A vertical-rl flow's replaced atom advances by its
                    // PHYSICAL height along the (vertical) inline axis
                    // and takes a column as wide as its physical width
                    // (measured on a 318x2048 chapter plate: the column
                    // is 318 wide, the image runs the page's length and
                    // clips); the swapped box maps back to the physical
                    // raster in the vertical paint walk.
                    let (width, height) = if tree
                        .strut_style(node)
                        .and_then(|id| styles.inline.style(id).ok())
                        .is_some_and(|strut| {
                            strut.bidi.writing_mode
                                == rito_style_contract::WritingMode::VerticalRightToLeft
                        }) {
                        (height, width)
                    } else {
                        (width, height)
                    };
                    // The image element's own flank borders (absorbed as
                    // padding by the bridge) widen the atom's advance; the
                    // raster paints inside them (measured on the b60
                    // cover's `border: none solid` — dropping the 1px
                    // flanks shifted the whole plate against Blink).
                    let edge = |side: rito_style_contract::NonNegativeLengthPercentage| match side
                        .value()
                    {
                        LengthPercentage::Length(px) => f64::from(px.get()).max(0.0),
                        _ => 0.0,
                    };
                    let inset_left = edge(layout_style.padding.left);
                    let inset_right = edge(layout_style.padding.right);
                    if inset_left > 0.0 || inset_right > 0.0 {
                        image_edge_insets.insert(item_index as u64, (inset_left, inset_right));
                    }
                    image_boxes.push(InlineBox {
                        id: item_index as u64,
                        kind: InlineBoxKind::InFlow,
                        index: text.len(),
                        width: width + (inset_left + inset_right) as f32,
                        height,
                    });
                }
                InlineItem::InlineBlock { node, .. } => {
                    // The atomic inline is its own mini paragraph, laid
                    // out recursively through the full pipeline at CSS
                    // 2.1 §10.3.5 shrink-to-fit width against the host.
                    let sizes = self.intrinsic_inline_sizes(tree, *node)?;
                    let available = available_inline_size.unwrap_or(sizes.max_content);
                    let width = sizes.max_content.min(sizes.min_content.max(available));
                    let outcome = FormattingContext::layout(
                        self,
                        tree,
                        *node,
                        &ConstraintSpace::continuous(width),
                        None,
                        cancel,
                    )?;
                    let rito_fragment::Fragment::Box(root_box) = outcome.fragments.root else {
                        return Err(LayoutError::Invalid(
                            "inline-block layout must produce a box fragment".to_owned(),
                        ));
                    };
                    // The atom's baseline is its LAST line's baseline
                    // (CSS §10.8.1); a line-less box uses its bottom.
                    let baseline = root_box
                        .children
                        .iter()
                        .rev()
                        .find_map(|child| match child {
                            rito_fragment::Fragment::Line(line) => {
                                Some(line.rect.y + line.baseline)
                            }
                            _ => None,
                        })
                        .unwrap_or(root_box.rect.height);
                    image_boxes.push(InlineBox {
                        id: item_index as u64,
                        kind: InlineBoxKind::InFlow,
                        index: text.len(),
                        width: root_box.rect.width as f32,
                        height: root_box.rect.height as f32,
                    });
                    inline_block_baselines.insert(node.0, baseline);
                    inline_block_boxes.insert(item_index as u64, (baseline, root_box));
                }
                InlineItem::EmptyBox {
                    style,
                    baseline_shift_px,
                } => {
                    empty_box_struts.push((text.len(), *style, *baseline_shift_px));
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
        // Per item: the paint-side right shift of the base glyphs inside
        // the column (the start inset that could not overhang).
        let mut ruby_center_shifts: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        for (range, style, item_index) in &runs {
            let Some(InlineItem::Text {
                ruby_annotation: Some(annotation),
                ..
            }) = items.get(*item_index)
            else {
                continue;
            };
            if annotation.text.is_empty() || range.is_empty() {
                continue;
            }
            let base_text = &text[range.clone()];
            if base_text.chars().count() == 0 {
                continue;
            }
            let annotation_size = style.font.size.get() * annotation.size_ratio;
            let annotation_advance =
                self.measure_styled_advance(style, Some(annotation_size), &annotation.text);
            let base_advance = self.measure_styled_advance(style, None, base_text);
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
            let plan = line_justify_plan(base_text, 0..base_text.len(), space, &[], &[]);
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
            let overhang_left = overhang(prev_byte, true);
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
                ruby_spreads.insert(*item_index, 0.0);
                ruby_spread_overhangs.insert(*item_index, overhang_left);
                ruby_spread_overhangs_right.insert(*item_index, overhang_right);
                ruby_center_shifts
                    .insert(*item_index, layout_unit_trunc(space / 2.0) - overhang_left);
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
            let absorbed_left = inset - overhang_left;
            if absorbed_left > 0.0 {
                ruby_center_shifts.insert(*item_index, absorbed_left);
            }
            ruby_spreads.insert(*item_index, share);
            ruby_spread_overhangs.insert(*item_index, overhang_left);
            ruby_spread_overhangs_right.insert(*item_index, overhang_right);
        }

        let mut fonts = self.fonts.borrow_mut();
        // Computed before the builder takes the font borrow: the trim
        // gate resolves each trimmed character's font to check `halt`.
        let inline_box_bytes: Vec<usize> = image_boxes
            .iter()
            .map(|inline_box| inline_box.index)
            .collect();
        let punctuation_trims = compute_cjk_punctuation_trims(
            &mut fonts,
            &self.registered_families,
            &mut self.halt_feature_cache.borrow_mut(),
            &text,
            &runs,
            suppressed_pair_trims,
            &inline_box_bytes,
        );
        let pair_trims: Vec<(usize, usize)> = punctuation_trims
            .iter()
            .map(|trim| (trim.left_byte, trim.right_byte))
            .collect();
        // Characters no registered face covers: shaping lands on a face's
        // `.notdef` advance while the canvas paints the browser's own
        // fallback glyph (measured: b12's U+2764 shaped 12.445px against a
        // painted 14.5625px, skewing every justify share on the line). The
        // host measures the fallback advance with the same canvas that
        // paints; the difference rides as letter spacing on the character,
        // the edit channel the punctuation trims already use.
        let mut uncovered_char_edits: Vec<(std::ops::Range<usize>, f32)> = Vec::new();
        {
            let mut coverage = self.char_coverage_cache.borrow_mut();
            let mut cursor = 0usize;
            for (byte, character) in text.char_indices() {
                if character.is_whitespace() || character.is_control() {
                    continue;
                }
                while cursor < runs.len() && runs[cursor].0.end <= byte {
                    cursor += 1;
                }
                let Some((_, style, _)) =
                    runs.get(cursor).filter(|(range, ..)| range.contains(&byte))
                else {
                    continue;
                };
                let family_key = host_family_key(style);
                let covered = *coverage
                    .entry((family_key.clone(), character))
                    .or_insert_with(|| {
                        stack_covers_character(
                            &mut fonts,
                            &self.registered_families,
                            style,
                            character,
                        )
                    });
                if covered {
                    continue;
                }
                let Some(host_advance) = self.host_char_advance(
                    &family_key,
                    f64::from(style.font.size.get()),
                    character,
                ) else {
                    continue;
                };
                let Some(notdef) = stack_notdef_advance_px(
                    &mut fonts,
                    &self.registered_families,
                    style,
                    shaping_font_size(style.font.size.get()),
                ) else {
                    continue;
                };
                let author = match style.text_flow.letter_spacing {
                    LengthPercentage::Length(px) => px.get(),
                    _ => 0.0,
                };
                uncovered_char_edits.push((
                    byte..byte + character.len_utf8(),
                    author + (host_advance - notdef) as f32,
                ));
            }
        }
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = SpacingBuilder::new(layouts.ranged_builder(&mut fonts, &text, 1.0, true));
        // The pinned-browser baseline: Chromium's ASCII break tailoring plus
        // its CJK-context treatment of ambiguous curly quotes.
        if break_anywhere {
            // `line-break: anywhere`: a soft wrap opportunity around every
            // typographic character unit — kinsoku and pair tables are
            // disregarded entirely (b50's afterword packs two more
            // full-width characters per line than any kinsoku-aware rule
            // set allows, breaking mid-ellipsis and before commas).
            builder.set_line_break_override(&break_anywhere_override);
        } else if chromium_tailoring {
            if strict_kinsoku {
                builder.set_line_break_override(&cjk_aware_chromium_break_override_strict);
            } else {
                builder.set_line_break_override(&cjk_aware_chromium_break_override);
            }
        } else if break_all {
            builder.set_line_break_override(&break_all_box_dash_override);
        }
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
                    | InlineItem::EmptyBox { style, .. } => *style,
                })
            })
            .and_then(|style_id| styles.inline.style(style_id).ok())
            .map_or(0.0_f32, resolved_text_indent);
        for (range, style, item_index) in &runs {
            if range.is_empty() {
                continue;
            }
            push_item_styles(&mut builder, style, range.clone());
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

        // Inline box advances: a span's horizontal padding and borders
        // widen the gap at each box boundary. The gap rides as letter
        // spacing on the character left of the boundary (the same
        // mechanism as the punctuation trims); a box opening at the very
        // start of the flow folds its lead into the first-line indent.
        // Each edit is (range, box gap, author letter-spacing): standalone
        // pushes apply author + gap; an edit landing on a trimmed
        // character adds only the gap (the trim value already carries the
        // author spacing).
        let mut box_edits: Vec<(std::ops::Range<usize>, f32, f32)> = Vec::new();
        let mut leading_box_indent = 0.0_f32;
        let mut item_box_sheds: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        let mut forced_line_indents: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        {
            let box_side =
                |value: &rito_style_contract::NonNegativeLengthPercentage| match value.value() {
                    LengthPercentage::Length(px) => px.get(),
                    _ => 0.0,
                };
            let edge_width = |edge: &rito_style_contract::BorderEdge| {
                use rito_style_contract::BorderStyle;
                if matches!(edge.style, BorderStyle::None | BorderStyle::Hidden) {
                    0.0
                } else {
                    edge.resolved_width.get()
                }
            };
            let author = |style: &InlineFormattingStyle| match style.text_flow.letter_spacing {
                LengthPercentage::Length(px) => px.get(),
                _ => 0.0,
            };
            // Inline horizontal margins displace the inline box
            // exactly like padding/border gaps, but stay OUTSIDE the
            // painted box (the pen grows the box by paint padding only).
            // Percentages resolve against the containing block's inline
            // size; vertical inline margins have no effect in CSS.
            let margin_side = |value: &rito_style_contract::LengthPercentageOrAuto| match value {
                rito_style_contract::LengthPercentageOrAuto::Auto => 0.0_f32,
                rito_style_contract::LengthPercentageOrAuto::Value(inner) => match inner {
                    LengthPercentage::Length(px) => px.get(),
                    LengthPercentage::Percentage(pct) => {
                        available_inline_size.map_or(0.0, |basis| pct.ratio() * basis as f32)
                    }
                    _ => 0.0,
                },
            };
            for (index, (range, style, item_index)) in runs.iter().enumerate() {
                if range.is_empty() {
                    continue;
                }
                let lead = box_side(&style.fragment.padding.left)
                    + edge_width(&style.fragment.border.left)
                    + margin_side(&style.fragment.margin.left);
                let trail = box_side(&style.fragment.padding.right)
                    + edge_width(&style.fragment.border.right)
                    + margin_side(&style.fragment.margin.right);
                if trail > 0.0 {
                    if let Some((last, _)) = text[range.clone()].char_indices().last() {
                        box_edits.push((range.start + last..range.end, trail, author(style)));
                        *item_box_sheds.entry(*item_index).or_insert(0.0) += f64::from(trail);
                    }
                }
                if lead > 0.0 {
                    if range.start == 0 {
                        leading_box_indent += lead;
                    } else if text.as_bytes().get(range.start - 1) == Some(&b'\n') {
                        // The span opens a forced-break line: the lead
                        // indents that line (a previous-char edit would
                        // widen the line ABOVE). Breaking does not see
                        // the reserved width — an indented long span may
                        // overfit vs Blink; b60-style badge lines hold
                        // one glyph and are exact.
                        *forced_line_indents.entry(range.start).or_insert(0.0) += f64::from(lead);
                    } else if let Some((prev_range, prev_style, prev_item)) =
                        runs.get(..index).and_then(|earlier| {
                            earlier
                                .iter()
                                .rev()
                                .find(|(earlier_range, ..)| !earlier_range.is_empty())
                        })
                    {
                        if let Some((last, _)) = text[prev_range.clone()].char_indices().last() {
                            box_edits.push((
                                prev_range.start + last..prev_range.end,
                                lead,
                                author(prev_style),
                            ));
                            *item_box_sheds.entry(*prev_item).or_insert(0.0) += f64::from(lead);
                        }
                    }
                }
            }
        }
        // Coincident box edits sum: one character can carry BOTH its own
        // box's trailing gap and the next box's leading gap (b74's title
        // cards — four adjacent bordered spans). Pushed separately they
        // land on the same builder range and the later LetterSpacing
        // OVERWRITES the earlier, silently dropping one gap (every
        // non-final card lost its 4px trail). The author spacing on both
        // edits comes from the same character's style, so merging keeps
        // it single-counted.
        {
            let mut coalesced: Vec<(std::ops::Range<usize>, f32, f32)> = Vec::new();
            for (range, gap, author) in box_edits.drain(..) {
                if let Some(existing) = coalesced.iter_mut().find(|(seen, ..)| *seen == range) {
                    existing.1 += gap;
                } else {
                    coalesced.push((range, gap, author));
                }
            }
            box_edits = coalesced;
        }
        let first_line_indent = first_line_indent + leading_box_indent;
        let opener_halt_trims: Vec<(std::ops::Range<usize>, f64)> = punctuation_trims
            .iter()
            .filter_map(|trim| match trim.edit {
                PunctuationTrimEdit::OpenerHalt(half) => {
                    Some((trim.edit_range.clone(), f64::from(half)))
                }
                PunctuationTrimEdit::LetterSpacing(_) => None,
            })
            .collect();
        for trim in punctuation_trims {
            let range = trim.edit_range;
            let spacing = match trim.edit {
                PunctuationTrimEdit::OpenerHalt(_) => {
                    builder.push(
                        StyleProperty::FontFeatures(parley::FontFeatures::List(
                            std::borrow::Cow::Owned(vec![parley::FontFeature::new(
                                parley::setting::Tag::new(b"halt"),
                                1,
                            )]),
                        )),
                        range,
                    );
                    continue;
                }
                PunctuationTrimEdit::LetterSpacing(spacing) => spacing,
            };
            // A box gap on the same character composes with the trim (the
            // trim value already carries the author spacing).
            let boxed = box_edits
                .iter()
                .position(|(edit_range, ..)| *edit_range == range);
            let spacing = match boxed {
                Some(found) => {
                    let (_, gap, _) = box_edits.remove(found);
                    spacing + gap
                }
                None => spacing,
            };
            builder.push(StyleProperty::LetterSpacing(spacing), range);
        }
        // A box gap landing on an uncovered character composes with its
        // advance edit instead of being overwritten by it.
        for (range, gap, author) in box_edits {
            if let Some((_, spacing)) = uncovered_char_edits
                .iter_mut()
                .find(|(edit_range, _)| *edit_range == range)
            {
                *spacing += gap;
                continue;
            }
            builder.push(StyleProperty::LetterSpacing(author + gap), range);
        }
        for (range, spacing) in &uncovered_char_edits {
            builder.push(StyleProperty::LetterSpacing(*spacing), range.clone());
        }
        for (range, spacing) in &ruby_spread_edits {
            builder.push(StyleProperty::LetterSpacing(*spacing), range.clone());
        }
        // A split spread segment's widening, decided by the outer layout
        // loop once line breaks are known (the segment carries its
        // allocated annotation words and spreads to their advance).
        for (range, spacing) in split_spread_edits {
            builder.push(StyleProperty::LetterSpacing(*spacing), range.clone());
        }
        push_line_end_trims(&mut builder, &text, &runs, end_trims);
        for image_box in image_boxes {
            builder.push_inline_box(image_box);
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
                    | InlineItem::EmptyBox { style, .. } => *style,
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
            item_box_sheds,
            forced_line_indents,
            ruby_spreads,
            ruby_spread_overhangs,
            ruby_spread_overhangs_right,
            ruby_annotation_widths,
            ruby_center_shifts,
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

/// Letter-spacing pushes in builder order: a later push overrides an
/// earlier one on the bytes they share.
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
pub(crate) struct ParagraphLayout {
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
    /// Per item index: advance the item's LAST cluster gained from inline
    /// box gaps (its own trailing padding/border, plus the leading
    /// padding/border of a box opening right after it). Emitted fragment
    /// widths shed it so the run rect stays the ink advance the painter
    /// grows the inline box from.
    pub(crate) item_box_sheds: std::collections::HashMap<usize, f64>,
    /// Per forced-break line start (flow-text byte): the box lead
    /// (margin, padding, border) of a span opening that line. A lead
    /// riding the previous character's letter spacing would widen the
    /// PREVIOUS line across a `<br/>`; Blink indents the span's own line
    /// (u3000/inline-margin oracle: margin box at x=30, padding glyph at
    /// +30, both on the span's line), so the line loop shifts the whole
    /// line instead.
    pub(crate) forced_line_indents: std::collections::HashMap<usize, f64>,
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
    /// Per item: the paint-side right shift centering a packed base
    /// under its wide `ruby-align: center` annotation.
    pub(crate) ruby_center_shifts: std::collections::HashMap<usize, f64>,
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

/// Key of one host metric sample: (family key, size in milli-px, font
/// blob id, face index, script).
pub(crate) type HostMetricSampleKey = (String, u64, u64, u32, u16);

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

/// Cache key for a `line-height: normal` strut: exactly the font inputs
/// `measure_normal_line_height` shapes with, so equal keys measure equal.
pub(crate) fn normal_strut_key(style: &InlineFormattingStyle) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    family_stack_source(style).hash(&mut hasher);
    shaping_font_size(style.font.size.get())
        .to_bits()
        .hash(&mut hasher);
    style.font.weight.get().to_bits().hash(&mut hasher);
    match style.font.slant {
        FontSlant::Normal => 0u8.hash(&mut hasher),
        FontSlant::Italic => 1u8.hash(&mut hasher),
        FontSlant::Oblique(angle) => {
            2u8.hash(&mut hasher);
            angle.degrees().to_bits().hash(&mut hasher);
        }
    }
    hasher.finish()
}

pub(crate) fn push_item_styles(
    builder: &mut SpacingBuilder<'_>,
    style: &InlineFormattingStyle,
    range: std::ops::Range<usize>,
) {
    let stack = family_stack_source(style);
    builder.push(
        StyleProperty::FontFamily(parley::FontFamily::Source(Cow::Owned(stack))),
        range.clone(),
    );
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

pub(crate) fn family_stack_source(style: &InlineFormattingStyle) -> String {
    style
        .font
        .families
        .iter()
        .map(|family| match family {
            FontFamily::Named(name) => format!("\"{}\"", name.as_str()),
            FontFamily::Generic(generic) => generic_source(*generic).to_owned(),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn generic_source(generic: GenericFontFamily) -> &'static str {
    match generic {
        GenericFontFamily::Serif => "serif",
        GenericFontFamily::SansSerif => "sans-serif",
        GenericFontFamily::Monospace => "monospace",
        GenericFontFamily::Cursive => "cursive",
        GenericFontFamily::Fantasy => "fantasy",
        GenericFontFamily::SystemUi => "system-ui",
    }
}

/// Points every generic family and every script's fallback at the given
/// registered families, in order.
///
/// With the platform font database excluded, the collection starts with no
/// generic mappings and no fallback entries at all; a stack ending in
/// `serif`, or a run of text no stack family covers, would otherwise
/// resolve to nothing and silently drop its glyphs. Han gets its tracked
/// locale-specific entries too, so `ja`/`ko`/regional-Chinese content
/// falls back the same way default Chinese does.
pub(crate) fn install_universal_fallbacks(
    collection: &mut parley::fontique::Collection,
    families: &[parley::fontique::FamilyId],
) {
    use parley::fontique::{FallbackKey, GenericFamily, Script, ScriptExt as _};
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
            language: None,
        },
        bidi: InlineBidi {
            direction: Direction::LeftToRight,
            unicode_bidi: UnicodeBidi::Normal,
            writing_mode: WritingMode::HorizontalTopToBottom,
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
            background: black.into(),
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
