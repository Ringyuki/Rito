//! Measures how much of a revision's real content the fragment engine can
//! represent, without touching production output.
//!
//! For every chapter whose typed style tables the revision retains, this
//! read-only diagnostic parses the chapter source and builds the fragment
//! engine's `FormattingTree` through the same bridge the engine will use.
//! Chapters that build report their size and content fingerprint; chapters
//! the engine cannot represent yet report the exact fail-closed reason.
//! Aggregated over a corpus this is the representability measurement that
//! gates the engine cutover: it says precisely which constructs still block
//! the fragment pipeline, book by book.

use std::collections::BTreeMap;

use crate::epub::EpubResult;
use crate::fragment_bridge::{build_chapter_formatting_tree_with_generated, ChapterFormattingTree};
use crate::xhtml::DocumentNode;

use super::{frame::RuntimeChapterStyleTables, RuntimeDocument};

impl RuntimeDocument {
    /// Builds the fragment engine's input for one chapter of a revision:
    /// the reader-filtered content flow (footnote asides and equivalent
    /// out-of-flow content removed, exactly as production paginates) with
    /// the revision's typed style tables and loaded image dimensions.
    ///
    /// This is the seam the fragment engine and its oracles lay out from.
    pub fn chapter_formatting_tree(
        &self,
        revision_id: &str,
        idref: &str,
    ) -> EpubResult<ChapterFormattingTree> {
        self.chapter_formatting_tree_with_flow(revision_id, idref, true)
    }

    /// Same seam with the raw document flow: footnote asides stay inline,
    /// the way a browser renders the chapter file as-is. Oracles that diff
    /// against native browser rendering read this; production pagination
    /// never does.
    pub fn chapter_formatting_tree_unfiltered(
        &self,
        revision_id: &str,
        idref: &str,
    ) -> EpubResult<ChapterFormattingTree> {
        self.chapter_formatting_tree_with_flow(revision_id, idref, false)
    }

    fn chapter_formatting_tree_with_flow(
        &self,
        revision_id: &str,
        idref: &str,
        filter_footnotes: bool,
    ) -> EpubResult<ChapterFormattingTree> {
        let revision = self.any_revision(revision_id).ok_or_else(|| {
            crate::epub::EpubError::new(format!("unknown revision: {revision_id}"))
        })?;
        self.prepared_chapter_formatting_tree(
            &revision.chapter_style_tables,
            idref,
            filter_footnotes,
        )
    }

    /// Builds one chapter's formatting tree from the whole-book
    /// preparation and the given per-chapter style tables; the whole-book
    /// page table is built from this before its revision exists.
    pub(super) fn prepared_chapter_formatting_tree(
        &self,
        chapter_style_tables: &BTreeMap<String, std::rc::Rc<RuntimeChapterStyleTables>>,
        idref: &str,
        filter_footnotes: bool,
    ) -> EpubResult<ChapterFormattingTree> {
        let tables = chapter_style_tables.get(idref).ok_or_else(|| {
            crate::epub::EpubError::new(format!(
                "revision retains no style tables for chapter {idref}"
            ))
        })?;
        let prepared = self.prepared.as_ref().ok_or_else(|| {
            crate::epub::EpubError::new("document is not prepared for tree construction")
        })?;
        self.formatting_tree_from_prepared(prepared, tables, idref, filter_footnotes)
    }

    /// Builds one chapter's formatting tree from an explicit prepared
    /// window (which may hold only that chapter), without touching the
    /// document's whole-book preparation.
    pub(super) fn formatting_tree_from_prepared(
        &self,
        prepared: &crate::epub::PreparedLoadedDocument,
        tables: &RuntimeChapterStyleTables,
        idref: &str,
        filter_footnotes: bool,
    ) -> EpubResult<ChapterFormattingTree> {
        let image_dimensions = self.chapter_image_dimensions(prepared, idref, filter_footnotes)?;
        chapter_formatting_tree(prepared, tables, idref, filter_footnotes, &image_dimensions)
    }

    /// Intrinsic sizes the document has decoded for every image in the
    /// chapter's content flow. A page table records these beside the
    /// chapter so a rebuilt chapter bridges against the sizes the first
    /// build saw.
    pub(super) fn chapter_image_dimensions(
        &self,
        prepared: &crate::epub::PreparedLoadedDocument,
        idref: &str,
        filter_footnotes: bool,
    ) -> EpubResult<BTreeMap<String, (u32, u32)>> {
        let mut image_dimensions = BTreeMap::new();
        if let Some((nodes, _)) = chapter_flow_nodes(prepared, idref, filter_footnotes)? {
            collect_image_dimensions(nodes, &self.document, &mut image_dimensions);
        }
        Ok(image_dimensions)
    }
}

/// Bridges one chapter of a prepared window with image sizes supplied by
/// the caller. Everything the bridge reads is an argument, so a chapter
/// rebuilt from a recorded set of inputs produces the same tree as the
/// build that recorded them.
pub(super) fn chapter_formatting_tree(
    prepared: &crate::epub::PreparedLoadedDocument,
    tables: &RuntimeChapterStyleTables,
    idref: &str,
    filter_footnotes: bool,
    image_dimensions: &BTreeMap<String, (u32, u32)>,
) -> EpubResult<ChapterFormattingTree> {
    let Some((nodes, body)) = chapter_flow_nodes(prepared, idref, filter_footnotes)? else {
        // Malformed or empty markup: render an empty chapter rather than
        // blocking the whole book on it.
        return crate::fragment_bridge::empty_chapter_formatting_tree();
    };
    build_chapter_formatting_tree_with_generated(
        nodes,
        body,
        &tables.layout,
        &tables.inline,
        &tables.generated,
        image_dimensions,
    )
}

/// The chapter's content flow and its body node index: footnote asides
/// leave the flow before layout when the caller filters them, the same
/// selection production pagination uses. `None` when the chapter has no
/// body element.
fn chapter_flow_nodes<'a>(
    prepared: &'a crate::epub::PreparedLoadedDocument,
    idref: &str,
    filter_footnotes: bool,
) -> EpubResult<Option<(&'a [DocumentNode], usize)>> {
    let chapter = prepared
        .chapters
        .iter()
        .find(|chapter| chapter.source.idref == idref)
        .ok_or_else(|| crate::epub::EpubError::new(format!("chapter {idref} is not prepared")))?;
    let Some(body) = chapter.parsed.body_source_node_id else {
        return Ok(None);
    };
    let nodes = if filter_footnotes {
        prepared
            .filtered_footnote_nodes
            .get(idref)
            .map(Vec::as_slice)
            .unwrap_or(&chapter.parsed.nodes)
    } else {
        &chapter.parsed.nodes
    };
    Ok(Some((nodes, body.index())))
}

/// Collects already-loaded dimensions for every image referenced by the
/// chapter. Images whose dimensions are not loaded stay absent, and the
/// bridge fails closed naming them.
fn collect_image_dimensions(
    nodes: &[DocumentNode],
    document: &crate::epub::LoadedEpubDocument,
    dimensions: &mut BTreeMap<String, (u32, u32)>,
) {
    for node in nodes {
        match node {
            DocumentNode::Image(image) => {
                if !dimensions.contains_key(&image.src) {
                    if let Some(size) = document.loaded_image_dimensions(&image.src) {
                        dimensions.insert(image.src.clone(), size);
                    }
                }
            }
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                collect_image_dimensions(&element.children, document, dimensions);
            }
            DocumentNode::Text(_) => {}
        }
    }
}
