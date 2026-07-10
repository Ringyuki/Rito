use serde_json::{Map, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild, RuntimeImage},
    image_size::{ImageSize, ImageSizeIndex},
    line::LineBox,
    style_values::{block_paint_from_style, border_box_from_style, positive_style, string_style},
};

type ContinuousBlock = RuntimeBlock<LineBox>;
type ContinuousChild = RuntimeChild<LineBox>;
type ContinuousImage = RuntimeImage;

pub(crate) struct ContinuousImageBlockInput<'a> {
    pub(crate) src: &'a str,
    pub(crate) content_width: f64,
    pub(crate) content_height: f64,
    pub(crate) y: f64,
    pub(crate) image_sizes: &'a ImageSizeIndex,
    pub(crate) style: &'a Map<String, Value>,
    pub(crate) alt: Option<String>,
    pub(crate) href: Option<String>,
}

pub(crate) fn layout_continuous_image_block(
    input: ContinuousImageBlockInput<'_>,
) -> ContinuousBlock {
    let intrinsic = input.image_sizes.resolve(input.src);
    let aspect = intrinsic
        .map(|size| size.height / size.width)
        .unwrap_or(0.75);
    let (width, height) = resolve_continuous_image_box(
        input.content_width,
        input.content_height,
        aspect,
        intrinsic,
        input.style,
    );
    let x = if width < input.content_width {
        (input.content_width - width) / 2.0
    } else {
        0.0
    };

    ContinuousBlock {
        x: 0.0,
        y: input.y,
        width: input.content_width,
        height,
        semantic_tag: None,
        anchor_id: None,
        paint: block_paint_from_style(input.style),
        border_box: border_box_from_style(input.style),
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: vec![ContinuousChild::Image(ContinuousImage {
            x,
            y: 0.0,
            width,
            height,
            src: input.src.to_owned(),
            alt: input.alt.filter(|value| !value.is_empty()),
            href: input.href.filter(|value| !value.is_empty()),
        })],
    }
}

fn resolve_continuous_image_box(
    content_width: f64,
    content_height: f64,
    aspect: f64,
    intrinsic: Option<ImageSize>,
    style: &Map<String, Value>,
) -> (f64, f64) {
    let has_explicit_width = positive_style(style, "width").is_some();
    let has_explicit_height = positive_style(style, "height").is_some();
    let mut width = if has_explicit_width {
        positive_style(style, "width")
            .unwrap_or(content_width)
            .min(content_width)
    } else {
        content_width
    };
    if let Some(max_width) = positive_style(style, "maxWidth") {
        width = width.min(max_width);
    }
    let mut height = if has_explicit_height {
        positive_style(style, "height").unwrap_or(0.0)
    } else {
        width * aspect
    };
    if has_explicit_height && !has_explicit_width {
        width = (height / aspect).min(content_width);
    }

    if let Some(intrinsic) = intrinsic {
        if string_style(style, "objectFit").as_deref() == Some("contain")
            && positive_style(style, "width").is_some()
            && positive_style(style, "height").is_some()
        {
            let intrinsic_ratio = intrinsic.width / intrinsic.height;
            let box_ratio = width / height;
            if intrinsic_ratio < box_ratio {
                width = height * intrinsic_ratio;
            } else if intrinsic_ratio > box_ratio {
                height = width / intrinsic_ratio;
            }
        }
    }

    if height > content_height {
        height = content_height;
        width = height / aspect;
    }
    if width > content_width {
        width = content_width;
        height = width * aspect;
    }

    (width, height)
}
