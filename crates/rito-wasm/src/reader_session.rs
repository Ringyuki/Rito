//! Binary-only WASM projection of Core's owned reader-session protocol.
//!
//! `u64` arguments are intentionally kept as `u64`: wasm-bindgen projects
//! them as JavaScript `bigint`, so session and artifact identities never pass
//! through an imprecise JavaScript `number`.

use rito_core::runtime::{
    decode_reader_adjacent_request, decode_reader_artifact_request,
    decode_reader_background_handoff, decode_reader_background_request,
    decode_reader_foreground_handoff, encode_reader_artifact, encode_reader_background_advance,
    encode_reader_background_handoff_ack, encode_reader_foreground_handoff_ack,
    encode_reader_publication, encode_reader_resource, ReaderError, ReaderErrorKind,
    ReaderResourceKind, ReaderSession,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = RitoReaderSession)]
pub struct RitoReaderSession {
    inner: ReaderSessionProjection,
}

#[cfg(test)]
impl RitoReaderSession {
    /// Native tests wrap an already-opened projection; the js-facing
    /// factories convert errors through JsValue, which panics off-wasm.
    fn from_projection(inner: ReaderSessionProjection) -> Self {
        Self { inner }
    }
}

#[wasm_bindgen(js_class = RitoReaderSession)]
impl RitoReaderSession {
    /// Opens an owned EPUB reader session. `session_id` is a JavaScript
    /// `bigint` at the generated binding boundary.
    #[wasm_bindgen(constructor)]
    pub fn new(publication_bytes: Vec<u8>, session_id: u64) -> Result<Self, JsValue> {
        ReaderSessionProjection::open(publication_bytes, session_id)
            .map(|inner| Self { inner })
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Opens a session with pinned fallback faces — the form chapter-local
    /// pagination requires (the fragment engine shapes with pinned faces
    /// only, so a bare open fails closed at layout time).
    /// `metadata_json` and `face_bytes` follow the same contract as
    /// `RitoWasmDocument.openWithPinnedFontPolicy`.
    #[wasm_bindgen(js_name = openWithPinnedFontPolicy)]
    pub fn open_with_pinned_font_policy(
        publication_bytes: Vec<u8>,
        session_id: u64,
        metadata_json: &str,
        face_bytes: JsValue,
    ) -> Result<Self, JsValue> {
        let face_bytes = crate::binding::pinned_font::require_face_byte_array(face_bytes)
            .map_err(crate::binding::error_to_js_value)?;
        let metadata = crate::pinned_font::validate_pinned_font_policy_metadata(
            metadata_json,
            face_bytes.length() as usize,
        )
        .map_err(crate::binding::error_to_js_value)?;
        crate::binding::pinned_font::validate_face_byte_array_types(&face_bytes)
            .map_err(crate::binding::error_to_js_value)?;
        let face_bytes = crate::binding::pinned_font::copy_face_byte_arrays(&face_bytes);
        let input = crate::pinned_font::pinned_font_policy_input(metadata, face_bytes);
        ReaderSessionProjection::open_with_pinned_font_policy(publication_bytes, session_id, input)
            .map(|inner| Self { inner })
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Returns the immutable session publication snapshot as one owned
    /// `RITOPUB1` message. No JSON or engine pointer crosses the boundary.
    #[wasm_bindgen(js_name = publication)]
    pub fn publication(&self) -> Result<Vec<u8>, JsValue> {
        self.inner
            .publication()
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Reports whether Core retained cooperative work for the previous
    /// adjacent request. Hosts must pair this typed query with
    /// `TargetNotPublished`; terminal boundaries never retry by message text.
    #[wasm_bindgen(js_name = hasPendingAdjacent)]
    pub fn has_pending_adjacent(&self) -> bool {
        self.inner.has_pending_adjacent()
    }

    /// Consumes a `RITOREQ1` request and returns the matching `RITOART1`
    /// artifact without a JSON or JavaScript-number identity hop.
    #[wasm_bindgen(js_name = requestArtifact)]
    pub fn request_artifact(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .request_artifact(&request_wire)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Consumes a `RITONAV1` request and returns the previous or next
    /// `RITOART1` artifact. All identities remain fixed-width integers in the
    /// binary message; direct `u64` binding arguments use JavaScript `bigint`.
    #[wasm_bindgen(js_name = requestAdjacent)]
    pub fn request_adjacent(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .request_adjacent(&request_wire)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Atomically adopts one prepared foreground candidate. `None` in the
    /// fixed-width `RITOFGH1` request is valid only for the first visible
    /// artifact; replacements compare-and-swap against the current visible
    /// artifact. The returned acknowledgement is one owned `RITOFGA1` wire.
    #[wasm_bindgen(js_name = adoptForegroundCandidate)]
    pub fn adopt_foreground_candidate(
        &mut self,
        request_wire: Vec<u8>,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .adopt_foreground_candidate(&request_wire)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Consumes one `RITOBGQ1` request, executes exactly one host-scheduled
    /// publication quantum, and returns Core's owned `RITOBGA1` result.
    #[wasm_bindgen(js_name = advanceBackgroundOnce)]
    pub fn advance_background_once(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .advance_background_once(&request_wire)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Consumes a `RITOHOF1` compare-and-swap handoff and returns the
    /// `RITOHOA1` acknowledgement. Artifact identities stay in the binary
    /// message and never cross a JavaScript `number` boundary.
    #[wasm_bindgen(js_name = adoptBackgroundCandidate)]
    pub fn adopt_background_candidate(
        &mut self,
        request_wire: Vec<u8>,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .adopt_background_candidate(&request_wire)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Reads a resource referenced by a live artifact and returns a complete
    /// `RITORES1` message. Kinds are `0` image, `1` font, `2` stylesheet.
    #[wasm_bindgen(js_name = readResource)]
    pub fn read_resource(
        &mut self,
        artifact_id: u64,
        kind: u32,
        href: String,
    ) -> Result<Vec<u8>, JsValue> {
        self.inner
            .read_resource(artifact_id, kind, &href)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Releases an artifact. Releasing an already released artifact is a
    /// successful no-op and returns `false`.
    #[wasm_bindgen(js_name = releaseArtifact)]
    pub fn release_artifact(&mut self, artifact_id: u64) -> Result<bool, JsValue> {
        self.inner
            .release_artifact(artifact_id)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Disposes the session. Repeated disposal is a successful no-op and
    /// returns `false`.
    #[wasm_bindgen(js_name = dispose)]
    pub fn dispose(&mut self) -> Result<bool, JsValue> {
        self.inner
            .dispose()
            .map_err(ReaderProjectionError::into_js_value)
    }
}

#[derive(Debug)]
struct ReaderSessionProjection {
    session: Option<ReaderSession>,
}

impl ReaderSessionProjection {
    fn has_pending_adjacent(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(ReaderSession::has_pending_adjacent)
    }

    fn open(publication_bytes: Vec<u8>, session_id: u64) -> ProjectionResult<Self> {
        validate_external_id(
            session_id,
            ReaderProjectionErrorCode::InvalidSession,
            "sessionId",
        )?;
        let session = ReaderSession::open_owned(session_id, publication_bytes)?;
        Ok(Self {
            session: Some(session),
        })
    }

    fn open_with_pinned_font_policy(
        publication_bytes: Vec<u8>,
        session_id: u64,
        input: rito_core::runtime::RuntimePinnedFontPolicyInput,
    ) -> ProjectionResult<Self> {
        validate_external_id(
            session_id,
            ReaderProjectionErrorCode::InvalidSession,
            "sessionId",
        )?;
        let session = ReaderSession::open_owned_with_pinned_font_policy(
            session_id,
            publication_bytes,
            input,
        )?;
        Ok(Self {
            session: Some(session),
        })
    }

    fn request_artifact(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_artifact_request(request_wire)?;
        validate_wire_id(request.session_id, "RITOREQ1 sessionId")?;
        validate_wire_id(request.request_id, "RITOREQ1 requestId")?;
        let artifact = self.live_session()?.request_artifact(request)?;
        encode_reader_artifact(&artifact).map_err(Into::into)
    }

    fn publication(&self) -> ProjectionResult<Vec<u8>> {
        let session = self
            .session
            .as_ref()
            .ok_or_else(ReaderProjectionError::session_disposed)?;
        encode_reader_publication(session.publication()).map_err(Into::into)
    }

    fn request_adjacent(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_adjacent_request(request_wire)?;
        validate_wire_id(request.session_id, "RITONAV1 sessionId")?;
        validate_wire_id(request.request_id, "RITONAV1 requestId")?;
        validate_wire_id(request.from_artifact_id, "RITONAV1 fromArtifactId")?;
        let artifact = self.live_session()?.request_adjacent(request)?;
        encode_reader_artifact(&artifact).map_err(Into::into)
    }

    fn adopt_foreground_candidate(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_foreground_handoff(request_wire)?;
        validate_wire_id(request.session_id, "RITOFGH1 sessionId")?;
        if let Some(artifact_id) = request.expected_visible_artifact_id {
            validate_wire_id(artifact_id, "RITOFGH1 expectedVisibleArtifactId")?;
        }
        validate_wire_id(
            request.candidate_artifact_id,
            "RITOFGH1 candidateArtifactId",
        )?;
        let ack = self.live_session()?.adopt_foreground_candidate(request)?;
        encode_reader_foreground_handoff_ack(&ack).map_err(Into::into)
    }

    fn advance_background_once(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_background_request(request_wire)?;
        validate_wire_id(request.session_id, "RITOBGQ1 sessionId")?;
        validate_wire_id(
            request.expected_visible_artifact_id,
            "RITOBGQ1 expectedVisibleArtifactId",
        )?;
        let advance = self.live_session()?.advance_background_once(request)?;
        encode_reader_background_advance(&advance).map_err(Into::into)
    }

    fn adopt_background_candidate(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_background_handoff(request_wire)?;
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
        encode_reader_background_handoff_ack(&ack).map_err(Into::into)
    }

    fn release_artifact(&mut self, artifact_id: u64) -> ProjectionResult<bool> {
        validate_external_id(
            artifact_id,
            ReaderProjectionErrorCode::InvalidRequest,
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
            ReaderProjectionErrorCode::InvalidRequest,
            "artifactId",
        )?;
        let kind = resource_kind(kind)?;
        let resource = self
            .live_session()?
            .read_resource(artifact_id, kind, href)?;
        encode_reader_resource(&resource).map_err(Into::into)
    }

    fn dispose(&mut self) -> ProjectionResult<bool> {
        let Some(session) = self.session.take() else {
            return Ok(false);
        };
        session.dispose()?;
        Ok(true)
    }

    fn live_session(&mut self) -> ProjectionResult<&mut ReaderSession> {
        self.session
            .as_mut()
            .ok_or_else(ReaderProjectionError::session_disposed)
    }
}

fn validate_wire_id(value: u64, field: &str) -> ProjectionResult<()> {
    validate_external_id(value, ReaderProjectionErrorCode::InvalidWire, field)
}

fn validate_external_id(
    value: u64,
    code: ReaderProjectionErrorCode,
    field: &str,
) -> ProjectionResult<()> {
    if value == 0 || value > i64::MAX as u64 {
        return Err(ReaderProjectionError {
            code,
            message: format!("{field} must be within 1..={}", i64::MAX),
        });
    }
    Ok(())
}

type ProjectionResult<T> = Result<T, ReaderProjectionError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReaderProjectionErrorCode {
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

impl ReaderProjectionErrorCode {
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
struct ReaderProjectionError {
    code: ReaderProjectionErrorCode,
    message: String,
}

impl ReaderProjectionError {
    fn session_disposed() -> Self {
        Self {
            code: ReaderProjectionErrorCode::SessionDisposed,
            message: "reader session is disposed".to_owned(),
        }
    }

    fn into_js_value(self) -> JsValue {
        let error: JsValue = js_sys::Error::new(&self.message).into();
        set_error_property(&error, "name", "RitoReaderError");
        set_error_property(&error, "code", self.code.as_str());
        error
    }
}

impl From<ReaderError> for ReaderProjectionError {
    fn from(error: ReaderError) -> Self {
        let code = match error.kind {
            ReaderErrorKind::InvalidSession => ReaderProjectionErrorCode::InvalidSession,
            ReaderErrorKind::InvalidRequest => ReaderProjectionErrorCode::InvalidRequest,
            ReaderErrorKind::InvalidLayout => ReaderProjectionErrorCode::InvalidLayout,
            ReaderErrorKind::InvalidLocator => ReaderProjectionErrorCode::InvalidLocator,
            ReaderErrorKind::UnsupportedTextProfile => {
                ReaderProjectionErrorCode::UnsupportedTextProfile
            }
            ReaderErrorKind::StaleRequest => ReaderProjectionErrorCode::StaleRequest,
            ReaderErrorKind::TargetNotPublished => ReaderProjectionErrorCode::TargetNotPublished,
            ReaderErrorKind::UnknownArtifact => ReaderProjectionErrorCode::UnknownArtifact,
            ReaderErrorKind::NumericOverflow => ReaderProjectionErrorCode::NumericOverflow,
            ReaderErrorKind::InvalidWire => ReaderProjectionErrorCode::InvalidWire,
            ReaderErrorKind::EngineFailure => ReaderProjectionErrorCode::EngineFailure,
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

fn resource_kind(value: u32) -> ProjectionResult<ReaderResourceKind> {
    match value {
        0 => Ok(ReaderResourceKind::Image),
        1 => Ok(ReaderResourceKind::Font),
        2 => Ok(ReaderResourceKind::Stylesheet),
        _ => Err(ReaderProjectionError {
            code: ReaderProjectionErrorCode::InvalidRequest,
            message: format!("unsupported reader resource kind: {value}"),
        }),
    }
}

#[cfg(test)]
mod tests;
