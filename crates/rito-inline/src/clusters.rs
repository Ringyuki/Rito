//! Where each cluster of a painted run sits: the origins the browser's
//! pen steps to from the run's start, so the renderer draws every cluster
//! where layout put it instead of shaping the run again.
//!
//! The step from one cluster to the next is its bare glyph advance on the
//! browser's 16.16 fixed-point scale, plus the spacing layout folded into
//! it (author letter and word spacing, a trim, a box gap, a ruby gap),
//! plus the justify share the line gave it. Two accumulation laws, both measured against
//! pinned Chromium: an all-CJK run at a fractional font size lands every
//! cluster on the 1/64 CSS-pixel grid (floor of the running sum: 21 of 21
//! positions on a 12.16px line), and everything else accumulates in float
//! the way the browser's own text pen does, so a kerned Latin word's
//! sub-pixel phases match its raster.

use rito_fragment::ClusterPosition;
use rito_style_contract::{InlineFormattingStyle, LengthPercentage};

use crate::*;

/// The cluster origins of one piece of a laid-out paragraph, relative to
/// the piece's start, and where the pen rests after the last of them.
pub(crate) struct PieceClusters {
    pub positions: Vec<ClusterPosition>,
    /// Whether the painter floors the absolute positions onto the 1/64
    /// grid.
    pub grid: bool,
    /// The pen's position after the last cluster, from the piece's start,
    /// accumulated under the same law as the positions.
    pub advance: f64,
}

/// The cluster origins of the piece `range` of a laid-out paragraph.
/// `halt_trims` are the openers shaped with the `halt` half-width
/// variant: the painter draws the untrimmed glyph, whose outline sits one
/// blank half further right, so such a cluster's origin moves left by its
/// half while the clusters after it keep the trimmed advance layout
/// stepped by.
pub(crate) fn piece_clusters(
    layout: &parley::Layout<[u8; 4]>,
    flow_text: &str,
    range: std::ops::Range<usize>,
    spacing_edits: &SpacingEdits,
    justify_px: f64,
    halt_trims: &[(std::ops::Range<usize>, f64)],
    word_spacing: bool,
) -> PieceClusters {
    let mut steps: Vec<(u32, f64, f64)> = Vec::new();
    let mut font_size = 0.0_f64;
    let mut cluster = parley::layout::Cluster::from_byte_index(layout, range.start);
    while let Some(current) = cluster {
        let text_range = current.text_range();
        if text_range.start >= range.end {
            break;
        }
        if steps.is_empty() {
            font_size = f64::from(current.run().font_size());
        }
        let step = hb_fixed_cluster_advance(&current, folded_spacing(spacing_edits, &current))
            + justify_px;
        let trim = halt_trims
            .iter()
            .find(|(trimmed, _)| *trimmed == text_range)
            .map_or(0.0, |(_, half)| *half);
        steps.push((text_range.start as u32, step, trim));
        cluster = current.next_logical();
    }
    let text = flow_text.get(range).unwrap_or_default();
    let grid = !word_spacing
        && (font_size * 64.0).fract() != 0.0
        && !text.is_empty()
        && text.chars().all(is_cjk_cluster_char);
    let mut positions = Vec::with_capacity(steps.len());
    let advance = if grid {
        let mut cumulative = 0.0_f64;
        for (byte, step, trim) in steps {
            positions.push(ClusterPosition {
                byte,
                x: cumulative - trim,
            });
            cumulative += step;
        }
        cumulative
    } else {
        let mut pen = 0.0_f32;
        for (byte, step, trim) in steps {
            positions.push(ClusterPosition {
                byte,
                x: f64::from(pen) - trim,
            });
            pen += step as f32;
        }
        f64::from(pen)
    };
    PieceClusters {
        positions,
        grid,
        advance,
    }
}

/// The spacing layout folded into `cluster`'s advance: the letter
/// spacing its range was last pushed with (author spacing, a trim, a box
/// gap, a ruby share — the last push wins) plus, on a space cluster
/// only, its word spacing — what the browser's pen adds OUTSIDE the
/// fixed-point glyph advance.
pub(crate) fn folded_spacing<B: parley::style::Brush>(
    spacing_edits: &SpacingEdits,
    cluster: &parley::layout::Cluster<'_, B>,
) -> f64 {
    let text_range = cluster.text_range();
    let folded_in = |edits: &[(std::ops::Range<usize>, f32)]| {
        edits
            .iter()
            .rev()
            .find(|(edited, _)| edited.contains(&text_range.start))
            .map_or(0.0, |(_, spacing)| f64::from(*spacing))
    };
    folded_in(&spacing_edits.letter)
        + if cluster.is_space_or_nbsp() {
            folded_in(&spacing_edits.word)
        } else {
            0.0
        }
}

