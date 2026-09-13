//! The `ReaderErrorV1` values the session reports and the checks that raise
//! them: the external identity range shared by session, request and artifact
//! ids, the identity allocator that stays inside that range, request identity
//! ordering against the latest accepted request, and the live-artifact
//! capacity check.

use super::{
    ReaderErrorKindV1, ReaderErrorV1, ReaderRevisionBackingV1, ReaderSessionV1,
    READER_EXTERNAL_ID_MAX_V1, READER_LIVE_ARTIFACT_CAP_V1,
};

impl ReaderSessionV1 {
    pub(super) fn validate_request_identity(
        &self,
        session_id: u64,
        request_id: u64,
        request_name: &str,
    ) -> Result<(), ReaderErrorV1> {
        if session_id == 0
            || session_id > READER_EXTERNAL_ID_MAX_V1
            || session_id != self.session_id
        {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::InvalidSession,
                format!("{request_name} request belongs to a different or invalid session"),
            ));
        }
        validate_external_request_id(request_id, "requestId")?;
        if request_id <= self.latest_request_id {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::StaleRequest,
                format!(
                    "requestId {request_id} is not newer than {}",
                    self.latest_request_id
                ),
            ));
        }
        Ok(())
    }

    pub(super) fn require_artifact_capacity(&self) -> Result<(), ReaderErrorV1> {
        if self.live_artifact_count() < READER_LIVE_ARTIFACT_CAP_V1 {
            return Ok(());
        }
        Err(ReaderErrorV1::new(
            ReaderErrorKindV1::InvalidRequest,
            format!(
                "live artifact cap {READER_LIVE_ARTIFACT_CAP_V1} reached; release an old artifact"
            ),
        ))
    }
}

pub(super) fn take_identity(next: &mut u64, field: &str) -> Result<u64, ReaderErrorV1> {
    let value = *next;
    if value == 0 || value > READER_EXTERNAL_ID_MAX_V1 {
        return Err(numeric_overflow(field));
    }
    *next = value
        .checked_add(1)
        .ok_or_else(|| numeric_overflow(field))?;
    Ok(value)
}

pub(super) fn validate_session_id(value: u64) -> Result<(), ReaderErrorV1> {
    if (1..=READER_EXTERNAL_ID_MAX_V1).contains(&value) {
        return Ok(());
    }
    Err(ReaderErrorV1::new(
        ReaderErrorKindV1::InvalidSession,
        format!("sessionId must be within 1..={READER_EXTERNAL_ID_MAX_V1}"),
    ))
}

pub(super) fn validate_external_request_id(value: u64, field: &str) -> Result<(), ReaderErrorV1> {
    if (1..=READER_EXTERNAL_ID_MAX_V1).contains(&value) {
        return Ok(());
    }
    Err(ReaderErrorV1::new(
        ReaderErrorKindV1::InvalidRequest,
        format!("{field} must be within 1..={READER_EXTERNAL_ID_MAX_V1}"),
    ))
}

pub(super) fn unknown_artifact(artifact_id: u64) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::UnknownArtifact,
        format!("unknown or released artifact: {artifact_id}"),
    )
}

pub(super) fn missing_artifact_revision(backing: ReaderRevisionBackingV1) -> ReaderErrorV1 {
    let kind = match backing {
        ReaderRevisionBackingV1::ChapterLocal => "chapter-local",
        ReaderRevisionBackingV1::Publication => "publication",
    };
    ReaderErrorV1::new(
        ReaderErrorKindV1::EngineFailure,
        format!("{kind} artifact revision ownership is missing"),
    )
}

pub(super) fn invalid_artifact_reference_count() -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::EngineFailure,
        "artifact revision reference count is invalid",
    )
}

pub(super) fn stale_background_intent(expected: u64, current: u64) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::StaleRequest,
        format!(
            "background expected visible artifact {expected}, but current visible artifact is {current}"
        ),
    )
}

pub(super) fn stale_foreground_intent(
    expected: Option<u64>,
    current: Option<u64>,
) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::StaleRequest,
        format!(
            "foreground expected visible artifact {expected:?}, but current visible artifact is {current:?}"
        ),
    )
}

pub(super) fn stale_foreground_candidate(message: impl Into<String>) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::StaleRequest, message)
}

pub(super) fn background_yields_to_foreground() -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::StaleRequest,
        "background work yields while foreground exact work or a candidate is pending",
    )
}

pub(super) fn target_not_published(message: impl Into<String>) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::TargetNotPublished, message)
}

pub(super) fn numeric_overflow(field: &str) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::NumericOverflow,
        format!("{field} exhausted"),
    )
}

pub(super) fn invalid_locator(error: impl std::fmt::Display) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::InvalidLocator, error.to_string())
}

pub(super) fn engine_error(error: impl std::fmt::Display) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::EngineFailure, error.to_string())
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    #[test]
    fn generated_identity_stops_after_signed_64_bit_maximum() {
        let mut next = READER_EXTERNAL_ID_MAX_V1;
        assert_eq!(
            take_identity(&mut next, "artifactId").expect("maximum identity remains valid"),
            READER_EXTERNAL_ID_MAX_V1
        );
        assert_eq!(
            take_identity(&mut next, "artifactId")
                .expect_err("next identity fails closed")
                .kind,
            ReaderErrorKindV1::NumericOverflow
        );
    }
}
