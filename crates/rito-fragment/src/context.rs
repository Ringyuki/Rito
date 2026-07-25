use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::break_token::BreakToken;
use crate::constraint_space::ConstraintSpace;
use crate::formatting_tree::{FormattingNodeId, FormattingTree};
use crate::fragment::FragmentTree;

/// Result of laying one fragmentainer's worth of content.
#[derive(Clone, Debug, PartialEq)]
pub struct LayoutOutcome {
    /// The sealed fragments that fit the constraint space.
    pub fragments: FragmentTree,
    /// Where to resume, or `None` when the content is exhausted.
    pub continuation: Option<BreakToken>,
    /// Floats this layout did not contain, in its own coordinates. Only a
    /// formatting-context root contains its floats; anywhere else they
    /// keep excluding content in the ancestor that does, which is why they
    /// travel back out instead of ending at the container's edge.
    pub escaped_floats: Vec<EscapedFloat>,
}

/// One float that escaped a non-root container, in that container's
/// coordinate space.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EscapedFloat {
    /// Whether the float occupies the line-left or line-right side.
    pub right_side: bool,
    /// Inline space the float withholds.
    pub width: f64,
    /// Block-axis top edge, relative to the container's origin.
    pub top: f64,
    /// Block-axis bottom edge, relative to the container's origin.
    pub bottom: f64,
}

/// Why a layout invocation produced no outcome.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LayoutError {
    /// The caller cancelled the invocation through its [`CancelFlag`]. No
    /// partial fragments exist; the same inputs can simply be laid out again.
    Cancelled,
    /// The provider rejected its inputs (malformed tree, unsupported content,
    /// invalid break token). Fail-closed: never a guessed layout.
    Invalid(String),
}

impl std::fmt::Display for LayoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => f.write_str("layout cancelled"),
            Self::Invalid(reason) => write!(f, "invalid layout input: {reason}"),
        }
    }
}

impl std::error::Error for LayoutError {}

/// Cooperative cancellation handle shared between a layout caller and the
/// provider working on its behalf.
///
/// Layout is a pure function with no partial state, so cancellation is
/// simply abandonment: providers poll the flag at fragment boundaries and
/// return [`LayoutError::Cancelled`] instead of finishing. Cloning shares
/// the underlying flag.
#[derive(Clone, Debug, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    /// A fresh, uncancelled flag.
    pub fn new() -> Self {
        Self::default()
    }

    /// Requests cancellation. Idempotent; visible to all clones.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    /// Whether cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// Content-driven inline-size bounds of one formatting node.
///
/// `min_content` is the narrowest inline size the node can lay out in
/// without overflow; `max_content` is the size it would occupy given
/// unlimited inline space. Both in CSS px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IntrinsicInlineSizes {
    /// Narrowest overflow-free inline size, CSS px.
    pub min_content: f64,
    /// Preferred inline size under unlimited space, CSS px.
    pub max_content: f64,
}

/// The provider seam every formatting engine implements.
///
/// Implementations must be deterministic pure functions of their inputs:
/// equal `(tree, space, token)` triples produce equal outcomes. They own no
/// platform types, spawn no threads, and hold no state across calls — that
/// is what makes input-keyed fragment caching, cancellation-by-abandonment,
/// and provider swaps sound.
pub trait FormattingContext {
    /// Lays out the subtree rooted at `node`, from `token` (or its start),
    /// into one constraint space.
    ///
    /// Parent formatting contexts invoke child contexts on child nodes;
    /// top-level callers pass the tree root. Providers poll `cancel` at
    /// fragment boundaries and return [`LayoutError::Cancelled`] promptly
    /// once it is set; a cancelled invocation must leave no observable
    /// state anywhere.
    fn layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
    ) -> Result<LayoutOutcome, LayoutError>;

    /// Computes the content-driven inline-size bounds of `node`.
    ///
    /// Deterministic like [`FormattingContext::layout`]; fails closed on a
    /// node the provider cannot size rather than guessing.
    fn intrinsic_inline_sizes(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
    ) -> Result<IntrinsicInlineSizes, LayoutError>;
}
