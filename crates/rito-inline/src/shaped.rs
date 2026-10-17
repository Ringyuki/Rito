//! Paragraphs as built — text analysed, fonts chosen, runs shaped — and not
//! yet broken into lines, kept across layouts.
//!
//! A paragraph's build depends on its content and styles, the faces the
//! context shapes with, the trims and spreads the line loop decided, and,
//! for an image, an inline block or a percentage margin, the space it is
//! laid out in. The formatting tree's fingerprint covers the content and
//! styles of every node, and the faces belong to the context that holds
//! this cache; the trims and spreads join the key; the space joins it only
//! when the build read it. So a paragraph of text laid out at another
//! width breaks the lines it already shaped instead of shaping them again,
//! as a browser keeps a block's shaped text across a resize.

use std::{cell::Cell, collections::BTreeMap};

use rustc_hash::FxHashMap;

use crate::ParagraphLayout;

/// How much the kept paragraphs may hold, by the estimate of
/// [`estimated_bytes`]: some ten chapters of a light novel.
const SHAPED_PARAGRAPH_BUDGET_BYTES: usize = 48 << 20;

/// The space a paragraph is built in, recording whether the build read it.
/// Only images, inline blocks and percentage margins read it: a paragraph
/// that never did builds the same in any space.
pub(crate) struct BuildSpace {
    inline_size: Option<f64>,
    block_size: Option<f64>,
    containing_block_size: Option<f64>,
    read: Cell<bool>,
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
            read: Cell::new(false),
        }
    }

    /// The available inline size.
    pub(crate) fn inline_size(&self) -> Option<f64> {
        self.read.set(true);
        self.inline_size
    }

    /// The fragmentainer's block size: the page an image is clamped to.
    pub(crate) fn block_size(&self) -> Option<f64> {
        self.read.set(true);
        self.block_size
    }

    /// The containing block's definite height.
    pub(crate) fn containing_block_size(&self) -> Option<f64> {
        self.read.set(true);
        self.containing_block_size
    }

    fn was_read(&self) -> bool {
        self.read.get()
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
    /// The space, when the build read it.
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
    bytes: usize,
    used: u64,
}

impl ShapedParagraphs {
    /// The build of `key` in `space`, if one is kept: first one that read
    /// no space, then one built in exactly this space.
    pub(crate) fn get(
        &mut self,
        key: &mut ShapeKey,
        space: &BuildSpace,
    ) -> Option<ParagraphLayout> {
        key.space = None;
        if let Some(paragraph) = self.touch(key) {
            return Some(paragraph);
        }
        key.space = Some(space.key());
        self.touch(key)
    }

    /// Keeps a fresh build: under a key without the space when the build
    /// never read it, so every space finds it.
    pub(crate) fn insert(
        &mut self,
        mut key: ShapeKey,
        space: &BuildSpace,
        paragraph: &ParagraphLayout,
    ) {
        key.space = space.was_read().then(|| space.key());
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

    fn touch(&mut self, key: &ShapeKey) -> Option<ParagraphLayout> {
        let entry = self.entries.get_mut(key)?;
        self.clock += 1;
        self.recency.remove(&entry.used);
        entry.used = self.clock;
        self.recency.insert(self.clock, key.clone());
        Some(entry.paragraph.clone())
    }
}

/// A paragraph's footprint, estimated from its text: Parley keeps a
/// cluster and its glyphs per character, a few dozen bytes each.
fn estimated_bytes(paragraph: &ParagraphLayout) -> usize {
    2048 + 64 * paragraph.text.len()
}
