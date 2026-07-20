//! Fail-closed bridge from Stylo's engine-neutral projections to the current
//! `StyledNode` consumer contract.
//!
//! This module never parses CSS and never completes a partial Stylo result
//! with values from the legacy cascade. Both the principal tree and an
//! optional filtered pagination tree are materialized from the same pair of
//! projection tables.

mod background;
mod transform;
mod value;

use rito_source::{NodeId, SourceArena, SourceNodeKind};
use rito_style_contract::{
    AlignItemsV1, InlineFormattingStyleV1, JustifyContentV1, LayoutDisplayInsideV1,
    LayoutDisplayOutsideV1, LayoutFormattingStyleV1, LayoutStyleTableError, LengthPercentage,
    LengthPercentageOrAuto, PhysicalSides, PreferredSizeV1, StyleTableError,
};
use rito_stylo::{
    InlineStyleDispositionV1, InlineStyleFieldV1, InlineStyleProjectionReasonV1,
    InlineStyleProjectionV1, LayoutStyleDispositionV1, LayoutStyleFieldV1,
    LayoutStyleProjectionReasonV1, LayoutStyleProjectionV1,
};
use serde_json::{json, Map, Value};

use crate::xhtml::{DocumentNode, ElementNode, ImageNode, SourceRef, TextNode};

use super::{ChapterStyleOptions, StyledNode, StyledNodeKind};
use background::copy_materialized_background_image;
use value::{is_transparent, materialize_style, LayoutMaterializationMode, MaterializeValueError};

pub(crate) struct StyloMaterializeInput<'a> {
    pub(crate) source_arena: &'a SourceArena,
    pub(crate) inline: &'a InlineStyleProjectionV1,
    pub(crate) layout: &'a LayoutStyleProjectionV1,
    pub(crate) nodes: &'a [DocumentNode],
    pub(crate) pagination_nodes: Option<&'a [DocumentNode]>,
    pub(crate) body_node_id: NodeId,
    pub(crate) options: ChapterStyleOptions<'a>,
}

