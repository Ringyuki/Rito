//! The boxes the cascade generates for `::before` and `::after`: their
//! styles, interned in the chapter's tables like any element's, and the
//! content they carry.

use std::collections::BTreeMap;

use crate::{LayoutStyleId, StyleId};

/// Which of an element's two generated boxes.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum PseudoElementKind {
    /// `::before`: the element's first child.
    Before,
    /// `::after`: the element's last child.
    After,
}

/// One piece of a generated box's `content`.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub enum GeneratedContentItem {
    /// Text laid out in the box's style: a string, or the value of an
    /// `attr()`.
    Text(String),
    /// A value the engine does not generate, named for diagnostics
    /// (`counter()`, a quote, an image); it contributes nothing.
    Unsupported(&'static str),
}

/// A generated box: its inline and layout styles and its content.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct GeneratedBox {
    pub inline: StyleId,
    pub layout: LayoutStyleId,
    pub content: Vec<GeneratedContentItem>,
}

/// Every generated box of one chapter, keyed by the source node index of
/// its element, and the generated boxes whose style could not be
/// projected, with the reason.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GeneratedBoxTable {
    boxes: BTreeMap<(usize, PseudoElementKind), GeneratedBox>,
    rejected: Vec<(usize, PseudoElementKind, String)>,
}

impl GeneratedBoxTable {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, node_index: usize, kind: PseudoElementKind, generated: GeneratedBox) {
        self.boxes.insert((node_index, kind), generated);
    }

    pub fn reject(&mut self, node_index: usize, kind: PseudoElementKind, reason: String) {
        self.rejected.push((node_index, kind, reason));
    }

    /// The generated boxes left out, with why.
    pub fn rejections(&self) -> &[(usize, PseudoElementKind, String)] {
        &self.rejected
    }

    /// The element's `kind` box, if the cascade generates one.
    pub fn get(&self, node_index: usize, kind: PseudoElementKind) -> Option<&GeneratedBox> {
        self.boxes.get(&(node_index, kind))
    }

    pub fn is_empty(&self) -> bool {
        self.boxes.is_empty()
    }

    pub fn len(&self) -> usize {
        self.boxes.len()
    }
}