/// A string shaped on its own in one style — an outside list marker, a
/// ruby annotation — as the engine places it: its advance and where
/// every cluster sits from its start.
#[derive(Clone, Debug, PartialEq)]
pub struct MeasuredRun {
    /// The pen's advance over the whole string: the cluster steps
    /// accumulated under the same law as the origins (what the browser's
    /// text pen measures the string at).
    pub advance: f64,
    /// Every cluster's origin from the string's start, in text order
    /// (byte offset into the string, CSS x).
    pub clusters: Vec<ClusterPosition>,
    /// Whether the painter floors the absolute origins onto the 1/64 grid.
    pub grid: bool,
}

impl MeasuredRun {
    /// The inline size the browser's layout gives a box holding the
    /// string: the advance quantized onto the 1/64 CSS-px grid, ceiling.
    pub fn box_inline_size(&self) -> f64 {
        layout_unit_ceil(self.advance)
    }
}

impl ParleyInlineContext {
    /// Shapes `text` in `style` as one line and measures it the way a
    /// painted run is placed: each cluster's origin under the cluster
    /// laws above, with the style's own letter and word spacing folded in
    /// and no justification.
    pub fn measure_run(&self, style: &InlineFormattingStyle, text: &str) -> MeasuredRun {
        self.shaped_run(style, None, true, text)
    }

    /// Shapes a ruby annotation: `text` in the base's `style` at the
    /// annotation's own size, with the base's letter and word spacing
    /// off (an annotation ignores its base's spacing; the browser's
    /// annotation pen draws it packed and distributes the free width by
    /// `ruby-align` afterwards), and measures where its line sits over
    /// the base `base_text` shaped in `style`: Chromium places the
    /// annotation line so that its em-height descent rests on the base's
    /// em-height ascent (LayoutNG `RubyBlockPositionCalculator`), each
    /// em height the fonts' OS/2 typo ascent and descent normalized to
    /// the em, united over the fonts the text used, ceiled to whole
    /// pixels and capped by the style's primary font's rounded ascent and
    /// descent (`ComputeEmHeight`). Measured on two books: a base whose
    /// primary font is the Latin pin over a CJK fallback and a Latin
    /// annotation sit 16px apart; a book face's 8.8px annotation 15px.
    pub fn measure_ruby_annotation(
        &self,
        style: &InlineFormattingStyle,
        annotation_size: f32,
        base_text: &str,
        text: &str,
    ) -> MeasuredRuby {
        let run = self.shaped_run(style, Some(annotation_size), false, text);
        let base = self.em_height(style, None, base_text);
        let annotation = self.em_height(style, Some(annotation_size), text);
        MeasuredRuby {
            run,
            over_offset: base.ascent + annotation.descent,
            em_ascent: annotation.primary_typo_ascent,
        }
    }

