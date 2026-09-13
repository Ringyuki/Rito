//! Line breaking: the Chromium-tailored break opportunities, line-end
//! punctuation trims and the rewind rules a line applies when a break
//! lands somewhere the browser would not.

use crate::*;

/// Chromium's line-break tailoring, extended with its CJK quote classes.
///
/// UAX-14 gives the curly quotes class QU (no break on either side), but
/// Blink reclassifies them in CJK context: an opening curly quote breaks
/// like an opening bracket (opportunity before, none after) and a closing
/// curly quote like a closing bracket (opportunity after, none before).
/// CJK dialogue in translated novels hangs on this. Everything else
/// defers to Parley's Chromium ASCII table.
/// Fills the one gap in Parley's `word-break: break-all` relaxation.
///
/// Under break-all Parley already breaks between latin letters (a|b) and
/// before the prolonged sound mark (ず|ー), but it still carries the CJK
/// novel dash pair ── (U+2500 BOX DRAWINGS LIGHT HORIZONTAL) as one
/// unbreakable word, while Blink splits it across the line boundary
/// (b93 truth: the first ─ closes the line, the second opens the next).
/// Everything else defers to Parley's break-all logic.
pub(crate) fn break_anywhere_override(_context: parley::LineBreakContext) -> Option<bool> {
    Some(true)
}

pub(crate) fn break_all_box_dash_override(context: parley::LineBreakContext) -> Option<bool> {
    if context.before == '\u{2500}' && context.after == '\u{2500}' {
        return Some(true);
    }
    None
}

pub(crate) fn cjk_aware_chromium_break_override(context: parley::LineBreakContext) -> Option<bool> {
    if let Some(verdict) = cjk_quote_reclassification(context) {
        return Some(verdict);
    }
    // Blink's default line-break (auto/normal/loose — measured matrix
    // zh-CN/ja/en × auto/normal/loose, 2026-08-11) resolves the UAX-14
    // CJ class (small kana + the prolonged sound mark) to ID: the
    // character may START a line (b39 truth: あず|ーる splits with ー
    // opening the next line). Parley keeps CJ as NS, so the pair
    // retreated whole. Only `line-break: strict` keeps the prohibition —
    // that path installs the strict variant below.
    if is_cj_conditional_starter(context.after)
        && is_cjk_context(context.before)
        && !['\u{2018}', '\u{201C}'].contains(&context.before)
        && fullwidth_punctuation_class(context.before) != PunctuationClass::Open
    {
        return Some(true);
    }
    (parley::CHROMIUM_LINE_BREAK_OVERRIDE)(context)
}

/// The `line-break: strict` variant: Chromium's quote reclassification
/// without the CJ line-start relaxation (strict keeps CJ as NS, measured
/// PAIR-RETREATS on the same matrix).
pub(crate) fn cjk_aware_chromium_break_override_strict(
    context: parley::LineBreakContext,
) -> Option<bool> {
    if let Some(verdict) = cjk_quote_reclassification(context) {
        return Some(verdict);
    }
    (parley::CHROMIUM_LINE_BREAK_OVERRIDE)(context)
}

/// UAX-14 gives the curly quotes class QU (no break on either side), but
/// Blink reclassifies them in CJK context: an opening curly quote breaks
/// like an opening bracket (opportunity before, none after) and a closing
/// curly quote like a closing bracket (opportunity after, none before).
/// CJK dialogue in translated novels hangs on this.
pub(crate) fn cjk_quote_reclassification(context: parley::LineBreakContext) -> Option<bool> {
    const OPEN_QUOTES: [char; 2] = ['\u{2018}', '\u{201C}'];
    const CLOSE_QUOTES: [char; 2] = ['\u{2019}', '\u{201D}'];
    // A close/stop before the opening quote KEEPS the prohibition: the
    // browser carries 说，'Caster' as one unbreakable block — the comma
    // never sheds the quote that follows it (pinned-Chromium b112 line:
    // …这点来 | 说，'Caster'… breaks before 说, not after the comma).
    // Only an ideograph ahead of the opening quote releases the break.
    if OPEN_QUOTES.contains(&context.after)
        && is_cjk_context(context.before)
        && matches!(
            fullwidth_punctuation_class(context.before),
            PunctuationClass::Other | PunctuationClass::Middle
        )
        && !OPEN_QUOTES.contains(&context.before)
    {
        return Some(true);
    }
    // The em/horizontal-bar dashes join the after-side context: a
    // closing curly quote breaks before a novel dash pair exactly like
    // before an ideograph (pinned-Chromium b112 line: 怕”|——可见 puts
    // the dash pair on the next line while the quote closes the first;
    // treating the pair as unbreakable-after-quote dragged 怕” down
    // with it and re-broke every following line of the chapter).
    let after_joins_cjk =
        is_cjk_context(context.after) || matches!(context.after, '\u{2014}' | '\u{2015}');
    if CLOSE_QUOTES.contains(&context.before)
        && after_joins_cjk
        && fullwidth_punctuation_class(context.after) != PunctuationClass::CloseOrStop
        && !CLOSE_QUOTES.contains(&context.after)
        && !OPEN_QUOTES.contains(&context.after)
    {
        return Some(true);
    }
    None
}

