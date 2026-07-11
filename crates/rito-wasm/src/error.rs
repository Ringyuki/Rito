use std::{error::Error, fmt};

use rito_core::{
    epub::EpubError,
    runtime::{
        RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeRevisionAccessError,
        RuntimeRevisionAccessErrorKind, RuntimeRevisionSummary,
    },
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasmRuntimeError {
    code: WasmRuntimeErrorCode,
    message: String,
    revision: Option<Box<RuntimeRevisionSummary>>,
}

impl WasmRuntimeError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            code: WasmRuntimeErrorCode::BadRequest,
            message: message.into(),
            revision: None,
        }
    }

    pub fn internal_error(message: impl Into<String>) -> Self {
        Self {
            code: WasmRuntimeErrorCode::InternalError,
            message: message.into(),
            revision: None,
        }
    }

    pub fn from_engine(error: EpubError) -> Self {
        Self {
            code: WasmRuntimeErrorCode::EngineError,
            message: error.message().to_owned(),
            revision: None,
        }
    }

    pub(crate) fn from_continuation(error: RuntimeContinuationError) -> Self {
        let code = match error.kind {
            RuntimeContinuationErrorKind::InvalidBudget => WasmRuntimeErrorCode::BadRequest,
            RuntimeContinuationErrorKind::UnknownRevision => WasmRuntimeErrorCode::UnknownRevision,
            RuntimeContinuationErrorKind::StaleRevisionVersion => {
                WasmRuntimeErrorCode::StaleRevisionVersion
            }
            _ => WasmRuntimeErrorCode::EngineError,
        };
        Self {
            code,
            message: error.message,
            revision: error.revision,
        }
    }

    pub(crate) fn from_revision_access(error: RuntimeRevisionAccessError) -> Self {
        let code = match error.kind {
            RuntimeRevisionAccessErrorKind::UnknownRevision => {
                WasmRuntimeErrorCode::UnknownRevision
            }
            RuntimeRevisionAccessErrorKind::StaleRevisionVersion => {
                WasmRuntimeErrorCode::StaleRevisionVersion
            }
            RuntimeRevisionAccessErrorKind::OperationFailed => WasmRuntimeErrorCode::EngineError,
        };
        Self {
            code,
            message: error.message,
            revision: None,
        }
    }

    pub fn code(&self) -> WasmRuntimeErrorCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn revision(&self) -> Option<&RuntimeRevisionSummary> {
        self.revision.as_deref()
    }
}

impl fmt::Display for WasmRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl Error for WasmRuntimeError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WasmRuntimeErrorCode {
    BadRequest,
    EngineError,
    InternalError,
    UnknownRevision,
    StaleRevisionVersion,
}

impl WasmRuntimeErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BadRequest => "bad-request",
            Self::EngineError => "engine-error",
            Self::InternalError => "internal-error",
            Self::UnknownRevision => "unknown-revision",
            Self::StaleRevisionVersion => "stale-revision-version",
        }
    }
}
