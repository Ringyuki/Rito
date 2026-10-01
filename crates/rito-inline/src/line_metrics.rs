//! `line-height: normal` geometry derived from font tables the way Blink
//! derives it, so every host lays out identical lines without measuring
//! anything itself.
//!
//! Blink reads each font's ascent, descent and line gap from Skia rounded
//! to whole pixels, splits the line gap with the floored half on top, and
//! sizes a line box from every inline box's primary font plus, under
//! `line-height: normal`, every font its text used. Ruby annotations
//! stack on em heights (the OS/2 typo metrics normalized to the em), and
//! a super/sub span's box rides its LayoutUnit shift. Each lookup is one
//! of the line shapes the line builder asks about ([`LineProbe`]).

use crate::*;

/// One line shape whose `line-height: normal` geometry the line builder
/// needs, laid out in a style at a size.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum LineProbe {
    /// An inline box's own strut: its primary font alone.
    Strut,
    /// A text run: the strut plus the font `char` resolves to.
    Text(char),
    /// A ruby over CJK or Latin base text, annotated in the same family.
    Ruby(RubyProbe),
    /// A line of strut text holding a raised or lowered span.
    Shifted(ShiftProbe),
}

/// A ruby line: `two_line` puts it on a second line under a line of CJK
/// text (Latin-mixed when `mixed_previous`), so its height shows how much
/// of the previous line's descent the annotation may reuse.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct RubyProbe {
    pub two_line: bool,
    pub latin_base: bool,
    pub mixed_previous: bool,
    /// Annotation size over base size, in ten-thousandths.
    pub ratio: u32,
    /// The annotation's own text; empty uses a sample of its script.
    pub annotation: String,
    pub cjk_annotation: bool,
}

/// A bold span at `ratio` of the strut size, raised (`superscript`) or
/// lowered by Blink's `vertical-align` shift, under the strut's used
/// line-height (`None` for `normal`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ShiftProbe {
    pub superscript: bool,
    /// Span size over strut size, in ten-thousandths.
    pub ratio: u32,
    /// The used line-height's bits.
    pub line_height: Option<u64>,
}

/// Quantizes a size ratio for a probe key.
pub(crate) fn probe_ratio(ratio: f64) -> u32 {
    (ratio * 10_000.0).round() as u32
}

/// `line-height: normal` geometry of one line shape.
///
/// A line box is built from these the way CSS builds one: every inline
/// box on the line contributes its own font's metrics, every text run
/// contributes the metrics of the font shaping resolved for it, and the
/// line takes the maximum ascent and the maximum descent.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NormalLineMetric {
    /// Line box height.
    pub height: f64,
    /// Baseline offset from the line box top.
    pub baseline: f64,
    /// The serving font's whole-pixel (ascent, descent): the basis Blink
    /// places fixed line-height baselines and selection boxes with. It
    /// differs from the normal-line envelope whenever the font carries a
    /// line gap.
    pub grid: (f64, f64),
}

impl NormalLineMetric {
    pub(crate) fn ascent(&self) -> f64 {
        self.baseline
    }

    pub(crate) fn descent(&self) -> f64 {
        self.height - self.baseline
    }

    /// Baseline of a fixed-height line: Blink floors the half-leading
    /// sum over the grid ascent and descent.
    pub(crate) fn fixed_baseline(&self, height: f64) -> f64 {
        let (ascent, descent) = self.grid;
        (ascent + (height - (ascent + descent)) / 2.0).floor()
    }
}

/// A face the collection serves: its blob and index.
#[derive(Clone)]
pub(crate) struct Face {
    blob: parley::fontique::Blob<u8>,
    index: u32,
}

impl Face {
    fn font_ref(&self) -> Option<skrifa::FontRef<'_>> {
        skrifa::FontRef::from_index(self.blob.as_ref(), self.index).ok()
    }

    fn same(&self, other: &Self) -> bool {
        self.blob.id() == other.blob.id() && self.index == other.index
    }

    /// Whole-pixel ascent, descent and line gap at `size`.
    fn rounded(&self, size: f64) -> (f64, f64, f64) {
        self.font_ref()
            .map_or((0.0, 0.0, 0.0), |font| rounded_metrics(&font, size))
    }

    /// The normal-line (ascent, descent): the line gap split with the
    /// floored half on top.
    fn normal(&self, size: f64) -> (f64, f64) {
        let (ascent, descent, gap) = self.rounded(size);
        let top = (gap / 2.0).floor();
        (ascent + top, descent + gap - top)
    }

    fn normalized_em(&self, size: f64) -> (f64, f64) {
        self.font_ref()
            .map_or((0.0, 0.0), |font| normalized_typo_height(&font, size))
    }
}

