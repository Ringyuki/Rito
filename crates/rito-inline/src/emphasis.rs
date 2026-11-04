//! Emphasis marks on a line, as Blink sizes them. A mark is set in its
//! face at half the text's size, rounded to a whole pixel, and stands
//! that far outside the em box of the text it marks. A line's annotation
//! extent — how far its marks reach past its box, and how much room its
//! box leaves past the em boxes of its text — is Blink's
//! `ComputeAnnotationOverflow`, each text item's em box its text box drawn
//! in by its fonts' normalized typo metrics
//! (`AdjustTextOverUnderOffsetsForEmHeight`).

use rito_fragment::FontFaceId;
use rito_style_contract::{LineSide, StyleId};

use crate::*;

/// How far a line's annotations reach past its box, and how much room its
/// box leaves past the em boxes of its text, on each side (Blink's
/// `AnnotationMetrics`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct LineAnnotationExtent {
    pub(crate) overflow_over: f64,
    pub(crate) overflow_under: f64,
    pub(crate) space_over: f64,
    pub(crate) space_under: f64,
}

/// One text item's em box on a line, from the line top, reaching out to
/// its emphasis marks on the side they stand.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ItemAnnotationBox {
    pub(crate) over: f64,
    pub(crate) under: f64,
    pub(crate) marks: Option<LineSide>,
}

/// The size an emphasis mark is set at: half the text's size rounded to a
/// whole pixel (Blink's `kEmphasisMarkFontSizeMultiplier`, `lroundf`). It
/// is also the mark's height, the mark face's normalized typo ascent and
/// descent summing to its em.
pub fn emphasis_mark_size(font_size: f32) -> f32 {
    (font_size * 0.5).round()
}

/// The annotation extent of a line `height` tall whose baseline sits
/// `baseline` below its top, holding `items`; `font_size` is the line's
/// own (its strut's) size, the content a line with too little text still
/// secures around its centre.
pub(crate) fn line_annotation_extent(
    items: &[ItemAnnotationBox],
    baseline: f64,
    height: f64,
    font_size: f64,
) -> LineAnnotationExtent {
    let mut content_over = baseline;
    let mut content_under = baseline;
    let mut marks_over = false;
    let mut marks_under = false;
    for item in items {
        content_over = content_over.min(item.over);
        content_under = content_under.max(item.under);
        match item.marks {
            Some(LineSide::Over) => marks_over = true,
            Some(LineSide::Under) => marks_under = true,
            None => {}
        }
    }
    if content_under - content_over < font_size {
        // LayoutUnit halving: the 1/64 units' difference, divided and
        // truncated.
        let leading = (height * 64.0).round() - (font_size * 64.0).trunc();
        let half_leading = ((leading / 2.0).trunc() / 64.0).max(0.0);
        content_over = half_leading;
        content_under = height - half_leading;
    }
    // Text taller than its line overflows the box only through marks.
    if content_over < 0.0 && !marks_over {
        content_over = 0.0;
    }
    if content_under > height && !marks_under {
        content_under = height;
    }
    LineAnnotationExtent {
        overflow_over: (-content_over).max(0.0),
        overflow_under: (content_under - height).max(0.0),
        space_over: content_over.max(0.0),
        space_under: (height - content_under).max(0.0),
    }
}

/// Each text item's em box offsets from its baseline, per style and the
/// faces its text was shaped with: one flow's lines mostly repeat them.
#[derive(Default)]
pub(crate) struct EmBoxes {
    kept: Vec<(EmBoxKey, Option<(f64, f64)>)>,
}

/// A text item's style and the faces its text was shaped with.
type EmBoxKey = (StyleId, Vec<FontFaceId>);

