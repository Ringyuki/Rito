use super::super::TextMeasurementFonts;
use crate::layout::text_work::{TextWorkMeter, TextWorkYield};

mod face_scan;
mod parser;

use face_scan::{FaceScanResult, PendingFaceScan};
use parser::{FamilyParseResult, PendingFamilyParser};

#[derive(Debug)]
pub(super) struct PendingFontSetup {
    phase: FontSetupPhase,
}

#[derive(Debug)]
enum FontSetupPhase {
    Parsing(PendingFamilyParser),
    Scanning(PendingFaceScan),
    Complete,
}

impl PendingFontSetup {
    pub(super) fn new(input: String) -> Self {
        Self {
            phase: FontSetupPhase::Parsing(PendingFamilyParser::new(input)),
        }
    }

    pub(super) const fn complete() -> Self {
        Self {
            phase: FontSetupPhase::Complete,
        }
    }

    pub(super) fn advance(
        &mut self,
        fonts: &TextMeasurementFonts<'_>,
        work: &mut TextWorkMeter,
    ) -> Result<FontSetupResult, TextWorkYield> {
        match &mut self.phase {
            FontSetupPhase::Parsing(parser) => match parser.advance(work)? {
                FamilyParseResult::Pending => Ok(FontSetupResult::Pending),
                FamilyParseResult::Family(family) => {
                    self.phase = FontSetupPhase::Scanning(PendingFaceScan::new(family));
                    Ok(FontSetupResult::Pending)
                }
                FamilyParseResult::Complete { monospace } => {
                    self.phase = FontSetupPhase::Complete;
                    Ok(FontSetupResult::Complete { monospace })
                }
            },
            FontSetupPhase::Scanning(scan) => match scan.advance(fonts, work)? {
                FaceScanResult::Pending => Ok(FontSetupResult::Pending),
                FaceScanResult::Match => {
                    self.phase = FontSetupPhase::Complete;
                    Ok(FontSetupResult::MatchingFace)
                }
                FaceScanResult::NoMatch { family } => {
                    let monospace = family.monospace || family.is_monospace;
                    if family.input_complete {
                        self.phase = FontSetupPhase::Complete;
                        Ok(FontSetupResult::Complete { monospace })
                    } else {
                        self.phase =
                            FontSetupPhase::Parsing(PendingFamilyParser::from_scanned(family));
                        Ok(FontSetupResult::Pending)
                    }
                }
            },
            FontSetupPhase::Complete => Ok(FontSetupResult::Pending),
        }
    }

    pub(super) const fn is_complete(&self) -> bool {
        matches!(self.phase, FontSetupPhase::Complete)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FontSetupResult {
    Pending,
    Complete { monospace: bool },
    MatchingFace,
}

pub(super) fn require_unit(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    if work.take_utf16_units(1) == 1 {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}
