//! Paragraphs as built — text analysed, fonts chosen, runs shaped — and not
//! yet broken into lines, kept across layouts.
//!
//! Kept with them: each paragraph's min- and max-content widths, which
//! take two builds to measure and depend on nothing a layout changes.
//!
//! A paragraph's build depends on its content and styles, the faces the
//! context shapes with, the trims and spreads the line loop decided, and,
//! for an image, an inline block or a percentage margin, the space it is
//! laid out in. The formatting tree's fingerprint covers the content and
//! styles of every node, and the faces belong to the context that holds
//! this cache; the trims and spreads join the key. Images and inline blocks
//! are only sized in the space, which shaping does not see: a paragraph
//! kept from another space has them sized again. A percentage margin is
//! shaped into the spacing, so the space joins the key of a build that
//! read one. So a paragraph laid out at another width breaks the lines it
//! already shaped instead of shaping them again, as a browser keeps a
//! block's shaped text across a resize.

use std::{cell::Cell, collections::BTreeMap};

use rito_fragment::IntrinsicInlineSizes;
use rustc_hash::FxHashMap;

use crate::ParagraphLayout;

/// How much the kept paragraphs may hold, by the estimate of
/// [`estimated_bytes`]: some ten chapters of a light novel.
const SHAPED_PARAGRAPH_BUDGET_BYTES: usize = 48 << 20;

/// The space a paragraph is built in, recording what read it: images and
/// inline blocks, sized in it, or percentage margins, shaped with it. A
/// paragraph that read neither builds the same in any space.
pub(crate) struct BuildSpace {
    inline_size: Option<f64>,
    block_size: Option<f64>,
    containing_block_size: Option<f64>,
    read_by_atoms: Cell<bool>,
    read_by_shaping: Cell<bool>,
}

impl BuildSpace {
    pub(crate) fn new(
        inline_size: Option<f64>,
        block_size: Option<f64>,
        containing_block_size: Option<f64>,
    ) -> Self {
        Self {
            inline_size,
            block_size,
            containing_block_size,
            read_by_atoms: Cell::new(false),
            read_by_shaping: Cell::new(false),
        }
    }

    /// The available inline size an image or inline block is sized in.
    pub(crate) fn inline_size(&self) -> Option<f64> {
        self.read_by_atoms.set(true);
        self.inline_size
    }

    /// The fragmentainer's block size: the page an image is clamped to.
    pub(crate) fn block_size(&self) -> Option<f64> {
        self.read_by_atoms.set(true);
        self.block_size
    }

    /// The containing block's definite height.
    pub(crate) fn containing_block_size(&self) -> Option<f64> {
        self.read_by_atoms.set(true);
        self.containing_block_size
    }

    /// The inline size a percentage margin resolves against, shaped into
    /// the spacing of the text beside it.
    pub(crate) fn margin_basis(&self) -> Option<f64> {
        self.read_by_shaping.set(true);
        self.inline_size
    }

    fn key(&self) -> [Option<u64>; 3] {
        [
            self.inline_size,
            self.block_size,
            self.containing_block_size,
        ]
        .map(|size| size.map(f64::to_bits))
    }
}

/// Everything a build reads besides the context's faces.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ShapeKey {
    tree: u64,
    node: u32,
    end_trims: Vec<usize>,
    suppressed_pair_trims: Vec<usize>,
    /// Range start, range end and spacing bits of each split spread.
    split_spreads: Vec<(usize, usize, u32)>,
    /// The space, when the shaping read it.
    space: Option<[Option<u64>; 3]>,
}

/// What the line loop has decided so far and builds the paragraph again
/// with: line-end trims, pair trims a break separated, and the spacing a
/// ruby base split across lines takes.
#[derive(Clone, Copy)]
pub(crate) struct ParagraphEdits<'a> {
    pub(crate) end_trims: &'a [usize],
    pub(crate) suppressed_pair_trims: &'a [usize],
    pub(crate) split_spreads: &'a [(std::ops::Range<usize>, f32)],
}

impl ShapeKey {
    pub(crate) fn new(tree: u64, node: u32, edits: ParagraphEdits<'_>) -> Self {
        Self {
            tree,
            node,
            end_trims: edits.end_trims.to_vec(),
            suppressed_pair_trims: edits.suppressed_pair_trims.to_vec(),
            split_spreads: edits
                .split_spreads
                .iter()
                .map(|(range, spacing)| (range.start, range.end, spacing.to_bits()))
                .collect(),
            space: None,
        }
    }
}

