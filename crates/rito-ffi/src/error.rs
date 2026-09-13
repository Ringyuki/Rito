use rito_core::runtime::{ReaderError, ReaderErrorKind};

pub const RITO_STATUS_OK: u32 = 0;
pub const RITO_STATUS_INVALID_ARGUMENT: u32 = 1;
pub const RITO_STATUS_NOT_FOUND: u32 = 2;
pub const RITO_STATUS_ALREADY_EXISTS: u32 = 3;
pub const RITO_STATUS_ENGINE_ERROR: u32 = 4;
pub const RITO_STATUS_STALE_REQUEST: u32 = 5;
pub const RITO_STATUS_TARGET_NOT_PUBLISHED: u32 = 6;
pub const RITO_STATUS_UNSUPPORTED_PROFILE: u32 = 7;
pub const RITO_STATUS_BUSY: u32 = 8;
pub const RITO_STATUS_QUEUE_FULL: u32 = RITO_STATUS_BUSY;
// Status value 9 is retired and is never reassigned.
pub const RITO_STATUS_ADJACENT_PENDING: u32 = 10;
pub const RITO_STATUS_SESSION_TERMINATED: u32 = 11;
pub const RITO_STATUS_PANIC: u32 = 255;

#[derive(Debug)]
pub(crate) struct FfiError {
    pub(crate) status: u32,
    pub(crate) message: String,
}

impl FfiError {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_INVALID_ARGUMENT,
            message: message.into(),
        }
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_NOT_FOUND,
            message: message.into(),
        }
    }

    pub(crate) fn exists(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_ALREADY_EXISTS,
            message: message.into(),
        }
    }

    pub(crate) fn engine(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_ENGINE_ERROR,
            message: message.into(),
        }
    }

    pub(crate) fn busy(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_BUSY,
            message: message.into(),
        }
    }

    pub(crate) fn stale(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_STALE_REQUEST,
            message: message.into(),
        }
    }

    pub(crate) fn session_terminated(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_SESSION_TERMINATED,
            message: message.into(),
        }
    }

    pub(crate) fn panic() -> Self {
        Self {
            status: RITO_STATUS_PANIC,
            message: "panic contained at the Rito FFI boundary".to_owned(),
        }
    }
}

impl From<ReaderError> for FfiError {
    fn from(error: ReaderError) -> Self {
        let status = match error.kind {
            ReaderErrorKind::InvalidSession | ReaderErrorKind::UnknownArtifact => {
                RITO_STATUS_NOT_FOUND
            }
            ReaderErrorKind::InvalidRequest
            | ReaderErrorKind::InvalidLayout
            | ReaderErrorKind::InvalidLocator
            | ReaderErrorKind::NumericOverflow
            | ReaderErrorKind::InvalidWire => RITO_STATUS_INVALID_ARGUMENT,
            ReaderErrorKind::StaleRequest => RITO_STATUS_STALE_REQUEST,
            ReaderErrorKind::TargetNotPublished => RITO_STATUS_TARGET_NOT_PUBLISHED,
            ReaderErrorKind::UnsupportedTextProfile => RITO_STATUS_UNSUPPORTED_PROFILE,
            ReaderErrorKind::EngineFailure => RITO_STATUS_ENGINE_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}