impl ParleyInlineContext {
    /// The style's `line-height: normal` geometry for one line shape.
    pub(crate) fn normal_line(
        &self,
        style: &InlineFormattingStyle,
        probe: &LineProbe,
    ) -> Option<NormalLineMetric> {
        self.normal_line_sized(style, f64::from(style.font.size.get()), probe)
    }

    /// The style's geometry at an explicit size — a ruby annotation rides
    /// the base family at its own size, a size no interned style carries.
    pub(crate) fn normal_line_sized(
        &self,
        style: &InlineFormattingStyle,
        size: f64,
        probe: &LineProbe,
    ) -> Option<NormalLineMetric> {
        let key = (family_key(style), size.to_bits(), probe.clone());
        if let Some(metric) = self.line_metrics.borrow().get(&key) {
            return *metric;
        }
        let metric = self.derive_line_metric(style, size, probe);
        self.line_metrics.borrow_mut().insert(key, metric);
        metric
    }

    fn derive_line_metric(
        &self,
        style: &InlineFormattingStyle,
        size: f64,
        probe: &LineProbe,
    ) -> Option<NormalLineMetric> {
        let primary = self.primary_face(style)?;
        let grid = |face: &Face| {
            let (ascent, descent, _) = face.rounded(size);
            (ascent, descent)
        };
        let (above, below, grid) = match probe {
            LineProbe::Strut => {
                let (above, below) = primary.normal(size);
                (above, below, grid(&primary))
            }
            LineProbe::Text(character) => {
                let face = self.char_face(style, size, false, *character, &primary);
                let (above, below) = envelope(&[&primary, &face], size);
                (above, below, grid(&face))
            }
            LineProbe::Ruby(ruby) => {
                let (above, below) = self.ruby_line(style, size, &primary, ruby);
                (above, below, grid(&primary))
            }
            LineProbe::Shifted(shift) => {
                let (above, below) = self.shifted_line(style, size, &primary, shift);
                (above, below, grid(&primary))
            }
        };
        Some(NormalLineMetric {
            height: above + below,
            baseline: above,
            grid,
        })
    }

    /// The ruby line's (above, below). One line: the base text's normal
    /// envelope, raised where the annotation's em stack over the base's
    /// em ascent reaches higher. Two lines: the second line grows by the
    /// annotation's overflow minus the space the first line leaves
    /// under its text.
    fn ruby_line(
        &self,
        style: &InlineFormattingStyle,
        size: f64,
        primary: &Face,
        ruby: &RubyProbe,
    ) -> (f64, f64) {
        let han = self.char_face(style, size, false, '\u{4E2D}', primary);
        let latin = self.char_face(style, size, false, 'a', primary);
        let base = if ruby.latin_base { &latin } else { &han };
        let annotation_size = size * f64::from(ruby.ratio) / 10_000.0;
        let annotation_text = match (ruby.annotation.is_empty(), ruby.cjk_annotation) {
            (false, _) => ruby.annotation.as_str(),
            (true, true) => "\u{3042}",
            (true, false) => "an",
        };
        let annotation_faces = self.used_faces(style, annotation_size, false, annotation_text);
        let base_em_ascent = em_height(&[base], primary, size).0;
        let (em_ascent, em_descent) = em_height(
            &annotation_faces.iter().collect::<Vec<_>>(),
            primary,
            annotation_size,
        );
        let annotation_top = base_em_ascent + em_ascent + em_descent;
        if !ruby.two_line {
            let (above, below) = envelope(&[primary, base], size);
            return (above.max(annotation_top), below);
        }
        let mut faces = vec![primary, &han, base];
        let mut previous = vec![&han];
        if ruby.mixed_previous {
            faces.push(&latin);
            previous.push(&latin);
        }
        let (above, below) = envelope(&faces, size);
        let line = above + below;
        let primary_descent = primary.rounded(size).1;
        let reusable = previous
            .iter()
            .map(|face| {
                (primary_descent - face.normalized_em(size).1)
                    .max(0.0)
                    .floor()
            })
            .fold(f64::INFINITY, f64::min);
        let space_under = line - (above + primary_descent - reusable);
        let overflow = (annotation_top - above).max(0.0);
        let shift = if space_under > 0.0 {
            (overflow - space_under).max(0.0)
        } else {
            overflow
        };
        (line + shift + above, line - above)
    }

