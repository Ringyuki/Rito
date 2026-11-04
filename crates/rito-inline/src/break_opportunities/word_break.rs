//! Blink's `word-break: break-all` and `keep-all` (`LazyLineBreakIterator`
//! with `LineBreakType::kBreakAll` and `kKeepAll`): break-all adds the
//! breaks its class table lists to the normal ones, keep-all keeps letters
//! and numbers together.

use icu_properties::props::{GeneralCategory, LineBreak as Lb};
use icu_properties::CodePointMapData;

/// The raw line breaking class Blink's break-all reads
/// (`LineBreakPropertyValue`): `+` counts as a letter.
pub(super) fn break_all_class(character: char) -> Lb {
    if character == '+' {
        Lb::Alphabetic
    } else {
        CodePointMapData::<Lb>::new().get(character)
    }
}

/// Whether break-all breaks between a character of class `before` and
/// `after` (`ShouldBreakAfterBreakAll` over
/// `kBreakAllLineBreakClassTable`); `false` leaves the boundary to the
/// normal rules. A break before a break-after character other than `|`
/// waits for `loose`.
pub(super) fn break_all_breaks(before: Lb, after: Lb, character: char, loose: bool) -> bool {
    use Lb as L;
    let letters = |class: Lb| {
        matches!(
            class,
            L::Ambiguous | L::Alphabetic | L::BreakAfter | L::Hyphen | L::Numeric | L::HebrewLetter
        )
    };
    let listed = match before {
        L::Ambiguous
        | L::Alphabetic
        | L::BreakAfter
        | L::Numeric
        | L::ComplexContext
        | L::BreakSymbols
        | L::HebrewLetter => {
            letters(after)
                || matches!(
                    after,
                    L::OpenPunctuation | L::PrefixNumeric | L::ComplexContext
                )
        }
        L::ClosePunctuation => letters(after) || after == L::PrefixNumeric,
        L::CloseParenthesis => {
            letters(after) || matches!(after, L::PrefixNumeric | L::ComplexContext)
        }
        L::Exclamation | L::PostfixNumeric => {
            letters(after) || matches!(after, L::PostfixNumeric | L::PrefixNumeric)
        }
        L::InfixNumeric => letters(after),
        L::Hyphen => after == L::Numeric,
        L::PrefixNumeric => after == L::PostfixNumeric,
        _ => false,
    };
    listed && (after != L::BreakAfter || character == '|' || loose)
}

/// Whether keep-all keeps the boundary before `after` (`last` before it,
/// `before_last` before that) together: between letters and numbers,
/// a combining mark reading as the character it follows, outside
/// dictionary-broken scripts (`ShouldKeepAfterKeepAll`).
pub(super) fn keep_all_keeps(before_last: Option<char>, last: char, after: char) -> bool {
    let category = |character: char| CodePointMapData::<GeneralCategory>::new().get(character);
    let is_mark = |character: char| {
        matches!(
            category(character),
            GeneralCategory::NonspacingMark
                | GeneralCategory::SpacingMark
                | GeneralCategory::EnclosingMark
        )
    };
    let word_character = |character: char| {
        matches!(
            category(character),
            GeneralCategory::UppercaseLetter
                | GeneralCategory::LowercaseLetter
                | GeneralCategory::TitlecaseLetter
                | GeneralCategory::ModifierLetter
                | GeneralCategory::OtherLetter
                | GeneralCategory::DecimalNumber
                | GeneralCategory::LetterNumber
                | GeneralCategory::OtherNumber
        ) && CodePointMapData::<Lb>::new().get(character) != Lb::ComplexContext
    };
    let reading = if is_mark(last) {
        before_last.unwrap_or(last)
    } else {
        last
    };
    word_character(reading) && word_character(after)
}
