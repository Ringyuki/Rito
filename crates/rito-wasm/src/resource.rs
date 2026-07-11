use rito_core::runtime::{RuntimeResourceKind, RuntimeResourceTransferPayload};

use crate::{
    wire::{
        parse_resource_prefetch_request, serialize_json, WasmFrameResourcePrefetchResponse,
        WasmMissingResource, WasmPlannedFrameResourcePrefetchResponse,
        WasmResourcePrefetchResponse,
    },
    WasmRuntimeDocument, WasmRuntimeError,
};

impl WasmRuntimeDocument {
    pub fn get_resource_payload_json(
        &mut self,
        revision_id: &str,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Result<String, WasmRuntimeError> {
        let payload = self.store_resource_transfer(revision_id, kind, href)?;
        serialize_json(&payload)
    }

    pub fn prefetch_resources_json(
        &mut self,
        revision_id: &str,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        self.assert_revision_exists(revision_id)?;
        let request = parse_resource_prefetch_request(request_json)?;
        let (payloads, missing_resources) = self.store_resource_transfers(
            revision_id,
            request
                .resources
                .into_iter()
                .map(|resource| (resource.kind, resource.href)),
        );
        serialize_json(&WasmResourcePrefetchResponse {
            revision_id: revision_id.to_owned(),
            payloads,
            missing_resources,
            pending_transfer_count: self.pending_resource_transfer_count(),
        })
    }

    pub fn prefetch_planned_frame_resources_json(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let plan = self
            .document
            .frame_resource_warm_plan(revision_id, spread_index)
            .map_err(WasmRuntimeError::from_engine)?;
        let mut spreads = Vec::new();
        for spread_index in plan.spread_indexes.clone() {
            spreads.push(self.prefetch_frame_resources(revision_id, spread_index)?);
        }
        serialize_json(&WasmPlannedFrameResourcePrefetchResponse {
            plan,
            spreads,
            pending_transfer_count: self.pending_resource_transfer_count(),
        })
    }

    pub fn read_resource_transfer(&self, transfer_id: &str) -> Result<Vec<u8>, WasmRuntimeError> {
        self.transfers
            .read(transfer_id)
            .map(|bytes| bytes.to_vec())
            .map_err(WasmRuntimeError::from_engine)
    }

    pub fn take_resource_transfer(
        &mut self,
        transfer_id: &str,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        self.transfers
            .take(transfer_id)
            .map_err(WasmRuntimeError::from_engine)
    }

    pub fn release_resource_transfer(&mut self, transfer_id: &str) -> bool {
        self.transfers.release(transfer_id)
    }

    pub fn release_revision_transfers(&mut self, revision_id: &str) -> usize {
        self.transfers.release_revision(revision_id)
    }

    pub fn release_revision(&mut self, revision_id: &str) -> bool {
        self.transfers.release_revision(revision_id);
        self.document.release_revision(revision_id)
    }

    pub fn pending_resource_transfer_count(&self) -> usize {
        self.transfers.len()
    }

    pub(crate) fn store_resource_transfers(
        &mut self,
        revision_id: &str,
        resources: impl Iterator<Item = (RuntimeResourceKind, String)>,
    ) -> (
        Vec<RuntimeResourceTransferPayload>,
        Vec<WasmMissingResource>,
    ) {
        let mut payloads = Vec::new();
        let mut missing_resources = Vec::new();
        for (kind, href) in resources {
            match self.store_resource_transfer(revision_id, kind, &href) {
                Ok(payload) => payloads.push(payload),
                Err(error) => missing_resources.push(WasmMissingResource {
                    kind,
                    href,
                    message: error.message().to_owned(),
                }),
            }
        }
        (payloads, missing_resources)
    }

    pub(crate) fn prefetch_frame_resources(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> Result<WasmFrameResourcePrefetchResponse, WasmRuntimeError> {
        let images = self
            .document
            .get_frame(revision_id, spread_index)
            .map_err(WasmRuntimeError::from_engine)?
            .resource_refs
            .images;
        let (payloads, missing_resources) = self.store_resource_transfers(
            revision_id,
            images
                .into_iter()
                .map(|href| (RuntimeResourceKind::Image, href)),
        );
        Ok(WasmFrameResourcePrefetchResponse {
            revision_id: revision_id.to_owned(),
            spread_index,
            payloads,
            missing_resources,
            pending_transfer_count: self.pending_resource_transfer_count(),
        })
    }
}
