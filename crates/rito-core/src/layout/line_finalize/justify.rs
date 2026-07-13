use super::super::{
    line::LineRun,
    line_align::JustifyPlan,
    line_break::is_cjk_character,
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug)]
pub(super) struct PendingJustifyAnalysis {
    mode: JustifyMode,
    run_index: usize,
    per_run_ascii_spaces: Vec<usize>,
    per_run_inter_gaps: Vec<usize>,
    boundary_before: Vec<bool>,
    text: Option<PendingTextAnalysis>,
    previous_text_was_cjk: bool,
    contains_atom: bool,
    total_spaces: usize,
    total_inter_gaps: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum JustifyMode {
    Auto,
    InterCharacter,
    InterWord,
}

#[derive(Debug, Default)]
struct JustifyRunStats {
    ascii_spaces: usize,
    scalar_count: usize,
    has_cjk: bool,
    boundary_before: bool,
}

#[derive(Debug, Default)]
struct PendingTextAnalysis {
    byte_cursor: usize,
    stats: JustifyRunStats,
    pending_scalar: Option<PendingScalar>,
}

#[derive(Debug)]
struct PendingScalar {
    character: char,
    utf8_len: usize,
    utf16_units_remaining: usize,
}

impl JustifyMode {
    pub(super) fn from_css(value: &str) -> Option<Self> {
        match value {
            "none" => None,
            "inter-character" => Some(Self::InterCharacter),
            "inter-word" => Some(Self::InterWord),
            _ => Some(Self::Auto),
        }
    }
}

impl PendingJustifyAnalysis {
    pub(super) fn new(mode: JustifyMode, run_count: usize) -> Self {
        Self {
            mode,
            run_index: 0,
            per_run_ascii_spaces: Vec::with_capacity(run_count),
            per_run_inter_gaps: Vec::with_capacity(run_count),
            boundary_before: Vec::with_capacity(run_count),
            text: None,
            previous_text_was_cjk: false,
            contains_atom: false,
            total_spaces: 0,
            total_inter_gaps: 0,
        }
    }

    pub(super) fn advance(
        &mut self,
        runs: &[LineRun],
        work: &mut TextWorkMeter,
    ) -> Result<JustifyPlan, TextWorkYield> {
        while self.run_index < runs.len() {
            if self.text.is_none() {
                require_unit(work)?;
                match &runs[self.run_index] {
                    LineRun::Text(_) => self.text = Some(PendingTextAnalysis::default()),
                    LineRun::Atom(_) => {
                        self.contains_atom = true;
                        self.finish_non_text_run();
                    }
                    LineRun::Ruby(_) => self.finish_non_text_run(),
                }
                if self.text.is_none() {
                    continue;
                }
            }

            let LineRun::Text(run) = &runs[self.run_index] else {
                unreachable!("only text runs retain text analysis state")
            };
            let text = self.text.as_mut().expect("text analysis is initialized");
            text.advance(&run.text, work)?;
            self.finish_text_run();
        }

        Ok(self.take_plan())
    }

    fn finish_non_text_run(&mut self) {
        self.previous_text_was_cjk = false;
        self.record_run(JustifyRunStats::default());
        self.run_index += 1;
    }

    fn finish_text_run(&mut self) {
        let mut text = self.text.take().expect("text analysis is complete");
        text.stats.boundary_before = self.previous_text_was_cjk && text.stats.has_cjk;
        self.previous_text_was_cjk = text.stats.has_cjk;
        self.record_run(text.stats);
        self.run_index += 1;
    }

    fn record_run(&mut self, stats: JustifyRunStats) {
        let inter_gaps = if stats.has_cjk {
            stats.scalar_count.saturating_sub(1)
        } else {
            0
        };
        self.total_spaces += stats.ascii_spaces;
        self.total_inter_gaps += inter_gaps + usize::from(stats.boundary_before);
        self.per_run_ascii_spaces.push(stats.ascii_spaces);
        self.per_run_inter_gaps.push(inter_gaps);
        self.boundary_before.push(stats.boundary_before);
    }

    fn take_plan(&mut self) -> JustifyPlan {
        debug_assert_eq!(self.per_run_ascii_spaces.len(), self.run_index);
        debug_assert_eq!(self.per_run_inter_gaps.len(), self.run_index);
        debug_assert_eq!(self.boundary_before.len(), self.run_index);
        if self.total_spaces > 0 && self.mode != JustifyMode::InterCharacter {
            return JustifyPlan::Word {
                per_run: std::mem::take(&mut self.per_run_ascii_spaces),
                total_gaps: self.total_spaces,
            };
        }
        if self.mode == JustifyMode::InterWord || self.contains_atom {
            return JustifyPlan::None;
        }

        if self.total_inter_gaps == 0 {
            JustifyPlan::None
        } else {
            JustifyPlan::InterCharacter {
                per_run: std::mem::take(&mut self.per_run_inter_gaps),
                boundary_before: std::mem::take(&mut self.boundary_before),
                total_gaps: self.total_inter_gaps,
            }
        }
    }
}

impl PendingTextAnalysis {
    fn advance(&mut self, value: &str, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        loop {
            if self.pending_scalar.is_none() {
                let Some(character) = value[self.byte_cursor..].chars().next() else {
                    return Ok(());
                };
                self.pending_scalar = Some(PendingScalar {
                    character,
                    utf8_len: character.len_utf8(),
                    utf16_units_remaining: character.len_utf16(),
                });
            }
            let scalar = self
                .pending_scalar
                .as_mut()
                .expect("pending scalar is initialized");
            let taken = work.take_utf16_units(scalar.utf16_units_remaining);
            scalar.utf16_units_remaining -= taken;
            if scalar.utf16_units_remaining != 0 {
                return Err(TextWorkYield);
            }

            let scalar = self.pending_scalar.take().expect("scalar is complete");
            self.byte_cursor += scalar.utf8_len;
            self.stats.scalar_count += 1;
            self.stats.ascii_spaces += usize::from(scalar.character == ' ');
            self.stats.has_cjk |= is_cjk_character(scalar.character);
        }
    }
}

fn require_unit(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    if work.take_utf16_units(1) == 1 {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}

#[cfg(test)]
#[path = "justify_tests.rs"]
mod tests;
