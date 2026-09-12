use std::collections::BTreeMap;

use serde_json::Value;

use crate::layout::RunPaint;

mod json;
mod reader_wire_v1;
mod refs;
mod stable_json;

pub(crate) use reader_wire_v1::{
    adapt_reader_display_list_v1, contract, encode_reader_primitive_list_v1,
    ReaderDisplayListWireError, ReaderEncodedDisplayListV1,
};
pub use refs::DisplayListResourceRefs;
pub(crate) use refs::{summarize_display_list_font_families, summarize_display_list_resource_refs};
use stable_json::hash_json;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DisplayCommandKind {
    PushState,
    PopState,
    Translate,
    Opacity,
    Transform,
    ClipRect,
    PaintPage,
    PaintBlock,
    PaintText,
    PaintRuby,
    PaintImage,
    PaintHorizontalRule,
}

impl DisplayCommandKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::PushState => "pushState",
            Self::PopState => "popState",
            Self::Translate => "translate",
            Self::Opacity => "opacity",
            Self::Transform => "transform",
            Self::ClipRect => "clipRect",
            Self::PaintPage => "paintPage",
            Self::PaintBlock => "paintBlock",
            Self::PaintText => "paintText",
            Self::PaintRuby => "paintRuby",
            Self::PaintImage => "paintImage",
            Self::PaintHorizontalRule => "paintHorizontalRule",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DisplayCommand {
    PushState,
    PopState,
    Translate {
        dx: Value,
        dy: Value,
    },
    Opacity {
        value: f64,
    },
    Transform {
        origin: Value,
        box_value: Value,
        transforms: Value,
    },
    ClipRect {
        rect: Value,
        radius: Option<Value>,
    },
    PaintPage {
        rect: Value,
        paint: Value,
    },
    PaintBlock {
        rect: Value,
        paint: Value,
        border_box: Option<Value>,
    },
    PaintText(DisplayTextCommandInput),
    PaintRuby(DisplayTextCommandInput),
    PaintImage {
        src: String,
        rect: Value,
        alt: Option<String>,
        href: Option<String>,
        source_rect: Option<Value>,
    },
    PaintHorizontalRule {
        rect: Value,
        paint: Value,
    },
}

impl DisplayCommand {
    pub(crate) fn push_state() -> Self {
        Self::PushState
    }

    pub(crate) fn pop_state() -> Self {
        Self::PopState
    }

    pub(crate) fn translate(dx: Value, dy: Value) -> Self {
        Self::Translate { dx, dy }
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "opacity lowers to the wire and both pens paint it, but fragment paint does not emit it yet"
        )
    )]
    pub(crate) fn opacity(value: f64) -> Self {
        Self::Opacity { value }
    }

    pub(crate) fn transform(origin: Value, box_value: Value, transforms: Value) -> Self {
        Self::Transform {
            origin,
            box_value,
            transforms,
        }
    }

    pub(crate) fn clip_rect(rect: Value, radius: Option<Value>) -> Self {
        Self::ClipRect { rect, radius }
    }

    pub(crate) fn paint_page(rect: Value, paint: Value) -> Self {
        Self::PaintPage { rect, paint }
    }

    pub(crate) fn paint_block(rect: Value, paint: Value, border_box: Option<Value>) -> Self {
        Self::PaintBlock {
            rect,
            paint,
            border_box,
        }
    }

    pub(crate) fn paint_text(input: DisplayTextCommandInput) -> Self {
        Self::PaintText(input)
    }

    pub(crate) fn paint_ruby(input: DisplayTextCommandInput) -> Self {
        Self::PaintRuby(input)
    }

    pub(crate) fn paint_image(
        src: String,
        rect: Value,
        alt: Option<String>,
        href: Option<String>,
    ) -> Self {
        Self::PaintImage {
            src,
            rect,
            alt,
            href,
            source_rect: None,
        }
    }

    /// An image command that samples only `source_rect` (raster pixels)
    /// — the clamp-bleed strip an svg letterbox smears across its sliver.
    pub(crate) fn paint_image_slice(src: String, rect: Value, source_rect: Value) -> Self {
        Self::PaintImage {
            src,
            rect,
            alt: None,
            href: None,
            source_rect: Some(source_rect),
        }
    }

    pub(crate) fn paint_horizontal_rule(rect: Value, paint: Value) -> Self {
        Self::PaintHorizontalRule { rect, paint }
    }

    fn kind(&self) -> &'static str {
        self.kind_enum().as_str()
    }

    fn kind_enum(&self) -> DisplayCommandKind {
        match self {
            Self::PushState => DisplayCommandKind::PushState,
            Self::PopState => DisplayCommandKind::PopState,
            Self::Translate { .. } => DisplayCommandKind::Translate,
            Self::Opacity { .. } => DisplayCommandKind::Opacity,
            Self::Transform { .. } => DisplayCommandKind::Transform,
            Self::ClipRect { .. } => DisplayCommandKind::ClipRect,
            Self::PaintPage { .. } => DisplayCommandKind::PaintPage,
            Self::PaintBlock { .. } => DisplayCommandKind::PaintBlock,
            Self::PaintText(_) => DisplayCommandKind::PaintText,
            Self::PaintRuby(_) => DisplayCommandKind::PaintRuby,
            Self::PaintImage { .. } => DisplayCommandKind::PaintImage,
            Self::PaintHorizontalRule { .. } => DisplayCommandKind::PaintHorizontalRule,
        }
    }

    fn to_value(&self) -> Value {
        json::command_value(self)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DisplayTextCommandInput {
    pub text: Value,
    pub rect: Value,
    pub paint: RunPaint,
    pub line_height_px: Option<Value>,
    pub href: Option<String>,
    pub source_text: Option<Value>,
    pub source_text_offset: Option<usize>,
    /// Where each cluster of the text paints, in text order: byte offset
    /// into `text` and the absolute CSS origin the pen draws it at — its
    /// alphabetic baseline, for a text run and an annotation alike.
    /// Empty only for a run the renderer still places itself.
    pub clusters: Vec<(u32, f64, f64)>,
}

pub(crate) fn display_command_values(commands: &[DisplayCommand]) -> Vec<Value> {
    commands.iter().map(DisplayCommand::to_value).collect()
}

pub(crate) fn count_display_commands(commands: &[DisplayCommand]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for command in commands {
        *counts.entry(command.kind().to_owned()).or_insert(0) += 1;
    }
    counts
}

pub(crate) fn hash_display_commands(commands: &[DisplayCommand]) -> String {
    hash_json(&Value::Array(display_command_values(commands)))
}

#[cfg(test)]
mod tests;
