use std::{error::Error, fmt, num::NonZeroUsize};

use crate::{
    epub::EpubError,
    runtime::{RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeRevisionWorkBudget},
};

pub(super) fn checked_budget(
    budget: RuntimeRevisionWorkBudget,
) -> Result<NonZeroUsize, RuntimeContinuationError> {
    NonZeroUsize::new(budget.max_top_level_nodes).ok_or_else(|| {
        continuation_error(
            RuntimeContinuationErrorKind::InvalidBudget,
            "maxTopLevelNodes must be greater than zero",
        )
    })
}

pub(super) fn unknown_revision(revision_id: &str) -> RuntimeContinuationError {
    continuation_error(
        RuntimeContinuationErrorKind::UnknownRevision,
        format!("unknown revision: {revision_id}"),
    )
}

pub(super) fn engine_error(error: EpubError) -> RuntimeContinuationError {
    continuation_error(RuntimeContinuationErrorKind::EngineFailure, error.message())
}

pub(super) fn continuation_error(
    kind: RuntimeContinuationErrorKind,
    message: impl Into<String>,
) -> RuntimeContinuationError {
    RuntimeContinuationError {
        kind,
        message: message.into(),
    }
}

impl fmt::Display for RuntimeContinuationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for RuntimeContinuationError {}
