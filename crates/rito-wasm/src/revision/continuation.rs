use crate::{
    wire::{
        parse_bounded_revision_request, parse_cancel_revision_request,
        parse_continue_revision_request, serialize_json,
    },
    WasmRuntimeDocument, WasmRuntimeError,
};

impl WasmRuntimeDocument {
    /// Starts the experimental, bounded Rust revision path.
    pub fn create_bounded_revision_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_bounded_revision_request(request_json)?;
        let advance = self
            .document
            .create_bounded_revision(request)
            .map_err(WasmRuntimeError::from_continuation)?;
        serialize_json(&advance)
    }

    /// Consumes one version-bound continuation cursor.
    pub fn continue_revision_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_continue_revision_request(request_json)?;
        let advance = self
            .document
            .continue_revision(request)
            .map_err(WasmRuntimeError::from_continuation)?;
        serialize_json(&advance)
    }

    /// Cancels a bounded revision at its current version.
    pub fn cancel_revision_json(&mut self, request_json: &str) -> Result<String, WasmRuntimeError> {
        let request = parse_cancel_revision_request(request_json)?;
        let revision = self
            .document
            .cancel_revision(request)
            .map_err(WasmRuntimeError::from_continuation)?;
        serialize_json(&revision)
    }

    /// Returns control-plane state only; frames and interactions remain gated.
    pub fn get_revision_summary_json(&self, revision_id: &str) -> Result<String, WasmRuntimeError> {
        let revision = self
            .document
            .get_revision_summary(revision_id)
            .map_err(WasmRuntimeError::from_continuation)?;
        serialize_json(&revision)
    }
}
