use std::{error::Error, fmt};

use crate::{
    epub::EpubError,
    runtime::{RuntimeRevisionError, RuntimeRevisionErrorKind},
};

pub(in crate::runtime) fn unknown_revision(revision_id: &str) -> RuntimeRevisionError {
    revision_error(
        RuntimeRevisionErrorKind::UnknownRevision,
        format!("unknown revision: {revision_id}"),
    )
}

pub(in crate::runtime) fn engine_error(error: EpubError) -> RuntimeRevisionError {
    revision_error(RuntimeRevisionErrorKind::EngineFailure, error.message())
}

pub(in crate::runtime) fn revision_error(
    kind: RuntimeRevisionErrorKind,
    message: impl Into<String>,
) -> RuntimeRevisionError {
    RuntimeRevisionError {
        kind,
        message: message.into(),
    }
}

impl fmt::Display for RuntimeRevisionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for RuntimeRevisionError {}