    /// The (above, below) of strut text holding a bold `①` span at the
    /// probe's ratio, shifted the way Blink shifts `vertical-align:
    /// super`/`sub`: a third (a fifth) of the parent's LayoutUnit font
    /// size, plus one pixel.
    fn shifted_line(
        &self,
        style: &InlineFormattingStyle,
        size: f64,
        primary: &Face,
        shift: &ShiftProbe,
    ) -> (f64, f64) {
        let line_height = shift
            .line_height
            .map(|bits| layout_unit(f64::from_bits(bits)));
        let text = self.char_face(style, size, false, '\u{4E2D}', primary);
        let (root_above, root_below) = inline_box(primary, &text, size, line_height);
        let span_size = size * f64::from(shift.ratio) / 10_000.0;
        let marker = self.char_face(style, span_size, true, '\u{2460}', primary);
        let (span_above, span_below) = inline_box(primary, &marker, span_size, line_height);
        let parent = layout_unit(size);
        let offset = if shift.superscript {
            -(layout_unit_floor(parent / 3.0) + 1.0)
        } else {
            layout_unit_floor(parent / 5.0) + 1.0
        };
        (
            root_above.max(span_above - offset).max(0.0),
            root_below.max(span_below + offset).max(0.0),
        )
    }

    /// The style's primary font: the first family of its list the
    /// collection serves, else the default serif face.
    pub(crate) fn primary_face(&self, style: &InlineFormattingStyle) -> Option<Face> {
        self.primary_font(style)
            .map(|(blob, index)| Face { blob, index })
    }

    /// The face `character` resolves to in the style, as shaping
    /// resolves it; the primary face when nothing serves it.
    fn char_face(
        &self,
        style: &InlineFormattingStyle,
        size: f64,
        bold: bool,
        character: char,
        primary: &Face,
    ) -> Face {
        self.used_faces(style, size, bold, character.encode_utf8(&mut [0; 4]))
            .into_iter()
            .next()
            .unwrap_or_else(|| primary.clone())
    }

    /// The distinct faces shaping uses for `text` in the style's family
    /// list at `size`, upright, in order of first use.
    fn used_faces(
        &self,
        style: &InlineFormattingStyle,
        size: f64,
        bold: bool,
        text: &str,
    ) -> Vec<Face> {
        let mut fonts = self.fonts.borrow_mut();
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = layouts.ranged_builder(&mut fonts, text, 1.0, true);
        builder.push_default(StyleProperty::FontFamily(parley::FontFamily::Source(
            Cow::Owned(family_stack_source(style)),
        )));
        builder.push_default(StyleProperty::FontSize(shaping_font_size(size as f32)));
        builder.push_default(StyleProperty::FontWeight(parley::FontWeight::new(
            if bold { 700.0 } else { 400.0 },
        )));
        let mut layout = builder.build(text);
        layout.break_all_lines(None);
        let mut faces: Vec<Face> = Vec::new();
        for line in layout.lines() {
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(glyph_run) = item else {
                    continue;
                };
                let font = glyph_run.run().font();
                let face = Face {
                    blob: font.data.clone(),
                    index: font.index,
                };
                if !faces.iter().any(|seen| seen.same(&face)) {
                    faces.push(face);
                }
            }
        }
        faces
    }
}

/// The greatest normal-line ascent and descent among `faces`.
fn envelope(faces: &[&Face], size: f64) -> (f64, f64) {
    faces
        .iter()
        .fold((0.0_f64, 0.0_f64), |(above, below), face| {
            let (ascent, descent) = face.normal(size);
            (above.max(ascent), below.max(descent))
        })
}

