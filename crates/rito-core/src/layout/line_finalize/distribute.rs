use super::super::{
    line::LineRun,
    line_align::JustifyPlan,
    text_shape::PendingShapeSpacing,
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug)]
pub(super) struct PendingJustifyDistribution {
    plan: DistributionPlan,
    run_index: usize,
    x_offset: f64,
    shape_spacing: Option<PendingShapeSpacing>,
}

#[derive(Debug)]
enum DistributionPlan {
    Word {
        per_run: Vec<usize>,
        gap_size: f64,
    },
    InterCharacter {
        per_run: Vec<usize>,
        boundary_before: Vec<bool>,
        gap_size: f64,
    },
}

impl PendingJustifyDistribution {
    pub(super) fn new(plan: JustifyPlan, extra: f64) -> Option<Self> {
        if !extra.is_finite() || extra <= 0.0 {
            return None;
        }
        let plan = match plan {
            JustifyPlan::None => return None,
            JustifyPlan::Word {
                per_run,
                total_gaps,
            } => {
                if total_gaps == 0 {
                    return None;
                }
                DistributionPlan::Word {
                    per_run,
                    gap_size: extra / total_gaps as f64,
                }
            }
            JustifyPlan::InterCharacter {
                per_run,
                boundary_before,
                total_gaps,
            } => {
                if total_gaps == 0 {
                    return None;
                }
                DistributionPlan::InterCharacter {
                    per_run,
                    boundary_before,
                    gap_size: extra / total_gaps as f64,
                }
            }
        };
        Some(Self {
            plan,
            run_index: 0,
            x_offset: 0.0,
            shape_spacing: None,
        })
    }

    pub(super) fn advance(
        &mut self,
        runs: &mut [LineRun],
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        while self.run_index < runs.len() {
            if let Some(spacing) = &mut self.shape_spacing {
                let LineRun::Text(run) = &mut runs[self.run_index] else {
                    unreachable!("only text runs retain shape spacing state")
                };
                spacing.advance(&mut run.shape, &run.text, work)?;
                self.finish_text_run();
                continue;
            }

            super::require_run_work(work)?;
            if self.plan.boundary_before(self.run_index) {
                self.x_offset += self.plan.gap_size();
            }
            match &mut runs[self.run_index] {
                LineRun::Text(run) => {
                    let intra_gaps = self.plan.intra_gaps(self.run_index);
                    let added_width = intra_gaps as f64 * self.plan.gap_size();
                    let known_spacing_gaps = self.plan.known_spacing_gaps(intra_gaps);
                    run.x += self.x_offset;
                    run.width += added_width;
                    let (word_spacing_delta, letter_spacing_delta) =
                        self.plan.spacing_deltas(intra_gaps);
                    if word_spacing_delta != 0.0 || letter_spacing_delta != 0.0 {
                        run.add_word_spacing_value(word_spacing_delta);
                        run.add_letter_spacing_value(letter_spacing_delta);
                        self.shape_spacing = Some(PendingShapeSpacing::new(
                            word_spacing_delta,
                            letter_spacing_delta,
                            run.width,
                            known_spacing_gaps,
                        ));
                    } else {
                        self.x_offset += added_width;
                        self.run_index += 1;
                    }
                }
                LineRun::Atom(run) => {
                    run.x += self.x_offset;
                    self.run_index += 1;
                }
                LineRun::Ruby(run) => {
                    run.x += self.x_offset;
                    self.run_index += 1;
                }
            }
        }
        Ok(())
    }

    fn finish_text_run(&mut self) {
        let added_width = self.plan.intra_gaps(self.run_index) as f64 * self.plan.gap_size();
        self.x_offset += added_width;
        self.shape_spacing = None;
        self.run_index += 1;
    }
}

impl DistributionPlan {
    fn intra_gaps(&self, run_index: usize) -> usize {
        match self {
            Self::Word { per_run, .. } | Self::InterCharacter { per_run, .. } => {
                per_run.get(run_index).copied().unwrap_or(0)
            }
        }
    }

    fn boundary_before(&self, run_index: usize) -> bool {
        match self {
            Self::Word { .. } => false,
            Self::InterCharacter {
                boundary_before, ..
            } => boundary_before.get(run_index).copied().unwrap_or(false),
        }
    }

    fn gap_size(&self) -> f64 {
        match self {
            Self::Word { gap_size, .. } | Self::InterCharacter { gap_size, .. } => *gap_size,
        }
    }

    fn spacing_deltas(&self, intra_gaps: usize) -> (f64, f64) {
        match self {
            Self::Word { gap_size, .. } => (*gap_size, 0.0),
            Self::InterCharacter { gap_size, .. } if intra_gaps > 0 => (0.0, *gap_size),
            Self::InterCharacter { .. } => (0.0, 0.0),
        }
    }

    fn known_spacing_gaps(&self, intra_gaps: usize) -> Option<usize> {
        match self {
            Self::Word { .. } => None,
            Self::InterCharacter { .. } => Some(intra_gaps),
        }
    }
}

#[cfg(test)]
#[path = "distribute_tests.rs"]
mod tests;