    /// The em height of `text` shaped in `style` (at `size_override`
    /// when given), the way Chromium's line layout reads it for ruby
    /// placement: the OS/2 typo ascent and descent of every font the text
    /// used, normalized so they sum to the em (`SimpleFontData::
    /// NormalizedTypoAscentAndDescent`, each rounded onto the 1/64 grid),
    /// united, ceiled to whole pixels, and capped by the primary font's
    /// platform ascent and descent — the hhea metrics (typo when the
    /// face asks for them) rounded to whole pixels the way Skia reports
    /// them to Blink.
    fn em_height(
        &self,
        style: &InlineFormattingStyle,
        size_override: Option<f32>,
        text: &str,
    ) -> EmHeight {
        let size = f64::from(size_override.unwrap_or(style.font.size.get()));
        let mut united = (0.0_f64, 0.0_f64);
        if !text.is_empty() {
            let mut sized;
            let shaped_style = match size_override
                .and_then(|size| rito_style_contract::NonNegativeCssPx::new(size).ok())
            {
                Some(size) => {
                    sized = style.clone();
                    sized.font.size = size;
                    &sized
                }
                None => style,
            };
            let mut fonts = self.fonts.borrow_mut();
            let mut layouts = self.layouts.borrow_mut();
            let mut builder =
                SpacingBuilder::new(layouts.ranged_builder(&mut fonts, text, 1.0, true));
            push_item_styles(&mut builder, shaped_style, 0..text.len());
            let (mut layout, _) = builder.build(text);
            layout.break_all_lines(None);
            let mut seen: Vec<(u64, u32)> = Vec::new();
            for line in layout.lines() {
                for item in line.items() {
                    let parley::PositionedLayoutItem::GlyphRun(glyph_run) = item else {
                        continue;
                    };
                    let font = glyph_run.run().font();
                    let key = (font.data.id(), font.index);
                    if seen.contains(&key) {
                        continue;
                    }
                    seen.push(key);
                    let Ok(font_ref) = skrifa::FontRef::from_index(font.data.as_ref(), font.index)
                    else {
                        continue;
                    };
                    let (ascent, descent) = normalized_typo_height(&font_ref, size);
                    united.0 = united.0.max(ascent);
                    united.1 = united.1.max(descent);
                }
            }
        }
        let (primary_ascent, primary_descent, primary_typo_ascent) = self
            .primary_font(style)
            .and_then(|(blob, index)| {
                let font_ref = skrifa::FontRef::from_index(blob.as_ref(), index).ok()?;
                let (ascent, descent) = platform_ascent_descent(&font_ref, size);
                let (typo_ascent, _) = normalized_typo_height(&font_ref, size);
                Some((ascent, descent, typo_ascent))
            })
            .unwrap_or((f64::INFINITY, f64::INFINITY, 0.0));
        EmHeight {
            ascent: united.0.ceil().min(primary_ascent),
            descent: united.1.ceil().min(primary_descent),
            primary_typo_ascent,
        }
    }

    /// The style's primary font — the first family of its list the
    /// collection can serve (a named face that is registered, or the
    /// first face behind a generic), the face Chromium reads platform
    /// metrics from.
    fn primary_font(
        &self,
        style: &InlineFormattingStyle,
    ) -> Option<(parley::fontique::Blob<u8>, u32)> {
        use parley::fontique::GenericFamily;
        let mut fonts = self.fonts.borrow_mut();
        let parley::FontContext {
            collection,
            source_cache,
        } = &mut *fonts;
        for family in style.font.families.iter() {
            let id = match family {
                FontFamily::Named(name) => collection.family_id(name.as_str()),
                FontFamily::Generic(generic) => collection
                    .generic_families(match generic {
                        GenericFontFamily::Serif => GenericFamily::Serif,
                        GenericFontFamily::SansSerif => GenericFamily::SansSerif,
                        GenericFontFamily::Monospace => GenericFamily::Monospace,
                        GenericFontFamily::Cursive => GenericFamily::Cursive,
                        GenericFontFamily::Fantasy => GenericFamily::Fantasy,
                        GenericFontFamily::SystemUi => GenericFamily::SystemUi,
                    })
                    .next(),
            };
            let Some(id) = id else {
                continue;
            };
            let Some(info) = collection.family(id) else {
                continue;
            };
            let Some(font) = info.default_font() else {
                continue;
            };
            let index = font.index();
            if let Some(blob) = font.load(Some(source_cache)) {
                return Some((blob, index));
            }
        }
        None
    }

    fn shaped_run(
        &self,
        style: &InlineFormattingStyle,
        size_override: Option<f32>,
        spacing: bool,
        text: &str,
    ) -> MeasuredRun {
        if text.is_empty() {
            return MeasuredRun {
                advance: 0.0,
                clusters: Vec::new(),
                grid: false,
            };
        }
        let mut sized;
        let style = match size_override
            .and_then(|size| rito_style_contract::NonNegativeCssPx::new(size).ok())
        {
            Some(size) => {
                sized = style.clone();
                sized.font.size = size;
                &sized
            }
            None => style,
        };
        let mut fonts = self.fonts.borrow_mut();
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = SpacingBuilder::new(layouts.ranged_builder(&mut fonts, text, 1.0, true));
        push_item_styles(&mut builder, style, 0..text.len());
        if !spacing {
            // Later pushes win: the style's spacing, pushed above, is
            // overridden to zero over the whole string.
            builder.push(parley::StyleProperty::LetterSpacing(0.0), 0..text.len());
            builder.push(parley::StyleProperty::WordSpacing(0.0), 0..text.len());
        }
        let (mut layout, spacing_edits) = builder.build(text);
        layout.break_all_lines(None);
        let word_spacing = spacing
            && matches!(
                style.text_flow.word_spacing,
                LengthPercentage::Length(px) if px.get() != 0.0
            );
        let piece = piece_clusters(
            &layout,
            text,
            0..text.len(),
            &spacing_edits,
            0.0,
            &[],
            word_spacing,
        );
        MeasuredRun {
            advance: piece.advance,
            clusters: piece.positions,
            grid: piece.grid,
        }
    }
}

