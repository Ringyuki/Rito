use crate::{
    runtime::{RuntimeChapterTextIndex, RuntimeChapterTextSpan},
    xhtml::DocumentNode,
};

pub(super) fn build_chapter_text_index(
    href: &str,
    nodes: &[DocumentNode],
) -> RuntimeChapterTextIndex {
    let mut builder = ChapterTextIndexBuilder {
        spans: Vec::new(),
        normalized_text: String::new(),
        normalized_offset: 0,
        ruby_depth: 0,
        annotation_depth: 0,
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
    /// How many `<ruby>` elements the walk is inside.
    ruby_depth: usize,
    /// How many `<rt>`/`<rp>` elements inside a ruby the walk is inside.
    annotation_depth: usize,
}

impl ChapterTextIndexBuilder {
    fn walk(&mut self, node: &DocumentNode) {
        match node {
            DocumentNode::Text(text) => self.push_text(text),
            DocumentNode::Block(element) | DocumentNode::Inline(element) => {
                let ruby = element.tag == "ruby";
                let annotation =
                    self.ruby_depth > 0 && (element.tag == "rt" || element.tag == "rp");
                self.ruby_depth += usize::from(ruby);
                self.annotation_depth += usize::from(annotation);
                for child in &element.children {
                    self.walk(child);
                }
                self.ruby_depth -= usize::from(ruby);
                self.annotation_depth -= usize::from(annotation);
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
            annotation: self.annotation_depth > 0,
        });
        self.normalized_offset += text_len;
        self.normalized_text.push_str(&text.content);
    }
}

/// The text a line shows for `start..end` of the index's text (UTF-16
/// offsets): the text there without its ruby annotations, which are laid
/// out apart from the line. `None` when the range is not on the text.
pub(super) fn flow_text(
    index: &RuntimeChapterTextIndex,
    start: usize,
    end: usize,
) -> Option<String> {
    let whole = super::source_locator::utf16_slice(&index.normalized_text, start, end)?;
    if !index.spans.iter().any(|span| span.annotation) {
        return Some(whole.to_owned());
    }
    let mut text = String::new();
    for span in &index.spans {
        if span.annotation || span.normalized_end <= start || span.normalized_start >= end {
            continue;
        }
        let piece = super::source_locator::utf16_slice(
            &index.normalized_text,
            span.normalized_start.max(start),
            span.normalized_end.min(end),
        )?;
        text.push_str(piece);
    }
    Some(text)
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
