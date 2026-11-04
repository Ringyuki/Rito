//! CJK punctuation: fullwidth classes, the half-em pair trims, and the
//! `halt` feature gate that decides which faces may trim.

use crate::*;

/// Which glyph loses its blank half at a fullwidth-punctuation boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TrimmedGlyph {
    Left,
    Right,
}

/// A character's static Han kerning class (Blink's
/// `unicode::GetHanKerningCharType`, css-text-4's text-spacing classes)
/// as the pinned CJK faces resolve it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PunctuationClass {
    /// Fullwidth opening punctuation: `Ps` in the CJK Symbols block or
    /// East Asian Fullwidth, and the curly opening quotes.
    Open,
    /// Fullwidth closing punctuation (`Pe` likewise, the curly closing
    /// quotes) and the dots and colons, whose blank half sits on the right
    /// in the pinned faces' Simplified Chinese forms.
    CloseOrStop,
    /// The ideographic space and the middle dots: they make their
    /// neighbours trim but never trim themselves.
    Middle,
    /// Any other opening punctuation (`(`, `[`, halfwidth brackets): a
    /// fullwidth opener after it trims.
    OpenNarrow,
    /// Any other closing punctuation: a fullwidth closer before it trims.
    CloseNarrow,
    Other,
}

pub(crate) fn fullwidth_punctuation_class(character: char) -> PunctuationClass {
    use icu_properties::props::{EastAsianWidth, GeneralCategory};
    use icu_properties::CodePointMapData;
    match character {
        // The curly quotes are ambiguous-width, but in the CJK faces this
        // engine shapes with they are fullwidth, and the pinned Chromium
        // trims them exactly like brackets (pair probe, 2026-07-26,
        // 17-pair matrix incl. quotes): `。”` costs 8+16, `”。` costs
        // 8+16, `「“` costs 16+8, and none of them trim against an
        // ideograph. Blink types them kOpenQuote/kCloseQuote, which its
        // Han kerning treats as kOpen/kClose.
        '‘' | '“' => PunctuationClass::Open,
        '’' | '”' | '。' | '、' | '，' | '．' | '：' | '；' => {
            PunctuationClass::CloseOrStop
        }
        // The ideographic space is fullwidth-punctuation CONTEXT: an
        // opener after it halts (　「 = 16+8) and a close/stop before it
        // halts (』　 = 8+16), while the space itself never trims —
        // 　　 and 　、 stay full (measured 6-pair matrix, 2026-08-08).
        // The middle dots are the same class (measured: ·「 = 5.33+8).
        '　' | '・' | '·' | '‧' => PunctuationClass::Middle,
        _ => {
            let fullwidth = ('\u{3000}'..='\u{303F}').contains(&character)
                || CodePointMapData::<EastAsianWidth>::new().get(character)
                    == EastAsianWidth::Fullwidth;
            match CodePointMapData::<GeneralCategory>::new().get(character) {
                GeneralCategory::OpenPunctuation if fullwidth => PunctuationClass::Open,
                GeneralCategory::OpenPunctuation => PunctuationClass::OpenNarrow,
                GeneralCategory::ClosePunctuation if fullwidth => PunctuationClass::CloseOrStop,
                GeneralCategory::ClosePunctuation => PunctuationClass::CloseNarrow,
                _ => PunctuationClass::Other,
            }
        }
    }
}

/// The half-width trim at the boundary between `left` and `right`, if any.
///
/// Chromium ships `text-spacing-trim: normal` on by default for CJK text
/// (Blink "Han kerning"): where two fullwidth punctuation glyphs meet, the
/// blank half at the boundary collapses so the pair advances 1.5em instead
/// of 2em. Blink's `HanKerning::ShouldKern` trims an opener after an
/// opener, a middle dot or space, a closer or a narrow opener
/// (measured: `、〝` = 16+8, `(「` = 5.33+8), and `ShouldKernLast` trims a
/// closer before a closer, a middle dot or space or a narrow closer
/// (`〟、` = 8+16, `」)` = 8+5.33); nothing trims against an ideograph or
/// at a line edge, `！？・` never trim themselves, the trim applies with or
/// without justification, and it crosses inline element boundaries.
pub(crate) fn cjk_punctuation_trim(left: char, right: char) -> Option<TrimmedGlyph> {
    use PunctuationClass::*;
    let left_class = fullwidth_punctuation_class(left);
    let right_class = fullwidth_punctuation_class(right);
    if right_class == Open && matches!(left_class, Open | Middle | CloseOrStop | OpenNarrow) {
        return Some(TrimmedGlyph::Right);
    }
    if left_class == CloseOrStop && matches!(right_class, CloseOrStop | Middle | CloseNarrow) {
        return Some(TrimmedGlyph::Left);
    }
    None
}

