//! Line breaking: the Chromium-tailored break opportunities, line-end
//! punctuation trims and the rewind rules a line applies when a break
//! lands somewhere the browser would not.

use crate::*;

/// Whether the character puts the boundary in CJK typographic context.
pub(crate) fn is_cjk_context(character: char) -> bool {
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

/// How many glyphs past a soft break the candidate scan follows. The
/// dragged-down tail is whatever could not break before the closer — an
/// entire unbreakable Latin word included (measured: 有點melancholy。」,
/// where the closer is the 12th cluster past the break and Blink still
/// extends the line). Blink's ShapeLine has no small bound; this cap
/// only guards pathological input. Engine-forced breaks are excluded
/// from the scan separately — a forced line's tail is rewound content,
/// not a dragged closer.
pub(crate) const LINE_END_TRIM_SCAN: usize = 64;

/// The first character after `line_index`'s soft break that did not fit,
/// if extending the line by exactly that character with its blank right
/// half trimmed could keep it on the line. `decided` says whether a
/// character's trim was already accepted or rejected.
///
/// This reconstructs Blink's `ShapingLineBreaker::ShapeLine` extension:
/// the candidate is the first character past the break that exceeds the
/// available advance (characters before it fit and were only dragged down
/// by break prohibitions), it must be an eligible closing glyph, and its
/// half-width advance must fit `max_advance` (the line's width with its
/// fit epsilon). Blink extends within whichever text item overflows, so
/// element boundaries and atomic inlines earlier on the line do not
/// matter, and a closer ending its item keeps the trim (Chromium 153+,
/// `LineBreakerHanKerningEnd`; measured on 156: `<span>①</span>…）` and
/// `…<span>永</span>…）` both extend). A box gap riding on the closer
/// counts: Blink measures the closing tag after the trimmed text and
/// breaks the item before the closer when the two overflow together. The
/// decision is a pre-filter only — the caller re-lays the paragraph with
/// the trim applied and keeps it only if the line then breaks exactly
/// after the trimmed closer, so parley's own fitting (and its break
/// rules) remain the authority.
#[allow(clippy::too_many_arguments)]
pub(crate) fn line_end_trim_candidate(
    catalog: &FontCatalog,
    layout: &parley::Layout<[u8; 4]>,
    text: &str,
    line_index: usize,
    max_advance: f32,
    decided: impl Fn(usize) -> bool,
    suppressed_openers: &[(usize, usize)],
    bounds: &mut WidthBounds,
) -> Option<(usize, Vec<usize>)> {
    let line = layout.get(line_index)?;
    let next = layout.get(line_index + 1)?;
    // Only a fit-driven soft break can be extended; a forced break is not
    // a fit decision.
    if line.break_reason() != parley::layout::BreakReason::Regular {
        return None;
    }
    let metrics = line.metrics();
    // Hung trailing whitespace is not measured against the available
    // advance; content is.
    let mut advance = metrics.advance - metrics.trailing_whitespace;
    let next_range = next.text_range();
    let mut cluster = parley::layout::Cluster::from_byte_index(layout, next_range.start)?;
    // Openers whose pair trim the straddle pass suppressed (they opened
    // the next line at full width). Blink's extension runs in the
    // shaping domain BEFORE any such suppression: the opener it measures
    // still carries its halt half-width, and a successful extension puts
    // the pair back on one line. Mirror that: measure these openers
    // trimmed, and hand the pairs back for un-suppression on accept.
    let mut unsuppress: Vec<usize> = Vec::new();
    // A box's start and end sizes (inline boxes of their own) take their
    // width between the characters they stand between, as Blink adds an
    // open or close tag before measuring the text after it.
    let tags: Vec<(usize, parley::InlineBoxKind, f32)> = layout
        .inline_boxes()
        .iter()
        .filter(|inline_box| inline_box.kind.is_tag())
        .map(|inline_box| (inline_box.index, inline_box.kind, inline_box.width))
        .collect();
    let tags_before = |from: usize, to: usize| -> f32 {
        tags.iter()
            .filter(|(index, ..)| from <= *index && *index <= to)
            .map(|(_, _, width)| *width)
            .sum()
    };
    let mut scanned_from = next_range.start;
    for _ in 0..LINE_END_TRIM_SCAN {
        let byte = cluster.text_range().start;
        if byte >= next_range.end {
            return None;
        }
        let character = text[byte..].chars().next()?;
        advance += tags_before(scanned_from, byte);
        scanned_from = byte + 1;
        let mut cluster_advance = cluster.advance();
        if let Some((_, left_byte)) = suppressed_openers
            .iter()
            .find(|(right_byte, _)| *right_byte == byte)
        {
            cluster_advance -= 0.5 * cluster.run().font_size();
            unsuppress.push(*left_byte);
        }
        if bounds.fits_f32(advance + cluster_advance, max_advance) {
            // Fits, so it only moved down under a break prohibition; the
            // overflowing character is further along.
            advance += cluster_advance;
            cluster = cluster.next_logical()?;
            continue;
        }
        // The first character that does not fit is the only one Blink
        // considers for the line-end trim.
        if !line_end_trim_eligible(character) {
            return None;
        }
        if !cluster_font_has_halt(catalog, &cluster) {
            return None;
        }
        if decided(byte) {
            return None;
        }
        // The close tags right after the closer stay on its line; the open
        // tags there go down with what they open.
        let closer_end = byte + character.len_utf8();
        let closing: f32 = tags
            .iter()
            .filter(|(index, kind, _)| {
                *index == closer_end && *kind == parley::InlineBoxKind::CloseTag
            })
            .map(|(_, _, width)| *width)
            .sum();
        let trimmed = cluster_advance - 0.5 * cluster.run().font_size();
        if !bounds.fits_f32(advance + trimmed + closing, max_advance) {
            return None;
        }
        // A forced break right after the closer ends the line there at
        // any width, and no soft break comes before a forced one: no line
        // can end exactly after the trimmed closer, and the re-lay, which
        // builds the whole paragraph again, could only reject the trim.
        if cluster
            .next_logical()
            .is_some_and(|next| next.is_hard_line_break())
        {
            return None;
        }
        return Some((byte, unsuppress));
    }
    None
}

/// Whether a line of the paragraph could take a line-end trim, or the
/// rewind it is rejected into, at any width: both need an eligible closer
/// (see [`line_end_trim_eligible`]) shaped in a face with `halt`, and
/// shaping puts a character in the same face at every width. It reads the
/// runs, so it answers before the paragraph is broken into lines; either
/// direction's feature makes a trim possible.
pub(crate) fn line_end_trims_possible(
    catalog: &FontCatalog,
    layout: &parley::Layout<[u8; 4]>,
    text: &str,
) -> bool {
    text.char_indices()
        .filter(|(_, character)| line_end_trim_eligible(*character))
        .any(|(byte, _)| {
            layout
                .font_at(byte)
                .is_some_and(|font| catalog.has_halt(font, false) || catalog.has_halt(font, true))
        })
}

/// Whether a fullwidth closing glyph is eligible for the conditional
/// line-end trim.
///
/// Blink (`ShapingLineBreaker::ShapeLine`, gated by
/// `Character::MaybeHanKerningClose`) extends a line past its first
/// overflowing character only when that character has static
/// `HanKerningCharType` `kClose` — fullwidth closing punctuation, Unicode
/// `Pe` within the CJK block or East Asian Fullwidth — or `kCloseQuote`
/// (`’` `”`). The dots and commas `。、，．` are `kDot` and the colons
/// `：；` are `kColon`/`kSemicolon`; both classes are excluded from the
/// line-end path even though they pair-trim mid-line. css-text-4
/// `text-spacing-trim: normal` words the same conditionality: closing
/// punctuation is set half-width at the end of the line only "if it does
/// not otherwise fit prior to justification". (Re-affirmed 2026-08-05:
/// synthetic oracles at 16px — left, justify, zh-TW — all send a
/// trailing 法，pair down instead of trimming the comma; b20's real
/// `看法，` line stays open evidence, see the task archive.)
pub(crate) fn line_end_trim_eligible(character: char) -> bool {
    fullwidth_punctuation_class(character) == PunctuationClass::CloseOrStop
        && !matches!(character, '。' | '、' | '，' | '．' | '：' | '；')
}
