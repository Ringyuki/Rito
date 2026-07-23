//! Parley-backed inline formatting context.
//!
//! Implements the `rito-fragment` provider contract for inline flows: one
//! paragraph of typed-styled text items in, line and text fragments out.
//! Fonts are explicit — the context lays out with exactly the font bytes it
//! was constructed with, never a platform font database — which is what
//! makes its output reproducible across platforms and comparable against
//! the pinned-browser oracle. Parley supplies shaping and line breaking;
//! everything it cannot express (fragmentation, resumed layout, non-text
//! inline items) fails closed instead of degrading.

use std::borrow::Cow;
use std::cell::RefCell;

use parley::{
    FontContext, InlineBox, InlineBoxKind, LayoutContext, PositionedLayoutItem, RangedBuilder,
    StyleProperty,
};
use rito_fragment::{
    BoxFragment, CancelFlag, ConstraintSpace, FormattingContext, FormattingNodeContent,
    FormattingNodeId, FormattingTree, Fragment, FragmentRect, FragmentTree, InlineItem,
    IntrinsicInlineSizes, LayoutError, LayoutOutcome, LineFragment, TextFragment,
};
use rito_style_contract::{
    FontFamily, FontSlant, GenericFontFamily, InlineFormattingStyleV1, LayoutFormattingStyleV1,
    LengthPercentage, LineHeight, MaximumSizeV1, PreferredSizeV1, TextAlign,
};

/// One paragraph's built Parley layout plus the metadata the fragment
/// assembly needs.
struct ParagraphLayout {
    layout: parley::Layout<[u8; 4]>,
    #[allow(dead_code)]
    text: String,
    alignment: parley::Alignment,
    /// Byte ranges of the flow text whose runs carry a baseline shift
    /// (positive raises), in content order.
    shifted_ranges: Vec<(std::ops::Range<usize>, f64)>,
}

/// Marker id for the inline box that reserves first-line indent space.
const INDENT_INLINE_BOX_ID: u64 = u64::MAX;

/// Inline formatting context backed by Parley shaping and line breaking.
///
/// Holds its font and layout scratch state behind `RefCell`: layout is a
/// pure function of its inputs, but Parley's contexts require mutable
/// access, so one `ParleyInlineContext` must not be re-entered from within
/// its own call stack.
pub struct ParleyInlineContext {
    fonts: RefCell<FontContext>,
    layouts: RefCell<LayoutContext<[u8; 4]>>,
    registered_families: Vec<String>,
}