/// The UAX-14 CJ class: small kana and the katakana-hiragana prolonged
/// sound mark, whose line-start prohibition is conditional on
/// `line-break` strictness.
pub(crate) fn is_cj_conditional_starter(character: char) -> bool {
    matches!(u32::from(character),
        0x3041 | 0x3043 | 0x3045 | 0x3047 | 0x3049
        | 0x3063 | 0x3083 | 0x3085 | 0x3087 | 0x308E | 0x3095 | 0x3096
        | 0x30A1 | 0x30A3 | 0x30A5 | 0x30A7 | 0x30A9
        | 0x30C3 | 0x30E3 | 0x30E5 | 0x30E7 | 0x30EE | 0x30F5 | 0x30F6
        | 0x30FC
        | 0x31F0..=0x31FF
        | 0xFF67..=0xFF70)
}

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

/// Layout-unit epsilon for line-fit comparisons, Chromium's `LayoutUnit`
/// quantum (1/64 px).
pub(crate) const LINE_FIT_EPS: f32 = 1.0 / 64.0;

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
/// half trimmed could keep it on the line.
///
/// This reconstructs Blink's `ShapingLineBreaker::ShapeLine` extension:
/// the candidate is the first character past the break that exceeds the
/// available advance (characters before it fit and were only dragged down
/// by break prohibitions), it must be an eligible closing glyph, and its
/// half-width advance must fit. The decision is a pre-filter only — the
/// caller re-lays the paragraph with the trim applied and keeps it only
/// if the line then breaks exactly after the trimmed closer, so parley's
/// own fitting (and its break rules) remain the authority.
/// Detects a rejected-extension rewind on `line_index`: the line-end trim
/// extension would fit the first overflowing closer (so a single-item
/// line would have extended), but the line crosses an element boundary,
/// which Blink answers by rewinding the WHOLE overflowing item to the
/// next line — measured on razor-fit note-box lines, where line one keeps
/// only the leading `①` span while greedy would split the text item.
/// Returns the cluster count the line must be forced to hold.
pub(crate) fn rewind_break_count(
    layout: &parley::Layout<[u8; 4]>,
    text: &str,
    line_index: usize,
    max_advance: f64,
    item_ranges: &[std::ops::Range<usize>],
) -> Option<u32> {
    let line = layout.get(line_index)?;
    let next = layout.get(line_index + 1)?;
    if line.break_reason() != parley::layout::BreakReason::Regular {
        return None;
    }
    // Only a line crossing an element boundary rewinds; a single-item
    // line extends instead (see `line_end_trim_candidate`).
    let mut line_item: Option<u32> = None;
    let mut crosses = false;
    for item in line.items() {
        let brush = match item {
            PositionedLayoutItem::GlyphRun(run) => u32::from_le_bytes(run.style().brush),
            PositionedLayoutItem::InlineBox(inline_box) => u32::MAX - inline_box.id as u32,
        };
        if *line_item.get_or_insert(brush) != brush {
            crosses = true;
            break;
        }
    }
    if !crosses {
        return None;
    }
    let metrics = line.metrics();
    let mut advance = f64::from(metrics.advance - metrics.trailing_whitespace);
    let next_range = next.text_range();
    let mut cluster = parley::layout::Cluster::from_byte_index(layout, next_range.start)?;
    for _ in 0..LINE_END_TRIM_SCAN {
        let byte = cluster.text_range().start;
        if byte >= next_range.end {
            return None;
        }
        let character = text[byte..].chars().next()?;
        let cluster_advance = f64::from(cluster.advance());
        if advance + cluster_advance <= max_advance + f64::from(LINE_FIT_EPS) {
            advance += cluster_advance;
            cluster = cluster.next_logical()?;
            continue;
        }
        if !cluster_font_has_halt(&cluster) {
            return None;
        }
        if !line_end_trim_eligible(character) {
            return None;
        }
        let trimmed = cluster_advance - 0.5 * f64::from(cluster.run().font_size());
        if advance + trimmed > max_advance + f64::from(LINE_FIT_EPS) {
            return None;
        }
        // Only a PARAGRAPH-FINAL candidate rewinds (measured: `……。）啊`
        // with content after the closer breaks greedily; the razor-fit
        // note line whose `）` ends the paragraph rewinds its whole item).
        let candidate_end = byte + character.len_utf8();
        if !text
            .get(candidate_end..)
            .is_some_and(|rest| rest.chars().all(char::is_whitespace))
        {
            return None;
        }
        // The extension would fit; the rewound item is the one holding
        // the candidate, and it must begin inside this line.
        let item_start = item_ranges
            .iter()
            .find(|range| range.contains(&byte))
            .map(|range| range.start)?;
        let line_start = line.text_range().start;
        if item_start <= line_start {
            return None;
        }
        let count = text.get(line_start..item_start)?.chars().count();
        return u32::try_from(count).ok().filter(|count| *count > 0);
    }
    None
}

