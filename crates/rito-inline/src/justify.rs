//! Justification: which characters open a share, how a line's slack
//! distributes across them, and where the atoms sit in that plan.

/// Blink's justification character class (`Character::IsCJKIdeographOrSymbol`
/// by block): ideographs, kana, CJK punctuation, and fullwidth forms.
/// Measured against pinned Chromium (scratchpad justify probes,
/// 2026-07-28): em dashes, ellipses, middle dots and curly quotes are NOT
/// in the class even when a CJK face serves them — the class is decided
/// by code point, not by the resolved font. Enclosed alphanumerics
/// (U+2460 circled digits — postil markers) ARE in the class, plain and
/// superscripted alike (measured 2026-08-03).
pub(crate) fn is_cjk_justify(character: char) -> bool {
    matches!(u32::from(character),
        0x2460..=0x24FF
        // Geometric shapes and the star pair count as CJK symbols in the
        // browser's justify classes (measured share-after on a 20-symbol
        // matrix: \u{25A0}\u{25B2}\u{25B3}\u{25C7}\u{25CB}\u{25CE}\u{25CF}
        // and \u{2605}\u{2606} each open one share; math operators
        // \u{2220}\u{2252}\u{2260}, \u{00D7}\u{00F7}, the em dash, the
        // ellipsis, and Greek letters open none).
        | 0x25A0..=0x25FF
        | 0x2605..=0x2606
        | 0x2E80..=0x2EFF
        | 0x3000..=0x303F
        | 0x3041..=0x30FF
        | 0x31C0..=0x31EF
        | 0x3200..=0x33FF
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xF900..=0xFAFF
        | 0xFE30..=0xFE4F
        // Blink's CJK symbol table cuts at U+FF1A: the fullwidth
        // semicolon ；(U+FF1B) neither expands after itself nor takes a
        // "before" share (measured boundary-by-boundary on the OO；觉
        // line: the engine's CJK classification minted two phantom
        // shares there, inflating the denominator 48 → 50 and shifting
        // every glyph after the first latin run).
        | 0xFF00..=0xFF1A
        | 0xFF1C..=0xFF60
        | 0xFFE0..=0xFFE6
        | 0x20000..=0x2FA1F)
}

/// Whether a justified line expands after this character: word separators
/// and CJK ideographs/symbols both open a share on their right side.
pub(crate) fn justify_expands_after(character: char) -> bool {
    character == ' ' || is_cjk_justify(character)
}

/// Punctuation that CJK fonts join into one continuous rule when repeated
/// (em dash and ellipsis pairs —— / …… via GSUB contextual/ligature
/// substitution). The canvas shapes each fillText call independently, so a
/// paint cut inside such a sequence severs the substitution and the glyphs
/// raster in their isolated form (measured on an embedded face: the joined
/// dash pair's bar sits 2px lower than two isolated dashes; the browser
/// keeps the pair in one shaping run because no justify share separates
/// them).
pub(crate) fn joins_with_identical_neighbor(character: char) -> bool {
    matches!(character, '\u{2014}' | '\u{2015}' | '\u{2026}')
}

