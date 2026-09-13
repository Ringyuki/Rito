use crate::{
    wire::{parse_layout_config, serialize_json},
    WasmRuntimeDocument, WasmRuntimeError,
};

impl WasmRuntimeDocument {
    /// Creates a whole-book revision; the book paginates in one step.
    pub fn create_revision_json(
        &mut self,
        layout_config_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let layout_config = parse_layout_config(layout_config_json)?;
        let summary = self
            .document
            .create_revision(&layout_config)
            .map_err(WasmRuntimeError::from_revision)?;
        let revision = rito_core::runtime::RuntimeRevisionHandle::from(&summary);
        self.finish_created_revision_transport(revision, None, move |_, _, _| {
            serialize_json(&summary)
        })
    }

    /// Returns control-plane state only; frames and interactions remain gated.
    pub fn get_revision_summary_json(&self, revision_id: &str) -> Result<String, WasmRuntimeError> {
        let revision = self
            .document
            .get_revision_summary(revision_id)
            .map_err(WasmRuntimeError::from_revision)?;
        serialize_json(&revision)
    }
}
