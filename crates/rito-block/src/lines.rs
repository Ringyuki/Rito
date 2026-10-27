//! Choosing which of a paragraph's already laid-out lines belong in the
//! current fragmentainer: skip what an earlier fragment consumed, open
//! the first line remaining with the annotation space above it, take as
//! many as fit, move the break to honour the UA orphan and widow counts,
//! and shift the chosen lines into coordinates relative to the paragraph
//! fragment's top.

use std::borrow::Cow;

use crate::*;

pub(crate) fn place_lines(
    lines: &[Fragment],
    consumed: f64,
    remaining: f64,
    fragmentainer_is_empty: bool,
    fragmentainer_size: Option<f64>,
    opening: LineOpening,
) -> LinePlacement {
    // Resumed lines: skip everything a previous fragmentainer consumed.
    // A ZERO-HEIGHT line (line-height: 0) at the paragraph start sits at
    // y + height == 0 and would read as already consumed — it is not;
    // Blink keeps the line box and paints its overflowing ink (b115's
    // `line-height: 0%` divider rows vanished wholesale). The rescue is
    // scoped to the fresh paragraph (consumed == 0): past a real resume
    // boundary a zero-height line at exactly `consumed` was placed by
    // the previous fragment.
    let mut pending: Vec<Cow<'_, Fragment>> = lines
        .iter()
        .filter(|line| {
            let rect = line.rect();
            rect.y + rect.height > consumed + f64::EPSILON
                || (consumed == 0.0 && rect.height <= 0.0)
        })
        .map(Cow::Borrowed)
        .collect();
    // The fragment's first line takes the annotation space above it; its
    // place in the paragraph's own coordinates (what `consumed` counts)
    // does not move.
    let mut opening_delta = 0.0;
    if let Some(first) = pending.first_mut() {
        let (opened, delta) = opening.open(first);
        if delta != 0.0 {
            *first = Cow::Owned(opened);
            opening_delta = delta;
        }
    }
    let total = pending.len();
    let mut fit_count = 0;
    let mut used = 0.0_f64;
    for line in &pending {
        let height = line.rect().height;
        if used + height <= remaining + f64::EPSILON {
            fit_count += 1;
            used += height;
        } else {
            break;
        }
    }
    let mut take = fit_count;
    if take < total {
        // The paragraph breaks here. Widows pulls lines over to the next
        // fragment only while orphans still holds; when the pair cannot
        // both be satisfied the natural break stays and widows yields
        // (measured: Blink splits a 3-line paragraph 2+1 at a column
        // bottom rather than deferring it). An orphans violation moves
        // the break before the paragraph instead.
        if total - take < DEFAULT_WIDOWS {
            let candidate = total.saturating_sub(DEFAULT_WIDOWS);
            if candidate >= DEFAULT_ORPHANS {
                take = candidate;
            }
        }
        if take < DEFAULT_ORPHANS {
            take = 0;
        }
        if take == 0 && fragmentainer_is_empty {
            // An empty fragmentainer must make progress. Orphans yields
            // first: lines that FIT a fresh page place even when the
            // paragraph cannot keep its orphan count together — a pair
            // of page-tall plate lines splits one per page, and breaking
            // before them again would never advance (b110's 人物介绍
            // page hung the reader exactly here). A line taller than the
            // WHOLE page overflows in place; one merely squeezed by
            // ancestor padding/borders breaks to the next page, where
            // the resumed ancestors carry no leading edges (measured:
            // Blink's 2px-only blank column before a full-height
            // illustration in a padded figure).
            if fit_count > 0 {
                take = fit_count;
            } else if fragmentainer_size.is_none_or(|size| remaining + f64::EPSILON >= size) {
                // Force-placement is progress of last resort, and only at
                // the top of a fragmentainer nothing has shortened. When
                // ancestor edges squeezed this page, the line breaks to the
                // next one and overflows THERE if it must: Blink pushes an
                // 854px plate line (850px image plus strut descent) past a
                // margin-shortened opener, leaves the opener blank, and
                // lets the line overflow the fresh column invisibly —
                // b117's gallery ran one page early when the taller-than-
                // page test alone forced it onto the shortened opener. On
                // the resumed page `remaining == size`, so this branch
                // fires and progress is guaranteed.
                take = 1;
            }
        }
    }
    let mut placed = Vec::new();
    let mut consumed_end = consumed;
    let mut y = 0.0_f64;
    for (index, line) in pending.into_iter().take(take).enumerate() {
        let rect = line.rect();
        // The line's fragment-local top is the block distance consumed so
        // far inside this fragmentainer's paragraph chunk.
        let mut shifted = line.into_owned();
        set_fragment_y(&mut shifted, y);
        placed.push(shifted);
        y += rect.height;
        let source_height = if index == 0 {
            rect.height - opening_delta
        } else {
            rect.height
        };
        consumed_end = rect.y + source_height;
    }
    LinePlacement {
        lines: placed,
        consumed_end,
        exhausted: take == total,
        opening_delta: if take == 0 { 0.0 } else { opening_delta },
    }
}

fn set_fragment_y(fragment: &mut Fragment, y: f64) {
    match fragment {
        Fragment::Box(inner) => inner.rect.y = y,
        Fragment::Line(inner) => inner.rect.y = y,
        Fragment::Text(inner) => inner.rect.y = y,
        Fragment::Image(inner) => inner.rect.y = y,
    }
}