impl ParleyInlineContext {
    /// The em boxes of a line's text items, from the line top, each
    /// reaching out to its emphasis marks: an item's baseline is the
    /// line's `baseline` less its own shift, its faces those its glyph
    /// runs on the line were shaped with.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn line_annotation_boxes(
        &self,
        line: &parley::Line<'_, [u8; 4]>,
        items: &[InlineItem],
        item_ranges: &[std::ops::Range<usize>],
        item_shifts: &[f64],
        styles: &rito_fragment::FormattingTreeStyles,
        baseline: f64,
        em_boxes: &mut EmBoxes,
    ) -> Vec<ItemAnnotationBox> {
        let mut segments: Vec<(usize, Vec<FontFaceId>)> = Vec::new();
        for run in line.style_runs() {
            // Each style run's brush is its item's index.
            let parley::LineStyleRun::Glyphs { run, style } = run else {
                continue;
            };
            let index = u32::from_le_bytes(style.brush) as usize;
            if item_ranges.get(index).is_none_or(|range| range.is_empty()) {
                continue;
            }
            let face = self.catalog.face_id(run.font());
            match segments.iter_mut().find(|(item, _)| *item == index) {
                Some((_, faces)) if !faces.contains(&face) => faces.push(face),
                Some(_) => {}
                None => segments.push((index, vec![face])),
            }
        }
        segments
            .into_iter()
            .filter_map(|(index, mut faces)| {
                let InlineItem::Text { style: id, .. } = items.get(index)? else {
                    return None;
                };
                let style = styles.inline.style(*id).ok()?;
                faces.sort_unstable();
                let key = (*id, faces);
                let offsets = match em_boxes.kept.iter().find(|(kept, _)| *kept == key) {
                    Some((_, offsets)) => *offsets,
                    None => {
                        let offsets = self.em_box_offsets(style, &key.1);
                        em_boxes.kept.push((key, offsets));
                        offsets
                    }
                }?;
                let item_baseline = baseline - item_shifts.get(index).copied().unwrap_or(0.0);
                let mut over = item_baseline + offsets.0;
                let mut under = item_baseline + offsets.1;
                let marks = style.text_flow.text_emphasis.as_ref().map(|emphasis| {
                    let height = f64::from(emphasis_mark_size(style.font.size.get()));
                    match emphasis.side {
                        LineSide::Over => over -= height,
                        LineSide::Under => under += height,
                    }
                    emphasis.side
                });
                Some(ItemAnnotationBox { over, under, marks })
            })
            .collect()
    }

    /// The em box of text in `style` shaped with `faces`, as offsets from
    /// its baseline (over negative): its text box drawn in on each side by
    /// the least inset of its faces (see [`MeasuredEmphasis::em_insets`]).
    pub(crate) fn em_box_offsets(
        &self,
        style: &InlineFormattingStyle,
        faces: &[FontFaceId],
    ) -> Option<(f64, f64)> {
        let basis = self.em_basis(style)?;
        let (over, under) = least_insets(
            faces
                .iter()
                .filter_map(|face| self.em_insets(&basis, *face)),
        );
        Some((-basis.above + over, basis.below - under))
    }

    /// What every em box of text in `style` is drawn from.
    fn em_basis(&self, style: &InlineFormattingStyle) -> Option<EmBasis> {
        let size = f64::from(style.font.size.get());
        let baseline = LineBaseline::of(style);
        let (ascent, descent, _) = self.primary_face(style)?.rounded(size);
        let (above, below) = baseline.split(ascent, descent);
        // Around the central baseline the primary ascent compared is half
        // the font's height, not the whole-pixel half the text box takes.
        let primary_ascent = match baseline {
            LineBaseline::Alphabetic => ascent,
            LineBaseline::Central => ((ascent + descent) * 32.0).trunc() / 64.0,
        };
        Some(EmBasis {
            size,
            baseline,
            above,
            below,
            primary_ascent,
            primary_descent: above + below - primary_ascent,
        })
    }

    /// How far `face`'s em box sits inside the text box `basis` gives, over
    /// and under: the whole pixels the primary font's ascent and descent
    /// exceed the face's normalized typo ascent and descent.
    fn em_insets(&self, basis: &EmBasis, face: FontFaceId) -> Option<(f64, f64)> {
        let face = self.catalog.face_font(face)?;
        let (em_ascent, em_descent) = basis.baseline.em_box(&face.font_ref()?, basis.size);
        Some((
            (basis.primary_ascent - em_ascent).max(0.0).floor(),
            (basis.primary_descent - em_descent).max(0.0).floor(),
        ))
    }

    /// The emphasis mark text in `style` takes, measured for painting;
    /// `None` when the style takes none or no face serves the mark.
    pub fn measure_emphasis_mark(&self, style: &InlineFormattingStyle) -> Option<MeasuredEmphasis> {
        use skrifa::MetadataProvider as _;
        let emphasis = style.text_flow.text_emphasis.as_ref()?;
        // The mark is shaped with the text's font at the text's size; its
        // first glyph's face sets it, at the mark's own size.
        let run = self.shaped_run_with(style, None, false, None, &emphasis.mark);
        let face_id = run.clusters.first()?.face;
        let face = self.catalog.face_font(face_id)?;
        let font = face.font_ref()?;
        let size = f64::from(emphasis_mark_size(style.font.size.get()));
        let (ascent, descent) = normalized_typo_height(&font, size);
        let character = emphasis.mark.chars().next()?;
        let upright = shapes_top_to_bottom(style, character);
        let glyph = font.charmap().map(character)?;
        let glyph = if upright {
            vertical_form(&font, glyph)
        } else {
            glyph
        };
        let ink_center = outline_center(&font, glyph, size)?;
        // An upright glyph's blob sits off the point by its face's ascent
        // over its central-baseline ascent (half its whole-pixel height).
        let (mark_ascent, mark_descent, _) = rounded_metrics(&font, size);
        let upright_offset = if upright {
            (mark_ascent - mark_descent) / 2.0
        } else {
            0.0
        };
        let basis = self.em_basis(style)?;
        let em_insets = (0..self.catalog.aliases().len())
            .filter_map(|index| {
                let face = FontFaceId(u32::try_from(index).ok()?);
                let (over, under) = self.em_insets(&basis, face)?;
                Some((face, over, under))
            })
            .collect();
        Some(MeasuredEmphasis {
            mark: emphasis.mark.clone(),
            side: emphasis.side,
            face: face_id,
            size,
            ascent,
            descent,
            ink_center,
            upright,
            upright_offset,
            text_box: (basis.above, basis.below),
            em_insets,
        })
    }
}

