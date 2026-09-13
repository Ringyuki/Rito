//! Block formatting context for the fragment contract.
//!
//! Composes an inline provider's line output into vertical block flow with
//! fragmentainer pagination. Lines are the atomic unit of pagination for
//! paragraphs: an inline flow lays out once in continuous space (through
//! the input-keyed fragment cache, so resumed fragmentainers replay it),
//! and this context decides which lines land in which fragmentainer,
//! resuming from a break token that records the consumed block size.
//!
//! Vertical margins resolve from the typed layout styles carried by the
//! tree: adjacent siblings collapse (max of positives plus min of
//! negatives), the container is a formatting-context root so no margin
//! collapses through it, and a margin that meets an unforced fragmentainer
//! break is truncated to zero, matching CSS fragmentation.
//!
//! Nested block containers lay out recursively; a break inside one comes
//! back as a break token whose resume path names the whole ancestor chain,
//! so resumption re-enters exactly the interrupted subtree. Each container
//! is treated as a formatting-context root for margins (no through-collapse
//! yet — the parent-child collapse of plain `display: block` wrappers is an
//! explicit remaining gap tracked for the oracle round).
//!
//! Content the block model cannot lay out yet — anything beyond block
//! containers, sized leaves, and inline flows — fails closed instead of
//! guessing.
//!
//! The context is one type spread over the modules that own its parts:
//! `context` (construction, the inline-outcome cache and the two
//! provider entry points), `flow` (the driver that lays a container's
//! children out and breaks them at the fragmentainer edge), `lines`
//! (which of a paragraph's lines land in the current fragmentainer),
//! `table` (grid building, column sizing and table fragmentation),
//! `floats` (float occupancy inside one container), `resume` (reading a
//! break token back), `margins` (vertical margin collapsing), `sizing`
//! (horizontal box resolution and the LayoutUnit grid) and `fragments`
//! (building, moving and sealing fragments). Every module sees the whole
//! crate through the root's re-exports, as the single file they were
//! carved from did.

use std::cell::RefCell;

use rito_fragment::{
    BoxFragment, BreakToken, BreakTokenStage, CancelFlag, ConstraintSpace, FloatBreak,
    FormattingContext, FormattingNodeContent, FormattingNodeId, FormattingTree, Fragment,
    FragmentCache, FragmentRect, FragmentTree, IntrinsicInlineSizes, LayoutError, LayoutOutcome,
};
use rito_style_contract::{
    BoxSizing, Clear, Float, LayoutFormattingStyle, LengthPercentage, LengthPercentageOrAuto,
    MaximumSize, PageBreak, PreferredSize,
};

mod context;
mod floats;
mod flow;
mod fragments;
mod lines;
mod margins;
mod resume;
mod sizing;
mod table;
#[cfg(test)]
mod tests;

pub(crate) use floats::*;
pub(crate) use fragments::*;
pub(crate) use lines::*;
pub(crate) use margins::*;
pub(crate) use resume::*;
pub(crate) use sizing::*;

/// Byte budget for the internal inline-outcome cache. Sized for one
/// chapter's worth of paragraphs; least-recently-used outcomes re-lay out
/// transparently if a pathological document overflows it.
const INLINE_CACHE_BUDGET_BYTES: usize = 4 * 1024 * 1024;

/// Block formatting context that owns its inline provider.
///
/// Holds an internal fragment cache for inline outcomes behind a `RefCell`:
/// layout stays a pure function of its inputs (a cache replay is exactly
/// the recomputed outcome), but resumed fragmentainers skip re-shaping the
/// paragraphs they resume into.
pub struct BlockFormattingContext<I: FormattingContext> {
    inline: I,
    inline_cache: RefCell<FragmentCache>,
}

/// Lines chosen for the current fragmentainer, shifted into fragment-local
/// coordinates (relative to the paragraph fragment's top).
struct LinePlacement {
    lines: Vec<Fragment>,
    /// Paragraph-coordinate bottom edge of the last placed line.
    consumed_end: f64,
    /// Whether every remaining line of the paragraph was placed.
    exhausted: bool,
}

