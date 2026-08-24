use crate::layout::LayoutRuntimePage;

use super::{
    caret::{resolve_address_caret, resolve_text_caret},
    collect::collect_page_text_runs,
    resolve_text_range, LayoutExactTextRangeResolution, LayoutTextCaretResolution, LayoutTextPoint,
    LayoutTextRangeFromPoints, LayoutTextRangeFromPointsResolution, TextCaretAddress,
    TextInteractionUnavailableReason,
};

/// Atomically rebinds one stable-prefix caret address and resolves a live point
/// against the same retained revision version before constructing the range.
pub(crate) fn resolve_text_range_to_point(
    pages: &[LayoutRuntimePage],
    anchor_address: TextCaretAddress,
    focus_point: LayoutTextPoint,
) -> LayoutTextRangeFromPointsResolution {
    let Some(anchor_page) = pages.get(anchor_address.page_index) else {
        return LayoutTextRangeFromPointsResolution::Unavailable(
            TextInteractionUnavailableReason::InvalidCaret,
        );
    };
    let anchor_runs = collect_page_text_runs(anchor_address.page_index, anchor_page);
    let anchor_caret = match resolve_address_caret(&anchor_runs, anchor_address) {
        Ok(caret) => caret,
        Err(reason) => return LayoutTextRangeFromPointsResolution::Unavailable(reason),
    };
    let Some(focus_page) = pages.get(focus_point.page_index) else {
        return LayoutTextRangeFromPointsResolution::Miss;
    };
    let focus_caret = match resolve_text_caret(
        focus_point.page_index,
        focus_page,
        focus_point.x,
        focus_point.y,
    ) {
        LayoutTextCaretResolution::Resolved(caret) => caret,
        LayoutTextCaretResolution::Unavailable(reason) => {
            return LayoutTextRangeFromPointsResolution::Unavailable(reason);
        }
        LayoutTextCaretResolution::Miss => return LayoutTextRangeFromPointsResolution::Miss,
    };
    let range = match resolve_text_range(pages, anchor_caret.address, focus_caret.address) {
        LayoutExactTextRangeResolution::Resolved(range) => range,
        LayoutExactTextRangeResolution::Unavailable(reason) => {
            return LayoutTextRangeFromPointsResolution::Unavailable(reason);
        }
    };
    LayoutTextRangeFromPointsResolution::Resolved(Box::new(LayoutTextRangeFromPoints {
        anchor_caret,
        focus_caret,
        range,
    }))
}
