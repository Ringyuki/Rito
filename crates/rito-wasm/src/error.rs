use std::{error::Error, fmt};

use rito_core::{
    epub::EpubError,
    runtime::{
        RuntimeChapterLocalRevisionError, RuntimeRevisionAccessError,
        RuntimeRevisionAccessErrorKind, RuntimeRevisionError, RuntimeRevisionErrorKind,
    },
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasmRuntimeError {
    code: WasmRuntimeErrorCode,
    message: String,
    pending_shards: Vec<u32>,
}

impl WasmRuntimeError {
    fn new(code: WasmRuntimeErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            pending_shards: Vec::new(),
        }
    }

    /// A failure that waits on content shards the host has not supplied.
    fn pending(code: WasmRuntimeErrorCode, message: String, pending_shards: Vec<u32>) -> Self {
        if pending_shards.is_empty() {
            return Self::new(code, message);
        }
        Self {
            code: WasmRuntimeErrorCode::ResourcePending,
            message,
            pending_shards,
        }
    }

    pub(crate) fn is_pending(&self) -> bool {
        self.code == WasmRuntimeErrorCode::ResourcePending
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(WasmRuntimeErrorCode::BadRequest, message)
    }

    pub fn internal_error(message: impl Into<String>) -> Self {
        Self::new(WasmRuntimeErrorCode::InternalError, message)
    }

    pub fn from_engine(error: EpubError) -> Self {
        Self::pending(
            WasmRuntimeErrorCode::EngineError,
            error.message().to_owned(),
            error.pending_shards().to_vec(),
        )
    }

    pub(crate) fn from_revision(error: RuntimeRevisionError) -> Self {
        Self::new(revision_error_code(error.kind), error.message)
    }

    pub(crate) fn from_chapter_local(error: RuntimeChapterLocalRevisionError) -> Self {
        Self::pending(
            revision_error_code(error.kind),
            error.message,
            error.pending_shards,
        )
    }

    pub(crate) fn from_revision_access(error: RuntimeRevisionAccessError) -> Self {
        let code = match error.kind {
            RuntimeRevisionAccessErrorKind::UnknownRevision => {
                WasmRuntimeErrorCode::UnknownRevision
            }
            RuntimeRevisionAccessErrorKind::StaleRevisionVersion => {
                WasmRuntimeErrorCode::StaleRevisionVersion
            }
            RuntimeRevisionAccessErrorKind::OperationFailed
            | RuntimeRevisionAccessErrorKind::ResourcePending => WasmRuntimeErrorCode::EngineError,
        };
        Self::pending(code, error.message, error.pending_shards)
    }

    pub fn code(&self) -> WasmRuntimeErrorCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    /// Content shards to supply before retrying; non-empty exactly for
    /// `ResourcePending`.
    pub fn pending_shards(&self) -> &[u32] {
        &self.pending_shards
    }
}

fn revision_error_code(kind: RuntimeRevisionErrorKind) -> WasmRuntimeErrorCode {
    match kind {
        RuntimeRevisionErrorKind::InvalidChapterLocalTarget
        | RuntimeRevisionErrorKind::ChapterLocalOwnerMismatch => WasmRuntimeErrorCode::BadRequest,
        RuntimeRevisionErrorKind::UnknownRevision => WasmRuntimeErrorCode::UnknownRevision,
        RuntimeRevisionErrorKind::StaleRevisionVersion => {
            WasmRuntimeErrorCode::StaleRevisionVersion
        }
        RuntimeRevisionErrorKind::EngineFailure | RuntimeRevisionErrorKind::ResourcePending => {
            WasmRuntimeErrorCode::EngineError
        }
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
    ResourcePending,
}

impl WasmRuntimeErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BadRequest => "bad-request",
            Self::EngineError => "engine-error",
            Self::InternalError => "internal-error",
            Self::UnknownRevision => "unknown-revision",
            Self::StaleRevisionVersion => "stale-revision-version",
            Self::ResourcePending => "resource-pending",
        }
    }
}
