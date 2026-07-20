use serde_json::{Map, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild},
    continuous_image::{layout_continuous_image_block, ContinuousImageBlockInput},
    image_size::ImageSizeIndex,
    line::LineBox,
    style_values::{
        block_paint_from_style, bool_style, border_box_from_style, border_width, positive_style,
        resolve_margin_bottom, resolve_margin_left, resolve_margin_right, resolve_margin_top,
        resolve_padding_bottom, resolve_padding_left, resolve_padding_right, resolve_padding_top,
        string_or_default,
    },
};
use crate::style::{StyledNode, StyledNodeKind};

pub(crate) struct SingleImageFlexInput<'a> {
    pub(crate) node: &'a StyledNode,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) page_content_height: f64,
    pub(crate) image_sizes: &'a ImageSizeIndex,
}

pub(crate) fn is_supported_single_image_flex(node: &StyledNode) -> bool {
    node.node_type == StyledNodeKind::Block
        && string_or_default(&node.style, "display", "block") == "flex"
        && string_or_default(&node.style, "flexDirection", "") == "row"
        && string_or_default(&node.style, "flexWrap", "") == "nowrap"
        && string_or_default(&node.style, "justifyContent", "") == "center"
        && string_or_default(&node.style, "alignItems", "") == "center"
        && positive_style(&node.style, "height").is_some()
        && matches!(node.children.as_slice(), [child]
            if child.node_type == StyledNodeKind::Image
                && child.src.is_some()
                && !bool_style(&child.style, "marginLeftAuto")
                && !bool_style(&child.style, "marginRightAuto"))
}

pub(crate) fn layout_single_image_flex(input: SingleImageFlexInput<'_>) -> RuntimeBlock<LineBox> {
    debug_assert!(is_supported_single_image_flex(input.node));
    let style = &input.node.style;
    let insets = FlexInsets::from_style(style, input.width);
    let height = flex_border_box_height(style, insets);
    let inner_width = (input.width - insets.horizontal()).max(0.0);
    let inner_height = (height - insets.vertical()).max(0.0);
    let image_node = &input.node.children[0];
    let margins = FlexItemMargins::from_style(&image_node.style, inner_width);
    let mut image_block = layout_continuous_image_block(ContinuousImageBlockInput {
        src: image_node
            .src
            .as_deref()
            .expect("validated flex image source"),
        content_width: (inner_width - margins.horizontal()).max(0.0),
        content_height: (inner_height - margins.vertical())
            .max(0.0)
            .min(input.page_content_height),
        y: 0.0,
        image_sizes: input.image_sizes,
        style: &image_node.style,
        alt: image_node.alt.clone(),
        href: image_node.href.clone(),
    });
    let image = match image_block.children.pop() {
        Some(RuntimeChild::Image(mut image)) => {
            image.x = insets.left
                + (inner_width - image.width - margins.horizontal()) / 2.0
                + margins.left;
            image.y =
                insets.top + (inner_height - image.height - margins.vertical()) / 2.0 + margins.top;
            image
        }
        _ => unreachable!("continuous image block owns exactly one image"),
    };

    RuntimeBlock {
        x: input.x,
        y: input.y,
        width: input.width,
        height,
        semantic_tag: input.node.tag.clone(),
        anchor_id: input.node.id.clone(),
        paint: block_paint_from_style(style),
        border_box: border_box_from_style(style),
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: vec![RuntimeChild::Image(image)],
    }
}

#[derive(Clone, Copy)]
struct FlexItemMargins {
    top: f64,
    right: f64,
    bottom: f64,
    left: f64,
}

impl FlexItemMargins {
    fn from_style(style: &Map<String, Value>, width: f64) -> Self {
        Self {
            top: resolve_margin_top(style, width),
            right: resolve_margin_right(style, width),
            bottom: resolve_margin_bottom(style, width),
            left: resolve_margin_left(style, width),
        }
    }

    fn horizontal(self) -> f64 {
        self.left + self.right
    }

    fn vertical(self) -> f64 {
        self.top + self.bottom
    }
}

#[derive(Clone, Copy)]
struct FlexInsets {
    top: f64,
    right: f64,
    bottom: f64,
    left: f64,
}

impl FlexInsets {
    fn from_style(style: &Map<String, Value>, width: f64) -> Self {
        Self {
            top: resolve_padding_top(style, width) + border_width(style, "borderTop"),
            right: resolve_padding_right(style, width) + border_width(style, "borderRight"),
            bottom: resolve_padding_bottom(style, width) + border_width(style, "borderBottom"),
            left: resolve_padding_left(style, width) + border_width(style, "borderLeft"),
        }
    }

    fn horizontal(self) -> f64 {
        self.left + self.right
    }

    fn vertical(self) -> f64 {
        self.top + self.bottom
    }
}

fn flex_border_box_height(style: &Map<String, Value>, insets: FlexInsets) -> f64 {
    let specified = positive_style(style, "height").expect("validated positive flex height");
    let mut height = if string_or_default(style, "boxSizing", "content-box") == "border-box" {
        specified
    } else {
        specified + insets.vertical()
    };
    if let Some(min_height) = positive_style(style, "minHeight") {
        height = height.max(min_height);
    }
    if let Some(max_height) = positive_style(style, "maxHeight") {
        height = height.min(max_height);
    }
    height
}
