use serde_json::{Map, Value};

use crate::style::StyledNode;

use super::super::{build_inline_child_context, SegmentContext};
use crate::layout::image_size::ImageSizeIndex;
use crate::layout::{inline_segment::AtomSegment, style_values::string_style};

#[derive(Debug, Clone, Default)]
pub(super) struct OwnedInlineContext {
    pub(super) href: Option<String>,
    bg_color: Option<String>,
    vertical_align: Option<String>,
    padding: Option<crate::layout::inline_segment::InlinePadding>,
    border_radius: Option<f64>,
    borders: Option<crate::layout::inline_segment::InlineBorders>,
}

impl OwnedInlineContext {
    pub(super) fn root(href: Option<String>) -> Self {
        Self {
            href,
            ..Self::default()
        }
    }

    pub(super) fn child(&self, node: &StyledNode) -> (Self, bool) {
        let inherited = self.as_borrowed(None);
        let child = build_inline_child_context(node, &inherited);
        let context = child.context;
        (
            Self {
                href: context.href,
                bg_color: context.bg_color,
                vertical_align: context.vertical_align,
                padding: context.padding,
                border_radius: context.border_radius,
                borders: context.borders,
            },
            child.has_own_borders,
        )
    }

    pub(super) fn ruby_base(&self) -> Self {
        Self {
            href: self.href.clone(),
            bg_color: self.bg_color.clone(),
            vertical_align: self.vertical_align.clone(),
            padding: None,
            border_radius: None,
            borders: None,
        }
    }

    pub(super) fn patched_style(&self, style: Map<String, Value>) -> Map<String, Value> {
        super::super::patch_owned_inherited_style(style, &self.as_borrowed(None))
    }

    pub(super) fn finish_image_atom(&self, mut atom: AtomSegment) -> AtomSegment {
        atom.href = self.href.clone();
        if self.vertical_align.is_some()
            && string_style(&atom.style, "verticalAlign").as_deref() == Some("baseline")
        {
            if let Some(vertical_align) = &self.vertical_align {
                atom.style.insert(
                    "verticalAlign".to_owned(),
                    Value::String(vertical_align.clone()),
                );
            }
        }
        atom
    }

    pub(super) fn as_borrowed<'a>(
        &self,
        image_sizes: Option<&'a ImageSizeIndex>,
    ) -> SegmentContext<'a> {
        SegmentContext {
            image_sizes,
            href: self.href.clone(),
            bg_color: self.bg_color.clone(),
            vertical_align: self.vertical_align.clone(),
            padding: self.padding.clone(),
            border_radius: self.border_radius,
            borders: self.borders.clone(),
        }
    }
}