pub(crate) struct StyloMaterializedChapter {
    pub(crate) styled_nodes: Vec<StyledNode>,
    pub(crate) pagination_styled_nodes: Option<Vec<StyledNode>>,
    pub(crate) page_paint: Option<Value>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SemanticNodeKind {
    Element,
    Image,
    Text,
    Body,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StyloMaterializeRejection {
    MissingSourceNodeId {
        kind: SemanticNodeKind,
    },
    SourceNodeOutOfBounds {
        node_id: NodeId,
    },
    SourceNodeKindMismatch {
        node_id: NodeId,
        expected: SemanticNodeKind,
    },
    SourceElementTagMismatch {
        node_id: NodeId,
    },
    InlineProjectionRejected {
        node_id: NodeId,
        field: InlineStyleFieldV1,
        reason: InlineStyleProjectionReasonV1,
    },
    LayoutProjectionRejected {
        node_id: NodeId,
        field: LayoutStyleFieldV1,
        reason: LayoutStyleProjectionReasonV1,
    },
    InlineTable(StyleTableError),
    LayoutTable(LayoutStyleTableError),
    UnsupportedValue(MaterializeValueError),
}

impl From<MaterializeValueError> for StyloMaterializeRejection {
    fn from(value: MaterializeValueError) -> Self {
        Self::UnsupportedValue(value)
    }
}

pub(crate) fn materialize_stylo_chapter(
    input: StyloMaterializeInput<'_>,
) -> Result<StyloMaterializedChapter, StyloMaterializeRejection> {
    validate_body(input.source_arena, input.body_node_id)?;
    let body = projected_style(input.inline, input.layout, input.body_node_id)?;
    let body_style = materialize_style(
        body.0,
        body.1,
        LayoutMaterializationMode::FlowOnly,
        &Map::new(),
    )?;
    let computed_override_line_height = input
        .options
        .line_height_override
        .and_then(|_| body_style.get("lineHeight"))
        .and_then(Value::as_f64);
    let computed_override_family = input
        .options
        .font_family_override
        .and_then(|_| body_style.get("fontFamily"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let page_paint = page_paint(body.0, &body_style);
    let mut styled_nodes = materialize_nodes(
        input.source_arena,
        input.inline,
        input.layout,
        input.nodes,
        &body_style,
        input.options,
    )?;
    let mut pagination_styled_nodes = input
        .pagination_nodes
        .map(|nodes| {
            materialize_nodes(
                input.source_arena,
                input.inline,
                input.layout,
                nodes,
                &body_style,
                input.options,
            )
        })
        .transpose()?;
    if let (Some(original), Some(computed)) = (
        input.options.line_height_override,
        computed_override_line_height,
    ) {
        normalize_overridden_line_height(&mut styled_nodes, computed, original);
        if let Some(nodes) = &mut pagination_styled_nodes {
            normalize_overridden_line_height(nodes, computed, original);
        }
    }
    if let (Some(original), Some(computed)) = (
        input.options.font_family_override,
        computed_override_family.as_deref(),
    ) {
        normalize_overridden_font_family(&mut styled_nodes, computed, original);
        if let Some(nodes) = &mut pagination_styled_nodes {
            normalize_overridden_font_family(nodes, computed, original);
        }
    }
    apply_forced_typography(&mut styled_nodes, input.options);
    if let Some(nodes) = &mut pagination_styled_nodes {
        apply_forced_typography(nodes, input.options);
    }
    Ok(StyloMaterializedChapter {
        styled_nodes,
        pagination_styled_nodes,
        page_paint,
    })
}

fn validate_body(source: &SourceArena, node_id: NodeId) -> Result<(), StyloMaterializeRejection> {
    let element = source
        .node(node_id)
        .ok_or(StyloMaterializeRejection::SourceNodeOutOfBounds { node_id })?
        .as_element()
        .ok_or(StyloMaterializeRejection::SourceNodeKindMismatch {
            node_id,
            expected: SemanticNodeKind::Body,
        })?;
    if !element.name.local_name.eq_ignore_ascii_case("body") {
        return Err(StyloMaterializeRejection::SourceElementTagMismatch { node_id });
    }
    Ok(())
}

fn materialize_nodes(
    source: &SourceArena,
    inline: &InlineStyleProjectionV1,
    layout: &LayoutStyleProjectionV1,
    nodes: &[DocumentNode],
    parent_style: &Map<String, Value>,
    options: ChapterStyleOptions<'_>,
) -> Result<Vec<StyledNode>, StyloMaterializeRejection> {
    let mut output = Vec::with_capacity(nodes.len());
    for node in nodes {
        if let Some(node) = materialize_node(source, inline, layout, node, parent_style, options)? {
            output.push(node);
        }
    }
    Ok(output)
}

fn materialize_node(
    source: &SourceArena,
    inline: &InlineStyleProjectionV1,
    layout: &LayoutStyleProjectionV1,
    node: &DocumentNode,
    parent_style: &Map<String, Value>,
    options: ChapterStyleOptions<'_>,
) -> Result<Option<StyledNode>, StyloMaterializeRejection> {
    match node {
        DocumentNode::Block(element) | DocumentNode::Inline(element) => {
            materialize_element(source, inline, layout, node, element, parent_style, options)
        }
        DocumentNode::Image(image) => {
            materialize_image(source, inline, layout, image, parent_style)
        }
        DocumentNode::Text(text) => {
            validate_text_source(source, text)?;
            // Text nodes inherit only the legacy-inheritable subset; box
            // properties reset to their defaults exactly like the retired
            // resolver.
            Ok(Some(StyledNode::text(
                text.content.clone(),
                text.source_text.clone(),
                super::inheritance::inheritable_style(parent_style),
                text.source_ref.clone(),
            )))
        }
    }
}

fn materialize_element(
    source: &SourceArena,
    inline: &InlineStyleProjectionV1,
    layout: &LayoutStyleProjectionV1,
    semantic: &DocumentNode,
    element: &ElementNode,
    parent_style: &Map<String, Value>,
    options: ChapterStyleOptions<'_>,
) -> Result<Option<StyledNode>, StyloMaterializeRejection> {
    let node_id = element_node_id(source, element)?;
    let (inline_style, layout_style) = projected_style(inline, layout, node_id)?;
    if value::display_is_none(layout_style) {
        return Ok(None);
    }
    let layout_mode =
        layout_materialization_mode(source, inline, layout, semantic, element, layout_style)?;
    #[cfg(feature = "bench-internals")]
    if layout_mode == LayoutMaterializationMode::SingleImageCenteredFlex
        && std::env::var_os("RITO_STYLO_FALLBACK_DIAGNOSTICS").is_some()
    {
        eprintln!(
            "rito Stylo bounded layout [single-image-centered-flex]: node_id={}",
            node_id.index()
        );
    }
    let mut style = materialize_style(inline_style, layout_style, layout_mode, parent_style)?;
    propagate_text_decoration(&mut style, parent_style);
    let children = materialize_nodes(source, inline, layout, &element.children, &style, options)?;
    Ok(Some(StyledNode {
        node_type: match semantic {
            DocumentNode::Block(_) => StyledNodeKind::Block,
            DocumentNode::Inline(_) => StyledNodeKind::Inline,
            DocumentNode::Text(_) | DocumentNode::Image(_) => unreachable!(),
        },
        tag: Some(element.tag.clone()),
        content: None,
        source_text: None,
        src: None,
        alt: None,
        id: element
            .attributes
            .as_ref()
            .and_then(|value| value.id.clone()),
        href: element
            .attributes
            .as_ref()
            .and_then(|value| value.href.clone()),
        colspan: element.attributes.as_ref().and_then(|value| value.colspan),
        rowspan: element.attributes.as_ref().and_then(|value| value.rowspan),
        style,
        children,
        source_ref: Some(element.source_ref.clone()),
    }))
}

fn materialize_image(
    source: &SourceArena,
    inline: &InlineStyleProjectionV1,
    layout: &LayoutStyleProjectionV1,
    image: &ImageNode,
    parent_style: &Map<String, Value>,
) -> Result<Option<StyledNode>, StyloMaterializeRejection> {
    let node_id = source_element_id(source, &image.source_ref, SemanticNodeKind::Image)?;
    let (inline_style, layout_style) = projected_style(inline, layout, node_id)?;
    if value::display_is_none(layout_style) {
        return Ok(None);
    }
    let mut style = materialize_style(
        inline_style,
        layout_style,
        LayoutMaterializationMode::FlowOnly,
        parent_style,
    )?;
    // Replaced-element defaults are Rito layout policy, not author CSS.
    style.insert("objectFit".to_owned(), Value::String("contain".to_owned()));
    style.insert(
        "boxSizing".to_owned(),
        Value::String("border-box".to_owned()),
    );
    Ok(Some(StyledNode {
        node_type: StyledNodeKind::Image,
        tag: None,
        content: None,
        source_text: None,
        src: Some(image.src.clone()),
        alt: Some(image.alt.clone()),
        id: image.attributes.as_ref().and_then(|value| value.id.clone()),
        href: image
            .attributes
            .as_ref()
            .and_then(|value| value.href.clone()),
        colspan: None,
        rowspan: None,
        style,
        children: Vec::new(),
        source_ref: Some(image.source_ref.clone()),
    }))
}

fn layout_materialization_mode(
    source: &SourceArena,
    inline: &InlineStyleProjectionV1,
    layout_projection: &LayoutStyleProjectionV1,
    semantic: &DocumentNode,
    element: &ElementNode,
    layout: &LayoutFormattingStyleV1,
) -> Result<LayoutMaterializationMode, StyloMaterializeRejection> {
    let is_exact_flex = layout.display.outside == LayoutDisplayOutsideV1::Block
        && layout.display.inside == LayoutDisplayInsideV1::Flex
        && !layout.display.is_list_item
        && layout.justify_content == JustifyContentV1::Center
        && layout.align_items == AlignItemsV1::Center;
    let has_positive_absolute_height = matches!(
        layout.height,
        PreferredSizeV1::Value(value)
            if matches!(value.value(), LengthPercentage::Length(height) if height.get() > 0.0)
    );
    if !matches!(semantic, DocumentNode::Block(_))
        || !is_exact_flex
        || !has_positive_absolute_height
    {
        return Ok(LayoutMaterializationMode::FlowOnly);
    }
    let [DocumentNode::Image(image)] = element.children.as_slice() else {
        return Ok(LayoutMaterializationMode::FlowOnly);
    };
    let image_node_id = source_element_id(source, &image.source_ref, SemanticNodeKind::Image)?;
    let (image_inline, _) = projected_style(inline, layout_projection, image_node_id)?;
    if has_auto_margin(image_inline.fragment.margin) {
        return Err(MaterializeValueError::UnsupportedConsumerValue {
            field: value::MaterializeField::FlexItemMargin,
        }
        .into());
    }
    Ok(LayoutMaterializationMode::SingleImageCenteredFlex)
}

fn has_auto_margin(sides: PhysicalSides<LengthPercentageOrAuto>) -> bool {
    matches!(sides.top, LengthPercentageOrAuto::Auto)
        || matches!(sides.right, LengthPercentageOrAuto::Auto)
        || matches!(sides.bottom, LengthPercentageOrAuto::Auto)
        || matches!(sides.left, LengthPercentageOrAuto::Auto)
}

fn element_node_id(
    source: &SourceArena,
    element: &ElementNode,
) -> Result<NodeId, StyloMaterializeRejection> {
    let node_id = source_element_id(source, &element.source_ref, SemanticNodeKind::Element)?;
    let source_element = source
        .node(node_id)
        .and_then(|node| node.as_element())
        .expect("source_element_id validated the node");
    if !source_element
        .name
        .local_name
        .eq_ignore_ascii_case(&element.tag)
    {
        return Err(StyloMaterializeRejection::SourceElementTagMismatch { node_id });
    }
    Ok(node_id)
}

fn source_element_id(
    source: &SourceArena,
    source_ref: &SourceRef,
    kind: SemanticNodeKind,
) -> Result<NodeId, StyloMaterializeRejection> {
    let node_id = source_ref
        .source_node_id
        .ok_or(StyloMaterializeRejection::MissingSourceNodeId { kind })?;
    let node = source
        .node(node_id)
        .ok_or(StyloMaterializeRejection::SourceNodeOutOfBounds { node_id })?;
    if !matches!(&node.kind, SourceNodeKind::Element(_)) {
        return Err(StyloMaterializeRejection::SourceNodeKindMismatch {
            node_id,
            expected: kind,
        });
    }
    Ok(node_id)
}

fn validate_text_source(
    source: &SourceArena,
    text: &TextNode,
) -> Result<(), StyloMaterializeRejection> {
    let node_id =
        text.source_ref
            .source_node_id
            .ok_or(StyloMaterializeRejection::MissingSourceNodeId {
                kind: SemanticNodeKind::Text,
            })?;
    source
        .node(node_id)
        .ok_or(StyloMaterializeRejection::SourceNodeOutOfBounds { node_id })?;
    Ok(())
}

fn projected_style<'a>(
    inline: &'a InlineStyleProjectionV1,
    layout: &'a LayoutStyleProjectionV1,
    node_id: NodeId,
) -> Result<(&'a InlineFormattingStyleV1, &'a LayoutFormattingStyleV1), StyloMaterializeRejection> {
    let inline_style = inline
        .table()
        .style_for_node(node_id.index())
        .map_err(|error| {
            inline_rejection(inline, node_id)
                .unwrap_or(StyloMaterializeRejection::InlineTable(error))
        })?;
    let layout_style = layout
        .table()
        .style_for_node(node_id.index())
        .map_err(|error| {
            layout_rejection(layout, node_id)
                .unwrap_or(StyloMaterializeRejection::LayoutTable(error))
        })?;
    Ok((inline_style, layout_style))
}

fn inline_rejection(
    projection: &InlineStyleProjectionV1,
    expected: NodeId,
) -> Option<StyloMaterializeRejection> {
    projection
        .dispositions()
        .iter()
        .find_map(|disposition| match *disposition {
            InlineStyleDispositionV1::ContractRejected {
                node_id,
                field,
                reason,
            } if node_id == expected => Some(StyloMaterializeRejection::InlineProjectionRejected {
                node_id,
                field,
                reason,
            }),
            InlineStyleDispositionV1::ContractProjected { .. }
            | InlineStyleDispositionV1::ContractRejected { .. } => None,
        })
}

fn layout_rejection(
    projection: &LayoutStyleProjectionV1,
    expected: NodeId,
) -> Option<StyloMaterializeRejection> {
    projection
        .dispositions()
        .iter()
        .find_map(|disposition| match *disposition {
            LayoutStyleDispositionV1::ContractRejected {
                node_id,
                field,
                reason,
            } if node_id == expected => Some(StyloMaterializeRejection::LayoutProjectionRejected {
                node_id,
                field,
                reason,
            }),
            LayoutStyleDispositionV1::ContractProjected { .. }
            | LayoutStyleDispositionV1::ContractRejected { .. } => None,
        })
}

fn page_paint(inline: &InlineFormattingStyleV1, style: &Map<String, Value>) -> Option<Value> {
    let background = inline.paint.background.resolve(inline.paint.foreground);
    let mut paint = Map::new();
    if !is_transparent(background) {
        let background_color = style.get("backgroundColor")?.as_str()?;
        paint.insert(
            "backgroundColor".to_owned(),
            Value::String(background_color.to_owned()),
        );
    }
    copy_materialized_background_image(&mut paint, style);
    (!paint.is_empty()).then_some(Value::Object(paint))
}

fn propagate_text_decoration(style: &mut Map<String, Value>, parent_style: &Map<String, Value>) {
    if style.get("textDecoration").and_then(Value::as_str) == Some("none") {
        if let Some(parent) = parent_style.get("textDecoration") {
            style.insert("textDecoration".to_owned(), parent.clone());
        }
    }
}

fn apply_forced_typography(nodes: &mut [StyledNode], options: ChapterStyleOptions<'_>) {
    for node in nodes {
        if options.line_height_force {
            if let Some(line_height) = options.line_height_override {
                node.style
                    .insert("lineHeight".to_owned(), json!(line_height));
                node.style.remove("lineHeightPx");
            }
        }
        if options.font_family_force {
            if let Some(font_family) = options.font_family_override {
                node.style.insert(
                    "fontFamily".to_owned(),
                    Value::String(font_family.to_owned()),
                );
            }
        }
        apply_forced_typography(&mut node.children, options);
    }
}

fn normalize_overridden_font_family(nodes: &mut [StyledNode], computed: &str, original: &str) {
    for node in nodes {
        if node.style.get("fontFamily").and_then(Value::as_str) == Some(computed) {
            node.style
                .insert("fontFamily".to_owned(), Value::String(original.to_owned()));
        }
        normalize_overridden_font_family(&mut node.children, computed, original);
    }
}

fn normalize_overridden_line_height(nodes: &mut [StyledNode], computed: f64, original: f64) {
    for node in nodes {
        if node.style.get("lineHeight").and_then(Value::as_f64) == Some(computed) {
            node.style.insert("lineHeight".to_owned(), json!(original));
        }
        normalize_overridden_line_height(&mut node.children, computed, original);
    }
}