pub(crate) fn line_end_trim_candidate(
    layout: &parley::Layout<[u8; 4]>,
    text: &str,
    line_index: usize,
    max_advance: f32,
    accepted: &[usize],
    rejected: &[usize],
    suppressed_openers: &[(usize, usize)],
) -> Option<(usize, Vec<usize>)> {
    let line = layout.get(line_index)?;
    let next = layout.get(line_index + 1)?;
    // Only a fit-driven soft break can be extended; a forced break is not
    // a fit decision.
    if line.break_reason() != parley::layout::BreakReason::Regular {
        return None;
    }
    // Blink skips the extension whenever the line crosses an element
    // boundary (measured 2026-07-28, note-box ablation: a leading
    // <span>① kills it at every size, alignment and vertical-align while
    // a font-fallback split inside one element does not; flip widths
    // 560.35 span vs 541.41 without). The line must be one inline item.
    let mut line_item: Option<u32> = None;
    for item in line.items() {
        match item {
            PositionedLayoutItem::GlyphRun(run) => {
                let brush = u32::from_le_bytes(run.style().brush);
                if *line_item.get_or_insert(brush) != brush {
                    return None;
                }
            }
            // An atomic inline is an element boundary by definition.
            PositionedLayoutItem::InlineBox(_) => return None,
        }
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
    for _ in 0..LINE_END_TRIM_SCAN {
        let byte = cluster.text_range().start;
        if byte >= next_range.end {
            return None;
        }
        let character = text[byte..].chars().next()?;
        let mut cluster_advance = cluster.advance();
        if let Some((_, left_byte)) = suppressed_openers
            .iter()
            .find(|(right_byte, _)| *right_byte == byte)
        {
            cluster_advance -= 0.5 * cluster.run().font_size();
            unsuppress.push(*left_byte);
        }
        if advance + cluster_advance <= max_advance + LINE_FIT_EPS {
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
        if !cluster_font_has_halt(&cluster) {
            return None;
        }
        if accepted.contains(&byte) || rejected.contains(&byte) {
            return None;
        }
        let trimmed = cluster_advance - 0.5 * cluster.run().font_size();
        if advance + trimmed > max_advance + LINE_FIT_EPS {
            return None;
        }
        return Some((byte, unsuppress));
    }
    None
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
    matches!(
        character,
        '」' | '』'
            | '）'
            | '】'
            | '〕'
            | '》'
            | '〉'
            | '〗'
            | '〙'
            | '〛'
            | '｝'
            | '］'
            | '｠'
            | '’'
            | '”'
    )
}

pub(crate) fn push_line_end_trims(
    builder: &mut SpacingBuilder<'_>,
    text: &str,
    runs: &[(std::ops::Range<usize>, &InlineFormattingStyle, usize)],
    end_trims: &[usize],
) {
    for &byte in end_trims {
        let Some(character) = text[byte..].chars().next() else {
            continue;
        };
        let Some(style) = runs
            .iter()
            .find(|(range, ..)| range.contains(&byte))
            .map(|(_, style, _)| *style)
        else {
            continue;
        };
        let author = match style.text_flow.letter_spacing {
            LengthPercentage::Length(px) => px.get(),
            _ => 0.0,
        };
        builder.push(
            StyleProperty::LetterSpacing(author - 0.5 * shaping_font_size(style.font.size.get())),
            byte..byte + character.len_utf8(),
        );
    }
}