/// Blink's `ComputeEmHeight`: the faces' normalized em ascents and
/// descents united, ceiled to whole pixels, capped by the primary font's
/// whole-pixel ascent and descent.
fn em_height(faces: &[&Face], primary: &Face, size: f64) -> (f64, f64) {
    let (ascent, descent) = faces.iter().fold((0.0_f64, 0.0_f64), |(a, d), face| {
        let (ascent, descent) = face.normalized_em(size);
        (a.max(ascent), d.max(descent))
    });
    let (primary_ascent, primary_descent, _) = primary.rounded(size);
    (
        ascent.ceil().min(primary_ascent),
        descent.ceil().min(primary_descent),
    )
}

/// An inline box's (above, below) the way Blink computes it: the primary
/// font's whole-pixel ascent and descent with the leading of the used
/// line-height split floored on top; under `normal` the font its text
/// used joins with its own line gap as leading.
fn inline_box(primary: &Face, text: &Face, size: f64, line_height: Option<f64>) -> (f64, f64) {
    let (ascent, descent, gap) = primary.rounded(size);
    let height = line_height.unwrap_or(ascent + descent + gap);
    let top = ((height - (ascent + descent)) / 2.0).floor();
    let (above, below) = (ascent + top, height - ascent - top);
    if line_height.is_some() {
        return (above, below);
    }
    let (text_above, text_below) = text.normal(size);
    (above.max(text_above), below.max(text_below))
}

/// A face's whole-pixel ascent, descent and line gap at `size`, the way
/// Skia hands them to Blink's `FontMetrics`: the hhea metrics (the OS/2
/// typo metrics when the face sets USE_TYPO_METRICS), each rounded.
pub(crate) fn rounded_metrics(font_ref: &skrifa::FontRef<'_>, size: f64) -> (f64, f64, f64) {
    use skrifa::raw::TableProvider as _;
    let Ok(head) = font_ref.head() else {
        return (0.0, 0.0, 0.0);
    };
    let upem = f64::from(head.units_per_em());
    if upem <= 0.0 {
        return (0.0, 0.0, 0.0);
    }
    let use_typo = font_ref.os2().ok().is_some_and(|os2| {
        os2.fs_selection()
            .contains(skrifa::raw::tables::os2::SelectionFlags::USE_TYPO_METRICS)
    });
    let (ascent, descent, gap) = match (use_typo, font_ref.os2(), font_ref.hhea()) {
        (true, Ok(os2), _) => (
            f64::from(os2.s_typo_ascender()),
            -f64::from(os2.s_typo_descender()),
            f64::from(os2.s_typo_line_gap()),
        ),
        (_, _, Ok(hhea)) => (
            f64::from(hhea.ascender().to_i16()),
            -f64::from(hhea.descender().to_i16()),
            f64::from(hhea.line_gap().to_i16()),
        ),
        _ => return (0.0, 0.0, 0.0),
    };
    let scale = |units: f64| (units * size / upem + 0.5).floor();
    (scale(ascent), scale(descent), scale(gap))
}

/// The OS/2 typo ascent and descent of a face at `size`, normalized so
/// they sum to the em and each rounded onto the 1/64 grid (Chromium's
/// `NormalizedTypoAscentAndDescent`); a face without usable typo metrics
/// normalizes its whole-pixel ascent and descent instead.
pub(crate) fn normalized_typo_height(font_ref: &skrifa::FontRef<'_>, size: f64) -> (f64, f64) {
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
        None => {
            let (ascent, descent, _) = rounded_metrics(font_ref, size);
            (ascent, descent)
        }
    };
    let height = ascent + descent;
    if height <= 0.0 || ascent < 0.0 || ascent > height {
        return (0.0, 0.0);
    }
    let normalized_ascent = layout_unit(ascent * size / height);
    (normalized_ascent, layout_unit(size) - normalized_ascent)
}

/// Floors a length onto the 1/64 px grid, the way LayoutUnit division
/// truncates.
fn layout_unit_floor(value: f64) -> f64 {
    (value * 64.0).floor() / 64.0
}

/// Serializes a computed family list into a cache key.
pub(crate) fn family_key(style: &InlineFormattingStyle) -> String {
    family_stack_source(style)
}