/// The text box of text in one style and what its em box is measured
/// against: the primary font's whole-pixel ascent and descent from the
/// line's baseline, and its ascent and descent as Blink's
/// `AdjustTextOverUnderOffsetsForEmHeight` compares them.
struct EmBasis {
    size: f64,
    baseline: LineBaseline,
    above: f64,
    below: f64,
    primary_ascent: f64,
    primary_descent: f64,
}

/// The least of several faces' em insets, over and under; none inset
/// nothing.
fn least_insets(insets: impl Iterator<Item = (f64, f64)>) -> (f64, f64) {
    let (over, under) = insets.fold((f64::INFINITY, f64::INFINITY), |(over, under), inset| {
        (over.min(inset.0), under.min(inset.1))
    });
    (
        if over.is_finite() { over } else { 0.0 },
        if under.is_finite() { under } else { 0.0 },
    )
}

/// The centre of a glyph's outline at `size`, from its origin, y down:
/// the bounds of every point its outline is drawn through, control points
/// included (Skia's path bounds, which Blink centres a mark on).
fn outline_center(
    font: &skrifa::FontRef<'_>,
    glyph: skrifa::GlyphId,
    size: f64,
) -> Option<(f64, f64)> {
    use skrifa::outline::{DrawSettings, OutlinePen};
    use skrifa::MetadataProvider as _;
    #[derive(Default)]
    struct Bounds(Option<[f32; 4]>);
    impl Bounds {
        fn add(&mut self, x: f32, y: f32) {
            let bounds = self.0.get_or_insert([x, y, x, y]);
            *bounds = [
                bounds[0].min(x),
                bounds[1].min(y),
                bounds[2].max(x),
                bounds[3].max(y),
            ];
        }
    }
    impl OutlinePen for Bounds {
        fn move_to(&mut self, x: f32, y: f32) {
            self.add(x, y);
        }
        fn line_to(&mut self, x: f32, y: f32) {
            self.add(x, y);
        }
        fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
            self.add(cx0, cy0);
            self.add(x, y);
        }
        fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
            self.add(cx0, cy0);
            self.add(cx1, cy1);
            self.add(x, y);
        }
        fn close(&mut self) {}
    }
    let outline = font.outline_glyphs().get(glyph)?;
    let mut bounds = Bounds::default();
    outline
        .draw(
            DrawSettings::unhinted(
                skrifa::instance::Size::new(size as f32),
                skrifa::instance::LocationRef::default(),
            ),
            &mut bounds,
        )
        .ok()?;
    let [left, bottom, right, top] = bounds.0?;
    Some((
        f64::from(left + right) / 2.0,
        -f64::from(bottom + top) / 2.0,
    ))
}

