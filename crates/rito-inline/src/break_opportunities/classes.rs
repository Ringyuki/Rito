//! The ICU line rule sets Chromium opens and the line breaking class each
//! character takes under one: UAX #14's classes as ICU's rule files
//! (`line.txt` and its `_cj`, `normal` and `loose` tailorings) resolve
//! and tailor them.

use icu_properties::props::{
    EastAsianWidth, ExtendedPictographic, GeneralCategory, LineBreak as Lb,
};
use icu_properties::{CodePointMapData, CodePointSetData};
use rito_style_contract::LineBreak;

/// One of ICU's line rule sets (its `brkitr/rules/line*.txt` files).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RuleSet {
    /// `line.txt`: CSS `strict`; small kana and the prolonged sound mark
    /// are nonstarters.
    Strict,
    /// `line_normal.txt`: small kana and the prolonged sound mark may
    /// start a line.
    Normal,
    /// `line_normal_cj.txt`: `normal` as Chinese and Japanese define it —
    /// the curly double quotes as brackets, and a line may start with 〜
    /// or ゠.
    NormalCj,
    /// `line_loose.txt`: `normal` that also starts lines with iteration
    /// marks and breaks between inseparables.
    Loose,
    /// `line_loose_cj.txt`: `loose` as Chinese and Japanese define it.
    LooseCj,
}

impl RuleSet {
    /// The rule set Chromium's ICU opens for a content language and a
    /// `line-break` value: the locale's `line`, `line_normal`,
    /// `line_loose` or `line_strict` entry (Blink passes `@lb=` only for
    /// a value other than `auto`), Chinese, Japanese and Korean carrying
    /// their own tables and every other language the root's. Chromium's
    /// ICU data leaves out Korean's strict table (`line_cj`), so Korean
    /// `strict` opens the locale's default, as Chromium 156 breaks it.
    pub(crate) fn for_content(language: Option<&str>, line_break: LineBreak) -> Self {
        let primary = language
            .and_then(|tag| tag.split(['-', '_']).next())
            .map(str::to_ascii_lowercase);
        match (primary.as_deref(), line_break) {
            (Some("zh"), LineBreak::Strict) => Self::Strict,
            (Some("zh"), LineBreak::Loose) => Self::LooseCj,
            (Some("zh"), _) => Self::NormalCj,
            (Some("ja"), LineBreak::Strict) => Self::Strict,
            (Some("ko"), LineBreak::Strict) => Self::Normal,
            (Some("ja" | "ko"), LineBreak::Normal) => Self::NormalCj,
            (Some("ja" | "ko"), LineBreak::Loose) => Self::LooseCj,
            (_, LineBreak::Strict) => Self::Strict,
            (_, LineBreak::Loose) => Self::Loose,
            _ => Self::Normal,
        }
    }

    pub(super) fn loose(self) -> bool {
        matches!(self, Self::Loose | Self::LooseCj)
    }

    pub(super) fn loose_cj(self) -> bool {
        self == Self::LooseCj
    }

    /// Whether the rule set takes `character` out of its class: such a
    /// character answers only rules that admit any character.
    fn unclasses(self, character: char) -> bool {
        const NORMAL_CJ: [char; 2] = ['\u{301C}', '\u{30A0}'];
        const ITERATION_MARKS: [char; 6] = [
            '\u{3005}', '\u{303B}', '\u{309D}', '\u{309E}', '\u{30FD}', '\u{30FE}',
        ];
        const LOOSE_CJ: [char; 10] = [
            '\u{203C}', '\u{2047}', '\u{2048}', '\u{2049}', '\u{30FB}', '\u{FF1A}', '\u{FF1B}',
            '\u{FF65}', '\u{FF01}', '\u{FF1F}',
        ];
        match self {
            Self::Strict | Self::Normal => false,
            Self::NormalCj => NORMAL_CJ.contains(&character),
            Self::Loose => ITERATION_MARKS.contains(&character),
            Self::LooseCj => {
                NORMAL_CJ.contains(&character)
                    || ITERATION_MARKS.contains(&character)
                    || LOOSE_CJ.contains(&character)
            }
        }
    }
}

/// A line breaking class as the rules read it (UAX #14 LB1 resolved).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Class {
    Ak,
    Al,
    Ap,
    As,
    B2,
    Ba,
    Bb,
    Bk,
    Cb,
    Cl,
    Cm,
    Cp,
    Cr,
    Eb,
    Em,
    Ex,
    Gl,
    H2,
    H3,
    Hh,
    Hl,
    Hy,
    Id,
    In,
    Is,
    Jl,
    Jt,
    Jv,
    Lf,
    Nl,
    Ns,
    Nu,
    Op,
    Po,
    Pr,
    Qu,
    Ri,
    Sp,
    Sy,
    Vf,
    Vi,
    Wj,
    Zw,
    Zwj,
    /// Taken out of its class by the rule set.
    Unclassed,
    /// `line_loose_cj`'s postfix exceptions (`$POX`): still a postfix
    /// beside letters and before a number.
    PoX,
    /// `line_loose_cj`'s prefix exceptions (`$PRX`): still a prefix only
    /// after a number.
    PrX,
}

