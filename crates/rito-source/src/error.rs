use std::fmt;

use crate::{MAX_SOURCE_DEPTH, MAX_SOURCE_NODES};

/// Error returned while constructing a [`crate::SourceArena`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceError {
    /// The normalized input is not well-formed XML.
    InvalidXml(String),
    /// Element nesting exceeds the defensive parser limit.
    TooDeep,
    /// The source exceeds the defensive node-count limit.
    TooManyNodes,
}

impl fmt::Display for SourceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidXml(error) => write!(formatter, "invalid XHTML: {error}"),
            Self::TooDeep => write!(
                formatter,
                "XHTML nesting depth exceeds the {MAX_SOURCE_DEPTH}-element safety limit"
            ),
            Self::TooManyNodes => write!(
                formatter,
                "XHTML node count exceeds the {MAX_SOURCE_NODES}-node safety limit"
            ),
        }
    }
}

impl std::error::Error for SourceError {}