/// One boundary trim: the pair identity for straddle bookkeeping, the
/// character range the edit applies to, and the edit itself.
pub(crate) struct PunctuationTrim {
    pub(crate) left_byte: usize,
    pub(crate) right_byte: usize,
    pub(crate) edit_range: std::ops::Range<usize>,
    pub(crate) edit: PunctuationTrimEdit,
}

/// How a boundary trim collapses a blank half. Either edit is a distinct
/// resolved style on the trimmed character, so shaping, line breaking and
/// run splitting all see it and the character sits in its own glyph run,
/// keeping painted runs position-exact.
pub(crate) enum PunctuationTrimEdit {
    /// A close/stop's blank right half collapses: negative letter-spacing
    /// on the trimmed character itself (correct fit attribution — the
    /// credit belongs to the line holding that character).
    LetterSpacing(f32),
    /// An opener's blank LEFT half collapses: the OpenType `halt`
    /// feature on the opener itself, exactly Blink's Han kerning. A
    /// left-char letter-spacing here would leak the credit into the
    /// PREVIOUS line's fit at a break boundary (measured: a compressed
    /// ，squeezed onto the prior line, straddling the pair and killing
    /// the trim, while Blink's full-width ，broke earlier and kept
    /// 作，『 together). Carries the removed half width (half the
    /// opener's font size) for the painter's draw-origin compensation.
    OpenerHalt(f32),
}

/// The boundary trims as edits, computed before the shaping builder
/// exists so the trim gate can consult the font collection. Blink's Han
/// kerning only adjusts glyphs whose resolved font carries the OpenType
/// `halt` feature, `vhal` for a glyph shaped top to bottom (measured: a
/// book-embedded face without it keeps `。」` at two full advances while
/// the pinned SourceHan trims), so each trimmed character resolves its
/// font first.
pub(crate) fn compute_cjk_punctuation_trims(
    fonts: &mut FontContext,
    catalog: &FontCatalog,
    halt_cache: &mut rustc_hash::FxHashMap<(u64, u32, bool), bool>,
    text: &str,
    runs: &[(std::ops::Range<usize>, &InlineFormattingStyle, usize)],
    suppressed_pairs: &[usize],
    inline_box_bytes: &[usize],
) -> Vec<PunctuationTrim> {
    fn style_at<'a>(
        cursor: &mut usize,
        runs: &[(std::ops::Range<usize>, &'a InlineFormattingStyle, usize)],
        byte: usize,
    ) -> Option<&'a InlineFormattingStyle> {
        while *cursor < runs.len() && runs[*cursor].0.end <= byte {
            *cursor += 1;
        }
        runs.get(*cursor)
            .filter(|(range, ..)| range.contains(&byte))
            .map(|(_, style, _)| *style)
    }
    let mut trims = Vec::new();
    let mut cursor = 0usize;
    let mut previous: Option<(usize, char)> = None;
    for (byte, character) in text.char_indices() {
        if let Some((left_byte, left)) = previous {
            // A pair a line break was found to separate keeps both
            // glyphs at full width, exactly as the browser trims within
            // lines only.
            if suppressed_pairs.contains(&left_byte) {
                previous = Some((byte, character));
                continue;
            }
            // An inline box (an image — flow text carries no placeholder
            // for it) sitting between the two characters separates them:
            // the browser keeps 的。<img>』at full width while 。』
            // alone trims (measured on b20's note badge, p143).
            if inline_box_bytes.contains(&byte) {
                previous = Some((byte, character));
                continue;
            }
            if let Some(trimmed) = cjk_punctuation_trim(left, character) {
                let left_style = style_at(&mut cursor, runs, left_byte);
                let (trimmed_style, trimmed_char) = match trimmed {
                    TrimmedGlyph::Left => (left_style, left),
                    TrimmedGlyph::Right => (style_at(&mut cursor, runs, byte), character),
                };
                if let (Some(left_style), Some(trimmed_style)) = (left_style, trimmed_style) {
                    let Some(halt_covers_glyph) =
                        resolved_font_halt(fonts, catalog, halt_cache, trimmed_style, trimmed_char)
                    else {
                        previous = Some((byte, character));
                        continue;
                    };
                    match trimmed {
                        TrimmedGlyph::Left => {
                            let author = match left_style.text_flow.letter_spacing {
                                LengthPercentage::Length(px) => px.get(),
                                _ => 0.0,
                            };
                            trims.push(PunctuationTrim {
                                left_byte,
                                right_byte: byte,
                                edit_range: left_byte..byte,
                                edit: PunctuationTrimEdit::LetterSpacing(
                                    author - 0.5 * trimmed_style.font.size.get(),
                                ),
                            });
                        }
                        TrimmedGlyph::Right if halt_covers_glyph => {
                            trims.push(PunctuationTrim {
                                left_byte,
                                right_byte: byte,
                                edit_range: byte..byte + character.len_utf8(),
                                edit: PunctuationTrimEdit::OpenerHalt(
                                    0.5 * trimmed_style.font.size.get(),
                                ),
                            });
                        }
                        TrimmedGlyph::Right => {
                            // The face declares `halt` but its lookups skip
                            // this opener (b12's BuMing): the browser still
                            // trims, synthesizing the half-width — the
                            // opener's ink already hugs its right half, so
                            // removing the blank left half from the gap
                            // BEFORE it reproduces the compressed pair
                            // without any paint shift.
                            let author = match left_style.text_flow.letter_spacing {
                                LengthPercentage::Length(px) => px.get(),
                                _ => 0.0,
                            };
                            trims.push(PunctuationTrim {
                                left_byte,
                                right_byte: byte,
                                edit_range: left_byte..byte,
                                edit: PunctuationTrimEdit::LetterSpacing(
                                    author - 0.5 * trimmed_style.font.size.get(),
                                ),
                            });
                        }
                    }
                }
            }
        }
        previous = Some((byte, character));
    }
    trims
}

