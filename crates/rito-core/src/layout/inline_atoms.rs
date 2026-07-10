use super::{
    image_size::{ImageSize, ImageSizeIndex},
    inline_segment::AtomSegment,
    style_values::{number_style, positive_style, string_style},
};
use crate::style::StyledNode;

pub(crate) fn create_image_atom(
    node: &StyledNode,
    image_sizes: Option<&ImageSizeIndex>,
) -> AtomSegment {
    let src = node.src.clone().unwrap_or_default();
    let intrinsic = image_sizes.and_then(|sizes| sizes.resolve(&src));
    let font_size = number_style(&node.style, "fontSize").unwrap_or(16.0);
    let style_width = number_style(&node.style, "width").unwrap_or(0.0);
    let style_height = number_style(&node.style, "height").unwrap_or(0.0);
    let mut width = if style_width > 0.0 {
        style_width
    } else {
        intrinsic.map(|size| size.width).unwrap_or(font_size)
    };
    let mut height = if style_height > 0.0 {
        style_height
    } else {
        intrinsic.map(|size| size.height).unwrap_or(font_size)
    };

    if intrinsic.is_none() && style_width <= 0.0 && style_height <= 0.0 {
        width = font_size;
        height = font_size;
    } else if intrinsic.is_some() && style_width <= 0.0 && style_height <= 0.0 {
        (width, height) = fit_intrinsic_to_line_height(width, height, node);
    }

    if let Some(intrinsic) = intrinsic {
        (width, height) = fit_contain_object(width, height, intrinsic, node);
    }

    AtomSegment {
        width,
        height,
        style: node.style.clone(),
        image_src: Some(src),
        alt: node.alt.clone().filter(|alt| !alt.is_empty()),
        href: None,
        source_path: None,
    }
}

pub(crate) fn create_inline_block_atom(node: &StyledNode) -> AtomSegment {
    let font_size = number_style(&node.style, "fontSize").unwrap_or(16.0);
    let line_height = number_style(&node.style, "lineHeight").unwrap_or(1.2);
    let width = positive_style(&node.style, "width").unwrap_or(font_size * 5.0);
    let height = positive_style(&node.style, "height").unwrap_or_else(|| {
        number_style(&node.style, "lineHeightPx").unwrap_or(font_size * line_height)
    });

    AtomSegment {
        width,
        height,
        style: node.style.clone(),
        image_src: None,
        alt: None,
        href: None,
        source_path: node
            .source_ref
            .as_ref()
            .map(|source| source.node_path.clone()),
    }
}

fn fit_intrinsic_to_line_height(width: f64, height: f64, node: &StyledNode) -> (f64, f64) {
    let font_size = number_style(&node.style, "fontSize").unwrap_or(16.0);
    let line_height = number_style(&node.style, "lineHeight").unwrap_or(1.2);
    let max_height = number_style(&node.style, "lineHeightPx").unwrap_or(font_size * line_height);
    if height <= max_height {
        return (width, height);
    }
    let scale = max_height / height;
    (width * scale, max_height)
}

fn fit_contain_object(
    width: f64,
    height: f64,
    intrinsic: ImageSize,
    node: &StyledNode,
) -> (f64, f64) {
    if string_style(&node.style, "objectFit").as_deref() != Some("contain")
        || width <= 0.0
        || height <= 0.0
    {
        return (width, height);
    }
    let intrinsic_ratio = intrinsic.width / intrinsic.height;
    let box_ratio = width / height;
    if intrinsic_ratio < box_ratio {
        (height * intrinsic_ratio, height)
    } else if intrinsic_ratio > box_ratio {
        (width, width / intrinsic_ratio)
    } else {
        (width, height)
    }
}
