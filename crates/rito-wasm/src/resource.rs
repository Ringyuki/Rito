use rito_core::runtime::{
    RuntimeResourceKind, RuntimeResourceTransferPayload, RuntimeResourceTransferStore,
};

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
        let mut new_transfer_ids = Vec::new();
        let result = (|| {
            let plan = self
                .document
                .frame_resource_warm_plan(revision_id, spread_index)
                .map_err(WasmRuntimeError::from_engine)?;
            let mut spreads = Vec::new();
            for spread_index in plan.spread_indexes.clone() {
                // One spread failing to enumerate (a frame not warm yet, a
                // relayout race) must not abort the window: the visible
                // spread's bytes ride in the same response, and losing them
                // strands its canvas on the previous image forever.
                let spread = match self.prefetch_frame_resources(revision_id, spread_index) {
                    Ok(spread) => spread,
                    Err(error) => degraded_frame_resource_prefetch(
                        revision_id.to_owned(),
                        spread_index,
                        &error,
                        self.pending_resource_transfer_count(),
                    ),
                };
                new_transfer_ids.extend(
                    spread
                        .payloads
                        .iter()
                        .map(|payload| payload.transfer_id.clone()),
                );
                spreads.push(spread);
            }
            serialize_json(&WasmPlannedFrameResourcePrefetchResponse {
                plan,
                spreads,
                pending_transfer_count: self.pending_resource_transfer_count(),
            })
        })();
        rollback_new_transfers_on_error(&mut self.transfers, &new_transfer_ids, result)
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
            .get_frame_image_resource_hrefs(revision_id, spread_index)
            .map_err(WasmRuntimeError::from_engine)?;
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
            prefetch_error: None,
            pending_transfer_count: self.pending_resource_transfer_count(),
        })
    }
}

pub(crate) fn degraded_frame_resource_prefetch(
    revision_id: String,
    spread_index: usize,
    error: &WasmRuntimeError,
    pending_transfer_count: usize,
) -> WasmFrameResourcePrefetchResponse {
    WasmFrameResourcePrefetchResponse {
        revision_id,
        spread_index,
        payloads: Vec::new(),
        missing_resources: Vec::new(),
        prefetch_error: Some(error.message().to_owned()),
        pending_transfer_count,
    }
}

pub(crate) fn rollback_new_transfers_on_error<T>(
    transfers: &mut RuntimeResourceTransferStore,
    transfer_ids: &[String],
    result: Result<T, WasmRuntimeError>,
) -> Result<T, WasmRuntimeError> {
    if result.is_err() {
        for transfer_id in transfer_ids {
            transfers.release(transfer_id);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use rito_core::runtime::{
        RuntimeResource, RuntimeResourceKind, RuntimeResourceTransferStore, RuntimeRevisionHandle,
    };

    use super::rollback_new_transfers_on_error;
    use crate::WasmRuntimeError;

    #[test]
    fn aggregate_rollback_releases_only_new_transfer_leases() {
        let revision = RuntimeRevisionHandle::new("rev-1", 7);
        let mut transfers = RuntimeResourceTransferStore::new();
        let existing = transfers
            .store_at(&revision, resource("existing.png"))
            .expect("existing lease is stored");
        let created = transfers
            .store_at(&revision, resource("created.png"))
            .expect("new lease is stored");
        let error = WasmRuntimeError::internal_error("injected later spread failure");

        let result = rollback_new_transfers_on_error::<()>(
            &mut transfers,
            std::slice::from_ref(&created.transfer_id),
            Err(error.clone()),
        );

        assert_eq!(result, Err(error));
        assert!(transfers.read(&existing.transfer_id).is_ok());
        assert!(transfers.read(&created.transfer_id).is_err());
    }

    fn resource(href: &str) -> RuntimeResource {
        RuntimeResource {
            revision_id: "rev-1".to_owned(),
            kind: RuntimeResourceKind::Image,
            href: href.to_owned(),
            media_type: "image/png".to_owned(),
            bytes: vec![1, 2, 3],
            width: None,
            height: None,
        }
    }
}
