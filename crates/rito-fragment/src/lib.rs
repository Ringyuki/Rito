//! The durable layout contract that interchangeable formatting engines
//! target: `FormattingTree + ConstraintSpace + BreakToken -> FragmentTree`.
//! The types here are Rito-owned; external layout algorithms (Parley for
//! inline text, Taffy for flex/grid, selectively derived Servo code) plug in
//! behind [`FormattingContext`] without leaking their own types into
//! platform adapters or runtime consumers.
//!
//! Reader-semantic capabilities (footnote asides and other out-of-flow reader
//! content, noteref/anchor targets, interaction projections) are resolved
//! before a [`FormattingTree`] is built and are therefore engine-independent
//! by construction: the tree's input is the already-filtered content flow.

#![forbid(unsafe_code)]

mod break_token;
mod cache;
mod constraint_space;
mod context;
mod formatting_tree;
mod fragment;
mod serialize;

pub use break_token::{BreakToken, BreakTokenStage, FloatBreak};
pub use cache::{CachedLayout, FragmentCache};
pub use constraint_space::{ConstraintSpace, FloatBand};
pub use context::{
    EscapedFloat,
    CancelFlag, FormattingContext, IntrinsicInlineSizes, LayoutError, LayoutOutcome,
};
pub use formatting_tree::{
    allocate_ruby_annotation, FormattingNode, FormattingNodeContent, FormattingNodeId,
    FormattingTree, FormattingTreeStyles, InlineItem, RubyAnnotation,
};
pub use fragment::{
    BoxFragment, BoxSnap, Fragment, FragmentRect, FragmentTree, ImageFragment, LineFragment,
    MarkerFragment, TextFragment,
};
pub use serialize::{decode_layout_outcome, encode_layout_outcome};

/// The one stub provider this crate ships: bounded vertical block stacking
/// with fragmentainer breaks, enough for the substrate's own contract tests.
pub mod block;