/// The kept paragraphs, least recently used evicted first.
#[derive(Default)]
pub(crate) struct ShapedParagraphs {
    entries: FxHashMap<ShapeKey, Entry>,
    /// Last use → key, so eviction finds the oldest without scanning.
    recency: BTreeMap<u64, ShapeKey>,
    clock: u64,
    bytes: usize,
}

struct Entry {
    paragraph: ParagraphLayout,
    /// The space its images and inline blocks were sized in, when it has
    /// any.
    atoms_space: Option<[Option<u64>; 3]>,
    bytes: usize,
    used: u64,
}

/// A kept paragraph, and whether its images and inline blocks were sized
/// for another space than the one it was asked for in.
pub(crate) struct KeptParagraph {
    pub(crate) paragraph: ParagraphLayout,
    pub(crate) atoms_sized_elsewhere: bool,
}

impl ShapedParagraphs {
    /// The build of `key` in `space`, if one is kept: first one whose
    /// shaping read no space, then one shaped in exactly this space.
    pub(crate) fn get(&mut self, key: &mut ShapeKey, space: &BuildSpace) -> Option<KeptParagraph> {
        key.space = None;
        if let Some(kept) = self.touch(key, space) {
            return Some(kept);
        }
        key.space = Some(space.key());
        self.touch(key, space)
    }

    /// Keeps a build, replacing one under the same key: under a key without
    /// the space when its shaping never read it, so every space finds it.
    pub(crate) fn insert(
        &mut self,
        mut key: ShapeKey,
        space: &BuildSpace,
        paragraph: &ParagraphLayout,
    ) {
        key.space = space.read_by_shaping.get().then(|| space.key());
        let atoms_space = space.read_by_atoms.get().then(|| space.key());
        let bytes = estimated_bytes(paragraph);
        if bytes > SHAPED_PARAGRAPH_BUDGET_BYTES {
            return;
        }
        self.clock += 1;
        if let Some(old) = self.entries.remove(&key) {
            self.recency.remove(&old.used);
            self.bytes -= old.bytes;
        }
        self.recency.insert(self.clock, key.clone());
        self.entries.insert(
            key,
            Entry {
                paragraph: paragraph.clone(),
                atoms_space,
                bytes,
                used: self.clock,
            },
        );
        self.bytes += bytes;
        while self.bytes > SHAPED_PARAGRAPH_BUDGET_BYTES {
            let Some((_, oldest)) = self.recency.pop_first() else {
                break;
            };
            if let Some(evicted) = self.entries.remove(&oldest) {
                self.bytes -= evicted.bytes;
            }
        }
    }

    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }

    fn touch(&mut self, key: &ShapeKey, space: &BuildSpace) -> Option<KeptParagraph> {
        let entry = self.entries.get_mut(key)?;
        self.clock += 1;
        self.recency.remove(&entry.used);
        entry.used = self.clock;
        self.recency.insert(self.clock, key.clone());
        Some(KeptParagraph {
            paragraph: entry.paragraph.clone(),
            atoms_sized_elsewhere: entry.atoms_space.is_some_and(|sized| sized != space.key()),
        })
    }
}

/// How many paragraphs' intrinsic widths are kept before all are dropped:
/// two megabytes or so, and measuring one again is two builds.
const INTRINSIC_SIZES_LIMIT: usize = 1 << 16;

/// Each paragraph's min- and max-content widths by tree fingerprint and
/// node: the content and styles they are measured from, as in
/// [`ShapeKey`].
#[derive(Default)]
pub(crate) struct IntrinsicSizes {
    sizes: FxHashMap<(u64, u32), IntrinsicInlineSizes>,
}

impl IntrinsicSizes {
    pub(crate) fn get(&self, tree: u64, node: u32) -> Option<IntrinsicInlineSizes> {
        self.sizes.get(&(tree, node)).copied()
    }

    pub(crate) fn insert(&mut self, tree: u64, node: u32, sizes: IntrinsicInlineSizes) {
        if self.sizes.len() >= INTRINSIC_SIZES_LIMIT {
            self.sizes.clear();
        }
        self.sizes.insert((tree, node), sizes);
    }

    pub(crate) fn clear(&mut self) {
        self.sizes.clear();
    }
}

/// A paragraph's footprint, estimated from its text: Parley keeps a
/// cluster and its glyphs per character, a few dozen bytes each.
fn estimated_bytes(paragraph: &ParagraphLayout) -> usize {
    2048 + 64 * paragraph.text.len()
}
