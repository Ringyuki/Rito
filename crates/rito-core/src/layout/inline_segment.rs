use std::sync::Arc;

use serde_json::{Map, Value};

use super::{
    image_size::ImageSizeIndex,
    text_mapping::{RunTextMapping, TextSegmentMapping},
};

#[derive(Debug, Clone, Default)]
pub(crate) struct SegmentContext<'a> {
    pub(crate) image_sizes: Option<&'a ImageSizeIndex>,
    pub(crate) href: Option<String>,
    pub(crate) bg_color: Option<String>,
    pub(crate) vertical_align: Option<String>,
    pub(crate) padding: Option<InlinePadding>,
    pub(crate) border_radius: Option<f64>,
    pub(crate) borders: Option<InlineBorders>,
}

#[derive(Debug, Clone)]
pub(crate) struct InlinePadding {
    pub(crate) top: f64,
    pub(crate) right: f64,
    pub(crate) bottom: f64,
    pub(crate) left: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct InlineBorders {
    pub(crate) top: Value,
    pub(crate) right: Value,
    pub(crate) bottom: Value,
    pub(crate) left: Value,
}

#[derive(Debug, Clone)]
pub(crate) enum InlineSegment {
    Text(TextSegment),
    Atom(AtomSegment),
}

impl InlineSegment {
    pub(crate) fn style(&self) -> &Map<String, Value> {
        match self {
            Self::Text(segment) => &segment.style,
            Self::Atom(segment) => &segment.style,
        }
    }

    pub(crate) fn is_atom(&self) -> bool {
        matches!(self, Self::Atom(_))
    }

    pub(crate) fn text_content(&self) -> Option<&str> {
        match self {
            Self::Text(segment) => Some(&segment.text),
            Self::Atom(_) => None,
        }
    }

    pub(crate) fn ruby_annotation(&self) -> Option<&str> {
        match self {
            Self::Text(segment) => segment.ruby_annotation.as_deref(),
            Self::Atom(_) => None,
        }
    }

    pub(crate) fn as_text_mut(&mut self) -> Option<&mut TextSegment> {
        match self {
            Self::Text(segment) => Some(segment),
            Self::Atom(_) => None,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct TextSegment {
    pub(crate) text: String,
    pub(crate) mapping: TextSegmentMapping,
    pub(crate) style: Map<String, Value>,
    pub(crate) href: Option<String>,
    pub(crate) source_path: Option<Vec<usize>>,
    pub(crate) source_text: Option<Arc<str>>,
    pub(crate) source_text_offset: Option<usize>,
    pub(crate) ruby_annotation: Option<String>,
    pub(crate) inline_margin_left: Option<f64>,
    pub(crate) inline_margin_right: Option<f64>,
    pub(crate) border_start: bool,
    pub(crate) border_end: bool,
}

impl TextSegment {
    pub(crate) fn run_text_mapping(&self, start: usize, end: usize) -> RunTextMapping {
        self.mapping.run_mapping(start, end)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AtomSegment {
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) style: Map<String, Value>,
    pub(crate) image_src: Option<String>,
    pub(crate) alt: Option<String>,
    pub(crate) href: Option<String>,
    pub(crate) source_path: Option<Vec<usize>>,
}
