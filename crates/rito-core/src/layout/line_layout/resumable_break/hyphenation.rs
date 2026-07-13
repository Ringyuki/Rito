use crate::layout::{
    hyphenation::find_hyphenation_points,
    line_break::Utf16Text,
    text_work::{AtomicTextOperationKind, TextWorkMeter},
};

use super::{permit_atomic, TextWorkYield};

#[derive(Debug)]
pub(super) struct PendingAsciiHyphenation {
    line_start: usize,
    fit_pos: usize,
    word_start: usize,
    word_end: usize,
    pending_utf16_units: usize,
    points: Vec<usize>,
    point_index: usize,
    pending_candidate: Option<usize>,
    result: Option<Option<usize>>,
    stage: HyphenationStage,
    #[cfg(test)]
    point_generation_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HyphenationStage {
    Eligibility,
    ScanStart,
    ScanEnd,
    GeneratePoints,
    ProbeCandidates,
    Complete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PendingHyphenationAdvance {
    Candidate(usize),
    Complete(Option<usize>),
}

impl PendingAsciiHyphenation {
    pub(super) fn new(line_start: usize, fit_pos: usize) -> Self {
        Self {
            line_start,
            fit_pos,
            word_start: fit_pos,
            word_end: fit_pos,
            pending_utf16_units: 0,
            points: Vec::new(),
            point_index: 0,
            pending_candidate: None,
            result: None,
            stage: HyphenationStage::Eligibility,
            #[cfg(test)]
            point_generation_count: 0,
        }
    }

    pub(super) fn require_request(&self, line_start: usize, fit_pos: usize) {
        assert_eq!(
            self.line_start, line_start,
            "hyphen replay changed its line start"
        );
        assert_eq!(
            self.fit_pos, fit_pos,
            "hyphen replay changed its fit position"
        );
    }

    pub(super) fn advance(
        &mut self,
        text: &Utf16Text<'_>,
        work: &mut TextWorkMeter,
    ) -> Result<PendingHyphenationAdvance, TextWorkYield> {
        loop {
            match self.stage {
                HyphenationStage::Eligibility => self.check_eligibility(text, work)?,
                HyphenationStage::ScanStart => self.scan_word_start(text, work)?,
                HyphenationStage::ScanEnd => self.scan_word_end(text, work)?,
                HyphenationStage::GeneratePoints => self.generate_points(text, work)?,
                HyphenationStage::ProbeCandidates => return self.probe_candidates(work),
                HyphenationStage::Complete => {
                    return Ok(PendingHyphenationAdvance::Complete(
                        self.result.expect("completed hyphenation has a result"),
                    ));
                }
            }
        }
    }

    pub(super) fn resolve_candidate(&mut self, candidate: usize, fits: bool) {
        assert_eq!(
            self.pending_candidate,
            Some(candidate),
            "hyphen candidate replay changed its endpoint"
        );
        if fits {
            self.complete(Some(candidate));
        } else {
            self.pending_candidate = None;
        }
    }

    fn check_eligibility(
        &mut self,
        text: &Utf16Text<'_>,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if self.fit_pos <= self.line_start {
            self.complete(None);
            return Ok(());
        }
        let character = text.char_before(self.fit_pos);
        self.consume_character(work, character)?;
        if character.is_some_and(|character| character.is_ascii_alphabetic()) {
            self.stage = HyphenationStage::ScanStart;
        } else {
            self.complete(None);
        }
        Ok(())
    }

    fn scan_word_start(
        &mut self,
        text: &Utf16Text<'_>,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        while self.word_start > self.line_start {
            let character = text.char_before(self.word_start);
            self.consume_character(work, character)?;
            if !character.is_some_and(|character| character.is_ascii_alphabetic()) {
                break;
            }
            self.word_start -= 1;
        }
        self.stage = HyphenationStage::ScanEnd;
        Ok(())
    }

    fn scan_word_end(
        &mut self,
        text: &Utf16Text<'_>,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        while self.word_end < text.len {
            let character = text.char_at(self.word_end);
            self.consume_character(work, character)?;
            if !character.is_some_and(|character| character.is_ascii_alphabetic()) {
                break;
            }
            self.word_end += 1;
        }
        self.stage = HyphenationStage::GeneratePoints;
        Ok(())
    }

    fn generate_points(
        &mut self,
        text: &Utf16Text<'_>,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        let word_len = self.word_end.saturating_sub(self.word_start);
        permit_atomic(work, AtomicTextOperationKind::Hyphenation, word_len)?;
        #[cfg(test)]
        {
            self.point_generation_count += 1;
        }
        self.points = find_hyphenation_points(text.slice(self.word_start, self.word_end), "en-us");
        self.point_index = self.points.len();
        self.stage = HyphenationStage::ProbeCandidates;
        Ok(())
    }

    fn probe_candidates(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<PendingHyphenationAdvance, TextWorkYield> {
        if let Some(candidate) = self.pending_candidate {
            return Ok(PendingHyphenationAdvance::Candidate(candidate));
        }
        let Some(candidate) = self.next_candidate(work)? else {
            self.complete(None);
            return Ok(PendingHyphenationAdvance::Complete(None));
        };
        self.pending_candidate = Some(candidate);
        Ok(PendingHyphenationAdvance::Candidate(candidate))
    }

    fn next_candidate(&mut self, work: &mut TextWorkMeter) -> Result<Option<usize>, TextWorkYield> {
        while self.point_index > 0 {
            if work.take_utf16_units(1) != 1 {
                return Err(TextWorkYield);
            }
            self.point_index -= 1;
            let candidate = self.word_start + self.points[self.point_index];
            if candidate > self.line_start && candidate < self.fit_pos.saturating_add(2) {
                return Ok(Some(candidate));
            }
        }
        Ok(None)
    }

    fn consume_character(
        &mut self,
        work: &mut TextWorkMeter,
        character: Option<char>,
    ) -> Result<(), TextWorkYield> {
        if self.pending_utf16_units == 0 {
            self.pending_utf16_units = character.map_or(0, char::len_utf16);
        }
        let consumed = work.take_utf16_units(self.pending_utf16_units);
        self.pending_utf16_units -= consumed;
        if self.pending_utf16_units == 0 {
            Ok(())
        } else {
            Err(TextWorkYield)
        }
    }

    fn complete(&mut self, result: Option<usize>) {
        self.result = Some(result);
        self.stage = HyphenationStage::Complete;
    }

    #[cfg(test)]
    pub(super) const fn point_generation_count(&self) -> usize {
        self.point_generation_count
    }
}

#[cfg(test)]
mod tests;
