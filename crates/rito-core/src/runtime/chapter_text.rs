use std::collections::BTreeMap;

use crate::{
    epub::PreparedLoadedDocument,
    runtime::{RuntimeChapterTextIndex, RuntimeChapterTextSpan},
    xhtml::DocumentNode,
};

pub(super) fn runtime_chapter_text_index_entries(
    prepared: &PreparedLoadedDocument,
) -> BTreeMap<String, RuntimeChapterTextIndex> {
    let mut entries = BTreeMap::new();
    for chapter in &prepared.chapters {
        let nodes = prepared
            .filtered_footnote_nodes
            .get(&chapter.source.idref)
            .map(Vec::as_slice)
            .unwrap_or(chapter.parsed.nodes.as_slice());
        entries.insert(
            chapter.source.idref.clone(),
            build_chapter_text_index(&chapter.source.href, nodes),
        );
    }
    entries
}

pub(super) fn build_chapter_text_index(
    href: &str,
    nodes: &[DocumentNode],
) -> RuntimeChapterTextIndex {
    let mut builder = ChapterTextIndexBuilder {
        spans: Vec::new(),
        normalized_text: String::new(),
        normalized_offset: 0,
    };
    for node in nodes {
        builder.walk(node);
    }
    RuntimeChapterTextIndex {
        href: href.to_owned(),
        normalized_text: builder.normalized_text,
        spans: builder.spans,
    }
}

struct ChapterTextIndexBuilder {
    spans: Vec<RuntimeChapterTextSpan>,
    normalized_text: String,
    normalized_offset: usize,
}

impl ChapterTextIndexBuilder {
    fn walk(&mut self, node: &DocumentNode) {
        match node {
            DocumentNode::Text(text) => self.push_text(text),
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                for child in &element.children {
                    self.walk(child);
                }
            }
            DocumentNode::Image(_) => {}
        }
    }

    fn push_text(&mut self, text: &crate::xhtml::TextNode) {
        if text.content.is_empty() {
            return;
        }
        let text_len = utf16_len(&text.content);
        self.spans.push(RuntimeChapterTextSpan {
            node_path: text.source_ref.node_path.clone(),
            source_start: 0,
            source_end: text_len,
            normalized_start: self.normalized_offset,
            normalized_end: self.normalized_offset + text_len,
        });
        self.normalized_offset += text_len;
        self.normalized_text.push_str(&text.content);
    }
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::build_chapter_text_index;
    use crate::xhtml::{DocumentNode, SourceRef, TextNode};

    #[test]
    fn builds_utf16_text_spans() {
        let index = build_chapter_text_index(
            "Text/chapter.xhtml",
            &[
                DocumentNode::Text(TextNode {
                    content: "A".to_owned(),
                    source_text: None,
                    source_ref: SourceRef {
                        node_path: vec![0],
                        source_node_id: None,
                    },
                }),
                DocumentNode::Text(TextNode {
                    content: "😀B".to_owned(),
                    source_text: None,
                    source_ref: SourceRef {
                        node_path: vec![1],
                        source_node_id: None,
                    },
                }),
            ],
        );

        assert_eq!(index.normalized_text, "A😀B");
        assert_eq!(index.href, "Text/chapter.xhtml");
        assert_eq!(index.spans[0].normalized_start, 0);
        assert_eq!(index.spans[0].normalized_end, 1);
        assert_eq!(index.spans[1].source_end, 3);
        assert_eq!(index.spans[1].normalized_start, 1);
        assert_eq!(index.spans[1].normalized_end, 4);
    }
}
