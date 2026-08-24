use rito_source::{visit_xhtml_semantic_elements, XhtmlSemanticElement};

use super::parser::{classify_tag, TagClassification};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EpubTypeAttributeHint {
    pub(crate) is_block: bool,
    pub(crate) epub_type: String,
    pub(crate) href: Option<String>,
    pub(crate) id: Option<String>,
}

/// Scans only source attributes needed to plan publication footnote work.
///
/// This mirrors the semantic projection rules that affect whether an element
/// survives as a `DocumentNode`: ignored/opaque subtrees are skipped, the
/// selected `<body>` replaces root fallback content, and inline wrappers that
/// contain blocks are unwrapped. No text, paint, style, or semantic tree is
/// allocated.
pub(crate) fn scan_epub_type_attribute_hints(
    source: &str,
) -> Result<Vec<EpubTypeAttributeHint>, String> {
    let mut scan = FootnoteAttributeScan::default();
    visit_xhtml_semantic_elements(source, |element| scan.visit(element))
        .map_err(|error| format!("Invalid XHTML: {error}"))?;
    scan.finish();
    Ok(scan.hints)
}

#[derive(Default)]
struct FootnoteAttributeScan {
    root_seen: bool,
    body_selected: bool,
    body_finished: bool,
    frames: Vec<ScanFrame>,
    hints: Vec<EpubTypeAttributeHint>,
}

impl FootnoteAttributeScan {
    fn visit(&mut self, element: XhtmlSemanticElement<'_>) {
        self.close_to_parent(element.parent_element_index);
        if !self.root_seen {
            self.root_seen = true;
            if element.local_name == "body" {
                self.select_body(element.node_index);
            } else {
                self.frames.push(ScanFrame::context(element.node_index));
            }
            return;
        }
        if element.local_name == "body" && !self.body_selected {
            self.select_body(element.node_index);
            return;
        }
        if self.body_finished || self.children_are_suppressed() {
            self.frames.push(ScanFrame::suppressed(element.node_index));
            return;
        }
        self.frames.push(ScanFrame::from_element(element));
    }

    fn select_body(&mut self, node_index: usize) {
        self.frames.clear();
        self.hints.clear();
        self.body_selected = true;
        self.frames.push(ScanFrame::context(node_index));
    }

    fn close_to_parent(&mut self, parent_element_index: Option<usize>) {
        while self
            .frames
            .last()
            .is_some_and(|frame| Some(frame.node_index) != parent_element_index)
        {
            self.close_last();
        }
    }

    fn children_are_suppressed(&self) -> bool {
        self.frames
            .last()
            .is_some_and(|frame| frame.kind.suppresses_children())
    }

    fn close_last(&mut self) {
        let Some(frame) = self.frames.pop() else {
            return;
        };
        let output = self.close_frame(frame);
        if !output.emitted_block {
            return;
        }
        let Some(parent) = self.frames.last_mut() else {
            return;
        };
        parent.children_have_block = true;
        if matches!(&parent.kind, ScanFrameKind::Inline(_)) {
            parent.block_hint_indices.extend(output.block_hint_indices);
        }
    }

    fn close_frame(&mut self, frame: ScanFrame) -> FrameOutput {
        match frame.kind {
            ScanFrameKind::Context => {
                if self.body_selected {
                    self.body_finished = true;
                }
                FrameOutput::default()
            }
            ScanFrameKind::Suppressed | ScanFrameKind::Ignored | ScanFrameKind::OpaqueInline => {
                FrameOutput::default()
            }
            ScanFrameKind::Block(attributes) => {
                let block_hint_indices = self.push_hint(attributes, true).into_iter().collect();
                FrameOutput {
                    emitted_block: true,
                    block_hint_indices,
                }
            }
            ScanFrameKind::Inline(attributes) => {
                if !frame.children_have_block {
                    self.push_hint(attributes.hint, false);
                    FrameOutput::default()
                } else {
                    self.inherit_anchor_href(
                        &frame.block_hint_indices,
                        attributes.anchor_href.as_deref(),
                    );
                    FrameOutput {
                        emitted_block: true,
                        block_hint_indices: frame.block_hint_indices,
                    }
                }
            }
        }
    }

    fn push_hint(&mut self, attributes: Option<TypedAttributes>, is_block: bool) -> Option<usize> {
        let attributes = attributes?;
        let hint_index = self.hints.len();
        self.hints.push(EpubTypeAttributeHint {
            is_block,
            epub_type: attributes.epub_type,
            href: attributes.href,
            id: attributes.id,
        });
        Some(hint_index)
    }

    fn inherit_anchor_href(&mut self, block_hint_indices: &[usize], href: Option<&str>) {
        let Some(href) = href else {
            return;
        };
        for &hint_index in block_hint_indices {
            let Some(hint) = self.hints.get_mut(hint_index) else {
                continue;
            };
            if hint.href.is_none() {
                hint.href = Some(href.to_owned());
            }
        }
    }

    fn finish(&mut self) {
        while !self.frames.is_empty() {
            self.close_last();
        }
    }
}

