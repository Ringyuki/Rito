//! Binary-only WASM projection of Core's owned reader-session protocol.
//!
//! `u64` arguments are intentionally kept as `u64`: wasm-bindgen projects
//! them as JavaScript `bigint`, so session and artifact identities never pass
//! through an imprecise JavaScript `number`.

use rito_core::runtime::{
    decode_reader_adjacent_request, decode_reader_artifact_request,
    decode_reader_background_handoff, decode_reader_background_request,
    decode_reader_foreground_handoff, encode_reader_artifact, encode_reader_background_advance,
    encode_reader_background_handoff_ack, encode_reader_font_catalog, encode_reader_font_names,
    encode_reader_foreground_handoff_ack, encode_reader_publication, encode_reader_resource,
    ReaderError, ReaderErrorKind, ReaderResourceKind, ReaderSession,
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
    /// `metadata_json` is `{schemaVersion: 1, faces: [{expectedSha256,
    /// genericRole, language?}]}` and `face_bytes` an array of one
    /// `Uint8Array` per face, in the same order.
    #[wasm_bindgen(js_name = openWithPinnedFontPolicy)]
    pub fn open_with_pinned_font_policy(
        publication_bytes: Vec<u8>,
        session_id: u64,
        metadata_json: &str,
        face_bytes: JsValue,
    ) -> Result<Self, JsValue> {
        let input = host_fonts::opening_policy(metadata_json, face_bytes)
            .map_err(ReaderProjectionError::into_js_value)?;
        ReaderSessionProjection::open_with_pinned_font_policy(publication_bytes, session_id, input)
            .map(|inner| Self { inner })
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Opens a session from a publication's skeleton shard (see
    /// `rito-pack`). `key` is the skeleton's 32-byte key when the shards
    /// are encrypted. Chapters, images and fonts arrive through
    /// `supplyShard`; an operation that needs a shard not yet supplied
    /// fails with code `resource-pending` and a `pendingShards` array.
    #[wasm_bindgen(js_name = openShardsWithPinnedFontPolicy)]
    pub fn open_shards_with_pinned_font_policy(
        skeleton: Vec<u8>,
        key: Option<Vec<u8>>,
        session_id: u64,
        metadata_json: &str,
        face_bytes: JsValue,
    ) -> Result<Self, JsValue> {
        let input = host_fonts::opening_policy(metadata_json, face_bytes)
            .map_err(ReaderProjectionError::into_js_value)?;
        ReaderSessionProjection::open_shards(&skeleton, key.as_deref(), session_id, input)
            .map(|inner| Self { inner })
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Hands the session one content shard and returns its id. A shard of
    /// another publication, one that fails authentication, or one that
    /// does not match the skeleton is refused with `invalid-request`.
    #[wasm_bindgen(js_name = supplyShard)]
    pub fn supply_shard(&mut self, shard: Vec<u8>, key: Option<Vec<u8>>) -> Result<u32, JsValue> {
        self.inner
            .supply_shard(&shard, key.as_deref())
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Every content shard, those the chapter at `href` draws first, then
    /// those of the chapters around it by reading distance.
    #[wasm_bindgen(js_name = contentShardsNear)]
    pub fn content_shards_near(&self, href: String) -> Result<Vec<u32>, JsValue> {
        self.inner
            .content_shards_near(&href)
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

    /// Every family a `font-family` list can name, as one `RITOFNT1`
    /// message (host families first).
    #[wasm_bindgen(js_name = fontCatalog)]
    pub fn font_catalog(&self) -> Result<Vec<u8>, JsValue> {
        let catalog = self
            .inner
            .session()
            .map_err(ReaderProjectionError::into_js_value)?
            .font_catalog();
        encode_reader_font_catalog(&catalog)
            .map_err(|error| ReaderProjectionError::from(error).into_js_value())
    }

    /// The names in a CSS `font-family` list no family answers to, as one
    /// `RITOFNN1` message.
    #[wasm_bindgen(js_name = unresolvedFontFamilies)]
    pub fn unresolved_font_families(&self, family_list: &str) -> Result<Vec<u8>, JsValue> {
        let names = self
            .inner
            .session()
            .map_err(ReaderProjectionError::into_js_value)?
            .unresolved_font_families(family_list);
        encode_reader_font_names(&names)
            .map_err(|error| ReaderProjectionError::from(error).into_js_value())
    }

    /// Adds host faces (`metadata_json` and `face_bytes` as for
    /// `openWithPinnedFontPolicy`; a face may share its role and language
    /// with another). The next request lays out with the new faces
    /// nameable.
    #[wasm_bindgen(js_name = addHostFontFaces)]
    pub fn add_host_font_faces(
        &mut self,
        metadata_json: &str,
        face_bytes: JsValue,
    ) -> Result<(), JsValue> {
        let faces = host_fonts::added_faces(metadata_json, face_bytes)
            .map_err(ReaderProjectionError::into_js_value)?;
        self.inner
            .live_session()
            .map_err(ReaderProjectionError::into_js_value)?
            .add_host_font_faces(faces)
            .map(|_| ())
            .map_err(|error| ReaderProjectionError::from(error).into_js_value())
    }

    /// Removes host faces by their SHA-256 digests; at least one face must
    /// remain.
    #[wasm_bindgen(js_name = removeHostFontFaces)]
    pub fn remove_host_font_faces(&mut self, sha256s: Vec<String>) -> Result<(), JsValue> {
        self.inner
            .live_session()
            .map_err(ReaderProjectionError::into_js_value)?
            .remove_host_font_faces(&sha256s)
            .map(|_| ())
            .map_err(|error| ReaderProjectionError::from(error).into_js_value())
    }

    /// Marks publication faces the page could not load, by the family an
    /// artifact lists them under. The next request lays out without them.
    #[wasm_bindgen(js_name = markFontFamiliesUnavailable)]
    pub fn mark_font_families_unavailable(&mut self, families: Vec<String>) -> Result<(), JsValue> {
        self.inner
            .live_session()
            .map_err(ReaderProjectionError::into_js_value)?
            .mark_font_families_unavailable(&families)
            .map_err(|error| ReaderProjectionError::from(error).into_js_value())
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
    fn session(&self) -> ProjectionResult<&ReaderSession> {
        self.session
            .as_ref()
            .ok_or_else(ReaderProjectionError::session_disposed)
    }

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

    fn open_shards(
        skeleton: &[u8],
        key: Option<&[u8]>,
        session_id: u64,
        input: rito_core::runtime::RuntimePinnedFontPolicyInput,
    ) -> ProjectionResult<Self> {
        validate_external_id(
            session_id,
            ReaderProjectionErrorCode::InvalidSession,
            "sessionId",
        )?;
        let key = shard_key(key)?;
        let session = ReaderSession::open_shards_with_pinned_font_policy(
            session_id,
            skeleton,
            key.as_ref(),
            input,
        )?;
        Ok(Self {
            session: Some(session),
        })
    }

    fn supply_shard(&mut self, shard: &[u8], key: Option<&[u8]>) -> ProjectionResult<u32> {
        let key = shard_key(key)?;
        self.live_session()?
            .supply_shard(shard, key.as_ref())
            .map_err(Into::into)
    }

    fn content_shards_near(&self, href: &str) -> ProjectionResult<Vec<u32>> {
        self.session
            .as_ref()
            .map(|session| session.content_shards_near(href))
            .ok_or_else(ReaderProjectionError::session_disposed)
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

fn shard_key(key: Option<&[u8]>) -> ProjectionResult<Option<rito_core::epub::shard::ShardKey>> {
    key.map(|bytes| {
        rito_core::epub::shard::ShardKey::from_slice(bytes).ok_or_else(|| ReaderProjectionError {
            code: ReaderProjectionErrorCode::InvalidRequest,
            message: format!("a shard key is 32 bytes, not {}", bytes.len()),
            pending_shards: Vec::new(),
        })
    })
    .transpose()
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
            pending_shards: Vec::new(),
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
    ResourcePending,
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
            Self::ResourcePending => "resource-pending",
            Self::SessionDisposed => "session-disposed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReaderProjectionError {
    code: ReaderProjectionErrorCode,
    message: String,
    pending_shards: Vec<u32>,
}

impl ReaderProjectionError {
    fn session_disposed() -> Self {
        Self {
            code: ReaderProjectionErrorCode::SessionDisposed,
            message: "reader session is disposed".to_owned(),
            pending_shards: Vec::new(),
        }
    }

    fn into_js_value(self) -> JsValue {
        let error: JsValue = js_sys::Error::new(&self.message).into();
        set_error_property(&error, "name", "RitoReaderError");
        set_error_property(&error, "code", self.code.as_str());
        if self.code == ReaderProjectionErrorCode::ResourcePending {
            let shards = self
                .pending_shards
                .iter()
                .map(|shard_id| JsValue::from(*shard_id))
                .collect::<js_sys::Array>();
            let _ = js_sys::Reflect::set(&error, &JsValue::from_str("pendingShards"), &shards);
        }
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
            ReaderErrorKind::ResourcePending => ReaderProjectionErrorCode::ResourcePending,
        };
        Self {
            code,
            message: error.message,
            pending_shards: error.pending_shards,
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
            pending_shards: Vec::new(),
        }),
    }
}

mod host_fonts;
mod queries;

#[cfg(test)]
mod query_tests;
#[cfg(test)]
pub(crate) mod tests;