/// One justified line's expansion plan.
///
/// Blink (`text-align: justify`, default `text-justify: auto`) spreads a
/// line's slack in equal shares across its expansion opportunities.
/// Measured against pinned Chromium (scratchpad justify probes,
/// 2026-07-28, five discriminating lines):
///
/// - every boundary whose left character is a space or CJK gets one share
///   (CJK-CJK, CJK-latin, CJK-space, space-anything: all one share, so
///   fullwidth punctuation expands exactly like an ideograph);
/// - latin-latin and latin-space boundaries get none;
/// - a CJK character right of a non-expansive character opens a share
///   that lands one boundary LATE (measured: `t|花` stays natural while
///   `花|鸟` doubles — Blink defers the "before" opportunity it cannot
///   apply at the boundary itself);
/// - the line's edges never expand, and trailing whitespace hangs
///   outside the distribution.
///
/// Glyph positions follow the ideal float accumulation truncated to the
/// device's 1/64px grid; painting the share as canvas letter spacing (or
/// per-cluster placement) reproduces the DOM raster bit-for-bit
/// (measured: 0-diff over all 250 line columns, all three paint models).
pub(crate) struct JustifyPlan {
    /// Pixels one expansion share adds.
    pub(crate) share: f64,
    /// Share count at each inter-character boundary, keyed by the byte
    /// index (into the flow text) of the boundary's right-hand character,
    /// ascending. Boundaries without shares are absent.
    pub(crate) counts: Vec<(usize, u32)>,
    /// Byte indices of CJK characters that follow a non-CJK character.
    /// Their deferred "before" share lands in the NEXT boundary's count
    /// (the advance side), but Blink additionally paints the glyph's INK
    /// one share to the right (ShapeResult::ApplySpacingOrExpansion adds
    /// `spacing_before` to the glyph offset as well as the advance), so
    /// the run starting here shifts its rect without moving its
    /// neighbours.
    pub(crate) before_bytes: Vec<usize>,
    /// Per in-flow atom on the line, in flow order: (flow-text position,
    /// shares accumulated up to AND INCLUDING the atom's left boundary).
    /// The atom's justified x adds `share × shares` — measured on b20's
    /// note badge: the image sits at the END of its prefix's EXPANDED
    /// advance (the [text-atom] boundary's share rides the preceding
    /// glyph), while the [atom-text] boundary's share shifts the
    /// following run only.
    pub(crate) atom_shares: Vec<(usize, u32)>,
    /// Every share the slack divides into — the boundary counts plus a
    /// share deferred into the line's end.
    pub(crate) total: u32,
}

impl JustifyPlan {
    pub(crate) fn count_at(&self, byte: usize) -> u32 {
        self.counts
            .binary_search_by_key(&byte, |(index, _)| *index)
            .map(|found| self.counts[found].1)
            .unwrap_or(0)
    }

    pub(crate) fn before_share_at(&self, byte: usize) -> bool {
        self.before_bytes.binary_search(&byte).is_ok()
    }

    /// Shares carried by the `ordinal`-th atom at `position` (flow-text
    /// byte), or `None` when the atom sits outside the plan's line.
    pub(crate) fn atom_shares_at(&self, position: usize, ordinal: usize) -> Option<u32> {
        self.atom_shares
            .iter()
            .filter(|(byte, _)| *byte == position)
            .nth(ordinal)
            .map(|(_, shares)| *shares)
    }
}