/// What the rules read of one character.
#[derive(Clone, Copy, Debug)]
pub(super) struct Props {
    pub(super) class: Class,
    /// East Asian Width F, W or H.
    pub(super) east_asian: bool,
    /// General category Pi.
    pub(super) initial_quote: bool,
    /// General category Pf.
    pub(super) final_quote: bool,
    /// Extended_Pictographic and unassigned (LB30b).
    pub(super) unassigned_pictograph: bool,
    /// Line break class SA: broken by dictionary, not by these rules.
    pub(super) complex: bool,
}

/// The class `character` takes under `rule_set`.
pub(super) fn props(character: char, rule_set: RuleSet) -> Props {
    let category = CodePointMapData::<GeneralCategory>::new().get(character);
    let raw = CodePointMapData::<Lb>::new().get(character);
    let class = if rule_set.unclasses(character) {
        Class::Unclassed
    } else {
        resolve(character, raw, category, rule_set)
    };
    Props {
        class,
        east_asian: matches!(
            CodePointMapData::<EastAsianWidth>::new().get(character),
            EastAsianWidth::Fullwidth | EastAsianWidth::Wide | EastAsianWidth::Halfwidth
        ),
        initial_quote: category == GeneralCategory::InitialPunctuation,
        final_quote: category == GeneralCategory::FinalPunctuation,
        unassigned_pictograph: category == GeneralCategory::Unassigned
            && CodePointSetData::new::<ExtendedPictographic>().contains(character),
        complex: raw == Lb::ComplexContext,
    }
}

fn resolve(character: char, raw: Lb, category: GeneralCategory, rule_set: RuleSet) -> Class {
    let curly_brackets = matches!(rule_set, RuleSet::NormalCj | RuleSet::LooseCj);
    if curly_brackets && character == '\u{201C}' {
        return Class::Op;
    }
    if curly_brackets && character == '\u{201D}' {
        return Class::Cl;
    }
    if rule_set.loose_cj() {
        const POX: [char; 10] = [
            '\u{00B0}', '\u{2030}', '\u{2032}', '\u{2033}', '\u{2035}', '\u{2103}', '\u{2109}',
            '\u{FE6A}', '\u{FF05}', '\u{FFE0}',
        ];
        const PRX: [char; 9] = [
            '\u{00A4}', '\u{00B1}', '\u{20AC}', '\u{2116}', '\u{FE69}', '\u{FF04}', '\u{FFE1}',
            '\u{FFE5}', '\u{FFE6}',
        ];
        if POX.contains(&character) {
            return Class::PoX;
        }
        if PRX.contains(&character) {
            return Class::PrX;
        }
    }
    match raw {
        Lb::Aksara => Class::Ak,
        Lb::AksaraPrebase => Class::Ap,
        Lb::AksaraStart => Class::As,
        Lb::BreakBoth => Class::B2,
        Lb::BreakAfter => Class::Ba,
        Lb::BreakBefore => Class::Bb,
        Lb::MandatoryBreak => Class::Bk,
        Lb::ContingentBreak => Class::Cb,
        Lb::ClosePunctuation => Class::Cl,
        Lb::CombiningMark => Class::Cm,
        Lb::CloseParenthesis => Class::Cp,
        Lb::CarriageReturn => Class::Cr,
        Lb::EBase => Class::Eb,
        Lb::EModifier => Class::Em,
        Lb::Exclamation => Class::Ex,
        Lb::Glue => Class::Gl,
        Lb::H2 => Class::H2,
        Lb::H3 => Class::H3,
        Lb::UnambiguousHyphen => Class::Hh,
        Lb::HebrewLetter => Class::Hl,
        Lb::Hyphen => Class::Hy,
        Lb::Ideographic => Class::Id,
        Lb::Inseparable => Class::In,
        Lb::InfixNumeric => Class::Is,
        Lb::JL => Class::Jl,
        Lb::JT => Class::Jt,
        Lb::JV => Class::Jv,
        Lb::LineFeed => Class::Lf,
        Lb::NextLine => Class::Nl,
        Lb::Nonstarter => Class::Ns,
        Lb::Numeric => Class::Nu,
        Lb::OpenPunctuation => Class::Op,
        Lb::PostfixNumeric => Class::Po,
        Lb::PrefixNumeric => Class::Pr,
        Lb::Quotation => Class::Qu,
        Lb::RegionalIndicator => Class::Ri,
        Lb::Space => Class::Sp,
        Lb::BreakSymbols => Class::Sy,
        Lb::ViramaFinal => Class::Vf,
        Lb::Virama => Class::Vi,
        Lb::WordJoiner => Class::Wj,
        Lb::ZWSpace => Class::Zw,
        Lb::ZWJ => Class::Zwj,
        // LB1: small kana and the prolonged sound mark start lines only
        // outside `strict`.
        Lb::ConditionalJapaneseStarter => {
            if rule_set == RuleSet::Strict {
                Class::Ns
            } else {
                Class::Id
            }
        }
        // LB1: a dictionary character's marks combine; the rest are
        // letters.
        Lb::ComplexContext => {
            if matches!(
                category,
                GeneralCategory::NonspacingMark | GeneralCategory::SpacingMark
            ) {
                Class::Cm
            } else {
                Class::Al
            }
        }
        // LB1: ambiguous, surrogate and unknown characters are letters.
        _ => Class::Al,
    }
}
