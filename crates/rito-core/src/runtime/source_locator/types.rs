use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

use crate::epub::EpubError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSourcePoint {
    pub node_path: Vec<usize>,
    /// UTF-16 code-unit offset within the parsed XHTML text node.
    pub text_offset: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSourceRange {
    pub start: RuntimeSourcePoint,
    /// End-exclusive source boundary.
    pub end: RuntimeSourcePoint,
}

/// A durable resource locator. When multiple selectors are supplied, resolution
/// uses range, point, anchor, progression, then href precision order. Every
/// supplied selector is still validated against the canonical source resource.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSourceLocator {
    /// Canonical manifest href. Legacy inputs may include a `#fragment`.
    pub href: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_point: Option<RuntimeSourcePoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_range: Option<RuntimeSourceRange>,
    /// Normalized source-text progression within the resource, in `[0, 1]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progression: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimePageReadingAnchorUnavailableReason {
    /// The page has no visible text slice with exact parsed-source ownership.
    NoSourceContent,
    /// Exact source ownership exists, but its canonical source index is unavailable.
    SourceUnavailable,
}

/// A revision-local projection of a durable reading locator.
///
/// `page_index` and `spread_index` describe only the captured revision. Persist
/// `locator`, then resolve it against a new revision with
/// `RuntimeDocument::resolve_source_locator_at`; never persist these page fields
/// as a substitute for source identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimePageReadingAnchor {
    Resolved {
        revision_id: String,
        page_index: usize,
        spread_index: usize,
        locator: RuntimeSourceLocator,
    },
    Unavailable {
        revision_id: String,
        page_index: usize,
        spread_index: usize,
        reason: RuntimePageReadingAnchorUnavailableReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeSourceLocatorMatchedBy {
    SourceRange,
    SourcePoint,
    Anchor,
    Progression,
    Href,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeSourceLocatorPendingReason {
    /// The source target is valid but lies beyond this revision's known extent.
    NotPaginated,
    /// The source target is valid but has no page projection in this revision.
    /// More work on an already completed chapter will not change this result.
    NoPageProjection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RuntimeSourceLocatorResolution {
    Resolved {
        revision_id: String,
        locator: RuntimeSourceLocator,
        spine_idref: String,
        page_index: usize,
        spread_index: usize,
        matched_by: RuntimeSourceLocatorMatchedBy,
    },
    Pending {
        revision_id: String,
        locator: RuntimeSourceLocator,
        spine_idref: String,
        reason: RuntimeSourceLocatorPendingReason,
        matched_by: RuntimeSourceLocatorMatchedBy,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeSourceLocatorErrorKind {
    UnknownRevision,
    HrefNotFound,
    InvalidSelector,
    SourceUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSourceLocatorError {
    pub kind: RuntimeSourceLocatorErrorKind,
    pub message: String,
}

impl RuntimeSourceLocatorError {
    fn new(kind: RuntimeSourceLocatorErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub(super) fn unknown_revision(revision_id: &str) -> Self {
        Self::new(
            RuntimeSourceLocatorErrorKind::UnknownRevision,
            format!("unknown revision: {revision_id}"),
        )
    }

    pub(super) fn href_not_found(href: &str) -> Self {
        Self::new(
            RuntimeSourceLocatorErrorKind::HrefNotFound,
            format!("source locator href not found: {href}"),
        )
    }

    pub(super) fn invalid_selector(message: impl Into<String>) -> Self {
        Self::new(RuntimeSourceLocatorErrorKind::InvalidSelector, message)
    }

    pub(super) fn source_unavailable(error: EpubError) -> Self {
        Self::new(
            RuntimeSourceLocatorErrorKind::SourceUnavailable,
            error.message().to_owned(),
        )
    }
}

impl fmt::Display for RuntimeSourceLocatorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for RuntimeSourceLocatorError {}
