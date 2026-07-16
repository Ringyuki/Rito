use super::revision_handle;
use crate::{
    wire::{
        parse_exact_source_range_request, parse_locator_request, parse_search_request,
        parse_source_locator_request, parse_text_point_request,
        parse_text_range_from_points_request, parse_text_range_geometry_request,
        parse_text_range_request, serialize_json,
    },
    WasmRuntimeDocument, WasmRuntimeError,
};

impl WasmRuntimeDocument {
    pub fn search_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_search_request(request_json)?;
        let response = self
            .document
            .search_at(&revision_handle(revision_id, revision_version), request)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn resolve_locator_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_locator_request(request_json)?;
        let response = self
            .document
            .resolve_locator_at(&revision_handle(revision_id, revision_version), request)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn resolve_source_locator_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_source_locator_request(request_json)?;
        let response = self
            .document
            .resolve_source_locator_at(&revision_handle(revision_id, revision_version), request)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn resolve_exact_source_range_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_exact_source_range_request(request_json)?;
        let response = self
            .document
            .resolve_exact_source_range_at(&revision_handle(revision_id, revision_version), request)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_page_targets_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        page_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .get_page_targets_at(&revision_handle(revision_id, revision_version), page_index)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_page_semantics_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        page_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .get_page_semantics_at(&revision_handle(revision_id, revision_version), page_index)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_page_reading_anchor_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        page_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .get_page_reading_anchor_at(&revision_handle(revision_id, revision_version), page_index)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_page_text_positions_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        page_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .get_page_text_positions_at(&revision_handle(revision_id, revision_version), page_index)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_text_range_geometry_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_text_range_geometry_request(request_json)?;
        let response = self
            .document
            .get_text_range_geometry_at(&revision_handle(revision_id, revision_version), request)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn resolve_text_caret_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_text_point_request(request_json)?;
        let response = self
            .document
            .resolve_text_caret_at(&revision_handle(revision_id, revision_version), request)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn resolve_text_range_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_text_range_request(request_json)?;
        let response = self
            .document
            .resolve_text_range_at(&revision_handle(revision_id, revision_version), request)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn resolve_text_range_from_points_at_revision_json(
        &self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_text_range_from_points_request(request_json)?;
        let response = self
            .document
            .resolve_text_range_from_points_at(
                &revision_handle(revision_id, revision_version),
                request,
            )
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_footnote_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        key: &str,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .get_footnote_at(&revision_handle(revision_id, revision_version), key)
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_footnotes_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .get_footnotes_at(&revision_handle(revision_id, revision_version))
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }

    pub fn get_chapter_text_indices_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
    ) -> Result<String, WasmRuntimeError> {
        let response = self
            .document
            .get_chapter_text_indices_at(&revision_handle(revision_id, revision_version))
            .map_err(WasmRuntimeError::from_revision_access)?;
        serialize_json(&response)
    }
}
