//! Where Chromium may break a line (Blink's `LazyLineBreakIterator::
//! NextBreakablePosition`): never before a breakable space and always
//! after a run of them, a fixed table between two Latin-1 characters, the
//! hyphen-minus before a digit by what comes before it, the breaks
//! `word-break: break-all` adds and those `keep-all` withholds, and
//! everywhere else the ICU line rules of the rule set the content language
//! and `line-break` value select; `line-break: anywhere` breaks everywhere.
//! A boundary inside dictionary-broken text (Thai, Lao, Khmer, Myanmar) is
//! left to the dictionary.

mod classes;
mod uax14;
mod word_break;

use std::sync::OnceLock;

pub(crate) use classes::RuleSet;
use rito_style_contract::WordBreak;

/// The first and last characters Blink's fast pair table covers.
const TABLE_FIRST: u32 = 0x21;
const TABLE_LAST: u32 = 0xFF;
const TABLE_SIZE: usize = (TABLE_LAST - TABLE_FIRST + 1) as usize;

/// How one character's text item breaks.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BreakContext {
    /// The ICU rule set its content language and `line-break` select.
    pub(crate) rule_set: RuleSet,
    pub(crate) word_break: WordBreak,
    /// `line-break: anywhere`.
    pub(crate) anywhere: bool,
    /// Whether its white space collapses.
    pub(crate) collapses: bool,
}

/// A paragraph's break opportunities, by the byte offset of the character
/// after each boundary.
#[derive(Debug, Default)]
pub(crate) struct BreakOpportunities {
    verdicts: Vec<Option<bool>>,
}

impl BreakOpportunities {
    /// The opportunities in `text`, each character read in the context
    /// `context_at` gives its byte offset, and each boundary broken as the
    /// character after it says.
    pub(crate) fn new(text: &str, context_at: impl Fn(usize) -> BreakContext) -> Self {
        let offsets: Vec<usize> = text.char_indices().map(|(offset, _)| offset).collect();
        let chars: Vec<char> = text.chars().collect();
        let contexts: Vec<BreakContext> =
            offsets.iter().map(|&offset| context_at(offset)).collect();
        let rule_sets: Vec<RuleSet> = contexts.iter().map(|context| context.rule_set).collect();
        let props: Vec<classes::Props> = chars
            .iter()
            .zip(&rule_sets)
            .map(|(&character, &rule_set)| classes::props(character, rule_set))
            .collect();
        let rules = uax14::opportunities(&chars, &props, &rule_sets);
        let iterated: Vec<Option<bool>> = (0..chars.len())
            .map(|index| match index {
                0 => Some(false),
                _ if contexts[index].anywhere => Some(true),
                _ => blink_verdict(&chars, &props, &rules, index, contexts[index]),
            })
            .collect();
        let mut by_index = iterated.clone();
        for (index, verdict) in iterated.iter().enumerate() {
            if *verdict != Some(true) {
                continue;
            }
            let end = line_end(&chars, &contexts, index);
            if end != index {
                by_index[index] = Some(false);
                if let Some(slot) = by_index.get_mut(end) {
                    *slot = Some(true);
                }
            }
        }
        let mut verdicts = vec![None; text.len() + 1];
        for (index, verdict) in by_index.into_iter().enumerate().skip(1) {
            verdicts[offsets[index]] = verdict;
        }
        Self { verdicts }
    }

    /// Whether a line may break before the character at byte `offset`;
    /// `None` leaves the boundary to the dictionary.
    pub(crate) fn before(&self, offset: usize) -> Option<bool> {
        self.verdicts.get(offset).copied().flatten()
    }
}

fn blink_verdict(
    chars: &[char],
    props: &[classes::Props],
    rules: &[bool],
    index: usize,
    context: BreakContext,
) -> Option<bool> {
    let breakable_space = |character: char| matches!(character, ' ' | '\t' | '\n');
    let (before, after) = (chars[index - 1], chars[index]);
    if breakable_space(after) {
        return Some(false);
    }
    if breakable_space(before) {
        return Some(true);
    }
    let fast = fast_verdict(chars, index);
    if fast == Some(true) {
        return Some(true);
    }
    match context.word_break {
        WordBreak::BreakAll => {
            let loose = context.rule_set.loose();
            let last = chars[..index]
                .iter()
                .rev()
                .map(|&character| word_break::break_all_class(character))
                .find(|&class| class != icu_properties::props::LineBreak::CombiningMark)
                .unwrap_or(icu_properties::props::LineBreak::Unknown);
            // `loose` breaks before a hyphen after a letter, a number or
            // an ideograph.
            let hyphen_after_word = matches!(after, '\u{2010}' | '\u{2013}')
                && matches!(
                    last,
                    icu_properties::props::LineBreak::Numeric
                        | icu_properties::props::LineBreak::Alphabetic
                        | icu_properties::props::LineBreak::ComplexContext
                        | icu_properties::props::LineBreak::Ideographic
                );
            if (loose && hyphen_after_word)
                || word_break::break_all_breaks(
                    last,
                    word_break::break_all_class(after),
                    after,
                    loose,
                )
            {
                return Some(true);
            }
        }
        WordBreak::KeepAll => {
            let before_last = index.checked_sub(2).map(|at| chars[at]);
            if word_break::keep_all_keeps(before_last, before, after) {
                return Some(false);
            }
        }
        WordBreak::Normal => {}
    }
    if fast == Some(false) {
        return Some(false);
    }
    if props[index - 1].complex && props[index].complex {
        return None;
    }
    Some(rules[index])
}