/// An emphasis mark measured for painting: the mark, the face and size it
/// is set in, and where it stands from the text it marks.
#[derive(Clone, Debug, PartialEq)]
pub struct MeasuredEmphasis {
    /// The mark string; its first glyph is what paints.
    pub mark: std::sync::Arc<str>,
    /// The side of the line the marks stand on.
    pub side: LineSide,
    /// The face the mark's first glyph was shaped with.
    pub face: FontFaceId,
    /// The size the mark is set at.
    pub size: f64,
    /// The mark face's normalized typo ascent and descent at that size.
    pub ascent: f64,
    pub descent: f64,
    /// The centre of the mark glyph's outline from its origin (y down):
    /// its vertical form when it stands upright in a vertical line.
    pub ink_center: (f64, f64),
    /// Whether the mark stands upright in a vertical line; otherwise it
    /// lies with a vertical line's text, turned a quarter.
    pub upright: bool,
    /// How far towards the line-over side of the point an upright mark's
    /// outline centres: its face's whole-pixel ascent less its ascent from
    /// the central baseline, half the face's whole-pixel height (Blink's
    /// vertical baseline offset of an upright glyph run). Zero otherwise.
    pub upright_offset: f64,
    /// The marked text's text box from its baseline, (above, below): its
    /// primary font's whole-pixel ascent and descent, split around the
    /// central baseline in a vertical line.
    pub text_box: (f64, f64),
    /// Per face the text may be shaped with, how far its em box sits
    /// inside the text box, over and under, in whole pixels; text shaped
    /// with several faces takes the least of each.
    pub em_insets: Vec<(FontFaceId, f64, f64)>,
}

impl MeasuredEmphasis {
    /// How far from the marked text's baseline, towards the side the marks
    /// stand on, the point the marks hang from lies for text shaped with
    /// `faces`: outside its em box by the mark's typo descent (over) or
    /// ascent (under), ceiled to a whole pixel (Blink's
    /// `TextPainter::SetEmphasisMark`). A horizontal line's mark sits on
    /// that point's baseline; an upright mark in a vertical line centres
    /// its outline on it.
    pub fn distance(&self, faces: impl Iterator<Item = FontFaceId>) -> f64 {
        let (over, under) = least_insets(faces.filter_map(|face| {
            self.em_insets
                .iter()
                .find(|(inset_face, _, _)| *inset_face == face)
                .map(|(_, over, under)| (*over, *under))
        }));
        match self.side {
            LineSide::Over => self.text_box.0 - over + self.descent.ceil(),
            LineSide::Under => self.text_box.1 - under + self.ascent.ceil(),
        }
    }
}

