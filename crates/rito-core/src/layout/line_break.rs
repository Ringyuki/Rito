use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
};

#[cfg(test)]
use std::convert::Infallible;

use unicode_linebreak::{linebreaks, BreakOpportunity};

use super::hyphenation::find_hyphenation_points;

/// Rust line-breaking policy.
///
/// Unicode Line Breaking Algorithm opportunities provide the base candidates.
/// EPUB/CJK-specific kinsoku and TS-compatible en-US Liang hyphenation are
/// layered on top while `docs/development/native-core-rust-plan.md` tracks the remaining
/// JLREQ/CSS hardening work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LineBreakSetting {
    Auto,
    Normal,
    Strict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WordBreakSetting {
    Normal,
    BreakAll,
    BreakWord,
    KeepAll,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LineBreakOptions {
    pub(crate) line_break: LineBreakSetting,
    pub(crate) word_break: WordBreakSetting,
    pub(crate) language: String,
}

impl Default for LineBreakOptions {
    fn default() -> Self {
        Self {
            line_break: LineBreakSetting::Auto,
            word_break: WordBreakSetting::Normal,
            language: "und".to_owned(),
        }
    }
}

impl LineBreakOptions {
    pub(crate) fn from_style(
        line_break: Option<&str>,
        word_break: Option<&str>,
        language: Option<&str>,
    ) -> Self {
        Self {
            line_break: match line_break {
                Some("normal") => LineBreakSetting::Normal,
                Some("strict") => LineBreakSetting::Strict,
                _ => LineBreakSetting::Auto,
            },
            word_break: match word_break {
                Some("break-all") => WordBreakSetting::BreakAll,
                Some("break-word") => WordBreakSetting::BreakWord,
                Some("keep-all") => WordBreakSetting::KeepAll,
                _ => WordBreakSetting::Normal,
            },
            language: language.unwrap_or("und").to_ascii_lowercase(),
        }
    }

    fn resolved_line_break(&self, text: &Utf16Text<'_>) -> ResolvedLineBreak {
        match self.line_break {
            LineBreakSetting::Normal => ResolvedLineBreak::Normal,
            LineBreakSetting::Strict => ResolvedLineBreak::Strict,
            LineBreakSetting::Auto => {
                if is_strict_line_break_language(&self.language) || contains_cjk(text.as_str()) {
                    ResolvedLineBreak::Strict
                } else {
                    ResolvedLineBreak::Normal
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResolvedLineBreak {
    Normal,
    Strict,
}

#[derive(Debug, Clone)]
pub(crate) struct Utf16Text<'a> {
    text: Cow<'a, str>,
    pub(crate) len: usize,
    boundaries: BTreeMap<usize, usize>,
    newlines: Vec<usize>,
}

impl<'a> Utf16Text<'a> {
    pub(crate) fn new(text: &'a str) -> Self {
        Self::from_text(Cow::Borrowed(text))
    }

    fn from_text(text: Cow<'a, str>) -> Self {
        let mut boundaries = BTreeMap::new();
        let mut newlines = Vec::new();
        let mut offset = 0usize;
        boundaries.insert(0, 0);
        for (byte_index, character) in text.char_indices() {
            boundaries.entry(offset).or_insert(byte_index);
            if character == '\n' {
                newlines.push(offset);
            }
            offset += character.len_utf16();
            boundaries.insert(offset, byte_index + character.len_utf8());
        }
        Self {
            text,
            len: offset,
            boundaries,
            newlines,
        }
    }

    pub(crate) fn slice(&self, start: usize, end: usize) -> &str {
        let start = self.byte_index(start);
        let end = self.byte_index(end);
        &self.text[start..end]
    }

    pub(crate) fn floor_boundary(&self, offset: usize) -> usize {
        self.boundaries
            .range(..=offset)
            .next_back()
            .map(|(boundary, _)| *boundary)
            .unwrap_or(0)
    }

    pub(crate) fn next_offset(&self, offset: usize) -> usize {
        self.boundaries
            .range((offset + 1)..)
            .next()
            .map(|(boundary, _)| *boundary)
            .unwrap_or(self.len)
    }

    pub(crate) fn char_at(&self, offset: usize) -> Option<char> {
        self.text[self.byte_index(offset)..].chars().next()
    }

    pub(crate) fn char_before(&self, offset: usize) -> Option<char> {
        let byte = self.byte_index(offset);
        self.text[..byte].chars().next_back()
    }

    pub(crate) fn find_char(&self, start: usize, needle: char) -> Option<usize> {
        if needle == '\n' {
            let index = self.newlines.partition_point(|offset| *offset < start);
            return self.newlines.get(index).copied();
        }
        self.text[self.byte_index(start)..]
            .char_indices()
            .find_map(|(relative, character)| {
                (character == needle)
                    .then(|| utf16_len(&self.text[..self.byte_index(start) + relative]))
            })
    }

    pub(crate) fn boundaries_between(&self, start: usize, end: usize) -> Vec<usize> {
        if end <= start {
            return Vec::new();
        }
        self.boundaries
            .range((start + 1)..=end)
            .map(|(boundary, _)| *boundary)
            .collect()
    }

    pub(crate) fn as_str(&self) -> &str {
        self.text.as_ref()
    }

    fn byte_index(&self, offset: usize) -> usize {
        self.boundaries
            .get(&offset)
            .copied()
            .unwrap_or_else(|| self.floor_byte_index(offset))
    }

    fn floor_byte_index(&self, offset: usize) -> usize {
        self.boundaries
            .range(..=offset)
            .next_back()
            .map(|(_, byte)| *byte)
            .unwrap_or(0)
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.boundaries
            .range(..offset)
            .next_back()
            .map(|(boundary, _)| *boundary)
            .unwrap_or(0)
    }
}

impl Utf16Text<'static> {
    pub(crate) fn new_owned(text: String) -> Self {
        Self::from_text(Cow::Owned(text))
    }
}

#[cfg(test)]
pub(crate) fn find_word_break(
    text: &Utf16Text<'_>,
    start: usize,
    fit_pos: usize,
    options: &LineBreakOptions,
) -> usize {
    let offsets = line_break_offsets(text, options);
    find_word_break_with_offsets(start, fit_pos, &offsets)
}

pub(crate) fn find_word_break_with_offsets(
    start: usize,
    fit_pos: usize,
    offsets: &BTreeSet<usize>,
) -> usize {
    if fit_pos <= start {
        return fit_pos;
    }
    offsets
        .range((start + 1)..=fit_pos)
        .next_back()
        .copied()
        .unwrap_or(fit_pos)
}

#[cfg(test)]
pub(crate) fn adjust_break_position<F>(
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
    candidate: usize,
    max_width: f64,
    mut measure_width: F,
    options: &LineBreakOptions,
) -> usize
where
    F: FnMut(usize) -> f64,
{
    let offsets = line_break_offsets(text, options);
    adjust_break_position_with_offsets(
        start,
        end,
        candidate,
        max_width,
        &mut measure_width,
        &offsets,
    )
}

#[cfg(test)]
pub(crate) fn adjust_break_position_with_offsets<F>(
    start: usize,
    end: usize,
    candidate: usize,
    max_width: f64,
    mut measure_width: F,
    offsets: &BTreeSet<usize>,
) -> usize
where
    F: FnMut(usize) -> f64,
{
    adjust_break_position_with_offsets_until(
        start,
        end,
        candidate,
        max_width,
        &mut measure_width,
        offsets,
        end,
    )
}

#[cfg(test)]
pub(crate) fn adjust_break_position_with_offsets_until<F>(
    start: usize,
    end: usize,
    candidate: usize,
    max_width: f64,
    mut measure_width: F,
    offsets: &BTreeSet<usize>,
    forward_end: usize,
) -> usize
where
    F: FnMut(usize) -> f64,
{
    match try_adjust_break_position_with_offsets_until(
        start,
        end,
        candidate,
        max_width,
        &mut |position| Ok::<f64, Infallible>(measure_width(position)),
        offsets,
        forward_end,
    ) {
        Ok(position) => position,
        Err(error) => match error {},
    }
}

pub(crate) fn try_adjust_break_position_with_offsets_until<F, E>(
    start: usize,
    end: usize,
    candidate: usize,
    max_width: f64,
    mut measure_width: F,
    offsets: &BTreeSet<usize>,
    forward_end: usize,
) -> Result<usize, E>
where
    F: FnMut(usize) -> Result<f64, E>,
{
    if candidate <= start || candidate >= end {
        return Ok(candidate);
    }

    if offsets.contains(&candidate) {
        return Ok(candidate);
    }

    if let Some(backward) = find_backward_break(start, candidate, offsets) {
        return Ok(backward);
    }

    let forward_start = candidate + 1;
    let forward_end = forward_end.min(end);
    if forward_start >= forward_end {
        return Ok(candidate);
    }
    Ok(try_find_forward_fitting_break(
        forward_start,
        forward_end,
        max_width,
        offsets,
        &mut measure_width,
    )?
    .unwrap_or(candidate))
}

#[cfg(test)]
pub(crate) fn try_ascii_hyphenation<F>(
    text: &Utf16Text<'_>,
    line_start: usize,
    fit_pos: usize,
    options: &LineBreakOptions,
    mut candidate_fits: F,
) -> Option<usize>
where
    F: FnMut(usize) -> bool,
{
    match try_ascii_hyphenation_with(text, line_start, fit_pos, options, &mut |candidate| {
        Ok::<bool, Infallible>(candidate_fits(candidate))
    }) {
        Ok(candidate) => candidate,
        Err(error) => match error {},
    }
}

pub(crate) fn try_ascii_hyphenation_with<F, E>(
    text: &Utf16Text<'_>,
    line_start: usize,
    fit_pos: usize,
    _options: &LineBreakOptions,
    mut candidate_fits: F,
) -> Result<Option<usize>, E>
where
    F: FnMut(usize) -> Result<bool, E>,
{
    let Some((word_start, word_end)) = find_ascii_word(text, line_start, fit_pos) else {
        return Ok(None);
    };
    let word = text.slice(word_start, word_end);

    for point in find_hyphenation_points(word, "en-us").into_iter().rev() {
        let candidate = word_start + point;
        if candidate <= line_start || candidate >= fit_pos.saturating_add(2) {
            continue;
        }
        if candidate_fits(candidate)? {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

pub(crate) fn contains_cjk(text: &str) -> bool {
    text.chars().any(|character| is_cjk(Some(character)))
}

pub(crate) fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[allow(dead_code)]
pub(crate) fn split_line_break_segments(text: &str, options: &LineBreakOptions) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let text = Utf16Text::new(text);
    let offsets = line_break_offsets(&text, options);
    let mut segments = Vec::new();
    let mut start = 0usize;
    for offset in offsets {
        if offset > start {
            segments.push(text.slice(start, offset).to_owned());
            start = offset;
        }
    }
    if start < text.len {
        segments.push(text.slice(start, text.len).to_owned());
    }
    segments
}

#[allow(dead_code)]
pub(crate) fn split_text_units(text: &str) -> Vec<String> {
    let mut units = Vec::new();
    let mut current = String::new();
    let mut previous_was_zwj = false;
    let mut regional_indicator_count = 0usize;
    for character in text.chars() {
        let joins_previous = current.is_empty()
            || is_combining_mark(character)
            || is_variation_selector(character)
            || is_emoji_modifier(character)
            || previous_was_zwj
            || character == '\u{200d}'
            || is_regional_indicator_pair(character, regional_indicator_count);
        if !joins_previous {
            units.push(std::mem::take(&mut current));
            regional_indicator_count = 0;
        }
        current.push(character);
        previous_was_zwj = character == '\u{200d}';
        if is_regional_indicator(character) {
            regional_indicator_count += 1;
        } else {
            regional_indicator_count = 0;
        }
    }
    if !current.is_empty() {
        units.push(current);
    }
    units
}

fn unicode_line_break_offsets(text: &Utf16Text<'_>) -> BTreeSet<usize> {
    let mut break_bytes = linebreaks(text.as_str())
        .filter_map(|(byte_index, opportunity)| {
            matches!(
                opportunity,
                BreakOpportunity::Allowed | BreakOpportunity::Mandatory
            )
            .then_some(byte_index)
        })
        .peekable();
    let mut offsets = BTreeSet::new();
    let mut utf16_offset = 0usize;

    for (byte_index, character) in text.as_str().char_indices() {
        while break_bytes
            .peek()
            .is_some_and(|break_byte| *break_byte <= byte_index)
        {
            if break_bytes.next() == Some(byte_index) && utf16_offset > 0 && utf16_offset < text.len
            {
                offsets.insert(utf16_offset);
            }
        }
        utf16_offset += character.len_utf16();
    }

    offsets
}

pub(crate) fn line_break_offsets(
    text: &Utf16Text<'_>,
    options: &LineBreakOptions,
) -> BTreeSet<usize> {
    let unicode_breaks = unicode_line_break_offsets(text);
    let resolved = options.resolved_line_break(text);
    let boundaries = text.boundaries_between(0, text.len);
    #[cfg(test)]
    let boundary_count = boundaries.len();
    let offsets = boundaries
        .into_iter()
        .filter(|position| {
            let previous = text.char_before(*position);
            let next = text.char_at(*position);
            is_allowed_line_break(
                *position,
                previous,
                next,
                &unicode_breaks,
                resolved,
                options,
            )
        })
        .collect::<BTreeSet<_>>();
    #[cfg(test)]
    super::text_work_trace::record_line_break_scan(
        text.as_str(),
        text.len,
        boundary_count,
        offsets.len(),
    );
    offsets
}

fn find_backward_break(start: usize, candidate: usize, offsets: &BTreeSet<usize>) -> Option<usize> {
    offsets.range((start + 1)..candidate).next_back().copied()
}

fn try_find_forward_fitting_break<F, E>(
    start: usize,
    end: usize,
    max_width: f64,
    offsets: &BTreeSet<usize>,
    measure_width: &mut F,
) -> Result<Option<usize>, E>
where
    F: FnMut(usize) -> Result<f64, E>,
{
    for position in offsets.range(start..end).copied() {
        if measure_width(position)? <= max_width {
            return Ok(Some(position));
        }
    }
    Ok(None)
}

fn is_allowed_line_break(
    position: usize,
    previous: Option<char>,
    next: Option<char>,
    unicode_breaks: &BTreeSet<usize>,
    line_break: ResolvedLineBreak,
    options: &LineBreakOptions,
) -> bool {
    match options.word_break {
        WordBreakSetting::BreakAll | WordBreakSetting::BreakWord => {
            // `css-line-break` permits this boundary after ASCII spaces and
            // line breaks, but not after tabs or other content.
            if is_blocked_aggressive_break_before_ascii_hyphen(previous, next) {
                return false;
            }
            return is_break_all_boundary(previous, next, line_break);
        }
        WordBreakSetting::KeepAll if is_keep_all_blocked(previous, next) => {
            return false;
        }
        WordBreakSetting::Normal | WordBreakSetting::KeepAll => {}
    }

    if next.is_some_and(char::is_whitespace) {
        return false;
    }

    if is_consecutive_dash_run_break(previous, next) {
        return false;
    }

    if unicode_breaks.contains(&position) || is_break_after(previous) {
        return match line_break {
            ResolvedLineBreak::Normal => true,
            ResolvedLineBreak::Strict => {
                !is_forbidden_line_start(next) && !is_forbidden_line_end(previous)
            }
        };
    }

    match line_break {
        ResolvedLineBreak::Normal => is_allowed_normal_cjk_break(previous, next),
        ResolvedLineBreak::Strict => is_allowed_cjk_break(previous, next),
    }
}

fn find_ascii_word(
    text: &Utf16Text<'_>,
    line_start: usize,
    fit_pos: usize,
) -> Option<(usize, usize)> {
    if fit_pos <= line_start || !is_ascii_letter(text.char_before(fit_pos)) {
        return None;
    }

    let mut start = fit_pos;
    while start > line_start && is_ascii_letter(text.char_before(start)) {
        start = text.previous_boundary(start);
    }

    let mut end = fit_pos;
    while end < text.len && is_ascii_letter(text.char_at(end)) {
        end = text.next_offset(end);
    }

    (end > start).then_some((start, end))
}

fn is_break_after(character: Option<char>) -> bool {
    matches!(
        character,
        Some(' ' | '\t' | '\n' | '\r' | '、' | '。' | '，' | '．' | '」' | '』' | '”' | '’',)
    )
}

fn is_blocked_aggressive_break_before_ascii_hyphen(
    previous: Option<char>,
    next: Option<char>,
) -> bool {
    next == Some('-') && !matches!(previous, Some(' ' | '\n' | '\r'))
}

fn is_consecutive_dash_run_break(previous: Option<char>, next: Option<char>) -> bool {
    matches!(
        (previous, next),
        (Some('-'), Some('-')) | (Some('─'), Some('─'))
    )
}

fn is_cjk(character: Option<char>) -> bool {
    let Some(character) = character else {
        return false;
    };
    matches!(
        character as u32,
        0x2e80..=0x9fff | 0xf900..=0xfaff | 0xfe30..=0xfe4f | 0x20000..=0x2fa1f | 0xff00..=0xffef
    )
}

fn is_allowed_cjk_break(previous: Option<char>, next: Option<char>) -> bool {
    if next.is_some_and(char::is_whitespace) {
        return false;
    }
    if is_blocked_opening_quote_break(previous, next) {
        return false;
    }
    (is_cjk(previous) || is_cjk(next))
        && !is_forbidden_line_start(next)
        && !is_forbidden_line_end(previous)
}

fn is_allowed_normal_cjk_break(previous: Option<char>, next: Option<char>) -> bool {
    if next.is_some_and(char::is_whitespace) {
        return false;
    }
    if is_blocked_opening_quote_break(previous, next) {
        return false;
    }
    (is_cjk(previous) || is_cjk(next))
        && !is_forbidden_punctuation_line_start(next)
        && !is_forbidden_line_end(previous)
}

fn is_break_all_boundary(
    previous: Option<char>,
    next: Option<char>,
    line_break: ResolvedLineBreak,
) -> bool {
    if previous.is_none() || next.is_none() || next.is_some_and(is_newline) {
        return false;
    }
    if next.is_some_and(char::is_whitespace) {
        return false;
    }
    match line_break {
        ResolvedLineBreak::Normal => true,
        ResolvedLineBreak::Strict => {
            !is_forbidden_line_start(next) && !is_forbidden_line_end(previous)
        }
    }
}

fn is_keep_all_blocked(previous: Option<char>, next: Option<char>) -> bool {
    let previous_is_cjk = is_cjk(previous);
    let next_is_cjk = is_cjk(next);
    previous_is_cjk && (next_is_cjk || is_ascii_letter(next))
}

fn is_strict_line_break_language(language: &str) -> bool {
    let primary = language.split('-').next().unwrap_or(language);
    matches!(primary, "ja" | "zh" | "ko")
}

fn is_opening_punctuation(character: Option<char>) -> bool {
    matches!(
        character,
        Some(
            '(' | '['
                | '{'
                | '（'
                | '【'
                | '〔'
                | '〈'
                | '《'
                | '「'
                | '『'
                | '〖'
                | '〘'
                | '〚'
                | '“'
                | '‘',
        )
    )
}

fn is_opening_quote_punctuation(character: Option<char>) -> bool {
    matches!(
        character,
        Some('「' | '『' | '【' | '〔' | '〈' | '《' | '〖' | '〘' | '〚' | '“' | '‘')
    )
}

fn is_closing_quote_punctuation(character: Option<char>) -> bool {
    matches!(
        character,
        Some('」' | '』' | '】' | '〕' | '〉' | '》' | '〗' | '〙' | '〛' | '”' | '’')
    )
}

fn is_blocked_opening_quote_break(previous: Option<char>, next: Option<char>) -> bool {
    is_opening_quote_punctuation(next)
        && !is_cjk(previous)
        && !is_closing_quote_punctuation(previous)
}

fn is_forbidden_line_start(character: Option<char>) -> bool {
    matches!(
        character,
        Some(
            '、' | '。'
                | '，'
                | '．'
                | ','
                | '.'
                | '!'
                | '?'
                | '！'
                | '？'
                | ':'
                | ';'
                | '：'
                | '；'
                | '…'
                | '‥'
                | ')'
                | ']'
                | '}'
                | '）'
                | '】'
                | '〕'
                | '〉'
                | '》'
                | '」'
                | '』'
                | '〗'
                | '〙'
                | '〛'
                | '”'
                | '’'
                | 'ー'
                | '゛'
                | '゜'
                | 'ぁ'
                | 'ぃ'
                | 'ぅ'
                | 'ぇ'
                | 'ぉ'
                | 'っ'
                | 'ゃ'
                | 'ゅ'
                | 'ょ'
                | 'ゎ'
                | 'ゕ'
                | 'ゖ'
                | 'ァ'
                | 'ィ'
                | 'ゥ'
                | 'ェ'
                | 'ォ'
                | 'ッ'
                | 'ャ'
                | 'ュ'
                | 'ョ'
                | 'ヮ'
                | 'ヵ'
                | 'ヶ'
                | 'ㇰ'
                | 'ㇱ'
                | 'ㇲ'
                | 'ㇳ'
                | 'ㇴ'
                | 'ㇵ'
                | 'ㇶ'
                | 'ㇷ'
                | 'ㇸ'
                | 'ㇹ'
                | 'ㇺ'
                | 'ㇻ'
                | 'ㇼ'
                | 'ㇽ'
                | 'ㇾ'
                | 'ㇿ'
        )
    )
}

fn is_forbidden_line_end(character: Option<char>) -> bool {
    is_opening_punctuation(character)
}

fn is_forbidden_punctuation_line_start(character: Option<char>) -> bool {
    matches!(
        character,
        Some(
            '、' | '。'
                | '，'
                | '．'
                | ','
                | '.'
                | '!'
                | '?'
                | '！'
                | '？'
                | ':'
                | ';'
                | '：'
                | '；'
                | '…'
                | '‥'
                | ')'
                | ']'
                | '}'
                | '）'
                | '】'
                | '〕'
                | '〉'
                | '》'
                | '」'
                | '』'
                | '〗'
                | '〙'
                | '〛'
                | '”'
                | '’'
        )
    )
}

fn is_ascii_letter(character: Option<char>) -> bool {
    character.is_some_and(|character| character.is_ascii_alphabetic())
}

fn is_newline(character: char) -> bool {
    matches!(character, '\n' | '\r')
}

fn is_combining_mark(character: char) -> bool {
    matches!(
        character as u32,
        0x0300..=0x036f
            | 0x1ab0..=0x1aff
            | 0x1dc0..=0x1dff
            | 0x20d0..=0x20ff
            | 0xfe20..=0xfe2f
    )
}

fn is_variation_selector(character: char) -> bool {
    matches!(character as u32, 0xfe00..=0xfe0f | 0xe0100..=0xe01ef)
}

fn is_emoji_modifier(character: char) -> bool {
    matches!(character as u32, 0x1f3fb..=0x1f3ff)
}

fn is_regional_indicator(character: char) -> bool {
    matches!(character as u32, 0x1f1e6..=0x1f1ff)
}

fn is_regional_indicator_pair(character: char, current_count: usize) -> bool {
    is_regional_indicator(character) && current_count % 2 == 1
}

#[cfg(test)]
mod tests {
    use super::{
        adjust_break_position, adjust_break_position_with_offsets_until, contains_cjk,
        find_word_break, is_allowed_cjk_break, is_allowed_normal_cjk_break,
        is_forbidden_line_start, split_line_break_segments, split_text_units,
        try_adjust_break_position_with_offsets_until, try_ascii_hyphenation,
        try_ascii_hyphenation_with, unicode_line_break_offsets, utf16_len, LineBreakOptions,
        Utf16Text,
    };

    fn options(
        line_break: Option<&str>,
        word_break: Option<&str>,
        language: Option<&str>,
    ) -> LineBreakOptions {
        LineBreakOptions::from_style(line_break, word_break, language)
    }

    #[test]
    fn keeps_opening_punctuation_breaks_available_for_greedy_fit() {
        assert!(!is_allowed_cjk_break(Some('A'), Some('『')));
        assert!(!is_allowed_cjk_break(Some('─'), Some('『')));
        assert!(is_allowed_cjk_break(Some('あ'), Some('『')));
        assert!(is_allowed_cjk_break(Some('』'), Some('『')));
        assert!(is_allowed_cjk_break(Some('O'), Some('（')));
        let text = Utf16Text::new("和「NEKO（受");
        assert_eq!(
            find_word_break(&text, 0, 6, &options(Some("strict"), None, Some("zh-CN"))),
            6
        );
    }

    #[test]
    fn blocks_opening_quote_after_dash_like_css_line_break() {
        let text = Utf16Text::new(
            "「保险起见……神圣之力是香醇之粮，赐予失去气力之人再次站起来的力量吧──『Healing』。」",
        );
        assert_eq!(
            find_word_break(&text, 0, 36, &options(Some("strict"), None, Some("zh-CN"))),
            34
        );
    }

    #[test]
    fn treats_small_kana_as_nonstarters() {
        assert!(is_forbidden_line_start(Some('っ')));
        assert!(is_forbidden_line_start(Some('ゃ')));
        assert!(is_forbidden_line_start(Some('ッ')));
        assert!(is_forbidden_line_start(Some('ㇿ')));
        assert!(!is_allowed_cjk_break(Some('だ'), Some('っ')));
        assert!(is_allowed_cjk_break(Some('っ'), Some('あ')));
    }

    #[test]
    fn treats_curly_closing_quotes_as_nonstarters() {
        assert!(is_forbidden_line_start(Some('”')));
        assert!(is_forbidden_line_start(Some('’')));
        assert!(!is_allowed_cjk_break(Some('己'), Some('”')));
        let text =
            Utf16Text::new("注：日版Let it go，这里温水说错歌词，把“做我自己”说成了“做你自己”");
        assert_eq!(
            find_word_break(&text, 0, 29, &LineBreakOptions::default()),
            28
        );
    }

    #[test]
    fn rejects_break_after_closing_punctuation_before_nonstarter() {
        assert!(!is_allowed_cjk_break(Some('」'), Some('，')));
        let text = Utf16Text::new("T先生」，他");
        assert_eq!(
            find_word_break(&text, 0, 4, &LineBreakOptions::default()),
            2
        );
    }

    #[test]
    fn uses_unicode_break_opportunities_for_whitespace() {
        let text = Utf16Text::new("hello world");

        assert_eq!(
            find_word_break(&text, 0, 8, &LineBreakOptions::default()),
            6
        );
    }

    #[test]
    fn empty_boundary_ranges_do_not_panic() {
        let text = Utf16Text::new("abc");

        assert!(text.boundaries_between(2, 2).is_empty());
        assert!(text.boundaries_between(2, 1).is_empty());
    }

    #[test]
    fn keeps_consecutive_dash_runs_together_like_css_line_break() {
        let text = Utf16Text::new("    --------------------------------------------");

        assert_eq!(
            find_word_break(&text, 0, 48, &LineBreakOptions::default()),
            4
        );
    }

    #[test]
    fn keeps_dash_runs_with_trailing_spaces_together_like_css_line_break() {
        let text = Utf16Text::new(
            "    --------------------------------------------    ---------------------------",
        );

        assert_eq!(
            find_word_break(&text, 0, 51, &LineBreakOptions::default()),
            4
        );
    }

    #[test]
    fn does_not_break_before_ascii_space_after_cjk_character() {
        let text = Utf16Text::new("金色之雷帝 〉");

        assert_eq!(
            find_word_break(&text, 0, 5, &options(Some("strict"), None, Some("zh-CN"))),
            4
        );
    }

    #[test]
    fn adjusts_unclassified_break_candidate_like_ts_greedy_breaker() {
        let text = Utf16Text::new("hello world");

        assert_eq!(
            adjust_break_position(
                &text,
                0,
                text.len,
                8,
                100.0,
                |_| 0.0,
                &LineBreakOptions::default()
            ),
            6
        );
    }

    #[test]
    fn bounded_forward_adjustment_does_not_probe_the_unbounded_suffix() {
        let offsets = std::collections::BTreeSet::from([8, 100, 200]);
        let mut measured = Vec::new();

        let adjusted = adjust_break_position_with_offsets_until(
            0,
            256,
            5,
            10.0,
            |position| {
                measured.push(position);
                11.0
            },
            &offsets,
            10,
        );

        assert_eq!(adjusted, 5);
        assert_eq!(measured, [8]);
    }

    #[test]
    fn fallible_forward_adjustment_preserves_the_infallible_candidate_order() {
        let offsets = std::collections::BTreeSet::from([8, 10, 12, 20]);
        let mut infallible_candidates = Vec::new();
        let infallible = adjust_break_position_with_offsets_until(
            0,
            32,
            5,
            10.0,
            |position| {
                infallible_candidates.push(position);
                match position {
                    8 => 11.0,
                    10 => 12.0,
                    12 => 9.0,
                    _ => unreachable!("unexpected candidate"),
                }
            },
            &offsets,
            13,
        );
        let mut fallible_candidates = Vec::new();
        let fallible = try_adjust_break_position_with_offsets_until(
            0,
            32,
            5,
            10.0,
            |position| {
                fallible_candidates.push(position);
                Ok::<f64, ()>(match position {
                    8 => 11.0,
                    10 => 12.0,
                    12 => 9.0,
                    _ => unreachable!("unexpected candidate"),
                })
            },
            &offsets,
            13,
        )
        .expect("successful fallible adjustment");

        assert_eq!(infallible, 12);
        assert_eq!(fallible, infallible);
        assert_eq!(fallible_candidates, [8, 10, 12]);
        assert_eq!(fallible_candidates, infallible_candidates);
    }

    #[test]
    fn failed_forward_adjustment_stops_and_replays_from_cached_widths() {
        const FAILED_CANDIDATE: usize = 10;
        let offsets = std::collections::BTreeSet::from([8, 10, 12, 20]);
        let mut cached_widths = std::collections::BTreeMap::new();
        let mut first_candidates = Vec::new();
        let first = try_adjust_break_position_with_offsets_until(
            0,
            32,
            5,
            10.0,
            |position| {
                first_candidates.push(position);
                if position == FAILED_CANDIDATE {
                    return Err(position);
                }
                let width = 11.0;
                cached_widths.insert(position, width);
                Ok(width)
            },
            &offsets,
            13,
        );

        assert_eq!(first, Err(FAILED_CANDIDATE));
        assert_eq!(first_candidates, [8, FAILED_CANDIDATE]);

        let mut replay_candidates = Vec::new();
        let mut replay_misses = Vec::new();
        let replayed = try_adjust_break_position_with_offsets_until(
            0,
            32,
            5,
            10.0,
            |position| {
                replay_candidates.push(position);
                if let Some(width) = cached_widths.get(&position) {
                    return Ok::<f64, usize>(*width);
                }
                replay_misses.push(position);
                let width = if position == 12 { 9.0 } else { 11.0 };
                cached_widths.insert(position, width);
                Ok(width)
            },
            &offsets,
            13,
        )
        .expect("cached replay succeeds");

        assert_eq!(replayed, 12);
        assert_eq!(replay_candidates, [8, 10, 12]);
        assert_eq!(replay_misses, [10, 12]);
    }

    #[test]
    fn hyphenates_long_ascii_word_like_ts_greedy_breaker() {
        let text = Utf16Text::new("Nokyoushitsue");

        assert_eq!(
            find_word_break(&text, 0, 11, &LineBreakOptions::default()),
            11
        );
        assert_eq!(
            try_ascii_hyphenation(&text, 0, 11, &LineBreakOptions::default(), |end| end <= 10),
            Some(10)
        );
    }

    #[test]
    fn fallible_ascii_hyphenation_preserves_the_infallible_candidate_order() {
        let text = Utf16Text::new("Nokyoushitsue");
        let mut infallible_candidates = Vec::new();
        let infallible =
            try_ascii_hyphenation(&text, 0, 11, &LineBreakOptions::default(), |candidate| {
                infallible_candidates.push(candidate);
                candidate <= 4
            });
        let mut fallible_candidates = Vec::new();
        let fallible =
            try_ascii_hyphenation_with(&text, 0, 11, &LineBreakOptions::default(), |candidate| {
                fallible_candidates.push(candidate);
                Ok::<bool, ()>(candidate <= 4)
            })
            .expect("successful fallible hyphenation");

        assert_eq!(infallible, Some(4));
        assert_eq!(fallible, infallible);
        assert_eq!(fallible_candidates, [10, 4]);
        assert_eq!(fallible_candidates, infallible_candidates);
    }

    #[test]
    fn failed_ascii_hyphenation_stops_and_replays_from_cached_fits() {
        const FAILED_CANDIDATE: usize = 4;
        let text = Utf16Text::new("Nokyoushitsue");
        let mut cached_fits = std::collections::BTreeMap::new();
        let mut first_candidates = Vec::new();
        let first =
            try_ascii_hyphenation_with(&text, 0, 11, &LineBreakOptions::default(), |candidate| {
                first_candidates.push(candidate);
                if candidate == FAILED_CANDIDATE {
                    return Err(candidate);
                }
                cached_fits.insert(candidate, false);
                Ok(false)
            });

        assert_eq!(first, Err(FAILED_CANDIDATE));
        assert_eq!(first_candidates, [10, FAILED_CANDIDATE]);

        let mut replay_candidates = Vec::new();
        let mut replay_misses = Vec::new();
        let replayed =
            try_ascii_hyphenation_with(&text, 0, 11, &LineBreakOptions::default(), |candidate| {
                replay_candidates.push(candidate);
                if let Some(fits) = cached_fits.get(&candidate) {
                    return Ok::<bool, usize>(*fits);
                }
                replay_misses.push(candidate);
                cached_fits.insert(candidate, true);
                Ok(true)
            })
            .expect("cached replay succeeds");

        assert_eq!(replayed, Some(4));
        assert_eq!(replay_candidates, [10, 4]);
        assert_eq!(replay_misses, [4]);
    }

    #[test]
    fn hyphenation_matches_the_ts_dictionary_independent_of_document_language() {
        let text = Utf16Text::new("hyphenation");

        assert_eq!(
            try_ascii_hyphenation(&text, 0, text.len, &options(None, None, Some("ja")), |_| {
                true
            }),
            Some(6)
        );
    }

    #[test]
    fn keeps_utf16_offsets_for_surrogate_pairs() {
        let text = Utf16Text::new("a𠮷b");

        assert_eq!(text.len, 4);
        assert_eq!(utf16_len("a𠮷"), 3);
        assert_eq!(text.slice(1, 3), "𠮷");
        assert_eq!(text.char_at(3), Some('b'));
    }

    #[test]
    fn detects_current_cjk_break_range() {
        assert!(contains_cjk("教室"));
        assert!(contains_cjk("ＡＢＣ"));
        assert!(!contains_cjk("ABC"));
    }

    #[test]
    fn unicode_break_offsets_are_utf16_offsets() {
        let text = Utf16Text::new("a𠮷 b");
        let offsets = unicode_line_break_offsets(&text);

        assert!(offsets.contains(&4));
        assert!(!offsets.contains(&5));
    }

    #[test]
    fn splits_line_break_segments_from_offsets() {
        let segments = split_line_break_segments(
            "温水 和 杏菜",
            &options(Some("strict"), None, Some("zh-CN")),
        );

        assert_eq!(segments.concat(), "温水 和 杏菜");
        assert!(segments.len() > 1);
    }

    #[test]
    fn splits_text_units_by_grapheme_like_clusters() {
        assert_eq!(split_text_units("A猫🙂"), ["A", "猫", "🙂"]);
        assert_eq!(
            split_text_units("e\u{301}cole"),
            ["e\u{301}", "c", "o", "l", "e"]
        );
        assert_eq!(split_text_units("👩\u{200d}💻"), ["👩\u{200d}💻"]);
        assert_eq!(split_text_units("🇯🇵🇺🇸"), ["🇯🇵", "🇺🇸"]);
    }

    #[test]
    fn explicit_normal_line_break_allows_small_kana_start() {
        assert!(is_allowed_normal_cjk_break(Some('あ'), Some('っ')));
        assert!(!is_allowed_cjk_break(Some('あ'), Some('っ')));
    }

    #[test]
    fn auto_line_break_uses_strict_rules_when_text_contains_cjk() {
        let text = Utf16Text::new("日あっ");

        assert_eq!(
            find_word_break(&text, 0, 2, &options(Some("normal"), None, None)),
            2
        );
        assert_eq!(find_word_break(&text, 0, 2, &options(None, None, None)), 1);
    }

    #[test]
    fn auto_line_break_is_strict_for_cjk_languages() {
        let text = Utf16Text::new("あっあ");

        assert_eq!(
            find_word_break(&text, 0, 2, &options(None, None, Some("ja-JP"))),
            2
        );
    }

    #[test]
    fn word_break_break_all_allows_alphabetic_boundaries() {
        let text = Utf16Text::new("hello");

        assert_eq!(
            find_word_break(&text, 0, 4, &options(None, Some("break-all"), None)),
            4
        );
    }

    #[test]
    fn aggressive_word_break_modes_match_ts_dash_run_boundaries() {
        for word_break in ["break-all", "break-word"] {
            let hyphens =
                split_line_break_segments(&"-".repeat(27), &options(None, Some(word_break), None));
            let embedded =
                split_line_break_segments("a--b", &options(None, Some(word_break), None));
            let surrounded =
                split_line_break_segments("--a--", &options(None, Some(word_break), None));
            let leading_space =
                split_line_break_segments(" ---", &options(None, Some(word_break), None));
            let leading_tab =
                split_line_break_segments("\t---", &options(None, Some(word_break), None));
            let box_drawing =
                split_line_break_segments(&"─".repeat(27), &options(None, Some(word_break), None));

            assert_eq!(hyphens, ["-".repeat(27)], "word-break: {word_break}");
            assert_eq!(embedded, ["a--", "b"], "word-break: {word_break}");
            assert_eq!(surrounded, ["--", "a--"], "word-break: {word_break}");
            assert_eq!(leading_space, [" ", "---"], "word-break: {word_break}");
            assert_eq!(leading_tab, ["\t---"], "word-break: {word_break}");
            assert_eq!(box_drawing, ["─"; 27], "word-break: {word_break}");
        }
    }

    #[test]
    fn word_break_break_word_matches_ts_character_boundaries() {
        let text = Utf16Text::new("hello");

        assert_eq!(
            find_word_break(&text, 0, 4, &options(None, Some("break-word"), None)),
            4
        );
    }

    #[test]
    fn word_break_keep_all_blocks_cjk_boundaries() {
        let text = Utf16Text::new("日本語ABC日本");

        assert_eq!(
            find_word_break(
                &text,
                0,
                3,
                &options(Some("strict"), Some("keep-all"), None)
            ),
            3
        );
        assert_eq!(
            find_word_break(
                &text,
                0,
                7,
                &options(Some("strict"), Some("keep-all"), None)
            ),
            6
        );
    }
}
