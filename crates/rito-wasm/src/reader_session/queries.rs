//! The reader-session operations beyond pagination — peeking a page turn,
//! footnotes, search, text geometry, selection, annotation targets and
//! reading-position questions. Each takes and returns the same binary
//! messages the C ABI carries, so a browser host and a native host speak
//! one protocol to one engine.

use rito_core::runtime::{
    decode_reader_adjacent_request, decode_reader_annotation_request,
    decode_reader_exact_source_range_request, decode_reader_foreground_handoff,
    decode_reader_navigation_request, decode_reader_search_request,
    decode_reader_text_interaction_request, decode_reader_text_range_request,
    encode_reader_annotation_response, encode_reader_artifact,
    encode_reader_exact_source_range_resolution, encode_reader_footnote,
    encode_reader_foreground_handoff_ack, encode_reader_navigation_result,
    encode_reader_search_response, encode_reader_text_interaction_response,
    encode_reader_text_range_geometry,
};
use wasm_bindgen::prelude::*;

use super::{
    validate_external_id, validate_wire_id, ProjectionResult, ReaderProjectionError,
    ReaderProjectionErrorCode, ReaderSessionProjection, RitoReaderSession,
};

#[wasm_bindgen(js_class = RitoReaderSession)]
impl RitoReaderSession {
    /// Consumes a `RITONAV1` request and returns the adjacent `RITOART1`
    /// artifact as a peek: it stays outside the foreground lane until
    /// `commitPeekedArtifact` adopts it.
    #[wasm_bindgen(js_name = peekAdjacent)]
    pub fn peek_adjacent(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .peek_adjacent(&request_wire)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Consumes a `RITOFGH1` handoff naming a peeked artifact and returns
    /// the `RITOFGA1` acknowledgement.
    #[wasm_bindgen(js_name = commitPeekedArtifact)]
    pub fn commit_peeked_artifact(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .commit_peeked_artifact(&request_wire)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// Reads a footnote a live artifact references, as a `RITOFTN1` message.
    #[wasm_bindgen(js_name = readFootnote)]
    pub fn read_footnote(&mut self, artifact_id: u64, key: String) -> Result<Vec<u8>, JsValue> {
        self.inner
            .read_footnote(artifact_id, &key)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// `RITOSRQ1` in, `RITOSRS1` out.
    #[wasm_bindgen(js_name = search)]
    pub fn search(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .query(&request_wire, Query::Search)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// `RITOTRQ1` in, `RITOTRG1` out.
    #[wasm_bindgen(js_name = textRangeGeometry)]
    pub fn text_range_geometry(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .query(&request_wire, Query::TextRangeGeometry)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// `RITOESQ1` in, `RITOESR1` out.
    #[wasm_bindgen(js_name = exactSourceRange)]
    pub fn exact_source_range(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .query(&request_wire, Query::ExactSourceRange)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// `RITOTIQ1` in, `RITOTIR1` out.
    #[wasm_bindgen(js_name = textInteraction)]
    pub fn text_interaction(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .query(&request_wire, Query::TextInteraction)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// `RITOANQ1` in, `RITOANR1` out.
    #[wasm_bindgen(js_name = annotation)]
    pub fn annotation(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .query(&request_wire, Query::Annotation)
            .map_err(ReaderProjectionError::into_js_value)
    }

    /// `RITONVQ1` in, `RITONVR1` out.
    #[wasm_bindgen(js_name = navigation)]
    pub fn navigation(&mut self, request_wire: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        self.inner
            .query(&request_wire, Query::Navigation)
            .map_err(ReaderProjectionError::into_js_value)
    }
}

/// A read-only question answered from one request message.
#[derive(Debug, Clone, Copy)]
pub(super) enum Query {
    Search,
    TextRangeGeometry,
    ExactSourceRange,
    TextInteraction,
    Annotation,
    Navigation,
}

impl ReaderSessionProjection {
    pub(super) fn peek_adjacent(&mut self, request_wire: &[u8]) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_adjacent_request(request_wire)?;
        validate_wire_id(request.session_id, "RITONAV1 sessionId")?;
        validate_wire_id(request.request_id, "RITONAV1 requestId")?;
        validate_wire_id(request.from_artifact_id, "RITONAV1 fromArtifactId")?;
        let artifact = self.live_session()?.peek_adjacent(request)?;
        encode_reader_artifact(&artifact).map_err(Into::into)
    }

    pub(super) fn commit_peeked_artifact(
        &mut self,
        request_wire: &[u8],
    ) -> ProjectionResult<Vec<u8>> {
        let request = decode_reader_foreground_handoff(request_wire)?;
        validate_wire_id(request.session_id, "RITOFGH1 sessionId")?;
        if let Some(artifact_id) = request.expected_visible_artifact_id {
            validate_wire_id(artifact_id, "RITOFGH1 expectedVisibleArtifactId")?;
        }
        validate_wire_id(
            request.candidate_artifact_id,
            "RITOFGH1 candidateArtifactId",
        )?;
        let ack = self.live_session()?.commit_peeked_artifact(request)?;
        encode_reader_foreground_handoff_ack(&ack).map_err(Into::into)
    }

    pub(super) fn read_footnote(
        &mut self,
        artifact_id: u64,
        key: &str,
    ) -> ProjectionResult<Vec<u8>> {
        validate_external_id(
            artifact_id,
            ReaderProjectionErrorCode::InvalidRequest,
            "artifactId",
        )?;
        let footnote = self.live_session()?.read_footnote(artifact_id, key)?;
        encode_reader_footnote(&footnote).map_err(Into::into)
    }

    pub(super) fn query(&mut self, request_wire: &[u8], query: Query) -> ProjectionResult<Vec<u8>> {
        let session = self.live_session()?;
        let response = match query {
            Query::Search => encode_reader_search_response(
                &session.search(decode_reader_search_request(request_wire)?)?,
            ),
            Query::TextRangeGeometry => encode_reader_text_range_geometry(
                &session
                    .get_text_range_geometry(decode_reader_text_range_request(request_wire)?)?,
            ),
            Query::ExactSourceRange => {
                encode_reader_exact_source_range_resolution(&session.resolve_exact_source_range(
                    decode_reader_exact_source_range_request(request_wire)?,
                )?)
            }
            Query::TextInteraction => {
                encode_reader_text_interaction_response(&session.resolve_text_interaction(
                    decode_reader_text_interaction_request(request_wire)?,
                )?)
            }
            Query::Annotation => encode_reader_annotation_response(
                &session.resolve_annotation(decode_reader_annotation_request(request_wire)?)?,
            ),
            Query::Navigation => encode_reader_navigation_result(
                &session.resolve_navigation(decode_reader_navigation_request(request_wire)?)?,
            ),
        };
        response.map_err(Into::into)
    }
}
