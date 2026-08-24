//! Binary-only WASM projection of Core's owned reader-session protocol.
//!
//! `u64` arguments are intentionally kept as `u64`: wasm-bindgen projects
//! them as JavaScript `bigint`, so session and artifact identities never pass
//! through an imprecise JavaScript `number`.

use rito_core::runtime::{
    decode_reader_adjacent_request_v1, decode_reader_artifact_request_v1,
    decode_reader_background_handoff_v1, decode_reader_background_request_v1,
    decode_reader_foreground_handoff_v1, encode_reader_artifact_v1,
    encode_reader_background_advance_v1, encode_reader_background_handoff_ack_v1,
    encode_reader_foreground_handoff_ack_v1, encode_reader_publication_v1,
    encode_reader_resource_v1, ReaderErrorKindV1, ReaderErrorV1, ReaderResourceKindV1,
    ReaderSessionV1,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = RitoReaderSessionV1)]
pub struct RitoReaderSessionV1 {
    inner: ReaderSessionProjectionV1,
}

#[wasm_bindgen(js_class = RitoReaderSessionV1)]
impl RitoReaderSessionV1 {
    /// Opens an owned EPUB reader session. `session_id` is a JavaScript
    /// `bigint` at the generated binding boundary.
    #[wasm_bindgen(constructor)]
    pub fn new(publication_bytes: Vec<u8>, session_id: u64) -> Result<Self, JsValue> {
        ReaderSessionProjectionV1::open(publication_bytes, session_id)
            .map(|inner| Self { inner })
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Returns the immutable session publication snapshot as one owned
    /// `RITOPUB1` message. No JSON or engine pointer crosses the boundary.
    #[wasm_bindgen(js_name = publicationV1)]
    pub fn publication_v1(&self) -> Result<Vec<u8>, JsValue> {
        self.inner
            .publication()
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Reports whether Core retained an exact-seek continuation after the
    /// previous single-quantum request. Hosts must use this explicit flag;
    /// error strings are never part of the retry protocol.
    #[wasm_bindgen(js_name = hasPendingExactSeekV1)]
    pub fn has_pending_exact_seek_v1(&self) -> bool {
        self.inner.has_pending_exact_seek()
    }

    /// Reports whether Core retained cooperative work for the previous
    /// adjacent request. Hosts must pair this typed query with
    /// `TargetNotPublished`; terminal boundaries never retry by message text.
    #[wasm_bindgen(js_name = hasPendingAdjacentV1)]
    pub fn has_pending_adjacent_v1(&self) -> bool {
        self.inner.has_pending_adjacent()
    }

    /// Consumes a `RITOREQ1` request and returns the matching `RITOART1`
    /// artifact without a JSON or JavaScript-number identity hop.
    #[wasm_bindgen(js_name = requestArtifactV1)]
    pub fn request_artifact_v1(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .request_artifact(&request_wire)
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Consumes a `RITONAV1` request and returns the previous or next
    /// `RITOART1` artifact. All identities remain fixed-width integers in the
    /// binary message; direct `u64` binding arguments use JavaScript `bigint`.
    #[wasm_bindgen(js_name = requestAdjacentV1)]
    pub fn request_adjacent_v1(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .request_adjacent(&request_wire)
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Atomically adopts one prepared foreground candidate. `None` in the
    /// fixed-width `RITOFGH1` request is valid only for the first visible
    /// artifact; replacements compare-and-swap against the current visible
    /// artifact. The returned acknowledgement is one owned `RITOFGA1` wire.
    #[wasm_bindgen(js_name = adoptForegroundCandidateV1)]
    pub fn adopt_foreground_candidate_v1(
        &mut self,
        request_wire: Vec<u8>,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .adopt_foreground_candidate(&request_wire)
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Consumes one `RITOBGQ1` request, executes exactly one host-scheduled
    /// publication quantum, and returns Core's owned `RITOBGA1` result.
    #[wasm_bindgen(js_name = advanceBackgroundOnceV1)]
    pub fn advance_background_once_v1(
        &mut self,
        request_wire: Vec<u8>,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .advance_background_once(&request_wire)
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Consumes a `RITOHOF1` compare-and-swap handoff and returns the
    /// `RITOHOA1` acknowledgement. Artifact identities stay in the binary
    /// message and never cross a JavaScript `number` boundary.
    #[wasm_bindgen(js_name = adoptBackgroundCandidateV1)]
    pub fn adopt_background_candidate_v1(
        &mut self,
        request_wire: Vec<u8>,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .adopt_background_candidate(&request_wire)
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Reads a resource referenced by a live artifact and returns a complete
    /// `RITORES1` message. Kinds are `0` image, `1` font, `2` stylesheet.
    #[wasm_bindgen(js_name = readResourceV1)]
    pub fn read_resource_v1(
        &mut self,
        artifact_id: u64,
        kind: u32,
        href: String,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .read_resource(artifact_id, kind, &href)
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Releases an artifact. Releasing an already released artifact is a
    /// successful no-op and returns `false`.
    #[wasm_bindgen(js_name = releaseArtifactV1)]
    pub fn release_artifact_v1(&mut self, artifact_id: u64) -> Result<bool, JsValue> {
        self.inner
            .release_artifact(artifact_id)
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }

    /// Disposes the session. Repeated disposal is a successful no-op and
    /// returns `false`.
    #[wasm_bindgen(js_name = disposeV1)]
    pub fn dispose_v1(&mut self) -> Result<bool, JsValue> {
        self.inner
            .dispose()
            .map_err(ReaderProjectionErrorV1::into_js_value)
    }
}

#[derive(Debug)]
struct ReaderSessionProjectionV1 {
    session: Option<ReaderSessionV1>,
}

impl ReaderSessionProjectionV1 {
    fn has_pending_exact_seek(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(ReaderSessionV1::has_pending_exact_seek_v1)
    }

    fn has_pending_adjacent(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(ReaderSessionV1::has_pending_adjacent_v1)
    }

    fn open(publication_bytes: Vec<u8>, session_id: u64) -> ProjectionResult<Self> {
        validate_external_id(
            session_id,
            ReaderProjectionErrorCodeV1::InvalidSession,
            "sessionId",
        )?;
        let session = ReaderSessionV1::open_owned(session_id, publication_bytes)?;
        Ok(Self {
            session: Some(session),
        })
    }

    fn request_artifact(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_artifact_request_v1(request_wire)?;
        validate_wire_id(request.session_id, "RITOREQ1 sessionId")?;
        validate_wire_id(request.request_id, "RITOREQ1 requestId")?;
        let artifact = self.live_session()?.request_artifact(request)?;
        encode_reader_artifact_v1(&artifact).map_err(Into::into)
    }

    fn publication(&self) -> ProjectionResult<Vec<u8>> {
        let session = self
            .session
            .as_ref()
            .ok_or_else(ReaderProjectionErrorV1::session_disposed)?;
        encode_reader_publication_v1(session.publication_v1()).map_err(Into::into)
    }

    fn request_adjacent(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_adjacent_request_v1(request_wire)?;
        validate_wire_id(request.session_id, "RITONAV1 sessionId")?;
        validate_wire_id(request.request_id, "RITONAV1 requestId")?;
        validate_wire_id(request.from_artifact_id, "RITONAV1 fromArtifactId")?;
        let artifact = self.live_session()?.request_adjacent(request)?;
        encode_reader_artifact_v1(&artifact).map_err(Into::into)
    }

    fn adopt_foreground_candidate(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_foreground_handoff_v1(request_wire)?;
        validate_wire_id(request.session_id, "RITOFGH1 sessionId")?;
        if let Some(artifact_id) = request.expected_visible_artifact_id {
            validate_wire_id(artifact_id, "RITOFGH1 expectedVisibleArtifactId")?;
        }
        validate_wire_id(
            request.candidate_artifact_id,
            "RITOFGH1 candidateArtifactId",
        )?;
        let ack = self.live_session()?.adopt_foreground_candidate(request)?;
        encode_reader_foreground_handoff_ack_v1(&ack).map_err(Into::into)
    }

    fn advance_background_once(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_background_request_v1(request_wire)?;
        validate_wire_id(request.session_id, "RITOBGQ1 sessionId")?;
        validate_wire_id(
            request.expected_visible_artifact_id,
            "RITOBGQ1 expectedVisibleArtifactId",
        )?;
        let advance = self.live_session()?.advance_background_once(request)?;
        encode_reader_background_advance_v1(&advance).map_err(Into::into)
    }

    fn adopt_background_candidate(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_background_handoff_v1(request_wire)?;
        validate_wire_id(request.session_id, "RITOHOF1 sessionId")?;
        validate_wire_id(
            request.expected_visible_artifact_id,
            "RITOHOF1 expectedVisibleArtifactId",
        )?;
        validate_wire_id(
            request.candidate_artifact_id,
            "RITOHOF1 candidateArtifactId",
        )?;
        let ack = self.live_session()?.adopt_background_candidate(request)?;
        encode_reader_background_handoff_ack_v1(&ack).map_err(Into::into)
    }

    fn release_artifact(&mut self, artifact_id: u64) -> ProjectionResult<bool> {
        validate_external_id(
            artifact_id,
            ReaderProjectionErrorCodeV1::InvalidRequest,
            "artifactId",
        )?;
        let Some(session) = self.session.as_mut() else {
            return Ok(false);
        };
        session.release_artifact(artifact_id).map_err(Into::into)
    }

    fn read_resource(
        &mut self,
        artifact_id: u64,
        kind: u32,
        href: &str,
    ) -> ProjectionResult<Vec<u8>> {
        validate_external_id(
            artifact_id,
            ReaderProjectionErrorCodeV1::InvalidRequest,
            "artifactId",
        )?;
        let kind = resource_kind(kind)?;
        let resource = self
            .live_session()?
            .read_resource(artifact_id, kind, href)?;
        encode_reader_resource_v1(&resource).map_err(Into::into)
    }

    fn dispose(&mut self) -> ProjectionResult<bool> {
        let Some(session) = self.session.take() else {
            return Ok(false);
        };
        session.dispose()?;
        Ok(true)
    }

    fn live_session(&mut self) -> ProjectionResult<&mut ReaderSessionV1> {
        self.session
            .as_mut()
            .ok_or_else(ReaderProjectionErrorV1::session_disposed)
    }
}

fn validate_wire_id(value: u64, field: &str) -> ProjectionResult<()> {
    validate_external_id(value, ReaderProjectionErrorCodeV1::InvalidWire, field)
}

fn validate_external_id(
    value: u64,
    code: ReaderProjectionErrorCodeV1,
    field: &str,
) -> ProjectionResult<()> {
    if value == 0 || value > i64::MAX as u64 {
        return Err(ReaderProjectionErrorV1 {
            code,
            message: format!("{field} must be within 1..={}", i64::MAX),
        });
    }
    Ok(())
}

type ProjectionResult<T> = Result<T, ReaderProjectionErrorV1>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReaderProjectionErrorCodeV1 {
    InvalidSession,
    InvalidRequest,
    InvalidLayout,
    InvalidLocator,
    UnsupportedTextProfile,
    StaleRequest,
    TargetNotPublished,
    UnknownArtifact,
    NumericOverflow,
    InvalidWire,
    EngineFailure,
    SessionDisposed,
}

impl ReaderProjectionErrorCodeV1 {
    const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidSession => "invalid-session",
            Self::InvalidRequest => "invalid-request",
            Self::InvalidLayout => "invalid-layout",
            Self::InvalidLocator => "invalid-locator",
            Self::UnsupportedTextProfile => "unsupported-text-profile",
            Self::StaleRequest => "stale-request",
            Self::TargetNotPublished => "target-not-published",
            Self::UnknownArtifact => "unknown-artifact",
            Self::NumericOverflow => "numeric-overflow",
            Self::InvalidWire => "invalid-wire",
            Self::EngineFailure => "engine-failure",
            Self::SessionDisposed => "session-disposed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReaderProjectionErrorV1 {
    code: ReaderProjectionErrorCodeV1,
    message: String,
}

impl ReaderProjectionErrorV1 {
    fn session_disposed() -> Self {
        Self {
            code: ReaderProjectionErrorCodeV1::SessionDisposed,
            message: "reader session is disposed".to_owned(),
        }
    }

    fn into_js_value(self) -> JsValue {
        let error: JsValue = js_sys::Error::new(&self.message).into();
        set_error_property(&error, "name", "RitoReaderErrorV1");
        set_error_property(&error, "code", self.code.as_str());
        error
    }
}

impl From<ReaderErrorV1> for ReaderProjectionErrorV1 {
    fn from(error: ReaderErrorV1) -> Self {
        let code = match error.kind {
            ReaderErrorKindV1::InvalidSession => ReaderProjectionErrorCodeV1::InvalidSession,
            ReaderErrorKindV1::InvalidRequest => ReaderProjectionErrorCodeV1::InvalidRequest,
            ReaderErrorKindV1::InvalidLayout => ReaderProjectionErrorCodeV1::InvalidLayout,
            ReaderErrorKindV1::InvalidLocator => ReaderProjectionErrorCodeV1::InvalidLocator,
            ReaderErrorKindV1::UnsupportedTextProfile => {
                ReaderProjectionErrorCodeV1::UnsupportedTextProfile
            }
            ReaderErrorKindV1::StaleRequest => ReaderProjectionErrorCodeV1::StaleRequest,
            ReaderErrorKindV1::TargetNotPublished => {
                ReaderProjectionErrorCodeV1::TargetNotPublished
            }
            ReaderErrorKindV1::UnknownArtifact => ReaderProjectionErrorCodeV1::UnknownArtifact,
            ReaderErrorKindV1::NumericOverflow => ReaderProjectionErrorCodeV1::NumericOverflow,
            ReaderErrorKindV1::InvalidWire => ReaderProjectionErrorCodeV1::InvalidWire,
            ReaderErrorKindV1::EngineFailure => ReaderProjectionErrorCodeV1::EngineFailure,
        };
        Self {
            code,
            message: error.message,
        }
    }
}

fn set_error_property(error: &JsValue, property: &str, value: &str) {
    let _ = js_sys::Reflect::set(
        error,
        &JsValue::from_str(property),
        &JsValue::from_str(value),
    );
}

fn resource_kind(value: u32) -> ProjectionResult<ReaderResourceKindV1> {
    match value {
        0 => Ok(ReaderResourceKindV1::Image),
        1 => Ok(ReaderResourceKindV1::Font),
        2 => Ok(ReaderResourceKindV1::Stylesheet),
        _ => Err(ReaderProjectionErrorV1 {
            code: ReaderProjectionErrorCodeV1::InvalidRequest,
            message: format!("unsupported reader resource kind: {value}"),
        }),
    }
}

#[cfg(test)]
mod tests;
