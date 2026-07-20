use rito_core::runtime::{ReaderErrorKindV1, ReaderErrorV1};

pub const RITO_STATUS_OK_V1: u32 = 0;
pub const RITO_STATUS_INVALID_ARGUMENT_V1: u32 = 1;
pub const RITO_STATUS_NOT_FOUND_V1: u32 = 2;
pub const RITO_STATUS_ALREADY_EXISTS_V1: u32 = 3;
pub const RITO_STATUS_ENGINE_ERROR_V1: u32 = 4;
pub const RITO_STATUS_STALE_REQUEST_V1: u32 = 5;
pub const RITO_STATUS_TARGET_NOT_PUBLISHED_V1: u32 = 6;
pub const RITO_STATUS_UNSUPPORTED_PROFILE_V1: u32 = 7;
pub const RITO_STATUS_BUSY_V1: u32 = 8;
pub const RITO_STATUS_QUEUE_FULL_V1: u32 = RITO_STATUS_BUSY_V1;
pub const RITO_STATUS_EXACT_SEEK_PENDING_V1: u32 = 9;
pub const RITO_STATUS_ADJACENT_PENDING_V1: u32 = 10;
pub const RITO_STATUS_SESSION_TERMINATED_V1: u32 = 11;
pub const RITO_STATUS_PANIC_V1: u32 = 255;

#[derive(Debug)]
pub(crate) struct FfiError {
    pub(crate) status: u32,
    pub(crate) message: String,
}

impl FfiError {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_INVALID_ARGUMENT_V1,
            message: message.into(),
        }
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_NOT_FOUND_V1,
            message: message.into(),
        }
    }

    pub(crate) fn exists(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_ALREADY_EXISTS_V1,
            message: message.into(),
        }
    }

    pub(crate) fn engine(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_ENGINE_ERROR_V1,
            message: message.into(),
        }
    }

    pub(crate) fn busy(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_BUSY_V1,
            message: message.into(),
        }
    }

    pub(crate) fn stale(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_STALE_REQUEST_V1,
            message: message.into(),
        }
    }

    pub(crate) fn session_terminated(message: impl Into<String>) -> Self {
        Self {
            status: RITO_STATUS_SESSION_TERMINATED_V1,
            message: message.into(),
        }
    }

    pub(crate) fn panic() -> Self {
        Self {
            status: RITO_STATUS_PANIC_V1,
            message: "panic contained at the Rito FFI boundary".to_owned(),
        }
    }
}

impl From<ReaderErrorV1> for FfiError {
    fn from(error: ReaderErrorV1) -> Self {
        let status = match error.kind {
            ReaderErrorKindV1::InvalidSession | ReaderErrorKindV1::UnknownArtifact => {
                RITO_STATUS_NOT_FOUND_V1
            }
            ReaderErrorKindV1::InvalidRequest
            | ReaderErrorKindV1::InvalidLayout
            | ReaderErrorKindV1::InvalidLocator
            | ReaderErrorKindV1::NumericOverflow
            | ReaderErrorKindV1::InvalidWire => RITO_STATUS_INVALID_ARGUMENT_V1,
            ReaderErrorKindV1::StaleRequest => RITO_STATUS_STALE_REQUEST_V1,
            ReaderErrorKindV1::TargetNotPublished => RITO_STATUS_TARGET_NOT_PUBLISHED_V1,
            ReaderErrorKindV1::UnsupportedTextProfile => RITO_STATUS_UNSUPPORTED_PROFILE_V1,
            ReaderErrorKindV1::EngineFailure => RITO_STATUS_ENGINE_ERROR_V1,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}
