//! Where a paragraph's lines end once its line edges are decided: the
//! line-end trims Chromium extends a line by, the pair trims a break
//! separates, the spreads of a ruby base split across lines and the lines
//! a split ruby base rewinds. Each decision belongs to one line's
//! edge, as Blink makes it while breaking that line (`ShapingLineBreaker`).

mod forward;

pub(crate) use forward::KeptDecisions;

use crate::*;
use rito_fragment::FloatBand;

/// Blink accepts a line that overflows its available width by up to
/// one LayoutUnit: NGLineBreaker::CanFitOnLine compares against
/// available_width_.AddEpsilon(). Measured on the Tinos body idiom:
/// a 626.695-wide line fits a 626.6875 column (threshold scanned to
/// the 1/64), so a strict compare here wrapped one word early and
/// drifted whole paragraphs. The epsilon widens only the FIT — the
/// justify target below keeps the true width, exactly as Blink
/// justifies to the unwidened line box.
pub(crate) const LINE_FIT_EPSILON: f64 = 1.0 / 64.0;

/// Lines break through one manual loop so a specific line index can
/// be FORCED to end before a text index: a ruby base split where its
/// first segment cannot carry its annotation rewinds the whole base to
/// the next line, and `break_next_to` reproduces that rewind, holding
/// whatever precedes the item (an inline image included).
pub(crate) fn break_paragraph_lines(
    layout: &mut parley::Layout<[u8; 4]>,
    space: &ConstraintSpace,
    band: Option<FloatBand>,
    forced: &[(usize, usize)],
) {
    if band.is_none() && forced.is_empty() {
        layout.break_all_lines(Some((space.inline_size + LINE_FIT_EPSILON) as f32));
        return;
    }
    let mut breaker = layout.break_lines();
    breaker
        .state_mut()
        .set_layout_max_advance((space.inline_size + LINE_FIT_EPSILON) as f32);
    let mut index = 0usize;
    loop {
        set_next_line_width(&mut breaker, space, band);
        let forced_end = forced
            .iter()
            .find(|(line, _)| *line == index)
            .map(|(_, end)| *end);
        let progressed = match forced_end {
            Some(end) => breaker.break_next_to(end).is_some(),
            None => breaker.break_next().is_some(),
        };
        if !progressed {
            break;
        }
        index += 1;
    }
    breaker.finish();
}

/// Whether a line whose top is `line_top` lies beside the float band: the
/// one rule the breaker and every decision about the line read.
pub(crate) fn line_inside_band(line_top: f64, band: FloatBand) -> bool {
    line_top < band.bottom
}

/// Gives the next line the breaker lays its advance and start: the band's
/// width and offset while the line's top sits inside the band, the full
/// inline size below it. Every line gets them explicitly: a forced break
/// leaves breaker state the next natural break must not inherit.
pub(crate) fn set_next_line_width(
    breaker: &mut parley::BreakLines<'_, [u8; 4]>,
    space: &ConstraintSpace,
    band: Option<FloatBand>,
) {
    if let Some(band) = band {
        let band_inline_size = (space.inline_size - band.left_inset - band.right_inset).max(0.0);
        let (advance, offset) = if line_inside_band(breaker.committed_y(), band) {
            (band_inline_size, band.left_inset)
        } else {
            (space.inline_size, 0.0)
        };
        let state = breaker.state_mut();
        state.set_line_max_advance((advance + LINE_FIT_EPSILON) as f32);
        state.set_line_x(offset as f32);
    } else {
        breaker
            .state_mut()
            .set_line_max_advance((space.inline_size + LINE_FIT_EPSILON) as f32);
    }
}

/// The max advance the breaker gave a line, reconstructed from the
/// same rule [`set_next_line_width`] applies: band width while the line's
/// top sits inside the band, the full inline size below it.
pub(crate) fn line_max_advance(
    space: &ConstraintSpace,
    band: Option<FloatBand>,
    line_top: f64,
) -> f32 {
    match band {
        Some(band) if line_inside_band(line_top, band) => {
            (space.inline_size - band.left_inset - band.right_inset).max(0.0) as f32
        }
        _ => space.inline_size as f32,
    }
}

/// What deciding a paragraph's line edges reads besides the paragraph.
#[derive(Clone, Copy)]
pub(crate) struct LineEdgeInputs<'a> {
    pub(crate) tree: &'a FormattingTree,
    pub(crate) root: FormattingNodeId,
    pub(crate) space: &'a ConstraintSpace,
    /// The float band the lines wrap around, when it narrows any.
    pub(crate) band: Option<FloatBand>,
    /// Each item's byte range in the flow text (an atom's is empty).
    pub(crate) item_text_ranges: &'a [std::ops::Range<usize>],
    pub(crate) cancel: &'a CancelFlag,
}

/// The paragraph built with its decided edges and broken into its lines,
/// with everything the line assembly reads from the build.
pub(crate) struct DecidedParagraph {
    pub(crate) layout: parley::Layout<[u8; 4]>,
    pub(crate) alignment: parley::Alignment,
    pub(crate) shifted_ranges: Vec<(std::ops::Range<usize>, f64)>,
    pub(crate) first_line_indent: f32,
    pub(crate) ruby_spreads: std::collections::HashMap<usize, f64>,
    pub(crate) ruby_spread_overhangs: std::collections::HashMap<usize, f64>,
    pub(crate) ruby_spread_overhangs_right: std::collections::HashMap<usize, f64>,
    pub(crate) ruby_base_shifts: std::collections::HashMap<usize, crate::paragraph::RubyBaseShift>,
    pub(crate) opener_halt_trims: Vec<(std::ops::Range<usize>, f64)>,
    pub(crate) inline_block_boxes:
        std::collections::HashMap<u64, (f64, rito_fragment::BoxFragment)>,
    pub(crate) inline_block_baselines: std::collections::HashMap<u32, f64>,
    pub(crate) image_edge_insets: std::collections::HashMap<u64, (f64, f64)>,
    pub(crate) empty_box_struts: Vec<(usize, rito_style_contract::StyleId, f64)>,
    pub(crate) spacing_edits: SpacingEdits,
    pub(crate) cluster_steps: std::rc::Rc<std::cell::OnceCell<ClusterSteps>>,
}
