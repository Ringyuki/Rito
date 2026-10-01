//! Parley-backed inline formatting context.
//!
//! Implements the `rito-fragment` provider contract for inline flows: one
//! paragraph of typed-styled text items in, line and text fragments out.
//! Fonts are explicit — the context lays out with exactly the font bytes it
//! was constructed with, never a platform font database — which is what
//! makes its output reproducible across platforms and comparable against
//! the pinned-browser oracle. Parley supplies shaping and line breaking;
//! everything it cannot express (fragmentation, resumed layout, non-text
//! inline items) fails closed instead of degrading.
//!
//! The context is one type spread over the modules that own its laws:
//! `context` (construction and fonts), `line_metrics` (normal-line
//! geometry from font tables), `strut` (line heights and measurement), `paragraph` (building a paragraph's
//! Parley layout), `layout` (the provider entry points and the line
//! loop), and the free laws the loop applies — `breaking`, `justify`,
//! `punctuation`, `marker`, `shaping`, `ruby`, `image`. Every module sees
//! the whole crate through the root's re-exports, as the single file they
//! were carved from did.

use std::borrow::Cow;
use std::cell::RefCell;

use parley::{
    FontContext, InlineBox, InlineBoxKind, LayoutContext, PositionedLayoutItem, RangedBuilder,
    StyleProperty,
};
use rito_fragment::{
    BoxFragment, CancelFlag, ConstraintSpace, FormattingContext, FormattingNodeContent,
    FormattingNodeId, FormattingTree, Fragment, FragmentRect, FragmentTree, InlineItem,
    IntrinsicInlineSizes, LayoutError, LayoutOutcome, LineFragment, TextFragment,
};
use rito_style_contract::{
    FontFamily, FontSlant, GenericFontFamily, InlineFormattingStyle, LayoutFormattingStyle,
    LengthPercentage, LineHeight, MaximumSize, PreferredSize, TextAlign,
};

mod breaking;
mod clusters;
mod context;
mod image;
mod justify;
mod layout;
mod line_metrics;
mod marker;
mod paragraph;
mod punctuation;
mod ruby;
mod shaping;
mod strut;
#[cfg(test)]
mod tests;

pub(crate) use breaking::*;
pub(crate) use clusters::*;
pub use clusters::{MeasuredRuby, MeasuredRun};
pub(crate) use image::*;
pub(crate) use justify::*;
pub(crate) use line_metrics::*;
pub(crate) use marker::*;
pub use paragraph::plain_paragraph_style;
pub(crate) use paragraph::*;
pub(crate) use punctuation::*;
pub(crate) use ruby::*;
pub(crate) use shaping::*;
pub use strut::layout_unit_ceil;
pub(crate) use strut::*;

/// Inline formatting context backed by Parley shaping and line breaking.
///
/// Holds its font and layout scratch state behind `RefCell`: layout is a
/// pure function of its inputs, but Parley's contexts require mutable
/// access, so one `ParleyInlineContext` must not be re-entered from within
/// its own call stack.
pub struct ParleyInlineContext {
    pub(crate) fonts: RefCell<FontContext>,
    pub(crate) layouts: RefCell<LayoutContext<[u8; 4]>>,
    pub(crate) registered_families: Vec<String>,
    /// `line-height: normal` geometry per (family key, size bits, line
    /// shape), derived from font tables once and reused.
    pub(crate) line_metrics:
        RefCell<std::collections::HashMap<LineMetricKey, Option<NormalLineMetric>>>,
    /// The character a text run's font is sampled with, per (family key,
    /// size bits, blob id, face index): every run that resolved to the
    /// same face shares one line-metric entry.
    pub(crate) run_samples: RefCell<std::collections::HashMap<(String, u64, u64, u32), char>>,
    /// Per-face `halt` feature presence, keyed by (blob id, face index) —
    /// the Han-kerning trim gate consults it for every trimmed character.
    pub(crate) halt_feature_cache: RefCell<std::collections::HashMap<(u64, u32), bool>>,
}
