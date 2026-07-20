#![forbid(unsafe_code)]

//! Platform-neutral, immutable XHTML source trees for Rito.
//!
//! [`SourceArena`] owns one canonical node topology. It intentionally does
//! not implement `Clone`; callers that need shared ownership should use
//! `Arc<SourceArena>`.

mod error;
mod normalizer;
mod scan;
mod tree;

pub use error::SourceError;
pub use scan::{visit_xhtml_semantic_elements, XhtmlSemanticElement};
pub use tree::{
    Children, Descendants, NodeId, QName, SourceArena, SourceAttribute, SourceElement, SourceNode,
    SourceNodeKind, MAX_SOURCE_DEPTH, MAX_SOURCE_NODES,
};
