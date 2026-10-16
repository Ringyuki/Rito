//! `TreeBuilder`'s generated boxes: what the cascade made for an element's
//! `::before` (its first child) and `::after` (its last). An inline box is
//! text in its own style at the start or end of the element's inline
//! content; a block, float or absolutely positioned box is a node of its
//! own, built like a block element: its borders folded into padding and
//! painted, its text as a flow inside.

use rito_fragment::{FormattingNode, FormattingNodeContent, FormattingNodeId};
use rito_style_contract::{
    Float, GeneratedBox, GeneratedContentItem, LayoutDisplayOutside, Position, PseudoElementKind,
};

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::{InlineCollector, TreeBuilder};

/// Where a generated box goes in its element.
pub(super) enum Generated {
    /// Text at the start or end of the element's inline content.
    Inline(GeneratedBox),
    /// A box of its own, the element's first or last child.
    Node(FormattingNodeId),
}

impl TreeBuilder<'_> {
    /// The element's `kind` box, built according to its display, float
    /// and position; `None` when the cascade generates none.
    pub(super) fn generated(
        &mut self,
        source_index: usize,
        kind: PseudoElementKind,
    ) -> EpubResult<Option<Generated>> {
        let Some(generated) = self.generated.get(source_index, kind).cloned() else {
            return Ok(None);
        };
        let what = match kind {
            PseudoElementKind::Before => "::before",
            PseudoElementKind::After => "::after",
        };
        let in_line = {
            let style = self
                .layout
                .style(generated.layout)
                .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?;
            style.position != Position::Absolute
                && style.float == Float::None
                && style.display.outside != LayoutDisplayOutside::Block
        };
        if in_line {
            return Ok(Some(Generated::Inline(generated)));
        }
        Ok(Some(Generated::Node(
            self.build_generated_box(&generated, what)?,
        )))
    }

    /// An element's generated box where it can only be text: inside an
    /// inline element, whose content is a run of inline items.
    pub(super) fn generated_inline(
        &mut self,
        source_index: usize,
        kind: PseudoElementKind,
    ) -> Option<GeneratedBox> {
        let generated = self.generated.get(source_index, kind).cloned()?;
        let boxed = self.layout.style(generated.layout).is_ok_and(|style| {
            style.position == Position::Absolute
                || style.float != Float::None
                || style.display.outside == LayoutDisplayOutside::Block
        });
        if boxed {
            self.degrade("generated box of an inline element laid out as inline text".to_owned());
        }
        Some(generated)
    }

    /// Appends an inline generated box to `collector`: its text, or, when
    /// it has none, an empty inline box whose leading joins the line.
    pub(super) fn collect_generated(
        &mut self,
        generated: &GeneratedBox,
        baseline_shift_px: f64,
        source_index: usize,
        collector: &mut InlineCollector,
    ) -> EpubResult<()> {
        self.require_inline_capabilities(generated.inline, true, "generated box")?;
        let text = self.generated_text(generated);
        if text.is_empty() {
            collector.push_empty_box(generated.inline, baseline_shift_px, source_index);
            return Ok(());
        }
        let collapse = self.white_space_collapse(generated.inline)?;
        collector.push_text(
            &text,
            generated.inline,
            baseline_shift_px,
            collapse,
            None,
            None,
            None,
        );
        Ok(())
    }

    /// Builds a block-level generated box: its border folded into padding
    /// and painted like a block element's, its text as a flow inside.
    fn build_generated_box(
        &mut self,
        generated: &GeneratedBox,
        what: &str,
    ) -> EpubResult<FormattingNodeId> {
        self.require_block_capabilities(generated.layout, what)?;
        let (style, decoration) = match self.block_box_paint_plan_for(generated.inline, what)? {
            Some((paint, widths)) if widths.iter().any(|width| *width > 0.0) => (
                self.style_with_border_padding(generated.layout, widths, what)?,
                Some(paint),
            ),
            Some((paint, _)) => (generated.layout, Some(paint)),
            None => (generated.layout, None),
        };
        let text = self.generated_text(generated);
        let id = if text.is_empty() {
            self.push_node(
                FormattingNode {
                    style,
                    content: FormattingNodeContent::BlockContainer,
                    children: Vec::new(),
                },
                None,
            )
        } else {
            let strut = self.container_text_style(generated.inline)?;
            let mut collector = self.inline_collector();
            let collapse = self.white_space_collapse(strut)?;
            collector.push_text(&text, strut, 0.0, collapse, None, None, None);
            let (items, sources) = collector.finish();
            let id = self.push_node(
                FormattingNode {
                    style,
                    content: FormattingNodeContent::InlineFlow { items },
                    children: Vec::new(),
                },
                None,
            );
            self.strut_styles.insert(id.0, strut);
            self.flow_item_sources.insert(id.0, sources);
            id
        };
        if let Some(paint) = decoration {
            self.node_paints.insert(id.0, paint);
        }
        Ok(id)
    }

    /// The text a generated box shows: its strings and `attr()` values in
    /// order. A value the engine does not generate shows nothing and is
    /// recorded.
    fn generated_text(&mut self, generated: &GeneratedBox) -> String {
        let mut text = String::new();
        for item in &generated.content {
            match item {
                GeneratedContentItem::Text(piece) => text.push_str(piece),
                GeneratedContentItem::Unsupported(what) => {
                    self.degrade(format!("generated content {what} not shown"));
                }
            }
        }
        text
    }
}
