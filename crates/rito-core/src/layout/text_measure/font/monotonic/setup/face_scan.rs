use super::{parser::ParsedFamily, require_unit};
use crate::layout::{
    text_measure::TextMeasurementFonts,
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug)]
pub(super) struct PendingFaceScan {
    family: Option<ParsedFamily>,
    face_index: usize,
    comparison_byte_index: Option<usize>,
}

impl PendingFaceScan {
    pub(super) fn new(family: ParsedFamily) -> Self {
        Self {
            family: Some(family),
            face_index: 0,
            comparison_byte_index: None,
        }
    }

    pub(super) fn advance(
        &mut self,
        fonts: &TextMeasurementFonts<'_>,
        work: &mut TextWorkMeter,
    ) -> Result<FaceScanResult, TextWorkYield> {
        let family = self.family.as_ref().expect("pending face-scan family");
        let Some(face) = fonts.faces.get(self.face_index) else {
            return Ok(FaceScanResult::NoMatch {
                family: self.family.take().expect("completed face-scan family"),
            });
        };
        if let Some(byte_index) = self.comparison_byte_index {
            require_unit(work)?;
            let left = family.value.as_bytes()[byte_index];
            let right = face.family.as_bytes()[byte_index];
            if !left.eq_ignore_ascii_case(&right) {
                self.face_index = self
                    .face_index
                    .checked_add(1)
                    .expect("font-face index must fit in usize");
                self.comparison_byte_index = None;
            } else if byte_index
                .checked_add(1)
                .expect("font-family comparison offset must fit in usize")
                == family.value.len()
            {
                return Ok(FaceScanResult::Match);
            } else {
                self.comparison_byte_index = Some(
                    byte_index
                        .checked_add(1)
                        .expect("font-family comparison offset must fit in usize"),
                );
            }
            return Ok(FaceScanResult::Pending);
        }

        require_unit(work)?;
        if face.ttf_face.is_none() || face.family.len() != family.value.len() {
            self.face_index = self
                .face_index
                .checked_add(1)
                .expect("font-face index must fit in usize");
        } else if family.value.is_empty() {
            unreachable!("empty font families are discarded by the parser");
        } else {
            self.comparison_byte_index = Some(0);
        }
        Ok(FaceScanResult::Pending)
    }
}

#[derive(Debug)]
pub(super) enum FaceScanResult {
    Pending,
    Match,
    NoMatch { family: ParsedFamily },
}