impl ParleyInlineContext {
    /// Creates a context that resolves families against exactly these font
    /// blobs. Fails closed if a blob registers no usable font face.
    ///
    /// The blobs are the resolution universe: they serve every generic
    /// family and every script's fallback, in construction order. Nothing
    /// else exists — the platform font database is explicitly excluded, so
    /// a family the blobs cannot serve resolves the same way on native and
    /// wasm hosts instead of silently borrowing a platform font.
    pub fn new(font_blobs: Vec<Vec<u8>>) -> Result<Self, String> {
        use parley::fontique::{Collection, CollectionOptions, SourceCache, SourceCacheOptions};
        let mut collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        });
        let mut registered_families = Vec::new();
        let mut fallback_ids = Vec::new();
        for (index, bytes) in font_blobs.into_iter().enumerate() {
            let registered = collection.register_fonts(bytes.into(), None);
            if registered.is_empty() {
                return Err(format!("font blob {index} registered no font face"));
            }
            for (family_id, _) in registered {
                if !fallback_ids.contains(&family_id) {
                    fallback_ids.push(family_id);
                }
                if let Some(name) = collection.family_name(family_id) {
                    let name = name.to_string();
                    if !registered_families.contains(&name) {
                        registered_families.push(name);
                    }
                }
            }
        }
        install_universal_fallbacks(&mut collection, &fallback_ids);
        let fonts = FontContext {
            collection,
            source_cache: SourceCache::new(SourceCacheOptions::default()),
        };
        Ok(Self {
            fonts: RefCell::new(fonts),
            layouts: RefCell::new(LayoutContext::new()),
            registered_families,
        })
    }

    /// Family names the constructor registered, in first-seen order.
    pub fn registered_families(&self) -> &[String] {
        &self.registered_families
    }

    /// Registers one font blob under an explicit family name, the way a
    /// stylesheet's `@font-face` binds a declared family to font bytes.
    /// Styles resolve the declared name regardless of the font's own
    /// internal family name.
    pub fn register_named_font(&mut self, family_name: &str, bytes: Vec<u8>) -> Result<(), String> {
        let fonts = self.fonts.get_mut();
        let registered = fonts.collection.register_fonts(
            bytes.into(),
            Some(parley::fontique::FontInfoOverride {
                family_name: Some(family_name),
                width: None,
                style: None,
                weight: None,
                axes: None,
            }),
        );
        if registered.is_empty() {
            return Err(format!(
                "font blob for family {family_name} registered no font face"
            ));
        }
        if !self
            .registered_families
            .iter()
            .any(|name| name == family_name)
        {
            self.registered_families.push(family_name.to_owned());
        }
        Ok(())
    }

    fn build_layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        available_inline_size: Option<f64>,
        available_block_size: Option<f64>,
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
        // Blink consults its pair-preference table only under
        // `word-break: normal`; `break-all`/`keep-all` change the break
        // opportunities the table would otherwise veto.
        let mut chromium_tailoring = true;
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
                    runs.push((start..text.len(), style, item_index));
                }
                InlineItem::Image {
                    intrinsic_width,
                    intrinsic_height,
                    layout_style,
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
                    )?;
                    image_boxes.push(InlineBox {
                        id: item_index as u64,
                        kind: InlineBoxKind::InFlow,
                        index: text.len(),
                        width,
                        height,
                    });
                }
            }
        }

        let mut fonts = self.fonts.borrow_mut();
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = layouts.ranged_builder(&mut fonts, &text, 1.0, true);
        // The pinned-browser baseline: Chromium's ASCII break tailoring plus
        // its CJK-context treatment of ambiguous curly quotes.
        if chromium_tailoring {
            builder.set_line_break_override(Some(&cjk_aware_chromium_break_override));
        }
        let mut first_line_indent = 0.0_f32;
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
            if range.start == 0 {
                first_line_indent = resolved_text_indent(style);
            }
        }
        push_cjk_punctuation_trims(&mut builder, &text, &runs);
        if first_line_indent > 0.0 {
            // Parley has no text-indent; an in-flow inline box at offset zero
            // occupies the same first-line space.
            builder.push_inline_box(InlineBox {
                id: INDENT_INLINE_BOX_ID,
                kind: InlineBoxKind::InFlow,
                index: 0,
                width: first_line_indent,
                height: 0.1,
            });
        }
        for image_box in image_boxes {
            builder.push_inline_box(image_box);
        }
        if cancel.is_cancelled() {
            return Err(LayoutError::Cancelled);
        }
        // text-align inherits, so the first item's style carries the
        // paragraph's alignment (an empty flow never reaches layout).
        let alignment = items
            .first()
            .map(|item| {
                let style_id = match item {
                    InlineItem::Text { style, .. } | InlineItem::Image { style, .. } => *style,
                };
                styles
                    .inline
                    .style(style_id)
                    .map(|style| paragraph_alignment(style.text_flow.text_align))
                    .map_err(|error| LayoutError::Invalid(error.to_string()))
            })
            .transpose()?
            .unwrap_or(parley::Alignment::Start);
        Ok(ParagraphLayout {
            layout: builder.build(&text),
            text,
            alignment,
            shifted_ranges,
        })
    }
}

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
        let ParagraphLayout {
            mut layout,
            alignment,
            shifted_ranges,
            ..
        } = self.build_layout(
            tree,
            root,
            Some(space.inline_size),
            space.fragmentainer_size,
            cancel,
        )?;
        layout.break_all_lines(Some(space.inline_size as f32));
        if !matches!(alignment, parley::Alignment::Start) {
            layout.align(alignment, parley::AlignmentOptions::default());
        }
        let strut_height = paragraph_strut_height(tree, root)?;
        let item_shifts: Vec<f64> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .map(|item| match item {
                    InlineItem::Text {
                        baseline_shift_px, ..
                    }
                    | InlineItem::Image {
                        baseline_shift_px, ..
                    } => *baseline_shift_px,
                })
                .collect(),
            _ => Vec::new(),
        };
        // Byte range each item occupies in the flow text (images occupy
        // none). Parley reports a glyph run's range at shaping-run
        // granularity, and one shaping run can span several items when
        // their measure styles are identical; intersecting with the run's
        // brushed item recovers the exact per-item range.
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
                        InlineItem::Image { .. } => cursor..cursor,
                    })
                    .collect()
            }
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

        let mut lines = Vec::new();
        // Line boxes stack by their CSS line height: the box model the
        // browser's per-character range rects expose. Parley's block
        // min/max coordinates track ink extents, which drift from the
        // line-height stack by rounding and leading distribution, so the
        // block position comes from accumulation instead.
        let mut running_top = 0.0_f64;
        for line in layout.lines() {
            let metrics = line.metrics();
            let line_top = running_top;
            let has_inline_box = line.items().any(|item| {
                matches!(&item, PositionedLayoutItem::InlineBox(inline_box)
                    if inline_box.id != INDENT_INLINE_BOX_ID)
            });
            let ink_top = f64::from(metrics.block_min_coord);
            let line_x = f64::from(metrics.offset);
            // Collect the line's content first, remembering each child's
            // baseline shift, so the line box can grow by however far
            // shifted content rises above the strut before positions are
            // finalized (a browser's line box contains its risen content).
            let mut children: Vec<(Fragment, f64)> = Vec::new();
            let mut max_rise = 0.0_f64;
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
                        let shift = shift_for_range(&run_range);
                        max_rise = max_rise.max(shift);
                        children.push((
                            Fragment::Text(TextFragment {
                                source: root,
                                rect: FragmentRect {
                                    x: f64::from(glyph_run.offset()) - line_x,
                                    y: 0.0,
                                    width: f64::from(glyph_run.advance()),
                                    height: 0.0,
                                },
                                text_start: run_range.start as u32,
                                text_end: run_range.end as u32,
                            }),
                            shift,
                        ));
                    }
                    PositionedLayoutItem::InlineBox(inline_box) => {
                        // The first-line indent box reserves space but
                        // paints nothing; every other inline box is an
                        // atomic image item. Its vertical position is
                        // measured in Parley's ink coordinates, so it maps
                        // into the line box through the ink top.
                        if inline_box.id == INDENT_INLINE_BOX_ID {
                            continue;
                        }
                        let shift = item_shifts
                            .get(inline_box.id as usize)
                            .copied()
                            .unwrap_or(0.0);
                        max_rise = max_rise.max(shift);
                        children.push((
                            Fragment::Image(rito_fragment::ImageFragment {
                                source: root,
                                rect: FragmentRect {
                                    x: f64::from(inline_box.x) - line_x,
                                    y: f64::from(inline_box.y) - ink_top,
                                    width: f64::from(inline_box.width),
                                    height: f64::from(inline_box.height),
                                },
                                item_index: inline_box.id as u32,
                            }),
                            shift,
                        ));
                    }
                }
            }
            // Text-only lines take Parley's line height (the CSS strut).
            // A line holding an atomic inline is sized by the CSS envelope
            // instead: baseline-aligned content ascent plus descent, never
            // smaller than the strut — Parley's own line height inflates
            // beyond what a browser gives such lines. Risen content grows
            // the box above the strut by its overflow.
            let base_height = if has_inline_box {
                let envelope = f64::from(metrics.ascent) + f64::from(metrics.descent);
                envelope.max(strut_height.unwrap_or(0.0))
            } else {
                f64::from(metrics.line_height)
            };
            let line_height = base_height + max_rise;
            running_top += line_height;
            let half_leading =
                (base_height - f64::from(metrics.ascent) - f64::from(metrics.descent)) / 2.0;
            let baseline = max_rise + half_leading + f64::from(metrics.ascent);
            let children: Vec<Fragment> = children
                .into_iter()
                .map(|(mut fragment, shift)| {
                    let adjust = max_rise - shift;
                    match &mut fragment {
                        Fragment::Text(text) => {
                            text.rect.y = adjust;
                            text.rect.height = base_height;
                        }
                        Fragment::Image(image) => image.rect.y += adjust,
                        _ => {}
                    }
                    fragment
                })
                .collect();
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
        let built = self.build_layout(tree, node, None, None, &CancelFlag::new())?;
        let widths = built.layout.calculate_content_widths();
        Ok(IntrinsicInlineSizes {
            min_content: f64::from(widths.min),
            max_content: f64::from(widths.max),
        })
    }
}