/// Whether the font the style resolves for `character` carries the
/// OpenType `halt` feature, or `vhal` where the character shapes top to
/// bottom (Blink's `HanKerning::FontData`), and whether that feature moves
/// the glyph. Resolution mirrors CSS font matching: the first stack family
/// whose matched face covers the character wins, and the registered
/// families (the engine's installed fallback order) stand in for script
/// fallback. An unresolvable character trims nothing.
pub(crate) fn resolved_font_halt(
    fonts: &mut FontContext,
    catalog: &FontCatalog,
    halt_cache: &mut rustc_hash::FxHashMap<(u64, u32, bool), bool>,
    style: &InlineFormattingStyle,
    character: char,
) -> Option<bool> {
    let vertical = shapes_top_to_bottom(style, character);
    use parley::fontique::{FontStyle, FontWeight, FontWidth, SourceKind};
    use skrifa::MetadataProvider as _;
    let weight = FontWeight::new(style.font.weight.get());
    let stack = catalog.resolve(style);
    for name in &stack.families {
        let Some(family) = fonts.collection.family_by_name(name) else {
            continue;
        };
        let Some(font) = family.match_font(FontWidth::NORMAL, FontStyle::Normal, weight, true)
        else {
            continue;
        };
        let SourceKind::Memory(blob) = font.source().kind() else {
            continue;
        };
        let Ok(font_ref) = skrifa::FontRef::from_index(blob.as_ref(), font.index()) else {
            continue;
        };
        if font_ref.charmap().map(character).is_none() {
            continue;
        }
        let key = (blob.id(), font.index(), vertical);
        let has_halt = *halt_cache
            .entry(key)
            .or_insert_with(|| font_ref_has_halt(&font_ref, vertical));
        if !has_halt {
            return None;
        }
        return Some(font_halt_covers(&font_ref, character, vertical));
    }
    None
}

/// Whether a Parley cluster's resolved font carries the `halt` feature —
/// the same gate the pair trims apply: Blink's Han kerning (including the
/// conditional line-end close trim) only adjusts glyphs whose font
/// declares it. A latin face's curly quote must NOT extend the line
/// (measured: a Tinos closing quote got the half-width extension and
/// pulled `men.` plus the quote onto a line the browser broke earlier).
pub(crate) fn cluster_font_has_halt(
    catalog: &FontCatalog,
    cluster: &parley::layout::Cluster<'_, [u8; 4]>,
) -> bool {
    catalog.has_halt(cluster.run().font(), cluster.run().is_vertical_upright())
}

/// The OpenType feature that sets a CJK punctuation glyph's alternate half
/// width: `halt`, or `vhal` for a glyph shaped top to bottom.
pub(crate) fn halt_tag(vertical: bool) -> &'static [u8; 4] {
    if vertical {
        b"vhal"
    } else {
        b"halt"
    }
}

/// Whether the face declares its alternate half widths (see [`halt_tag`])
/// in GSUB or GPOS.
pub(crate) fn font_ref_has_halt(font: &skrifa::FontRef, vertical: bool) -> bool {
    use skrifa::raw::TableProvider as _;
    let tag = skrifa::raw::types::Tag::new(halt_tag(vertical));
    let gsub = font.gsub().ok().and_then(|table| table.feature_list().ok());
    let gpos = font.gpos().ok().and_then(|table| table.feature_list().ok());
    gsub.is_some_and(|list| {
        list.feature_records()
            .iter()
            .any(|record| record.feature_tag() == tag)
    }) || gpos.is_some_and(|list| {
        list.feature_records()
            .iter()
            .any(|record| record.feature_tag() == tag)
    })
}

