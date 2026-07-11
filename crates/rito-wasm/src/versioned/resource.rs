use rito_core::runtime::{
    RuntimeResourceKind, RuntimeResourceTransferPayload, RuntimeRevisionHandle, RuntimeVersioned,
};

use super::revision_handle;
use crate::{
    wire::{
        parse_resource_prefetch_request, serialize_json, WasmFrameResourcePrefetchResponse,
        WasmMissingResource, WasmPlannedFrameResourcePrefetchResponse,
        WasmResourcePrefetchResponse,
    },
    WasmRuntimeDocument, WasmRuntimeError,
};

impl WasmRuntimeDocument {
    pub fn get_resource_payload_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Result<String, WasmRuntimeError> {
        let handle = revision_handle(revision_id, revision_version);
        let payload = self.store_resource_transfer_at(&handle, kind, href)?;
        serialize_json(&payload)
    }

    pub fn prefetch_resources_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_resource_prefetch_request(request_json)?;
        let handle = revision_handle(revision_id, revision_version);
        self.document
            .validate_revision_handle(&handle)
            .map_err(WasmRuntimeError::from_revision_access)?;
        let (payloads, missing_resources) = self.store_resource_transfers_at(
            &handle,
            request
                .resources
                .into_iter()
                .map(|resource| (resource.kind, resource.href)),
        );
        let response = WasmResourcePrefetchResponse {
            revision_id: revision_id.to_owned(),
            payloads,
            missing_resources,
            pending_transfer_count: self.pending_resource_transfer_count(),
        };
        serialize_json(&RuntimeVersioned::new(handle, response))
    }

    pub fn prefetch_planned_frame_resources_at_revision_json(
        &mut self,
        revision_id: &str,
        revision_version: u32,
        spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let handle = revision_handle(revision_id, revision_version);
        let plan = self
            .document
            .frame_resource_warm_plan_at(&handle, spread_index)
            .map_err(WasmRuntimeError::from_revision_access)?
            .value;
        let mut spreads = Vec::new();
        for spread_index in plan.spread_indexes.clone() {
            spreads.push(self.prefetch_frame_resources_at(&handle, spread_index)?);
        }
        let response = WasmPlannedFrameResourcePrefetchResponse {
            plan,
            spreads,
            pending_transfer_count: self.pending_resource_transfer_count(),
        };
        serialize_json(&RuntimeVersioned::new(handle, response))
    }

    fn store_resource_transfer_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Result<RuntimeVersioned<RuntimeResourceTransferPayload>, WasmRuntimeError> {
        let resource = self
            .document
            .get_resource_at(handle, kind, href)
            .map_err(WasmRuntimeError::from_revision_access)?;
        let payload = self
            .transfers
            .store_at(&resource.revision, resource.value)
            .map_err(WasmRuntimeError::from_engine)?;
        Ok(RuntimeVersioned::new(resource.revision, payload))
    }

    fn store_resource_transfers_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        resources: impl Iterator<Item = (RuntimeResourceKind, String)>,
    ) -> (
        Vec<RuntimeResourceTransferPayload>,
        Vec<WasmMissingResource>,
    ) {
        let mut payloads = Vec::new();
        let mut missing_resources = Vec::new();
        for (kind, href) in resources {
            match self.store_resource_transfer_at(handle, kind, &href) {
                Ok(payload) => payloads.push(payload.value),
                Err(error) => missing_resources.push(WasmMissingResource {
                    kind,
                    href,
                    message: error.message().to_owned(),
                }),
            }
        }
        (payloads, missing_resources)
    }

    pub(crate) fn prefetch_frame_resources_at(
        &mut self,
        handle: &RuntimeRevisionHandle,
        spread_index: usize,
    ) -> Result<WasmFrameResourcePrefetchResponse, WasmRuntimeError> {
        let images = self
            .document
            .get_frame_at(handle, spread_index)
            .map_err(WasmRuntimeError::from_revision_access)?
            .value
            .resource_refs
            .images;
        let (payloads, missing_resources) = self.store_resource_transfers_at(
            handle,
            images
                .into_iter()
                .map(|href| (RuntimeResourceKind::Image, href)),
        );
        Ok(WasmFrameResourcePrefetchResponse {
            revision_id: handle.revision_id.clone(),
            spread_index,
            payloads,
            missing_resources,
            pending_transfer_count: self.pending_resource_transfer_count(),
        })
    }
}