/// Blink's fast verdict (`ShouldBreakFast`): `Some` for a pair it decides
/// without the Unicode rules, `None` otherwise.
fn fast_verdict(chars: &[char], index: usize) -> Option<bool> {
    let (before, after) = (chars[index - 1], chars[index]);
    let (before_code, after_code) = (u32::from(before), u32::from(after));
    if before_code < TABLE_FIRST || after_code < TABLE_FIRST {
        return Some(false);
    }
    if before == '-' {
        if after.is_ascii_digit() {
            // A minus sign stays with its number; a hyphen inside a word
            // or a number (an ID, a URL) may break.
            return Some(index >= 2 && chars[index - 2].is_ascii_alphanumeric());
        }
        if after_code > 0x7F {
            return None;
        }
    }
    (before_code <= TABLE_LAST && after_code <= TABLE_LAST)
        .then(|| fast_table()[pair_index(before_code, after_code)])
}

/// Where a line broken before `index` ends (Blink's `ShapingLineBreaker`
/// then `LineBreaker::HandleTrailingSpaces`): the break moves back to the
/// start of the hangable spaces before it, and the line then takes the
/// spaces that follow as trailing — one space where white space collapses,
/// else the whole run of spaces and other space separators.
fn line_end(chars: &[char], contexts: &[BreakContext], index: usize) -> usize {
    let hangable =
        |character: char| matches!(character, ' ' | '\t') || is_other_space_separator(character);
    let mut start = index;
    while start > 0 && hangable(chars[start - 1]) {
        start -= 1;
    }
    match chars.get(start) {
        Some(' ') if contexts[start].collapses => start + 1,
        Some(_) => {
            let mut end = start;
            while end < chars.len() && hangable(chars[end]) {
                end += 1;
            }
            end
        }
        None => start,
    }
}

/// A space separator other than the space and the no-break space (Blink's
/// `unicode::IsOtherSpaceSeparator`).
fn is_other_space_separator(character: char) -> bool {
    matches!(
        character,
        '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
    )
}

fn pair_index(before: u32, after: u32) -> usize {
    (before - TABLE_FIRST) as usize * TABLE_SIZE + (after - TABLE_FIRST) as usize
}

/// Blink's fast line break table (`LineBreakData`): every pair of
/// characters from `!` to U+00FF as ICU's English line iterator breaks
/// the two alone, then the printable ASCII pairs overridden for
/// compatibility (`FillAscii`).
fn fast_table() -> &'static [bool] {
    static TABLE: OnceLock<Vec<bool>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = vec![false; TABLE_SIZE * TABLE_SIZE];
        for before in TABLE_FIRST..=TABLE_LAST {
            for after in TABLE_FIRST..=TABLE_LAST {
                let pair = [before, after].map(|code| char::from_u32(code).unwrap_or('\u{FFFD}'));
                let props = pair.map(|character| classes::props(character, RuleSet::Normal));
                table[pair_index(before, after)] =
                    uax14::opportunities(&pair, &props, &[RuleSet::Normal; 2])[1];
            }
        }
        fill_ascii(&mut table);
        table
    })
}

fn fill_ascii(table: &mut [bool]) {
    const ALL: (char, char) = ('!', '\u{7F}');
    let mut set = |before: (char, char), after: (char, char), value: bool| {
        for b in u32::from(before.0)..=u32::from(before.1) {
            for a in u32::from(after.0)..=u32::from(after.1) {
                table[pair_index(b, a)] = value;
            }
        }
    };
    let one = |character: char| (character, character);
    set(ALL, ALL, false);
    set(ALL, one('('), true);
    set(ALL, one('<'), true);
    set(ALL, one('['), true);
    set(ALL, one('{'), true);
    set(one('-'), ALL, true);
    set(one('?'), ALL, true);
    set(one('-'), one('$'), false);
    set(ALL, one('!'), false);
    set(one('?'), one('"'), false);
    set(one('?'), one('\''), false);
    set(ALL, one(')'), false);
    set(ALL, one(','), false);
    set(ALL, one('.'), false);
    set(ALL, one('/'), false);
    set(one('-'), ('0', '9'), false);
    set(ALL, one(':'), false);
    set(ALL, one(';'), false);
    set(ALL, one('?'), false);
    set(ALL, one(']'), false);
    set(ALL, one('}'), false);
    set(one('$'), ALL, false);
    set(one('\''), ALL, false);
    set(one('('), ALL, false);
    set(one('/'), ALL, false);
    set(('0', '9'), ALL, false);
    set(one('<'), ALL, false);
    set(one('@'), ALL, false);
    set(('A', 'Z'), ALL, false);
    set(one('['), ALL, false);
    set(('^', '`'), ALL, false);
    set(('a', 'z'), ALL, false);
    set(one('{'), ALL, false);
    set(one('\u{7F}'), ALL, false);
}
