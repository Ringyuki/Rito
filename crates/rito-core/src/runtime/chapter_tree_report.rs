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

use serde::{Deserialize, Serialize};

use crate::epub::EpubResult;
use crate::fragment_bridge::{build_chapter_formatting_tree, ChapterFormattingTree};
use crate::xhtml::DocumentNode;

use super::{RuntimeDocument, RuntimeRevisionStatus};

pub const RUNTIME_CHAPTER_TREE_REPORT_SCHEMA_VERSION: u32 = 1;

/// One chapter's representability in the fragment engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterTreeChapter {
    pub idref: String,
    /// Whether the chapter built into a formatting tree.
    pub representable: bool,
    /// The fail-closed reason when it did not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Nodes in the built tree (0 when not representable).
    pub formatting_node_count: usize,
    /// The built tree's content fingerprint, stable across runs and
    /// platforms for identical content and styles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree_fingerprint: Option<String>,
}

/// Fragment-engine representability of a revision's chapters.
///
/// `is_complete == false` means later chapters may not have retained style
/// tables yet; only chapters with tables are measured. Nothing here feeds
/// back into production layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterTreeReport {
    pub schema_version: u32,
    pub is_complete: bool,
    /// Chapters measured (those with retained style tables).
    pub chapter_count: usize,
    /// Chapters that built into a formatting tree.
    pub representable_chapter_count: usize,
    pub chapters: Vec<RuntimeChapterTreeChapter>,
}

impl RuntimeDocument {
    pub(super) fn chapter_tree_report(
        &self,
        revision_id: &str,
    ) -> EpubResult<RuntimeChapterTreeReport> {
        let revision = self.revisions.get(revision_id).ok_or_else(|| {
            crate::epub::EpubError::new(format!("unknown revision: {revision_id}"))
        })?;
        let idrefs: Vec<String> = revision.chapter_style_tables.keys().cloned().collect();
        let mut chapters = Vec::with_capacity(idrefs.len());
        let mut representable = 0usize;
        for idref in &idrefs {
            let entry = self.chapter_tree_entry(revision_id, idref);
            if entry.representable {
                representable += 1;
            }
            chapters.push(entry);
        }
        Ok(RuntimeChapterTreeReport {
            schema_version: RUNTIME_CHAPTER_TREE_REPORT_SCHEMA_VERSION,
            is_complete: revision.status == RuntimeRevisionStatus::Complete,
            chapter_count: chapters.len(),
            representable_chapter_count: representable,
            chapters,
        })
    }

    fn chapter_tree_entry(&self, revision_id: &str, idref: &str) -> RuntimeChapterTreeChapter {
        match self.chapter_formatting_tree(revision_id, idref) {
            Ok(built) => RuntimeChapterTreeChapter {
                idref: idref.to_owned(),
                representable: true,
                reason: None,
                formatting_node_count: built.tree.len(),
                tree_fingerprint: Some(format!("{:016x}", built.tree.fingerprint())),
            },
            Err(error) => RuntimeChapterTreeChapter {
                idref: idref.to_owned(),
                representable: false,
                reason: Some(error.to_string()),
                formatting_node_count: 0,
                tree_fingerprint: None,
            },
        }
    }

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
        let revision = self.any_revision(revision_id).ok_or_else(|| {
            crate::epub::EpubError::new(format!("unknown revision: {revision_id}"))
        })?;
        let tables = revision.chapter_style_tables.get(idref).ok_or_else(|| {
            crate::epub::EpubError::new(format!(
                "revision retains no style tables for chapter {idref}"
            ))
        })?;
        let prepared = self.prepared.as_ref().ok_or_else(|| {
            crate::epub::EpubError::new("document is not prepared for tree construction")
        })?;
        let chapter = prepared
            .chapters
            .iter()
            .find(|chapter| chapter.source.idref == idref)
            .ok_or_else(|| {
                crate::epub::EpubError::new(format!("chapter {idref} is not prepared"))
            })?;
        let Some(body) = chapter.parsed.body_source_node_id else {
            // Malformed or empty markup: render an empty chapter rather
            // than blocking the whole book on it.
            return crate::fragment_bridge::empty_chapter_formatting_tree();
        };
        // The reader-semantic content flow: footnote asides leave the flow
        // before layout, the same selection production pagination uses.
        let nodes = prepared
            .filtered_footnote_nodes
            .get(idref)
            .map(Vec::as_slice)
            .unwrap_or(&chapter.parsed.nodes);
        let mut image_dimensions = BTreeMap::new();
        collect_image_dimensions(nodes, &self.document, &mut image_dimensions);
        build_chapter_formatting_tree(
            nodes,
            body.index(),
            &tables.layout,
            &tables.inline,
            &image_dimensions,
        )
    }
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
