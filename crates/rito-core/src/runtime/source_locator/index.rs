use std::collections::BTreeMap;
use std::rc::Rc;

use crate::{epub::parsed_loaded_chapter_source, xhtml::DocumentNode};

use super::super::{
    chapter_text::build_chapter_text_index, RuntimeChapterTextIndex, RuntimeChapterTextSpan,
    RuntimeDocument,
};
use super::{RuntimeSourceLocatorError, RuntimeSourcePoint};

#[derive(Debug, Clone)]
pub(in crate::runtime) struct RuntimeSourceChapterIndex {
    pub(super) text: RuntimeChapterTextIndex,
    pub(super) span_by_path: BTreeMap<Vec<usize>, usize>,
    pub(super) anchors: BTreeMap<String, RuntimeSourceAnchor>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RuntimeSourceAnchor {
    ChapterStart,
    Point(RuntimeSourcePoint),
    /// No text follows the anchor: it sits at the chapter's end.
    ChapterEnd,
}

impl RuntimeSourceChapterIndex {
    pub(super) fn span_index(&self, node_path: &[usize]) -> Option<usize> {
        self.span_by_path.get(node_path).copied()
    }

    pub(super) fn span(&self, node_path: &[usize]) -> Option<&RuntimeChapterTextSpan> {
        self.span_index(node_path)
            .and_then(|index| self.text.spans.get(index))
    }
}

impl RuntimeDocument {
    pub(super) fn ensure_source_chapter_index(
        &mut self,
        chapter_index: usize,
    ) -> Result<(), RuntimeSourceLocatorError> {
        let idref = self
            .document
            .chapters
            .get(chapter_index)
            .map(|chapter| chapter.idref.clone())
            .ok_or_else(|| {
                RuntimeSourceLocatorError::href_not_found(&format!("chapter-{chapter_index}"))
            })?;
        if !self.source_chapter_indices.contains_key(&idref) {
            let index = self.build_source_chapter_index(chapter_index)?;
            self.source_chapter_indices.insert(idref, index);
        }
        Ok(())
    }

    /// A chapter's source text index, for tests that need real node paths.
    #[cfg(test)]
    pub(in crate::runtime) fn source_chapter_text_for_tests(
        &mut self,
        idref: &str,
    ) -> RuntimeChapterTextIndex {
        let chapter_index = self
            .document
            .chapters
            .iter()
            .position(|chapter| chapter.idref == idref)
            .expect("chapter exists");
        self.ensure_source_chapter_index(chapter_index)
            .expect("chapter source indexes");
        self.source_chapter_indices[idref].text.clone()
    }

    fn build_source_chapter_index(
        &mut self,
        chapter_index: usize,
    ) -> Result<RuntimeSourceChapterIndex, RuntimeSourceLocatorError> {
        self.document
            .ensure_chapter_loaded(chapter_index)
            .map_err(RuntimeSourceLocatorError::source_unavailable)?;
        if !self.parsed_chapters.contains_key(&chapter_index) {
            let parsed = self
                .document
                .chapters
                .get(chapter_index)
                .map(parsed_loaded_chapter_source)
                .ok_or_else(|| {
                    RuntimeSourceLocatorError::href_not_found(&format!("chapter-{chapter_index}"))
                })?;
            self.parsed_chapters.insert(chapter_index, Rc::new(parsed));
        }
        let chapter_href = self
            .document
            .chapters
            .get(chapter_index)
            .map(|chapter| chapter.href.as_str())
            .expect("source chapter existence was checked while parsing");
        let parsed = self
            .parsed_chapters
            .get(&chapter_index)
            .expect("source chapter parse was cached");
        // Persistent source locators are tied to the raw parsed XHTML tree, not to
        // revision-specific interaction filtering (for example, hidden footnotes).
        let nodes = parsed.parsed.nodes.as_slice();
        let text = build_chapter_text_index(chapter_href, nodes);
        let span_by_path = text
            .spans
            .iter()
            .enumerate()
            .map(|(index, span)| (span.node_path.clone(), index))
            .collect();
        let mut anchors = collect_source_anchors(nodes);
        if let Some(body_id) = parsed
            .parsed
            .body_attributes
            .as_ref()
            .and_then(|attributes| attributes.id.as_ref())
        {
            anchors
                .entry(body_id.clone())
                .or_insert(RuntimeSourceAnchor::ChapterStart);
        }
        Ok(RuntimeSourceChapterIndex {
            text,
            span_by_path,
            anchors,
        })
    }
}

/// Every anchor lands on the first text at or after its element's start,
/// in document order — where a browser scrolls to it. An element with no
/// text of its own (an empty `<a id>` marker, an image) takes the text
/// that follows it; one with no text after it takes the chapter's end.
/// The first element carrying an id owns it.
fn collect_source_anchors(nodes: &[DocumentNode]) -> BTreeMap<String, RuntimeSourceAnchor> {
    let mut walk = AnchorWalk::default();
    for node in nodes {
        walk.node(node);
    }
    for id in walk.pending {
        walk.anchors
            .entry(id)
            .or_insert(RuntimeSourceAnchor::ChapterEnd);
    }
    walk.anchors
}

#[derive(Default)]
struct AnchorWalk {
    anchors: BTreeMap<String, RuntimeSourceAnchor>,
    /// Ids met since the last text, in document order.
    pending: Vec<String>,
}

impl AnchorWalk {
    fn node(&mut self, node: &DocumentNode) {
        match node {
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                self.id(element.attributes.as_ref().and_then(|a| a.id.as_ref()));
                for child in &element.children {
                    self.node(child);
                }
            }
            DocumentNode::Image(image) => {
                self.id(image.attributes.as_ref().and_then(|a| a.id.as_ref()));
            }
            DocumentNode::Text(text) if !text.content.is_empty() => {
                let point = RuntimeSourcePoint {
                    node_path: text.source_ref.node_path.clone(),
                    text_offset: 0,
                };
                for id in self.pending.drain(..) {
                    self.anchors
                        .entry(id)
                        .or_insert_with(|| RuntimeSourceAnchor::Point(point.clone()));
                }
            }
            DocumentNode::Text(_) => {}
        }
    }

    fn id(&mut self, id: Option<&String>) {
        if let Some(id) = id {
            if !self.anchors.contains_key(id) && !self.pending.contains(id) {
                self.pending.push(id.clone());
            }
        }
    }
}
