//! Failures caused by publication shards the host has not supplied. Only an
//! image read can wait on a shard (the skeleton carries everything layout
//! reads); the errors such a read crosses report the shard ids it waited
//! on, so a session can tell "supply these and retry" apart from a real
//! failure.

use std::fmt;

use crate::epub::EpubError;

use super::{
    RuntimeChapterLocalRevisionError, RuntimeRevisionAccessError, RuntimeRevisionError,
    RuntimeSourceLocatorError,
};

pub(crate) trait PendingShardFailure: fmt::Display {
    /// Shards the failed operation waited on, ascending; empty for every
    /// other failure.
    fn pending_shards(&self) -> &[u32] {
        &[]
    }
}

impl PendingShardFailure for EpubError {
    fn pending_shards(&self) -> &[u32] {
        EpubError::pending_shards(self)
    }
}

impl PendingShardFailure for RuntimeRevisionError {}

impl PendingShardFailure for RuntimeChapterLocalRevisionError {
    fn pending_shards(&self) -> &[u32] {
        &self.pending_shards
    }
}

impl PendingShardFailure for RuntimeSourceLocatorError {}

impl PendingShardFailure for RuntimeRevisionAccessError {
    fn pending_shards(&self) -> &[u32] {
        &self.pending_shards
    }
}

impl PendingShardFailure for String {}
impl PendingShardFailure for &str {}