/// Chromium's line-break tailoring, extended with its CJK quote classes.
///
/// UAX-14 gives the curly quotes class QU (no break on either side), but
/// Blink reclassifies them in CJK context: an opening curly quote breaks
/// like an opening bracket (opportunity before, none after) and a closing
/// curly quote like a closing bracket (opportunity after, none before).
/// CJK dialogue in translated novels hangs on this. Everything else
/// defers to Parley's Chromium ASCII table.
fn cjk_aware_chromium_break_override(context: parley::LineBreakContext) -> Option<bool> {
    const OPEN_QUOTES: [char; 2] = ['\u{2018}', '\u{201C}'];
    const CLOSE_QUOTES: [char; 2] = ['\u{2019}', '\u{201D}'];
    if OPEN_QUOTES.contains(&context.after)
        && is_cjk_context(context.before)
        && fullwidth_punctuation_class(context.before) != PunctuationClass::Open
        && !OPEN_QUOTES.contains(&context.before)
    {
        return Some(true);
    }
    if CLOSE_QUOTES.contains(&context.before)
        && is_cjk_context(context.after)
        && fullwidth_punctuation_class(context.after) != PunctuationClass::CloseOrStop
        && !CLOSE_QUOTES.contains(&context.after)
        && !OPEN_QUOTES.contains(&context.after)
    {
        return Some(true);
    }
    (parley::CHROMIUM_LINE_BREAK_OVERRIDE)(context)
}

/// Whether the character puts the boundary in CJK typographic context.
fn is_cjk_context(character: char) -> bool {
    matches!(u32::from(character),
        0x2E80..=0x303F
        | 0x3040..=0x312F
        | 0x3130..=0x318F
        | 0x31C0..=0x9FFF
        | 0xAC00..=0xD7AF
        | 0xF900..=0xFAFF
        | 0xFF00..=0xFFEF
        | 0x20000..=0x3FFFF)
}

/// Which glyph loses its blank half at a fullwidth-punctuation boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrimmedGlyph {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PunctuationClass {
    Open,
    CloseOrStop,
    Middle,
    Other,
}

fn fullwidth_punctuation_class(character: char) -> PunctuationClass {
    match character {
        '「' | '『' | '（' | '【' | '〔' | '《' | '〈' | '〖' | '〘' | '〚' | '｛' | '［'
        | '｟' => PunctuationClass::Open,
        '」' | '』' | '）' | '】' | '〕' | '》' | '〉' | '〗' | '〙' | '〛' | '｝' | '］'
        | '｠' | '。' | '、' | '，' | '．' | '：' | '；' => PunctuationClass::CloseOrStop,
        '・' => PunctuationClass::Middle,
        _ => PunctuationClass::Other,
    }
}

/// The half-width trim at the boundary between `left` and `right`, if any.
///
/// Chromium ships `text-spacing-trim: normal` on by default for CJK text
/// (Blink "Han kerning"): where two fullwidth punctuation glyphs meet, the
/// blank half at the boundary collapses so the pair advances 1.5em instead
/// of 2em. Characterized against pinned Chromium (scratchpad trim probes,
/// 2026-07-23, 54-pair matrix): an opening bracket trims its blank left
/// half after any fullwidth punctuation; a close/stop/colon trims its
/// blank right half before any fullwidth punctuation; nothing trims
/// against an ideograph or at a line edge, `！？・` never trim themselves,
/// the trim applies with or without justification, and it crosses inline
/// element boundaries.
fn cjk_punctuation_trim(left: char, right: char) -> Option<TrimmedGlyph> {
    let left_class = fullwidth_punctuation_class(left);
    let right_class = fullwidth_punctuation_class(right);
    if right_class == PunctuationClass::Open && left_class != PunctuationClass::Other {
        return Some(TrimmedGlyph::Right);
    }
    if left_class == PunctuationClass::CloseOrStop && right_class != PunctuationClass::Other {
        return Some(TrimmedGlyph::Left);
    }
    None
}

