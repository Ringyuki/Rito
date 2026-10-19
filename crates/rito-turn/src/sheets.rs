//! The sheets of a frame, from the front of the book to the back.

use crate::curl::Curl;
use crate::leaf::{lay_leaf, pose_at, LeafGrab, LeafShape};
use crate::leaves::{Leaf, LeafId};

/// Which page a face of a sheet shows: the page a leaf was lifted from
/// (`Front`), the page under it (`After`), or none (bare paper).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Face {
    None,
    Front(LeafId),
    After(LeafId),
}

/// A sheet of a frame: where its points are and how they face, the page on
/// each face, how far over it is, whether it lies still (the same points
/// every frame while the layout lasts), and the curl it is laid out through.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sheet<'a> {
    pub positions: &'a [f32],
    pub normals: &'a [f32],
    pub front: Face,
    pub back: Face,
    pub shown: f64,
    pub still: bool,
    pub curl: Option<Curl>,
}

/// A sheet lying flat: where its points are and how they face.
#[derive(Debug, Clone, PartialEq)]
struct Lying {
    positions: Vec<f32>,
    normals: Vec<f32>,
}

/// The two sheets lying flat for a leaf of this shape on this grid, laid out once.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Flat {
    shape: LeafShape,
    columns: usize,
    rows: usize,
    right: Lying,
    left: Lying,
}

impl Flat {
    /// The flat sheets for `shape` on this grid: `kept` when it is for them.
    pub(crate) fn for_shape(
        kept: Option<Flat>,
        shape: LeafShape,
        columns: usize,
        rows: usize,
    ) -> Flat {
        if let Some(kept) = kept {
            if kept.shape == shape && kept.columns == columns && kept.rows == rows {
                return kept;
            }
        }
        let lying = |turned: f64| {
            let mut positions = vec![0.0f32; columns * rows * 3];
            let mut normals = vec![0.0f32; columns * rows * 3];
            let grab = LeafGrab { u: 1.0, v: 0.5 };
            lay_leaf(
                shape,
                pose_at(shape, grab, turned),
                columns,
                rows,
                &mut positions,
                &mut normals,
            );
            Lying { positions, normals }
        };
        Flat {
            shape,
            columns,
            rows,
            right: lying(0.0),
            left: lying(1.0),
        }
    }
}

/// The page lying left that the leaves land on, the leaves in the air in the
/// order they come in the book, and the page lying right that they leave.
/// The first leaf's front is printed on the back of the page lying left;
/// what lies under the last leaf is the page lying right. With one page a
/// spread nothing lies left, and the leaves are pages curled over.
pub(crate) fn sheets<'a>(flat: &'a Flat, book: &'a [Leaf], spine: f64) -> Vec<Sheet<'a>> {
    let mut sheets = Vec::with_capacity(book.len() + 2);
    if spine > 0.0 {
        sheets.push(Sheet {
            positions: &flat.left.positions,
            normals: &flat.left.normals,
            front: Face::None,
            back: book.first().map_or(Face::None, |leaf| Face::Front(leaf.id)),
            shown: 1.0,
            still: true,
            curl: None,
        });
    }
    for leaf in book {
        let curl = leaf.curled.as_ref().and_then(|curled| curled.curl);
        sheets.push(Sheet {
            positions: &leaf.positions,
            normals: &leaf.normals,
            front: Face::Front(leaf.id),
            // A page curled over shows nothing of the spread it uncovers on its back.
            back: if leaf.curled.is_some() {
                Face::None
            } else {
                Face::After(leaf.id)
            },
            shown: leaf.shown,
            still: false,
            curl,
        });
    }
    sheets.push(Sheet {
        positions: &flat.right.positions,
        normals: &flat.right.normals,
        front: book.last().map_or(Face::None, |leaf| Face::After(leaf.id)),
        back: Face::None,
        shown: 0.0,
        still: true,
        curl: None,
    });
    sheets
}