/// Builds the expansion plan for one line, or `None` when the line has no
/// slack or no opportunities (then the start-aligned positions stand).
pub(crate) fn line_justify_plan(
    text: &str,
    range: std::ops::Range<usize>,
    slack: f64,
    spread_ranges: &[std::ops::Range<usize>],
    atom_positions: &[usize],
) -> Option<JustifyPlan> {
    // Bails on NaN slack too: only a strictly positive slack justifies.
    if slack.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
        return None;
    }
    let content = text.get(range.clone())?.trim_end();
    let content_end = range.start + content.len();
    let mut counts: Vec<(usize, u32)> = Vec::new();
    let mut before_bytes: Vec<usize> = Vec::new();
    let mut atom_shares: Vec<(usize, u32)> = Vec::new();
    let mut total = 0u32;
    let mut pending = 0u32;
    // The left neighbour of the next boundary: a character, or an atomic
    // inline. Blink counts an atomic inline (an image, an inline-block)
    // as an ideograph on BOTH sides — measured on b20's badge line, the
    // truth carries a share at [text-atom] AND at [atom-text] where the
    // engine's text-only walk saw one adjacency.
    enum Left {
        Char(char),
        Atom,
    }
    let expands_after = |left: &Left| match left {
        Left::Char(character) => justify_expands_after(*character),
        // An atomic inline is NON-expansive on its trailing side: a
        // Chromium justify map on a badge line gives [atom|，] ZERO
        // shares and ，|有 TWO — the following CJK char's before-share
        // defers one boundary late, the usual deferral machinery. (An
        // earlier reading that an atom expands on both sides overfit
        // its line; the leading [text|atom] boundary DOES expand via
        // the left character's own class.)
        Left::Atom => false,
    };
    let mut previous: Option<Left> = None;
    let mut atoms = atom_positions
        .iter()
        .copied()
        .filter(|position| range.start < *position && *position <= content_end)
        .peekable();
    let mut walk = content.char_indices().peekable();
    loop {
        let boundary = match walk.peek() {
            Some((offset, _)) => range.start + offset,
            None => content_end,
        };
        // Atoms sitting at this boundary join the walk as ideographs:
        // the [left, atom] boundary's share is counted here and also
        // recorded as the atom's own placement share.
        while atoms.peek() == Some(&boundary) {
            atoms.next();
            let mut count = 0u32;
            if let Some(left) = &previous {
                count = pending;
                pending = 0;
                if expands_after(left) {
                    count += 1;
                }
            }
            atom_shares.push((boundary, total + count));
            if count > 0 {
                counts.push((boundary, count));
                total += count;
            }
            previous = Some(Left::Atom);
        }
        let Some((offset, character)) = walk.next() else {
            break;
        };
        // Zero-width characters are TRANSPARENT to justification: the
        // boundary they sit on neither takes a share nor defers one
        // (Range-measured on a justified line carrying U+FEFF: the
        // preceding ideograph's boundary keeps its one share and the
        // zero-width cluster steps 0, while counting it as a normal
        // character both inflated the denominator and deferred a
        // phantom share past it).
        if matches!(
            character,
            '\u{FEFF}' | '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}'
        ) {
            continue;
        }
        // A spread ruby base (its annotation wider than it) is one
        // justification item, Chromium's kBaseShorterRubyMarker: no
        // interior expansion (its clusters already sit at the
        // annotation-dictated spacing — measured: a justified
        // wide-annotation ruby is bit-identical to the left-aligned one,
        // while a narrow-annotation base justifies like plain text), no
        // opportunity of its own before or after (the marker is not an
        // ideograph: it takes the left neighbour's after-share and the
        // right neighbour, if CJK, opens a deferred before-share exactly
        // as after an atomic inline — DOM-measured on a justified line:
        // the column's box carries no share and the following ideograph
        // grows by two).
        let boundary = range.start + offset;
        let char_end = boundary + character.len_utf8();
        let left_after = if spread_ranges.iter().any(|spread| spread.end == char_end) {
            Left::Atom
        } else {
            Left::Char(character)
        };
        if let Some(left) = &previous {
            if spread_ranges
                .iter()
                .any(|spread| spread.start < boundary && boundary < spread.end)
            {
                pending = 0;
                previous = Some(left_after);
                continue;
            }
            let mut count = pending;
            pending = 0;
            if expands_after(left) {
                count += 1;
            } else if is_cjk_justify(character)
                && !spread_ranges.iter().any(|spread| spread.start == boundary)
            {
                pending += 1;
                before_bytes.push(boundary);
            }
            if count > 0 {
                // An atom at this byte may have deposited its own count
                // already; the counts vec stays unique-keyed for the
                // binary search.
                if let Some(entry) = counts.last_mut().filter(|(byte, _)| *byte == boundary) {
                    entry.1 += count;
                } else {
                    counts.push((boundary, count));
                }
                total += count;
            }
        }
        previous = Some(left_after);
    }
    // A share deferred into the line's end has nowhere to land, but
    // Blink still counts it in the denominator: a justified line ending
    // `……唉` distributes slack/(shares+1) and stays one share short of
    // the right edge (measured 2026-08-03, replica vs live: Blink share
    // 26.688/33 = 0.809 with the line ending 0.81px shy; the engine's
    // slack/32 overfilled).
    if pending > 0 {
        total += pending;
    }
    if total == 0 {
        return None;
    }
    if std::env::var_os("RITO_JUST_DEBUG").is_some() {
        let sample: String = content.chars().take(6).collect();
        eprintln!(
            "[plan] '{sample}' slack={slack} total={total} share={} counts={:?}",
            slack / f64::from(total),
            counts
                .iter()
                .map(|(byte, count)| {
                    let ch = text[*byte..].chars().next().unwrap_or(' ');
                    (ch, *count)
                })
                .collect::<Vec<_>>()
        );
    }
    Some(JustifyPlan {
        share: slack / f64::from(total),
        counts,
        before_bytes,
        atom_shares,
        total,
    })
}