/// Whether a character takes an emphasis mark: not a separator, control,
/// format or unassigned character, nor punctuation other than the few
/// symbols CSS lists (Blink's `CanReceiveTextEmphasis`).
pub fn takes_emphasis_mark(character: char) -> bool {
    use icu_properties::props::GeneralCategory as Category;
    use icu_properties::CodePointMapData;
    if matches!(
        character,
        '\u{1361}' | '\u{10100}' | '\u{10101}' | '\u{1039F}' | '\u{0F0B}' | '\u{0F0C}'
    ) {
        return false;
    }
    if matches!(
        character,
        '#' | '%'
            | '&'
            | '@'
            | '\u{00A7}'
            | '\u{00B6}'
            | '\u{0609}'
            | '\u{060A}'
            | '\u{066A}'
            | '\u{2030}'
            | '\u{2031}'
            | '\u{204A}'
            | '\u{204B}'
            | '\u{2053}'
            | '\u{303D}'
            | '\u{FE5F}'
            | '\u{FE60}'
            | '\u{FE6A}'
            | '\u{FE6B}'
            | '\u{FF03}'
            | '\u{FF05}'
            | '\u{FF06}'
            | '\u{FF20}'
    ) {
        return true;
    }
    !matches!(
        CodePointMapData::<Category>::new().get(character),
        Category::SpaceSeparator
            | Category::LineSeparator
            | Category::ParagraphSeparator
            | Category::Unassigned
            | Category::Control
            | Category::Format
            | Category::DashPunctuation
            | Category::OpenPunctuation
            | Category::ClosePunctuation
            | Category::ConnectorPunctuation
            | Category::OtherPunctuation
            | Category::InitialPunctuation
            | Category::FinalPunctuation
    )
}

#[cfg(test)]
mod tests {
    use super::{emphasis_mark_size, line_annotation_extent, ItemAnnotationBox};
    use rito_style_contract::LineSide;

    #[test]
    fn a_mark_is_half_the_text_rounded_to_a_whole_pixel() {
        assert_eq!(emphasis_mark_size(16.0), 8.0);
        assert_eq!(emphasis_mark_size(15.0), 8.0);
        assert_eq!(emphasis_mark_size(15.2), 8.0);
        assert_eq!(emphasis_mark_size(13.0), 7.0);
    }

    /// The 050 paragraph: a 20.796875px line, its baseline 16 below the
    /// top, the text's em box from 1 to 18, dots under it 8 tall.
    #[test]
    fn marks_under_a_short_line_overflow_its_bottom() {
        let item = |marks| ItemAnnotationBox {
            over: 1.0,
            under: 18.0
                + if marks == Some(LineSide::Under) {
                    8.0
                } else {
                    0.0
                },
            marks,
        };
        let marked = line_annotation_extent(&[item(Some(LineSide::Under))], 16.0, 20.796875, 16.0);
        assert_eq!(marked.overflow_under, 26.0 - 20.796875);
        assert_eq!(marked.space_over, 1.0);
        let plain = line_annotation_extent(&[item(None)], 16.0, 20.796875, 16.0);
        assert_eq!(plain.overflow_under, 0.0);
        assert_eq!(plain.space_under, 20.796875 - 18.0);
    }

    /// A text box taller than its line overflows nothing without marks.
    #[test]
    fn text_alone_never_overflows() {
        let item = ItemAnnotationBox {
            over: -2.0,
            under: 21.0,
            marks: None,
        };
        let extent = line_annotation_extent(&[item], 16.0, 20.0, 16.0);
        assert_eq!(extent.overflow_over, 0.0);
        assert_eq!(extent.overflow_under, 0.0);
        assert_eq!(extent.space_over, 0.0);
    }
}