/// A ruby annotation shaped for painting: its clusters and where its
/// line sits over the base.
#[derive(Clone, Debug, PartialEq)]
pub struct MeasuredRuby {
    /// The annotation string shaped at its own size.
    pub run: MeasuredRun,
    /// How far above the base's alphabetic baseline the annotation's
    /// alphabetic baseline sits (CSS px): the base's em-height ascent
    /// plus the annotation's em-height descent, whole pixels in every
    /// measured case.
    pub over_offset: f64,
    /// The annotation's em-box top above its alphabetic baseline at its
    /// size: its primary font's OS/2 typo ascent normalized to the em
    /// (what a browser canvas's `textBaseline: 'top'` resolves to).
    pub em_ascent: f64,
}

/// A run's em height on Chromium's terms (see
/// [`ParleyInlineContext::measure_ruby_annotation`]).
struct EmHeight {
    ascent: f64,
    descent: f64,
    primary_typo_ascent: f64,
}

/// The OS/2 typo ascent and descent of a face at `size`, normalized so
/// they sum to the em and each rounded onto the 1/64 grid (Chromium's
/// `NormalizedTypoAscentAndDescent`); a face without usable typo metrics
/// normalizes its platform ascent and descent instead.
fn normalized_typo_height(font_ref: &skrifa::FontRef<'_>, size: f64) -> (f64, f64) {
    use skrifa::raw::TableProvider as _;
    let typo = font_ref
        .os2()
        .ok()
        .map(|os2| {
            (
                f64::from(os2.s_typo_ascender()),
                -f64::from(os2.s_typo_descender()),
            )
        })
        .filter(|(ascent, _)| *ascent > 0.0);
    let (ascent, descent) = match typo {
        Some(pair) => pair,
        None => platform_ascent_descent(font_ref, size),
    };
    let height = ascent + descent;
    if height <= 0.0 || ascent < 0.0 || ascent > height {
        return (0.0, 0.0);
    }
    let normalized_ascent = layout_unit(ascent * size / height);
    (normalized_ascent, layout_unit(size) - normalized_ascent)
}

/// A face's platform ascent and descent at `size`: the hhea metrics (the
/// OS/2 typo metrics when the face sets USE_TYPO_METRICS), each rounded
/// to a whole pixel the way Skia hands them to Blink's `FontMetrics`.
fn platform_ascent_descent(font_ref: &skrifa::FontRef<'_>, size: f64) -> (f64, f64) {
    use skrifa::raw::TableProvider as _;
    let Ok(head) = font_ref.head() else {
        return (0.0, 0.0);
    };
    let upem = f64::from(head.units_per_em());
    if upem <= 0.0 {
        return (0.0, 0.0);
    }
    let use_typo = font_ref.os2().ok().is_some_and(|os2| {
        os2.fs_selection()
            .contains(skrifa::raw::tables::os2::SelectionFlags::USE_TYPO_METRICS)
    });
    let (ascent, descent) = match (use_typo, font_ref.os2(), font_ref.hhea()) {
        (true, Ok(os2), _) => (
            f64::from(os2.s_typo_ascender()),
            -f64::from(os2.s_typo_descender()),
        ),
        (_, _, Ok(hhea)) => (
            f64::from(hhea.ascender().to_i16()),
            -f64::from(hhea.descender().to_i16()),
        ),
        _ => return (0.0, 0.0),
    };
    let scale = |units: f64| (units * size / upem + 0.5).floor();
    (scale(ascent), scale(descent))
}

/// The CJK blocks whose clusters shape one to one with no kerning, plus
/// the middle dot that rides between ideographs the same way.
fn is_cjk_cluster_char(character: char) -> bool {
    matches!(
        u32::from(character),
        0xB7 | 0x2E80..=0x9FFF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF | 0x20000..=0x3FFFF
    )
}
