//! A line's text fragments, one per stretch of an inline item the line
//! holds, as the browser keeps one text item per inline item on a line:
//! the pieces the line loop places — words, justification stretches,
//! re-anchored CJK stretches — join the fragment as segments, each keeping
//! the origin its clusters were placed from.

use std::rc::Rc;

use rito_fragment::{ClusterPosition, FontFaceId, Fragment, TextFragment, TextSegment};
use rito_style_contract::{InlineFormattingStyle, LengthPercentage, NonNegativeLengthPercentage};

/// The fragment the line's next piece may join, and the clusters and
/// segments gathered for it until it closes.
#[derive(Default)]
pub(crate) struct LineRuns {
    open: Option<OpenRun>,
    clusters: Vec<ClusterPosition>,
    segments: Vec<TextSegment>,
}

struct OpenRun {
    /// Its index in the line's children.
    child: usize,
    item: usize,
    shift: f64,
    /// The one face every cluster so far was drawn from, if one.
    face: Option<FontFaceId>,
}

/// One piece the line loop places: its fragment (clusters not yet set),
/// baseline shift and item, and whether it may join the piece before it at
/// all — never in a vertical flow, whose painter steps each piece's glyphs
/// by its own spacing, nor a ruby base or a trimmed opener, which paint
/// from fields of their own.
pub(crate) struct Piece {
    pub(crate) fragment: TextFragment,
    pub(crate) shift: f64,
    pub(crate) item: usize,
    pub(crate) joinable: bool,
}

impl LineRuns {
    /// Places `piece`, whose clusters `write` appends to the buffer it is
    /// given (setting `fragment.cluster_grid` is the caller's).
    pub(crate) fn push(
        &mut self,
        children: &mut Vec<(Fragment, f64)>,
        piece: Piece,
        write: impl FnOnce(&mut Vec<ClusterPosition>) -> bool,
    ) {
        let Piece {
            mut fragment,
            shift,
            item,
            joinable,
        } = piece;
        let start = self.clusters.len();
        fragment.cluster_grid = write(&mut self.clusters);
        let face = uniform_face(&self.clusters[start..]);
        let joins = joinable
            && self.open.as_ref().is_some_and(|open| {
                open.child + 1 == children.len()
                    && open.item == item
                    && open.shift == shift
                    && open.face.is_some()
                    && open.face == face
                    && matches!(children.last(), Some((Fragment::Text(previous), _))
                        if fits(previous, &fragment))
            });
        if joins {
            let Some((Fragment::Text(previous), _)) = children.last_mut() else {
                return;
            };
            previous.rect.width = fragment.rect.x + fragment.rect.width - previous.rect.x;
            previous.text_end = fragment.text_end;
            self.segments.push(TextSegment {
                cluster: start as u32,
                x: fragment.rect.x,
            });
            return;
        }
        // The clusters before the new piece's close the open fragment; the
        // new piece's open the next.
        self.close_before(children, start);
        self.segments.push(TextSegment {
            cluster: 0,
            x: fragment.rect.x,
        });
        self.open = joinable.then_some(OpenRun {
            child: children.len(),
            item,
            shift,
            face,
        });
        if !joinable {
            // A piece no other joins closes at once.
            fragment.clusters = Rc::from(self.clusters.as_slice());
            self.clusters.clear();
            self.segments.clear();
            children.push((Fragment::Text(fragment), shift));
            return;
        }
        children.push((Fragment::Text(fragment), shift));
    }

    /// Hands the open fragment its clusters and segments.
    pub(crate) fn close(&mut self, children: &mut [(Fragment, f64)]) {
        self.close_before(children, self.clusters.len());
    }

    /// Hands the open fragment the clusters before `end` and its segments,
    /// keeping the clusters from `end` on for the next.
    fn close_before(&mut self, children: &mut [(Fragment, f64)], end: usize) {
        if let Some(open) = self.open.take() {
            if let Some((Fragment::Text(fragment), _)) = children.get_mut(open.child) {
                fragment.clusters = Rc::from(&self.clusters[..end]);
                fragment.segments =
                    (self.segments.len() > 1).then(|| Rc::from(self.segments.as_slice()));
            }
        }
        self.clusters.drain(..end);
        self.segments.clear();
    }
}

/// Whether an item paints more than its glyphs — a band behind them, a
/// box edge, a decoration line, a shadow — which the painter lowers from
/// each fragment's rect and in each fragment's paint order: such an item
/// keeps a fragment per piece.
pub(crate) fn paints_alone(style: &InlineFormattingStyle) -> bool {
    let paint = &style.paint;
    let lines = paint.text_decoration.lines;
    let some_length = |value: &NonNegativeLengthPercentage| !matches!(value.value(), LengthPercentage::Length(px) if px.get() == 0.0);
    let padding = &style.fragment.padding;
    let border = &style.fragment.border;
    !paint.text_shadows.is_empty()
        || lines.underline
        || lines.overline
        || lines.line_through
        || paint.background.resolve(paint.foreground).alpha().get() != 0.0
        || [&padding.top, &padding.right, &padding.bottom, &padding.left]
            .into_iter()
            .any(some_length)
        || [&border.top, &border.right, &border.bottom, &border.left]
            .into_iter()
            .any(|edge| edge.resolved_width.get() > 0.0)
}

/// Whether `next` continues `previous`'s text and paints alike.
fn fits(previous: &TextFragment, next: &TextFragment) -> bool {
    previous.text_end == next.text_start
        && previous.justify_px == next.justify_px
        && previous.box_snap == next.box_snap
        && previous.font_grid == next.font_grid
        && previous.cluster_grid == next.cluster_grid
}

fn uniform_face(clusters: &[ClusterPosition]) -> Option<FontFaceId> {
    let first = clusters.first()?.face;
    clusters
        .iter()
        .all(|cluster| cluster.face == first)
        .then_some(first)
}
