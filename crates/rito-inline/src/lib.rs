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
//! `context` (construction, fonts, the host metric exchange), `strut`
//! (line heights and measurement), `paragraph` (building a paragraph's
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
pub use context::HostNormalLineMetric;
pub(crate) use context::*;
pub(crate) use image::*;
pub(crate) use justify::*;
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
    /// `line-height: normal` strut heights, measured by shaping with the
    /// style's own resolved font (what a browser's strut does), cached
    /// because struts repeat per paragraph. Keyed by the font inputs the
    /// measurement shapes with (family stack, size, weight, slant) —
    /// NEVER by style-table id: ids restart per chapter, so on an engine
    /// shared across a book one chapter's strut would serve another
    /// chapter's unrelated style.
    pub(crate) normal_strut_cache: RefCell<std::collections::HashMap<u64, f64>>,
    /// Host-measured `line-height: normal` metrics per (family key, size,
    /// sample): the rendering host measures them because its font scaler
    /// grid-fits ascent and descent to integers per size, which font
    /// tables do not predict. The sample is what the host puts on the
    /// measured line — empty for an inline box's own strut, or one
    /// character for a text run, so the host resolves the same fallback
    /// font for it that shaping did. Keyed by [`host_size_key`].
    host_line_metrics:
        RefCell<std::collections::HashMap<(String, u64, String), HostNormalLineMetric>>,
    /// Keys a layout needed but the host has not measured yet; the host
    /// drains these, measures, injects, and relayouts.
    pub(crate) host_metric_requests: RefCell<std::collections::BTreeSet<(String, u64, String)>>,
    /// Sample character already requested for a (family, size, resolved
    /// font, script) key. Every character that resolves to the same font
    /// measures the same, so one sample per font is enough to bound the
    /// request set by fonts rather than by the book's character inventory
    /// — but the script has to be part of the key too: the engine's font
    /// universe is the book's, so it may serve two scripts from one font
    /// where the host picks a different fallback per script, and a single
    /// sample would then hide one of the host's two metrics.
    pub(crate) host_metric_samples: RefCell<std::collections::HashMap<HostMetricSampleKey, String>>,
    /// Per-face `halt` feature presence, keyed by (blob id, face index) —
    /// the Han-kerning trim gate consults it for every trimmed character.
    pub(crate) halt_feature_cache: RefCell<std::collections::HashMap<(u64, u32), bool>>,
    /// Host-measured advances for characters no registered face covers,
    /// keyed by (family key, size key, character). Shaping resolves such
    /// a character to a face's `.notdef` while the host paints it with a
    /// system fallback font; the host's canvas advance is the only source
    /// for the width that glyph actually occupies.
    pub(crate) host_char_advances: RefCell<std::collections::HashMap<(String, u64, char), f64>>,
    /// Whether any face of (family key, character)'s stack covers the
    /// character — the gate for the host-advance path, cached because the
    /// stack walk touches every face's charmap.
    pub(crate) char_coverage_cache: RefCell<std::collections::HashMap<(String, char), bool>>,
    pub(crate) metrics_generation: std::cell::Cell<u64>,
}