/// The UA default line constraints at a fragmentation break inside a
/// paragraph (css-break-3 §3.3, Chromium's defaults): at least `orphans`
/// line boxes stay before the break and at least `widows` carry over
/// after it. A break that cannot honor them moves — before the paragraph
/// entirely for orphans, one line earlier for widows — exactly as the
/// browser does (measured: a lone first line that fit at a column bottom
/// is pushed to the next column by Blink).
const DEFAULT_ORPHANS: usize = 2;
const DEFAULT_WIDOWS: usize = 2;

/// One cell in the table grid: its node and column placement.
struct TableGridCell {
    node: FormattingNodeId,
    column: usize,
    span: usize,
}

/// The table's sized grid: rows of placed cells over globally sized
/// columns. Column sizing runs once over the whole table; every row and
/// every fragment reads the same offsets.
struct TableGridLayout {
    rows: Vec<Vec<TableGridCell>>,
    row_ids: Vec<FormattingNodeId>,
    offsets: Vec<f64>,
    table_width: f64,
    spacing_x: f64,
    spacing_y: f64,
}

/// One table's placement attempt into the current fragmentainer.
enum TableFragmentainerPlacement {
    /// Nothing of the table fits here; the caller breaks before it.
    BreakBefore,
    /// A fragment was produced, with a continuation when content remains.
    Placed {
        fragment: BoxFragment,
        continuation: Option<BreakToken>,
    },
}

/// Active float occupancy inside one container, in flow coordinates.
///
/// Each placed float is kept as its own margin box: a new
/// float starts at its hypothetical flow position and stacks against the
/// floats STILL ACTIVE at its own y — CSS 2.1 §9.5.1 — instead of the
/// retired single-band model whose cumulative occupied widths chained
/// every float of a page into one x-run (measured on b60's title: the
/// third column belongs at the second column's margin edge because the
/// first two have expired at its y, 474.89 exact, where the band chain
/// parked it at 508.4).
struct FloatBands {
    /// Every float box this container has placed or adopted, in source
    /// order. `x0..x1` is the SIGNED margin-box interval exactly as
    /// handed back to the placement caller (negative margins can invert
    /// it); queries normalize per box.
    boxes: Vec<PlacedFloatBox>,
    /// Highest top any next float may take (§9.5.1 rule 5: a float is
    /// never higher than an earlier float's top).
    floor_y: f64,
}

struct PlacedFloatBox {
    right_side: bool,
    x0: f64,
    x1: f64,
    bottom: f64,
}

/// One in-flow child's resolved horizontal geometry within its containing
/// block: border-box offset and width, plus the padding that separates the
/// border box from the content area.
struct HorizontalBox {
    /// Border-box x relative to the containing block's content area.
    x: f64,
    /// Border-box width (no borders yet, so padding plus content).
    border_width: f64,
    /// Left padding: content-area offset inside the border box.
    padding_left: f64,
    /// Content-area width available to the child's own layout.
    content_width: f64,
    /// Vertical padding, part of the child's own block size.
    padding_top: f64,
    padding_bottom: f64,
}

/// One column's sizing constraints, the input to the width distribution.
struct ColumnConstraint {
    min: f64,
    max: f64,
    /// A definite authored width, already including the cell's padding.
    specified: Option<f64>,
    /// An authored percentage width, as a ratio of the table.
    percentage: Option<f64>,
}

/// A table cell's inline sizing inputs: its content bounds plus the width
/// it specified, which drives its column independently of content.
struct CellIntrinsicSizes {
    min_content: f64,
    max_content: f64,
    specified: Option<f64>,
    /// A percentage `width`, as a ratio. It constrains the table itself:
    /// the column must end up at least this share of the table's width.
    percentage: Option<f64>,
}

/// The margin set awaiting collapse below the previous in-flow child.
/// CSS 8.3.1 collapses ADJOINING margins as a SET — the largest positive
/// plus the most negative — which a pairwise fold gets wrong on
/// mixed-sign chains (measured: a UA +1em `<p>` top against authored
/// −0.8em bottoms through empty paragraphs collapses to 3.2px in Blink,
/// where folding pairwise 3.2 → −9.6 → 6.4 shifted every section of the
/// Durarara books).
#[derive(Clone, Copy)]
struct PendingMargin {
    positive: f64,
    negative: f64,
}
