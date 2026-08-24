use crate::{
    wire::{
        parse_locator_request, parse_search_request, parse_text_range_geometry_request,
        serialize_json,
    },
    WasmRuntimeDocument, WasmRuntimeError,
};

impl WasmRuntimeDocument {
    pub fn search_json(
        &self,
        revision_id: &str,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_search_request(request_json)?;
        let response = self
            .document
            .search(revision_id, request)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&response)
    }

    pub fn resolve_locator_json(
        &self,
        revision_id: &str,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_locator_request(request_json)?;
        let response = self
            .document
            .resolve_locator(revision_id, request)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&response)
    }

    pub fn get_page_targets_json(
        &self,
        revision_id: &str,
        page_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let targets = self
            .document
            .get_page_targets(revision_id, page_index)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&targets)
    }

    pub fn get_page_text_positions_json(
        &self,
        revision_id: &str,
        page_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let positions = self
            .document
            .get_page_text_positions(revision_id, page_index)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&positions)
    }

    pub fn get_text_range_geometry_json(
        &self,
        revision_id: &str,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_text_range_geometry_request(request_json)?;
        let geometry = self
            .document
            .get_text_range_geometry(revision_id, request)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&geometry)
    }

    pub fn get_footnote_json(
        &mut self,
        revision_id: &str,
        key: &str,
    ) -> Result<String, WasmRuntimeError> {
        let footnote = self
            .document
            .get_footnote(revision_id, key)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&footnote)
    }

    pub fn get_footnotes_json(&mut self, revision_id: &str) -> Result<String, WasmRuntimeError> {
        let footnotes = self
            .document
            .get_footnotes(revision_id)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&footnotes)
    }

    pub fn get_chapter_text_indices_json(
        &mut self,
        revision_id: &str,
    ) -> Result<String, WasmRuntimeError> {
        let indices = self
            .document
            .get_chapter_text_indices(revision_id)
            .map_err(WasmRuntimeError::from_engine)?;
        serialize_json(&indices)
    }
}