/// Applies the boundary trims as negative letter-spacing on the character
/// left of each trimming boundary — geometrically identical to removing
/// the blank half, and visible to shaping, line breaking, and run
/// splitting alike (the distinct resolved style isolates the trimmed
/// character in its own glyph run, so painted runs stay position-exact).
fn push_cjk_punctuation_trims(
    builder: &mut RangedBuilder<'_, [u8; 4]>,
    text: &str,
    runs: &[(std::ops::Range<usize>, &InlineFormattingStyleV1, usize)],
) {
    fn style_at<'a>(
        cursor: &mut usize,
        runs: &[(std::ops::Range<usize>, &'a InlineFormattingStyleV1, usize)],
        byte: usize,
    ) -> Option<&'a InlineFormattingStyleV1> {
        while *cursor < runs.len() && runs[*cursor].0.end <= byte {
            *cursor += 1;
        }
        runs.get(*cursor)
            .filter(|(range, ..)| range.contains(&byte))
            .map(|(_, style, _)| *style)
    }
    let mut cursor = 0usize;
    let mut previous: Option<(usize, char)> = None;
    for (byte, character) in text.char_indices() {
        if let Some((left_byte, left)) = previous {
            if let Some(trimmed) = cjk_punctuation_trim(left, character) {
                let left_style = style_at(&mut cursor, runs, left_byte);
                let trimmed_style = match trimmed {
                    TrimmedGlyph::Left => left_style,
                    TrimmedGlyph::Right => style_at(&mut cursor, runs, byte),
                };
                if let (Some(left_style), Some(trimmed_style)) = (left_style, trimmed_style) {
                    let author = match left_style.text_flow.letter_spacing {
                        LengthPercentage::Length(px) => px.get(),
                        _ => 0.0,
                    };
                    builder.push(
                        StyleProperty::LetterSpacing(author - 0.5 * trimmed_style.font.size.get()),
                        left_byte..byte,
                    );
                }
            }
        }
        previous = Some((byte, character));
    }
}