/// Whether the face's `halt` feature actually REPOSITIONS `character` —
/// its GPOS `halt` lookups cover the mapped glyph, or for a glyph shaped
/// top to bottom its `vhal` lookups cover the vertical form `vert` puts
/// there. A face may declare `halt` for a subset only (b12's BuMing covers
/// 51 glyphs, the corner bracket excluded): shaping such a glyph with the
/// feature is a no-op, and the browser SYNTHESIZES the half-width trim
/// instead. Parse failures report `true` so the shaped path stays the
/// default.
pub(crate) fn font_halt_covers(font: &skrifa::FontRef, character: char, vertical: bool) -> bool {
    use skrifa::raw::tables::gpos::PositionLookup;
    use skrifa::raw::TableProvider as _;
    use skrifa::MetadataProvider as _;
    let Some(glyph) = font.charmap().map(character) else {
        return true;
    };
    let glyph = if vertical {
        vertical_form(font, glyph)
    } else {
        glyph
    };
    let tag = skrifa::raw::types::Tag::new(halt_tag(vertical));
    let Ok(gpos) = font.gpos() else {
        return true;
    };
    let (Ok(features), Ok(lookups)) = (gpos.feature_list(), gpos.lookup_list()) else {
        return true;
    };
    let mut lookup_indices: Vec<u16> = Vec::new();
    for record in features.feature_records() {
        if record.feature_tag() != tag {
            continue;
        }
        let Ok(feature) = record.feature(features.offset_data()) else {
            return true;
        };
        lookup_indices.extend(feature.lookup_list_indices().iter().map(|i| i.get()));
    }
    if lookup_indices.is_empty() {
        return true;
    }
    let covers = |coverage: Result<skrifa::raw::tables::layout::CoverageTable, _>| {
        coverage.is_ok_and(|table| table.get(glyph).is_some())
    };
    for index in lookup_indices {
        let Ok(lookup) = lookups.lookups().get(index as usize) else {
            return true;
        };
        let single = match lookup {
            PositionLookup::Single(table) => table,
            _ => return true,
        };
        for subtable in single.subtables().iter() {
            let Ok(subtable) = subtable else {
                return true;
            };
            use skrifa::raw::tables::gpos::SinglePos;
            let covered = match subtable {
                SinglePos::Format1(t) => covers(t.coverage()),
                SinglePos::Format2(t) => covers(t.coverage()),
            };
            if covered {
                return true;
            }
        }
    }
    false
}

/// The glyph the face's `vert` feature substitutes for `glyph` — its form
/// in a vertical line — or `glyph` itself when no single substitution of
/// the feature covers it.
pub(crate) fn vertical_form(font: &skrifa::FontRef, glyph: skrifa::GlyphId) -> skrifa::GlyphId {
    use skrifa::raw::tables::gsub::{SingleSubst, SubstitutionSubtables};
    use skrifa::raw::TableProvider as _;
    let tag = skrifa::raw::types::Tag::new(b"vert");
    let Ok(gsub) = font.gsub() else {
        return glyph;
    };
    let (Ok(features), Ok(lookups)) = (gsub.feature_list(), gsub.lookup_list()) else {
        return glyph;
    };
    for record in features.feature_records() {
        if record.feature_tag() != tag {
            continue;
        }
        let Ok(feature) = record.feature(features.offset_data()) else {
            continue;
        };
        for index in feature.lookup_list_indices() {
            let Ok(lookup) = lookups.lookups().get(index.get() as usize) else {
                continue;
            };
            let Ok(SubstitutionSubtables::Single(subtables)) = lookup.subtables() else {
                continue;
            };
            for subtable in subtables.iter().flatten() {
                let substitute = match &subtable {
                    SingleSubst::Format1(table) => table.coverage().ok().and_then(|coverage| {
                        coverage.get(glyph).map(|_| {
                            let id = u16::try_from(glyph.to_u32()).unwrap_or_default();
                            skrifa::GlyphId::from(id.wrapping_add_signed(table.delta_glyph_id()))
                        })
                    }),
                    SingleSubst::Format2(table) => table.coverage().ok().and_then(|coverage| {
                        coverage.get(glyph).and_then(|index| {
                            table
                                .substitute_glyph_ids()
                                .get(index as usize)
                                .map(|id| skrifa::GlyphId::from(id.get()))
                        })
                    }),
                };
                if let Some(substitute) = substitute {
                    return substitute;
                }
            }
        }
    }
    glyph
}
