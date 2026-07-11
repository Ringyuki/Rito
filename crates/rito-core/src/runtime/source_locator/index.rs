use std::collections::BTreeMap;

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
    NoPageProjection,
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
            self.parsed_chapters.insert(chapter_index, parsed);
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

fn collect_source_anchors(nodes: &[DocumentNode]) -> BTreeMap<String, RuntimeSourceAnchor> {
    let mut anchors = BTreeMap::new();
    for node in nodes {
        collect_node_anchors(node, &mut anchors);
    }
    anchors
}

fn collect_node_anchors(node: &DocumentNode, anchors: &mut BTreeMap<String, RuntimeSourceAnchor>) {
    match node {
        DocumentNode::Block(element) | DocumentNode::Inline(element) => {
            if let Some(id) = element
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.id.as_ref())
            {
                anchors.entry(id.clone()).or_insert_with(|| {
                    first_text_point(&element.children)
                        .map(RuntimeSourceAnchor::Point)
                        .unwrap_or(RuntimeSourceAnchor::NoPageProjection)
                });
            }
            for child in &element.children {
                collect_node_anchors(child, anchors);
            }
        }
        DocumentNode::Image(image) => {
            if let Some(id) = image
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.id.as_ref())
            {
                anchors
                    .entry(id.clone())
                    .or_insert(RuntimeSourceAnchor::NoPageProjection);
            }
        }
        DocumentNode::Text(_) => {}
    }
}

fn first_text_point(nodes: &[DocumentNode]) -> Option<RuntimeSourcePoint> {
    for node in nodes {
        match node {
            DocumentNode::Text(text) if !text.content.is_empty() => {
                return Some(RuntimeSourcePoint {
                    node_path: text.source_ref.node_path.clone(),
                    text_offset: 0,
                });
            }
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                if let Some(point) = first_text_point(&element.children) {
                    return Some(point);
                }
            }
            DocumentNode::Text(_) | DocumentNode::Image(_) => {}
        }
    }
    None
}