fn push_item_styles(
    builder: &mut RangedBuilder<'_, [u8; 4]>,
    style: &InlineFormattingStyleV1,
    range: std::ops::Range<usize>,
) {
    let stack = family_stack_source(style);
    builder.push(
        StyleProperty::FontFamily(parley::FontFamily::Source(Cow::Owned(stack))),
        range.clone(),
    );
    builder.push(
        StyleProperty::FontSize(style.font.size.get()),
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

fn family_stack_source(style: &InlineFormattingStyleV1) -> String {
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

fn generic_source(generic: GenericFontFamily) -> &'static str {
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
fn install_universal_fallbacks(
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
) -> InlineFormattingStyleV1 {
    use rito_style_contract::{
        AbsoluteColor, AbsoluteColorSpace, AlignmentBaseline, BaselineShift, BaselineSource,
        BorderEdge, BorderEdges, BorderRadii, BorderStyle, ColorNoneFlags, CornerRadius, CssPx,
        Direction, FontStyleV1, FontWeight, InlineBidiV1, InlineFragmentStyleV1,
        InlinePaintStyleV1, InlineTextFlowV1, LengthPercentageOrAuto, LineBreak, NonNegativeCssPx,
        NonNegativeLengthPercentage, OverflowWrap, PhysicalSides, TextAlign, TextDecoration,
        TextDecorationLines, TextDecorationStyle, TextIndent, TextJustify, TextTransform,
        TextTransformCase, TextWrapMode, TransformListV1, UnicodeBidi, UnitInterval,
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
    InlineFormattingStyleV1 {
        font: FontStyleV1 {
            families,
            is_system_font: false,
            is_initial: false,
            size: NonNegativeCssPx::new(font_size_px).expect("font size is non-negative"),
            weight: FontWeight::new(400.0).expect("normal weight is valid"),
            slant: FontSlant::Normal,
            line_height: LineHeight::Normal,
            line_height_is_declared: false,
        },
        text_flow: InlineTextFlowV1 {
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
            language: None,
        },
        bidi: InlineBidiV1 {
            direction: Direction::LeftToRight,
            unicode_bidi: UnicodeBidi::Normal,
            writing_mode: WritingMode::HorizontalTopToBottom,
        },
        fragment: InlineFragmentStyleV1 {
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
        paint: InlinePaintStyleV1 {
            foreground: black,
            opacity: UnitInterval::new(1.0).expect("opacity is bounded"),
            background: black.into(),
            background_image: None,
            transform: TransformListV1::none(),
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

/// The paragraph's CSS strut height: its specified line-height in px, or
/// `None` for `normal` (where the content envelope wins). Inherited, so
/// the first item's style carries the paragraph value.
fn paragraph_strut_height(
    tree: &FormattingTree,
    node: FormattingNodeId,
) -> Result<Option<f64>, LayoutError> {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
        return Ok(None);
    };
    let Some(styles) = tree.styles() else {
        return Ok(None);
    };
    let Some(item) = items.first() else {
        return Ok(None);
    };
    let style_id = match item {
        InlineItem::Text { style, .. } | InlineItem::Image { style, .. } => *style,
    };
    let style = styles
        .inline
        .style(style_id)
        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
    Ok(match style.font.line_height {
        LineHeight::Normal => None,
        LineHeight::Number(number) => {
            Some(f64::from(number.get()) * f64::from(style.font.size.get()))
        }
        LineHeight::Length(px) => Some(f64::from(px.get())),
    })
}

/// Maps the computed `text-align` onto Parley's line alignment. The
/// Servo-internal `-moz-*` values behave as their physical counterparts.
fn paragraph_alignment(value: TextAlign) -> parley::Alignment {
    match value {
        TextAlign::Start => parley::Alignment::Start,
        TextAlign::End => parley::Alignment::End,
        TextAlign::Left | TextAlign::MozLeft => parley::Alignment::Left,
        TextAlign::Right | TextAlign::MozRight => parley::Alignment::Right,
        TextAlign::Center | TextAlign::MozCenter => parley::Alignment::Center,
        TextAlign::Justify => parley::Alignment::Justify,
    }
}

/// Resolves an image's display size from its intrinsic dimensions and the
/// CSS sizing fields of its layout style.
///
/// The supported slice: `auto` sizes use the intrinsic dimension (scaled by
/// ratio when the other axis is fixed), fixed lengths are used as written,
/// and a `max-width` length or percentage caps the result preserving the
/// ratio. Percentages resolve against `available_inline_size`; in intrinsic
/// (min/max-content) sizing there is none, and percentage-based fields are
/// treated as their auto/none behavior per CSS. Everything else fails
/// closed.
fn image_display_size(
    intrinsic_width: f64,
    intrinsic_height: f64,
    layout_style: &LayoutFormattingStyleV1,
    available_inline_size: Option<f64>,
    available_block_size: Option<f64>,
) -> Result<(f32, f32), LayoutError> {
    let resolve = |value: LengthPercentage| -> Option<f64> {
        match value {
            LengthPercentage::Length(px) => Some(f64::from(px.get())),
            LengthPercentage::Percentage(ratio) => {
                available_inline_size.map(|basis| f64::from(ratio.ratio()) * basis)
            }
            LengthPercentage::Linear { length, percentage } => available_inline_size
                .map(|basis| f64::from(length.get()) + f64::from(percentage.ratio()) * basis),
        }
    };
    let preferred = |value: PreferredSizeV1, axis: &str| -> Result<Option<f64>, LayoutError> {
        match value {
            PreferredSizeV1::Auto => Ok(None),
            PreferredSizeV1::Value(value) => Ok(resolve(value.value())),
            other => Err(LayoutError::Invalid(format!(
                "image {axis} sizing {other:?} is not representable yet"
            ))),
        }
    };
    let ratio = if intrinsic_width > 0.0 && intrinsic_height > 0.0 {
        intrinsic_height / intrinsic_width
    } else {
        1.0
    };
    let (mut width, mut height) = match (
        preferred(layout_style.width, "width")?,
        preferred(layout_style.height, "height")?,
    ) {
        (Some(width), Some(height)) => (width, height),
        (Some(width), None) => (width, width * ratio),
        (None, Some(height)) => (height / ratio.max(f64::EPSILON), height),
        (None, None) => (intrinsic_width, intrinsic_height),
    };
    if let MaximumSizeV1::Value(cap) = layout_style.max_width {
        if let Some(cap) = resolve(cap.value()) {
            if width > cap && width > 0.0 {
                let scale = cap / width;
                width = cap;
                height *= scale;
            }
        }
    }
    // A page-bound reader never shows a replaced image larger than one
    // page: the retained pipeline scales oversized images down to the page
    // content box on both axes, and this provider mirrors that reader
    // semantic whenever a page context is present. Continuous layout
    // without a page context leaves the image at its CSS size, exactly as
    // a scrolling browser does.
    if let Some(page_height) = available_block_size {
        if height > page_height && height > 0.0 && page_height > 0.0 {
            let scale = page_height / height;
            height = page_height;
            width *= scale;
        }
        if let Some(page_width) = available_inline_size {
            if width > page_width && width > 0.0 && page_width > 0.0 {
                let scale = page_width / width;
                width = page_width;
                height *= scale;
            }
        }
    }
    Ok((width as f32, height as f32))
}

/// The first-line indent this style asks for, in CSS px. Percentages need a
/// containing-block basis the inline context does not have; they fail to
/// zero here and must be resolved by the block container before reaching
/// this provider.
fn resolved_text_indent(style: &InlineFormattingStyleV1) -> f32 {
    match style.text_flow.text_indent.value {
        LengthPercentage::Length(px) => px.get().max(0.0),
        _ => 0.0,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use rito_fragment::{BreakToken, BreakTokenStage, FormattingNode, FragmentCache};
    use rito_style_contract::{
        AbsoluteColor, AbsoluteColorSpace, AlignmentBaseline, BaselineShift, BaselineSource,
        BorderEdge, BorderEdges, BorderRadii, BorderStyle, ColorNoneFlags, CornerRadius, CssPx,
        FontFamilies, FontFamilyName, FontStyleV1, FontWeight, InlineBidiV1, InlineFragmentStyleV1,
        InlinePaintStyleV1, InlineStyleTableV1, InlineTextFlowV1, LayoutStyleTableV1,
        LengthPercentageOrAuto, NonNegativeCssPx, NonNegativeLengthPercentage, PhysicalSides,
        TextAlign, TextDecoration, TextDecorationLines, TextDecorationStyle, TextIndent,
        TextJustify, TextTransform, TextTransformCase, TextWrapMode, TransformListV1, UnitInterval,
        WhiteSpaceCollapse, WordBreak,
    };
    use rito_style_contract::{Direction, LineBreak, OverflowWrap, UnicodeBidi, WritingMode};
    use std::sync::Arc;

    const FONT_SIZE: f32 = 16.0;

    fn tinos_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
        );
        std::fs::read(path).expect("pinned Tinos test font reads")
    }

    fn px(value: f32) -> NonNegativeCssPx {
        NonNegativeCssPx::new(value).expect("test length is non-negative")
    }

    fn transparent() -> AbsoluteColor {
        AbsoluteColor::new(
            AbsoluteColorSpace::Srgb,
            [0.0, 0.0, 0.0],
            1.0,
            ColorNoneFlags::new(false, false, false, false),
        )
        .expect("test color is finite")
    }

    fn sides<T: Copy>(value: T) -> PhysicalSides<T> {
        PhysicalSides {
            top: value,
            right: value,
            bottom: value,
            left: value,
        }
    }

    fn tinos_style(indent_px: f32) -> InlineFormattingStyleV1 {
        let border = BorderEdge {
            resolved_width: px(0.0),
            style: BorderStyle::None,
            color: transparent().into(),
        };
        let radius = CornerRadius {
            horizontal: NonNegativeLengthPercentage::new(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero radius"),
            )),
            vertical: NonNegativeLengthPercentage::new(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero radius"),
            )),
        };
        InlineFormattingStyleV1 {
            font: FontStyleV1 {
                families: FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
                    .expect("family list is non-empty"),
                is_system_font: false,
                is_initial: false,
                size: px(FONT_SIZE),
                weight: FontWeight::new(400.0).expect("valid weight"),
                slant: FontSlant::Normal,
                line_height: LineHeight::Normal,
                line_height_is_declared: false,
            },
            text_flow: InlineTextFlowV1 {
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
                letter_spacing: LengthPercentage::Length(CssPx::new(0.0).expect("zero spacing")),
                word_spacing: LengthPercentage::Length(CssPx::new(0.0).expect("zero spacing")),
                text_indent: TextIndent {
                    value: LengthPercentage::Length(CssPx::new(indent_px).expect("finite indent")),
                    hanging: false,
                    each_line: false,
                },
                language: None,
            },
            bidi: InlineBidiV1 {
                direction: Direction::LeftToRight,
                unicode_bidi: UnicodeBidi::Normal,
                writing_mode: WritingMode::HorizontalTopToBottom,
            },
            fragment: InlineFragmentStyleV1 {
                margin: sides(LengthPercentageOrAuto::Value(LengthPercentage::Length(
                    CssPx::new(0.0).expect("zero margin"),
                ))),
                padding: sides(NonNegativeLengthPercentage::new(LengthPercentage::Length(
                    CssPx::new(0.0).expect("zero padding"),
                ))),
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
                baseline_shift: BaselineShift::Offset(LengthPercentage::Length(
                    CssPx::new(0.0).expect("zero shift"),
                )),
            },
            paint: InlinePaintStyleV1 {
                foreground: transparent(),
                opacity: UnitInterval::new(1.0).expect("opacity is bounded"),
                background: transparent().into(),
                background_image: None,
                transform: TransformListV1::none(),
                text_decoration: TextDecoration {
                    lines: TextDecorationLines::new(false, false, false, false),
                    style: TextDecorationStyle::Solid,
                    color: transparent().into(),
                },
                text_shadows: Arc::from(Vec::new()),
                box_shadows: Arc::from(Vec::new()),
            },
        }
    }

    fn paragraph_tree(text: &str, indent_px: f32) -> (FormattingTree, String) {
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(0, tinos_style(indent_px))
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        (tree, text.to_owned())
    }

    fn line_texts(outcome: &LayoutOutcome, text: &str) -> Vec<String> {
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("inline outcome root is a box fragment");
        };
        root.children
            .iter()
            .map(|line| {
                let Fragment::Line(line) = line else {
                    panic!("inline children are line fragments");
                };
                let mut cursor: Option<u32> = None;
                let mut start = u32::MAX;
                let mut end = 0_u32;
                for run in &line.children {
                    let Fragment::Text(run) = run else {
                        panic!("line children are text fragments");
                    };
                    if let Some(previous_end) = cursor {
                        assert_eq!(
                            previous_end, run.text_start,
                            "run text ranges must tile the line without gaps"
                        );
                    }
                    cursor = Some(run.text_end);
                    start = start.min(run.text_start);
                    end = end.max(run.text_end);
                }
                assert!(start <= end, "lines carry at least one text fragment");
                text[start as usize..end as usize].to_owned()
            })
            .collect()
    }

    const SAMPLE: &str = "The quick brown fox jumps over the lazy dog and keeps \
running through the quiet forest until the morning light returns.";

    #[test]
    fn narrow_advance_breaks_into_multiple_reassemblable_lines() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, text) = paragraph_tree(SAMPLE, 0.0);
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(160.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let lines = line_texts(&outcome, &text);
        assert!(lines.len() > 2, "expected multiple lines, got {lines:?}");
        assert_eq!(lines.concat(), text);
        assert!(outcome.continuation.is_none());
    }

    /// A registered named font must win over the pinned fallback when the
    /// style names it: the two faces have different advances for the same
    /// glyphs, so the line width tells which one shaped.
    #[test]
    fn named_publication_fonts_shape_instead_of_the_pinned_fallback() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let mut context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        // Tinos under a publication name: its Latin advances differ from
        // Source Han's, so a hit is measurable.
        context
            .register_named_font("PubFace", tinos_bytes())
            .expect("named font registers");

        let shape_width = |families: Vec<FontFamily>| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(families).expect("family list"),
                        32.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "Wilhelm".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("root is a box");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .map(|child| child.rect().width)
                .sum::<f64>()
        };

        let named = shape_width(vec![FontFamily::Named(FontFamilyName::new("PubFace"))]);
        let fallback = shape_width(vec![FontFamily::Named(FontFamilyName::new("NoSuchFace"))]);
        assert!(
            (named - fallback).abs() > 1.0,
            "the named face must shape differently from the fallback: named {named}, fallback {fallback}"
        );
    }

    /// Adjacent fullwidth punctuation loses the blank half at the
    /// boundary, exactly as pinned Chromium's default
    /// `text-spacing-trim: normal` measures: each trimming pair shortens
    /// the line by half an em, and non-trimming neighbours stay full.
    #[test]
    fn cjk_punctuation_pairs_trim_half_an_em() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let shape_width = |text: &str| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        16.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("inline outcome root is a box fragment");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .map(|child| child.rect().width)
                .sum::<f64>()
        };
        let plain = shape_width("春日春日春日");
        assert!(
            (plain - 96.0).abs() < 0.1,
            "six ideographs at 16px: {plain}"
        );
        // close + open: the open's blank left half collapses.
        let close_open = shape_width("春日。「春日");
        assert!(
            (close_open - (plain - 8.0)).abs() < 0.1,
            "close+open trims half an em: {close_open}"
        );
        // close + close: the first close's blank right half collapses.
        let close_close = shape_width("春日」。春日");
        assert!(
            (close_close - (plain - 8.0)).abs() < 0.1,
            "close+close trims half an em: {close_close}"
        );
        // A close against an ideograph keeps its full advance.
        let close_ideo = shape_width("春日。春日日");
        assert!(
            (close_ideo - plain).abs() < 0.1,
            "close+ideograph must not trim: {close_ideo}"
        );
        // A middle dot never trims itself.
        let middle = shape_width("春日・」春日");
        assert!(
            (middle - plain).abs() < 0.1,
            "middle dot before a close must not trim: {middle}"
        );
    }

    /// The same must hold for CJK text: a named face whose ideograph
    /// advance differs from the pinned fallback's has to win shaping when
    /// the style names it. This is the exact 86 body-text shape.
    #[test]
    fn named_cjk_publication_fonts_shape_instead_of_the_pinned_fallback() {
        let kai = std::env::var("RITO_TEST_CJK_FONT")
            .ok()
            .and_then(|path| std::fs::read(path).ok());
        let Some(kai) = kai else {
            eprintln!("RITO_TEST_CJK_FONT not set; skipping");
            return;
        };
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let mut context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        context
            .register_named_font("FZWBKS", kai)
            .expect("named font registers");
        let shape_width = |families: Vec<FontFamily>| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(families).expect("family list"),
                        16.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "在那座战场上没有任何阵亡者".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("root is a box");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .map(|child| child.rect().width)
                .sum::<f64>()
        };
        let named = shape_width(vec![FontFamily::Named(FontFamilyName::new("FZWBKS"))]);
        let fallback = shape_width(vec![FontFamily::Named(FontFamilyName::new("NoSuchFace"))]);
        eprintln!("named {named} fallback {fallback}");
        assert!(
            (named - fallback).abs() > 0.5,
            "the named CJK face must shape differently: named {named}, fallback {fallback}"
        );
    }

    #[test]
    fn layout_is_deterministic_and_cache_replayable() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let space = ConstraintSpace::continuous(200.0);
        let cancel = CancelFlag::new();
        let first = context
            .layout(&tree, tree.root(), &space, None, &cancel)
            .expect("first layout");
        let second = context
            .layout(&tree, tree.root(), &space, None, &cancel)
            .expect("second layout");
        assert_eq!(first, second);

        let mut cache = FragmentCache::new(1 << 20);
        let computed = cache
            .layout(&context, &tree, tree.root(), &space, None, &cancel)
            .expect("cache fill");
        assert!(!computed.from_cache);
        let replayed = cache
            .layout(&context, &tree, tree.root(), &space, None, &cancel)
            .expect("cache replay");
        assert!(replayed.from_cache);
        assert_eq!(replayed.outcome, first);
    }

    #[test]
    fn line_geometry_is_positive_and_stacked() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        assert!(root.rect.height > 0.0);
        let mut previous_top = f64::NEG_INFINITY;
        for line in &root.children {
            let Fragment::Line(line) = line else {
                panic!("children are lines");
            };
            assert!(line.rect.height > 0.0);
            assert!(line.rect.width > 0.0);
            assert!(line.baseline > 0.0 && line.baseline <= line.rect.height);
            assert!(line.rect.y > previous_top);
            previous_top = line.rect.y;
        }
    }

    #[test]
    fn first_line_indent_narrows_only_the_first_line() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (plain_tree, text) = paragraph_tree(SAMPLE, 0.0);
        let (indented_tree, _) = paragraph_tree(SAMPLE, 32.0);
        let space = ConstraintSpace::continuous(200.0);
        let cancel = CancelFlag::new();
        let plain = context
            .layout(&plain_tree, plain_tree.root(), &space, None, &cancel)
            .expect("plain layout");
        let indented = context
            .layout(&indented_tree, indented_tree.root(), &space, None, &cancel)
            .expect("indented layout");
        let plain_lines = line_texts(&plain, &text);
        let indented_lines = line_texts(&indented, &text);
        assert_eq!(indented_lines.concat(), text);
        assert!(
            indented_lines[0].len() < plain_lines[0].len(),
            "indent must shorten the first line: {:?} vs {:?}",
            indented_lines[0],
            plain_lines[0]
        );
    }

    #[test]
    fn fragmented_space_and_break_tokens_fail_closed() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let cancel = CancelFlag::new();
        assert!(matches!(
            context.layout(
                &tree,
                tree.root(),
                &ConstraintSpace::fragmented(200.0, 400.0),
                None,
                &cancel
            ),
            Err(LayoutError::Invalid(_))
        ));
        let token = BreakToken {
            resume_path: vec![FormattingNodeId(0)],
            stage: BreakTokenStage::Before,
            pending_floats: Vec::new(),
        };
        assert!(matches!(
            context.layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(200.0),
                Some(&token),
                &cancel
            ),
            Err(LayoutError::Invalid(_))
        ));
    }

    #[test]
    fn cancellation_and_non_inline_roots_fail_closed() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let cancelled = CancelFlag::new();
        cancelled.cancel();
        assert_eq!(
            context.layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &cancelled
            ),
            Err(LayoutError::Cancelled)
        );

        let block_tree = FormattingTree::new(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::BlockContainer,
                children: Vec::new(),
            }],
            FormattingNodeId(0),
        )
        .expect("block tree builds");
        assert!(matches!(
            context.layout(
                &block_tree,
                block_tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new()
            ),
            Err(LayoutError::Invalid(_))
        ));
    }

    #[test]
    fn intrinsic_sizes_are_ordered_and_positive() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let sizes = context
            .intrinsic_inline_sizes(&tree, FormattingNodeId(0))
            .expect("intrinsic sizes");
        assert!(sizes.min_content > 0.0);
        assert!(sizes.max_content >= sizes.min_content);
        let wide = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(sizes.max_content + 1.0),
                None,
                &CancelFlag::new(),
            )
            .expect("unconstrained layout");
        let Fragment::Box(root) = &wide.fragments.root else {
            panic!("root is a box");
        };
        assert_eq!(root.children.len(), 1, "max-content width fits one line");
    }

    #[test]
    fn empty_font_registration_fails_closed() {
        assert!(ParleyInlineContext::new(vec![vec![0_u8; 4]]).is_err());
    }

    #[test]
    fn images_lay_out_as_atomic_inlines_with_display_geometry() {
        use rito_style_contract::{
            AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
            LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleTableV1,
            LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
            MinimumHeightV1, OverflowV1, PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let text_style = inline
            .intern_for_node(0, tinos_style(0.0))
            .expect("style interns");
        let mut layout = LayoutStyleTableV1::new(1);
        let auto = LengthPercentageOrAuto::Auto;
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero"),
        ));
        let image_layout = layout
            .intern_for_node(
                0,
                LayoutFormattingStyleV1 {
                    display: LayoutDisplayV1 {
                        outside: LayoutDisplayOutsideV1::Inline,
                        inside: LayoutDisplayInsideV1::Flow,
                        is_list_item: false,
                    },
                    margin: PhysicalSides {
                        top: auto,
                        right: auto,
                        bottom: auto,
                        left: auto,
                    },
                    padding: PhysicalSides {
                        top: zero_padding,
                        right: zero_padding,
                        bottom: zero_padding,
                        left: zero_padding,
                    },
                    box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
                    justify_content: JustifyContentV1::Normal,
                    align_items: AlignItemsV1::Normal,
                    break_before: PageBreakV1::Auto,
                    break_after: PageBreakV1::Auto,
                    width: PreferredSizeV1::Auto,
                    height: PreferredSizeV1::Auto,
                    max_width: MaximumSizeV1::None,
                    min_height: MinimumHeightV1::Auto,
                    max_height: MaximumHeightV1::None,
                    clear: ClearV1::None,
                    float: FloatV1::None,
                    overflow: OverflowV1::Visible,
                    list_style_type: ListMarkerStyleV1::None,
                    position: PositionV1::Static,
                    inset: PhysicalSides {
                        top: auto,
                        right: auto,
                        bottom: auto,
                        left: auto,
                    },
                },
            )
            .expect("layout style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "Before ".to_owned(),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Image {
                        src: "images/figure.png".to_owned(),
                        intrinsic_width: 40.0,
                        intrinsic_height: 30.0,
                        style: text_style,
                        layout_style: image_layout,
                        baseline_shift_px: 0.0,
                    },
                    InlineItem::Text {
                        text: " after the picture.".to_owned(),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(400.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let mut images = Vec::new();
        for line in &root.children {
            let Fragment::Line(line) = line else {
                panic!("children are lines");
            };
            for child in &line.children {
                if let Fragment::Image(image) = child {
                    images.push(image.clone());
                }
            }
            assert!(line.rect.height >= 30.0, "the image sets the line height");
        }
        assert_eq!(images.len(), 1);
        let image = &images[0];
        assert_eq!(image.item_index, 1);
        assert!((image.rect.width - 40.0).abs() < 0.01);
        assert!((image.rect.height - 30.0).abs() < 0.01);
        assert!(image.rect.x > 0.0, "the image sits after the leading text");

        let replay = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(400.0),
                None,
                &CancelFlag::new(),
            )
            .expect("replay succeeds");
        assert_eq!(outcome, replay);
    }

    #[test]
    fn glyph_runs_split_at_item_boundaries_even_with_identical_measure_styles() {
        // Two items sharing one interned style differ in nothing Parley
        // measures — exactly the shape of a pure paint change (a colored
        // span). The per-item brush must still keep their runs apart so a
        // paint consumer can map each run to its item by byte range.
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(0, tinos_style(0.0))
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "ab".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Text {
                        text: "cd".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(400.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let mut ranges = Vec::new();
        for line in &root.children {
            let Fragment::Line(line) = line else {
                panic!("children are lines");
            };
            for child in &line.children {
                if let Fragment::Text(run) = child {
                    ranges.push((run.text_start, run.text_end));
                }
            }
        }
        assert_eq!(ranges, vec![(0, 2), (2, 4)]);
    }

    #[test]
    fn glyph_runs_carry_monotonic_geometry_and_indent_offsets_the_first_run() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 32.0);
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        for (line_index, line) in root.children.iter().enumerate() {
            let Fragment::Line(line) = line else {
                panic!("children are lines");
            };
            assert!(line.trailing_whitespace >= 0.0);
            assert!(line.trailing_whitespace < line.rect.width);
            let mut previous_end = f64::NEG_INFINITY;
            for run in &line.children {
                let Fragment::Text(run) = run else {
                    panic!("line children are text fragments");
                };
                assert!(run.rect.width > 0.0);
                assert!(
                    run.rect.x >= previous_end - 0.01,
                    "runs must advance monotonically"
                );
                previous_end = run.rect.x + run.rect.width;
            }
            let Some(Fragment::Text(first_run)) = line.children.first() else {
                panic!("lines carry text fragments");
            };
            if line_index == 0 {
                assert!(
                    (first_run.rect.x - 32.0).abs() < 0.01,
                    "first line starts after the indent, got x = {}",
                    first_run.rect.x
                );
            } else {
                assert!(
                    first_run.rect.x.abs() < 0.01,
                    "continuation lines start at zero, got x = {}",
                    first_run.rect.x
                );
            }
        }
    }
}
