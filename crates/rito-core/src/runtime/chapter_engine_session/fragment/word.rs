//! The word a double tap selects, the way the browser chooses it: the word
//! the caret sits in; on a boundary between two words, the one after the
//! caret, except at the end of a line that wraps inside its paragraph or at
//! the end of the text, where it is the one before. A word selected at the
//! end of a paragraph (or before a forced break) ends at the caret. Spaces
//! a soft wrap leaves at a line's end and a forced break are not drawn: a
//! caret among them stands at the end of the line's drawn text.

use super::super::super::page_artifact::{FragmentPageArtifact, FragmentRunRecord};
use crate::interaction::{plain_word_around, WordSide};

/// What follows a page: whether there is a next page, and the paragraph its
/// text begins with.
#[derive(Clone, Copy, Debug)]
pub(super) struct NextPage {
    pub(super) exists: bool,
    pub(super) first_paragraph: Option<u32>,
}

/// The word around `caret`, a UTF-16 offset in the page text.
pub(super) fn word_around(
    artifact: &FragmentPageArtifact,
    caret: usize,
    next: NextPage,
    language: Option<&str>,
) -> (u32, u32) {
    let units: Vec<u16> = artifact.page_text().encode_utf16().collect();
    let end = line_end_at(artifact, &units, caret, next);
    let (caret, side, paragraph_end) = match end {
        Some(end) => {
            let text_end = !next.exists && end.last_on_page;
            let side = if text_end || (!end.paragraph_end && !end.line_start) {
                WordSide::Before
            } else {
                WordSide::After
            };
            (end.drawn_end, side, end.paragraph_end)
        }
        None => (caret, WordSide::After, false),
    };
    let caret = caret as u32;
    match plain_word_around(artifact.page_text(), caret, side, language) {
        Some((start, end)) if paragraph_end => (start, end.min(caret)),
        Some(word) => word,
        None => (caret, caret),
    }
}

/// Where a caret at the end of its line's drawn text stands.
struct LineEnd {
    /// The end of the line's drawn text.
    drawn_end: usize,
    /// The line draws nothing before it.
    line_start: bool,
    /// The line ends its paragraph: its last, or one a forced break ends.
    paragraph_end: bool,
    /// No text follows on the page.
    last_on_page: bool,
}

/// The line `caret` ends, when it stands at or past the end of the line's
/// drawn text.
fn line_end_at(
    artifact: &FragmentPageArtifact,
    units: &[u16],
    caret: usize,
    next: NextPage,
) -> Option<LineEnd> {
    let runs = artifact.interaction_runs();
    let on_line = |run: &FragmentRunRecord, other: &FragmentRunRecord| {
        other.block_index == run.block_index && other.line_index == run.line_index
    };
    runs.iter()
        .filter(|run| run.start <= caret && caret <= run.end)
        .find_map(|run| {
            let line = || runs.iter().filter(|other| on_line(run, other));
            let line_end = line().map(|other| other.end).max()?;
            let line_start = line().map(|other| other.start).min()?;
            if run.end != line_end {
                return None;
            }
            let forced = units.get(line_end.checked_sub(1)?) == Some(&u16::from(b'\n'))
                || artifact.hard_break_offsets().contains(&line_end);
            let mut drawn_end = line_end;
            if units.get(drawn_end.wrapping_sub(1)) == Some(&u16::from(b'\n')) {
                drawn_end -= 1;
            }
            while !forced && drawn_end > line_start && units[drawn_end - 1] == u16::from(b' ') {
                drawn_end -= 1;
            }
            if caret < drawn_end {
                return None;
            }
            let later_line = runs.iter().any(|other| {
                other.paragraph == run.paragraph
                    && other.block_index == run.block_index
                    && other.line_index > run.line_index
            });
            let continues = !forced && (later_line || next.first_paragraph == Some(run.paragraph));
            Some(LineEnd {
                drawn_end,
                line_start: drawn_end == line_start,
                paragraph_end: !continues,
                last_on_page: runs.iter().all(|other| other.end <= line_end),
            })
        })
}
