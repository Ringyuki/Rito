//! Each chapter's formatting tree as last built, kept by the engine that
//! measured it.
//!
//! A chapter's tree is a function of its parsed nodes (with the footnote
//! asides its window filters out), its style tables and the intrinsic
//! sizes of its images; its painted runs (list markers, ruby annotations)
//! are measured with the engine's faces. Nothing of the page size enters,
//! so a layout at another size bridges no chapter again whose inputs are
//! the ones its tree was built from. The engine is rebuilt when its faces
//! change, and this cache with it.

use std::{collections::BTreeMap, rc::Rc};

use crate::epub::{EpubError, EpubResult, ParsedLoadedChapterSource, PreparedLoadedDocument};
use crate::fragment_bridge::ChapterFormattingTree;
use crate::xhtml::DocumentNode;

use super::chapter_tree_report::chapter_formatting_tree;
use super::fragment_backend::FILTER_FOOTNOTES;
use super::fragment_frame::RuntimeFragmentEngine;
use super::frame::RuntimeChapterStyleTables;

/// How many chapters' trees stay built: the chapter being read and those
/// around it, not the whole book a book-wide layout passes through.
const KEPT_CHAPTER_TREES: usize = 8;

/// The kept trees, least recently used first.
#[derive(Default)]
pub(super) struct ChapterTreeCache {
    entries: Vec<ChapterTreeEntry>,
}

struct ChapterTreeEntry {
    idref: String,
    /// The parse the tree was bridged from: a document parses each chapter
    /// once and shares it, so a different `Rc` is a different parse.
    source: Rc<ParsedLoadedChapterSource>,
    /// The nodes left after the window filtered footnote asides out, when
    /// it filtered any; otherwise the parse's own nodes.
    filtered: Option<Vec<DocumentNode>>,
    tables: Rc<RuntimeChapterStyleTables>,
    image_dimensions: BTreeMap<String, (u32, u32)>,
    tree: Rc<ChapterFormattingTree>,
}

impl RuntimeFragmentEngine {
    /// `idref`'s formatting tree in `prepared` with its painted runs
    /// measured by this engine: kept from the last build that read the
    /// same inputs, or built and kept.
    pub(super) fn chapter_tree(
        &self,
        prepared: &PreparedLoadedDocument,
        tables: &Rc<RuntimeChapterStyleTables>,
        idref: &str,
        image_dimensions: &BTreeMap<String, (u32, u32)>,
    ) -> EpubResult<Rc<ChapterFormattingTree>> {
        let source = prepared
            .chapters
            .iter()
            .find(|chapter| chapter.source.idref == idref)
            .ok_or_else(|| EpubError::new(format!("chapter {idref} is not prepared")))?;
        let filtered = FILTER_FOOTNOTES
            .then(|| prepared.filtered_footnote_nodes.get(idref))
            .flatten();
        let mut cache = self.trees.borrow_mut();
        if let Some(position) = cache.entries.iter().position(|entry| {
            entry.idref == idref
                && Rc::ptr_eq(&entry.source, source)
                && Rc::ptr_eq(&entry.tables, tables)
                && entry.filtered.as_ref() == filtered
                && entry.image_dimensions == *image_dimensions
        }) {
            let entry = cache.entries.remove(position);
            let tree = Rc::clone(&entry.tree);
            cache.entries.push(entry);
            return Ok(tree);
        }
        let mut tree =
            chapter_formatting_tree(prepared, tables, idref, FILTER_FOOTNOTES, image_dimensions)?;
        // Outside markers and ruby annotations are painted, never laid
        // out: shape them once with the context the chapter lays out
        // with, so their boxes and clusters come from its own advances.
        tree.measure_painted_runs(self.engine.inline())
            .map_err(|error| {
                EpubError::new(format!("chapter {idref} markers: {}", error.message()))
            })?;
        let tree = Rc::new(tree);
        cache.entries.retain(|entry| entry.idref != idref);
        if cache.entries.len() >= KEPT_CHAPTER_TREES {
            cache.entries.remove(0);
        }
        cache.entries.push(ChapterTreeEntry {
            idref: idref.to_owned(),
            source: Rc::clone(source),
            filtered: filtered.cloned(),
            tables: Rc::clone(tables),
            image_dimensions: image_dimensions.clone(),
            tree: Rc::clone(&tree),
        });
        Ok(tree)
    }
}
