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
    pub fn chapter_tree_report(&self, revision_id: &str) -> EpubResult<RuntimeChapterTreeReport> {
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
        let nodes = if filter_footnotes {
            prepared
                .filtered_footnote_nodes
                .get(idref)
                .map(Vec::as_slice)
                .unwrap_or(&chapter.parsed.nodes)
        } else {
            &chapter.parsed.nodes
        };
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

/// One laid-out box in continuous flow coordinates, for differential
/// conformance against a browser laying out the same chapter source.
///
/// Only boxes whose source element carries an `id` attribute are reported:
/// the id is the join key that pairs an engine box with the same element's
/// `getBoundingClientRect` in the reference browser. Conformance cases are
/// generated with an id on every element, so coverage there is total.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterLayoutBox {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A chapter laid out continuously (no fragmentation) for conformance.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterLayoutGeometry {
    pub boxes: Vec<ChapterLayoutBox>,
    /// Approximations the tree build applied; a conformance case with any
    /// degradation is failed loudly rather than compared.
    pub degradations: Vec<String>,
}

impl RuntimeDocument {
    /// Lays one chapter out in a continuous (unfragmented) flow at
    /// `content_width` and reports every id-carrying box's border-box
    /// rectangle in flow coordinates. This is the engine side of the
    /// geometry-differential harness: the reference side is a browser
    /// rendering the same chapter file at the same width with no
    /// pagination, so rectangles compare directly.
    pub fn chapter_layout_geometry(
        &self,
        revision_id: &str,
        idref: &str,
        content_width: f64,
    ) -> EpubResult<ChapterLayoutGeometry> {
        use rito_fragment::{CancelFlag, ConstraintSpace, FormattingContext, Fragment};

        let built = self.chapter_formatting_tree_unfiltered(revision_id, idref)?;
        let engine = self.fragment_engine().ok_or_else(|| {
            crate::epub::EpubError::new("no fragment engine (no pinned faces)")
        })?;
        let space = ConstraintSpace::continuous(content_width);
        let outcome = engine
            .engine
            .layout(
                &built.tree,
                built.tree.root(),
                &space,
                None,
                &CancelFlag::new(),
            )
            .map_err(|error| {
                crate::epub::EpubError::new(format!("conformance layout failed: {error:?}"))
            })?;

        fn collect(
            fragment: &Fragment,
            origin_x: f64,
            origin_y: f64,
            built: &ChapterFormattingTree,
            boxes: &mut Vec<ChapterLayoutBox>,
        ) {
            let rect = fragment.rect();
            let (x, y) = (origin_x + rect.x, origin_y + rect.y);
            if let Fragment::Box(box_fragment) = fragment {
                if let Some(id) = built.node_anchors.get(&box_fragment.source.0) {
                    boxes.push(ChapterLayoutBox {
                        id: id.clone(),
                        tag: built.node_tags.get(&box_fragment.source.0).cloned(),
                        x,
                        y,
                        width: rect.width,
                        height: rect.height,
                    });
                }
                for child in &box_fragment.children {
                    collect(child, x, y, built, boxes);
                }
            } else if let Fragment::Line(line) = fragment {
                for child in &line.children {
                    collect(child, x, y, built, boxes);
                }
            }
        }

        let mut boxes = Vec::new();
        collect(&outcome.fragments.root, 0.0, 0.0, &built, &mut boxes);
        Ok(ChapterLayoutGeometry {
            boxes,
            degradations: built.degradations,
        })
    }
}

impl RuntimeDocument {
    /// Injects one host-measured `line-height: normal` metric pair into
    /// the fragment engine (see `rito_inline::HostNormalLineMetric`).
    /// The host measures with its own text stack; the engine treats the
    /// values as authoritative for normal-line heights.
    pub fn set_host_line_metric(&self, family_key: &str, size: f64, strut: f64, cjk: f64) {
        self.pending_host_line_metrics
            .borrow_mut()
            .push((family_key.to_owned(), size, strut, cjk));
        // Never force engine initialization here: the engine builds
        // lazily from resolved @font-face sources, and forcing it before
        // a revision resolved them would cache a font-less engine.
        self.apply_pending_host_line_metrics();
    }

    /// Applies recorded metrics to the fragment engine if (and only if)
    /// it already initialized; called again from engine initialization.
    pub(super) fn apply_pending_host_line_metrics(&self) {
        let Some(Some(engine)) = self.fragment_engine.get() else {
            return;
        };
        let pending = self.pending_host_line_metrics.borrow();
        for (family, size, strut, cjk) in pending.iter().skip(self.applied_host_line_metrics.get())
        {
            engine.engine.inline().set_host_line_metric(
                family,
                *size,
                rito_inline::HostNormalLineMetric {
                    strut: *strut,
                    cjk: *cjk,
                },
            );
        }
        self.applied_host_line_metrics.set(pending.len());
    }

    /// Drains the (family key, size) pairs layout needed but no host
    /// metric covered; the host measures them, injects, and relayouts.
    pub fn take_host_line_metric_requests(&self) -> Vec<(String, f64)> {
        match self.fragment_engine.get() {
            Some(Some(engine)) => engine.engine.inline().take_host_metric_requests(),
            _ => Vec::new(),
        }
    }
}
