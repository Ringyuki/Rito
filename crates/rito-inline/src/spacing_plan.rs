//! The letter spacing and `halt` features a paragraph's build pushes on
//! top of its runs' own styles, held apart from the edits the line loop
//! decides: the build emits its pushes from here, and the line loop reads
//! here what spacing any byte would carry under any edits without
//! building the paragraph again.
//!
//! The pushes layer as the builder takes them, a later push over the same
//! bytes replacing an earlier one: each run's author spacing (pushed with
//! its styles), the pair trims a break has not separated, the ruby
//! spreads, the split spreads, and last the line-end trims. A box's start
//! and end sizes are not spacing: they are inline boxes of their own.

use std::ops::Range;

use crate::{shaped::ParagraphEdits, PunctuationTrim, PunctuationTrimEdit};

pub(crate) struct SpacingPlan {
    /// Every pair trim the paragraph takes while no break separates it, in
    /// text order.
    pair_trims: Vec<PunctuationTrim>,
    /// Each pair trim by the character its edit applies to.
    pair_by_edit: rustc_hash::FxHashMap<usize, usize>,
    ruby_spreads: Vec<(Range<usize>, f32)>,
    runs: Vec<PlannedRun>,
}

/// A text run's own letter spacing and the spacing a line-end trim gives
/// one of its characters.
pub(crate) struct PlannedRun {
    pub(crate) range: Range<usize>,
    pub(crate) author: f32,
    pub(crate) end_trim: f32,
}

/// One push the build makes on top of the runs' styles.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum SpacingPush {
    LetterSpacing(Range<usize>, f32),
    Halt(Range<usize>),
}

impl SpacingPlan {
    pub(crate) fn new(
        pair_trims: Vec<PunctuationTrim>,
        ruby_spreads: Vec<(Range<usize>, f32)>,
        runs: Vec<PlannedRun>,
    ) -> Self {
        let pair_by_edit = pair_trims
            .iter()
            .enumerate()
            .map(|(index, trim)| (trim.edit_range.start, index))
            .collect();
        Self {
            pair_trims,
            pair_by_edit,
            ruby_spreads,
            runs,
        }
    }