struct ScanFrame {
    node_index: usize,
    kind: ScanFrameKind,
    children_have_block: bool,
    block_hint_indices: Vec<usize>,
}

impl ScanFrame {
    fn context(node_index: usize) -> Self {
        Self::new(node_index, ScanFrameKind::Context)
    }

    fn suppressed(node_index: usize) -> Self {
        Self::new(node_index, ScanFrameKind::Suppressed)
    }

    fn from_element(element: XhtmlSemanticElement<'_>) -> Self {
        let kind = if element.local_name == "svg" {
            ScanFrameKind::Ignored
        } else {
            match classify_tag(element.local_name) {
                TagClassification::Ignored => ScanFrameKind::Ignored,
                TagClassification::Block => {
                    ScanFrameKind::Block(TypedAttributes::from_element(element))
                }
                TagClassification::Inline if matches!(element.local_name, "br" | "img") => {
                    ScanFrameKind::OpaqueInline
                }
                TagClassification::Inline => {
                    ScanFrameKind::Inline(InlineAttributes::from_element(element))
                }
            }
        };
        Self::new(element.node_index, kind)
    }

    fn new(node_index: usize, kind: ScanFrameKind) -> Self {
        Self {
            node_index,
            kind,
            children_have_block: false,
            block_hint_indices: Vec::new(),
        }
    }
}

enum ScanFrameKind {
    Context,
    Suppressed,
    Ignored,
    OpaqueInline,
    Block(Option<TypedAttributes>),
    Inline(InlineAttributes),
}

impl ScanFrameKind {
    fn suppresses_children(&self) -> bool {
        matches!(self, Self::Suppressed | Self::Ignored | Self::OpaqueInline)
    }
}

struct TypedAttributes {
    epub_type: String,
    href: Option<String>,
    id: Option<String>,
}

struct InlineAttributes {
    hint: Option<TypedAttributes>,
    anchor_href: Option<String>,
}

impl InlineAttributes {
    fn from_element(element: XhtmlSemanticElement<'_>) -> Self {
        let anchor_href = (element.local_name == "a")
            .then(|| element.href.map(ToOwned::to_owned))
            .flatten();
        let hint = element.epub_type.map(|epub_type| TypedAttributes {
            epub_type: epub_type.to_owned(),
            href: anchor_href.clone(),
            id: element.id.map(ToOwned::to_owned),
        });
        Self { hint, anchor_href }
    }
}

impl TypedAttributes {
    fn from_element(element: XhtmlSemanticElement<'_>) -> Option<Self> {
        Some(Self {
            epub_type: element.epub_type?.to_owned(),
            href: (element.local_name == "a")
                .then(|| element.href.map(ToOwned::to_owned))
                .flatten(),
            id: element.id.map(ToOwned::to_owned),
        })
    }
}

#[derive(Default)]
struct FrameOutput {
    emitted_block: bool,
    block_hint_indices: Vec<usize>,
}

#[cfg(test)]
mod tests {
    use super::{scan_epub_type_attribute_hints, EpubTypeAttributeHint};

    #[test]
    fn mirrors_body_ignored_opaque_and_inline_unwrap_semantics() {
        let hints = scan_epub_type_attribute_hints(
            r##"<html xmlns:epub="http://www.idpf.org/2007/ops">
            <head><a epub:type="noteref" href="#head">head</a></head>
            <body>
              <a epub:type="noteref" href="#kept">kept</a>
              <script><a epub:type="noteref" href="#script">script</a></script>
              <a epub:type="noteref" href="#unwrapped"><div>block</div></a>
              <a href="#merged"><div epub:type="noteref">merged block target</div></a>
              <br epub:type="noteref" href="#br">
              <aside epub:type="footnote" id="outer">
                <aside epub:type="endnote" id="inner">nested</aside>
              </aside>
            </body></html>"##,
        )
        .expect("attribute scan");

        assert!(hints.contains(&EpubTypeAttributeHint {
            is_block: false,
            epub_type: "noteref".to_owned(),
            href: Some("#kept".to_owned()),
            id: None,
        }));
        assert!(hints.iter().any(|hint| {
            hint.is_block && hint.epub_type == "footnote" && hint.id.as_deref() == Some("outer")
        }));
        assert!(hints.iter().any(|hint| {
            hint.is_block && hint.epub_type == "endnote" && hint.id.as_deref() == Some("inner")
        }));
        assert!(hints.iter().any(|hint| {
            hint.is_block && hint.epub_type == "noteref" && hint.href.as_deref() == Some("#merged")
        }));
        for excluded in ["#head", "#script", "#unwrapped", "#br"] {
            assert!(!hints
                .iter()
                .any(|hint| hint.href.as_deref() == Some(excluded)));
        }
    }

    #[test]
    fn rejects_malformed_source_without_returning_partial_hints() {
        assert!(scan_epub_type_attribute_hints(
            r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><a epub:type="noteref" href="#n"></body></html>"##
        )
        .is_err());
    }
}