    /// The pair trims `edits` leaves applied: every one no break was found
    /// to separate.
    pub(crate) fn applied_pair_trims<'a>(
        &'a self,
        edits: ParagraphEdits<'a>,
    ) -> impl Iterator<Item = &'a PunctuationTrim> + 'a {
        self.pair_trims
            .iter()
            .filter(move |trim| !edits.suppressed_pair_trims.contains(&trim.left_byte))
    }

    /// The pushes a build under `edits` makes, in the order it makes them.
    pub(crate) fn pushes(&self, text: &str, edits: ParagraphEdits<'_>) -> Vec<SpacingPush> {
        let mut pushes = Vec::new();
        for trim in self.applied_pair_trims(edits) {
            let range = trim.edit_range.clone();
            let spacing = match trim.edit {
                PunctuationTrimEdit::OpenerHalt(_) => {
                    pushes.push(SpacingPush::Halt(range));
                    continue;
                }
                PunctuationTrimEdit::LetterSpacing(spacing) => spacing,
            };
            pushes.push(SpacingPush::LetterSpacing(range, spacing));
        }
        for (range, spacing) in &self.ruby_spreads {
            pushes.push(SpacingPush::LetterSpacing(range.clone(), *spacing));
        }
        // A split spread segment's widening, decided by the line loop once
        // line breaks are known (the segment carries its allocated
        // annotation words and spreads to their advance).
        for (range, spacing) in edits.split_spreads {
            pushes.push(SpacingPush::LetterSpacing(range.clone(), *spacing));
        }
        for &byte in edits.end_trims {
            let (Some(character), Some(run)) = (text[byte..].chars().next(), self.run_at(byte))
            else {
                continue;
            };
            pushes.push(SpacingPush::LetterSpacing(
                byte..byte + character.len_utf8(),
                run.end_trim,
            ));
        }
        pushes
    }

    /// The letter spacing the character at `byte` carries in a build under
    /// `edits` (its line-end trims and suppressed pairs sorted): the last
    /// push over it, its run's author spacing below them. Found without
    /// replaying the pushes: a pair trim and a line-end trim each cover one
    /// character, found by its start.
    pub(crate) fn letter_spacing_at(
        &self,
        text: &str,
        byte: usize,
        edits: ParagraphEdits<'_>,
    ) -> f32 {
        debug_assert!(edits.end_trims.is_sorted() && edits.suppressed_pair_trims.is_sorted());
        let run = self.run_at(byte);
        if edits.end_trims.binary_search(&byte).is_ok() && text[byte..].chars().next().is_some() {
            if let Some(run) = run {
                return run.end_trim;
            }
        }
        let latest = |spreads: &[(Range<usize>, f32)]| {
            spreads
                .iter()
                .rev()
                .find(|(range, _)| range.contains(&byte))
                .map(|(_, spacing)| *spacing)
        };
        if let Some(spacing) = latest(edits.split_spreads).or_else(|| latest(&self.ruby_spreads)) {
            return spacing;
        }
        self.pair_editing(byte)
            .filter(|trim| !Self::suppressed(edits, trim))
            .and_then(|trim| match trim.edit {
                PunctuationTrimEdit::LetterSpacing(spacing) => Some(spacing),
                PunctuationTrimEdit::OpenerHalt(_) => None,
            })
            .unwrap_or_else(|| run.map_or(0.0, |run| run.author))
    }

    /// The half width `halt` removes from the opener at `byte` in a build
    /// under `edits`, when it is shaped with it.
    pub(crate) fn halt_half_at(&self, byte: usize, edits: ParagraphEdits<'_>) -> Option<f32> {
        self.pair_editing(byte)
            .filter(|trim| !Self::suppressed(edits, trim))
            .and_then(|trim| match trim.edit {
                PunctuationTrimEdit::OpenerHalt(half) => Some(half),
                PunctuationTrimEdit::LetterSpacing(_) => None,
            })
    }

    /// The pair trim applied under `edits` whose right character starts at
    /// `right_byte`: the pair a break there separates.
    pub(crate) fn applied_pair_ending_at(
        &self,
        right_byte: usize,
        edits: ParagraphEdits<'_>,
    ) -> Option<&PunctuationTrim> {
        let at = self
            .pair_trims
            .partition_point(|trim| trim.right_byte < right_byte);
        self.pair_trims
            .get(at)
            .filter(|trim| trim.right_byte == right_byte && !Self::suppressed(edits, trim))
    }

    /// Where the pair trim whose left character starts at `left_byte`
    /// applies its edit.
    pub(crate) fn pair_edit_start(&self, left_byte: usize) -> Option<usize> {
        let at = self
            .pair_trims
            .partition_point(|trim| trim.left_byte < left_byte);
        self.pair_trims
            .get(at)
            .filter(|trim| trim.left_byte == left_byte)
            .map(|trim| trim.edit_range.start)
    }

    /// The pair trim whose edit applies to the character at `byte`, applied
    /// or not: each character is the edit of one pair at most.
    fn pair_editing(&self, byte: usize) -> Option<&PunctuationTrim> {
        self.pair_by_edit
            .get(&byte)
            .map(|&index| &self.pair_trims[index])
    }

    fn suppressed(edits: ParagraphEdits<'_>, trim: &PunctuationTrim) -> bool {
        edits
            .suppressed_pair_trims
            .binary_search(&trim.left_byte)
            .is_ok()
    }

    fn run_at(&self, byte: usize) -> Option<&PlannedRun> {
        let at = self.runs.partition_point(|run| run.range.end <= byte);
        self.runs.get(at).filter(|run| run.range.contains(&byte))
    }
}
