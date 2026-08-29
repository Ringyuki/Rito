use rito_core::runtime::{RuntimeChapterLocalRevisionHandle, RuntimeResourceKind};

use super::wire::{
    parse_owner, WasmChapterLocalFrameCommandBufferMetadata, WasmChapterLocalFrameResourceResponse,
    WasmChapterLocalMissingResource,
};
use crate::{wire::serialize_json, WasmRuntimeDocument, WasmRuntimeError};

impl WasmRuntimeDocument {
    pub fn get_chapter_local_frame_json(
        &mut self,
        owner_json: &str,
        local_spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        let frame = self
            .document
            .get_chapter_local_frame(&owner, local_spread_index)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        serialize_json(&frame)
    }

    pub fn get_chapter_local_frame_command_buffer_metadata_json(
        &mut self,
        owner_json: &str,
        local_spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        let metadata = self
            .document
            .get_chapter_local_frame_command_buffer_metadata(&owner, local_spread_index)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        let metadata = WasmChapterLocalFrameCommandBufferMetadata::try_new(
            owner,
            local_spread_index,
            metadata,
        )?;
        serialize_json(&metadata)
    }

    pub fn read_chapter_local_frame_command_buffer(
        &mut self,
        owner_json: &str,
        local_spread_index: usize,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        self.document
            .read_chapter_local_frame_command_buffer(&owner, local_spread_index)
            .map_err(WasmRuntimeError::from_chapter_local)
    }

    pub fn get_chapter_local_resource_payload_json(
        &mut self,
        owner_json: &str,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Result<String, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        let payload = self.store_chapter_local_resource(&owner, kind, href)?;
        self.finish_local_resource_payload_transport(&owner, payload, serialize_json)
    }

    pub fn prefetch_chapter_local_frame_resources_json(
        &mut self,
        owner_json: &str,
        local_spread_index: usize,
    ) -> Result<String, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        let hrefs = self
            .document
            .get_chapter_local_frame_image_resource_hrefs(&owner, local_spread_index)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        let mut new_transfer_ids = Vec::new();
        let (payloads, missing_resources) =
            self.store_local_images(&owner, hrefs, &mut new_transfer_ids);
        let response = WasmChapterLocalFrameResourceResponse {
            owner,
            local_spread_index,
            payloads,
            missing_resources,
            pending_chapter_local_transfer_count: self.chapter_local_transfers.len(),
        };
        match serialize_json(&response) {
            Ok(json) => Ok(json),
            Err(error) => {
                for transfer_id in new_transfer_ids {
                    self.chapter_local_transfers
                        .release_at(&response.owner, &transfer_id)
                        .expect("new transfer retains its exact owner");
                }
                Err(error)
            }
        }
    }

    pub fn read_chapter_local_resource_transfer(
        &self,
        owner_json: &str,
        transfer_id: &str,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        self.chapter_local_transfers.read_at(&owner, transfer_id)
    }

    pub fn take_chapter_local_resource_transfer(
        &mut self,
        owner_json: &str,
        transfer_id: &str,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        self.chapter_local_transfers.take_at(&owner, transfer_id)
    }

    pub fn release_chapter_local_resource_transfer(
        &mut self,
        owner_json: &str,
        transfer_id: &str,
    ) -> Result<bool, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        self.chapter_local_transfers.release_at(&owner, transfer_id)
    }

    fn store_chapter_local_resource(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Result<super::wire::WasmChapterLocalResourceTransferPayload, WasmRuntimeError> {
        let resource = self
            .document
            .get_chapter_local_resource(owner, kind, href)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        let mut payload = self.chapter_local_transfers.store_at(owner, resource)?;
        // Resource resolution may canonicalize the href away from the frame's
        // resource-table key; consumers match payloads against that table, so
        // the payload must report the lookup key it satisfies.
        payload.href = href.to_owned();
        Ok(payload)
    }

    fn finish_local_resource_payload_transport<T>(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        payload: super::wire::WasmChapterLocalResourceTransferPayload,
        encode: impl FnOnce(
            &super::wire::WasmChapterLocalResourceTransferPayload,
        ) -> Result<T, WasmRuntimeError>,
    ) -> Result<T, WasmRuntimeError> {
        let transfer_id = payload.transfer_id.clone();
        match encode(&payload) {
            Ok(value) => Ok(value),
            Err(error) => {
                self.chapter_local_transfers
                    .release_at(owner, &transfer_id)
                    .expect("new transfer retains its exact owner");
                Err(error)
            }
        }
    }

    fn store_local_images(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        hrefs: Vec<String>,
        new_transfer_ids: &mut Vec<String>,
    ) -> (
        Vec<super::wire::WasmChapterLocalResourceTransferPayload>,
        Vec<WasmChapterLocalMissingResource>,
    ) {
        let mut payloads = Vec::new();
        let mut missing = Vec::new();
        for href in hrefs {
            match self.store_chapter_local_resource(owner, RuntimeResourceKind::Image, &href) {
                Ok(payload) => {
                    new_transfer_ids.push(payload.transfer_id.clone());
                    payloads.push(payload);
                }
                Err(error) => missing.push(WasmChapterLocalMissingResource {
                    kind: RuntimeResourceKind::Image,
                    href,
                    message: error.message().to_owned(),
                }),
            }
        }
        (payloads, missing)
    }
}

#[cfg(test)]
mod tests {
    use rito_core::runtime::RuntimeResourceKind;
    use serde_json::{json, Value};

    use crate::{tests::fixture, WasmRuntimeError};

    #[test]
    fn resource_payload_reports_the_lookup_href_not_the_canonical_manifest_href() {
        let mut document = fixture::pinned_fixture_wasm_document();
        let advance = document
            .create_bounded_chapter_local_revision_json(
                &json!({
                    "layoutConfig": fixture::layout(),
                    "targetChapterIndex": 0,
                    "targetLocator": { "href": "chapter.xhtml" },
                    "localPageCap": 4,
                    "budget": { "maxTopLevelNodes": 64 }
                })
                .to_string(),
            )
            .expect("local revision");
        let advance: Value = serde_json::from_str(&advance).expect("advance JSON");
        let owner = super::parse_owner(
            &json!({
                "revisionId": advance["revision"]["revisionId"],
                "revisionVersion": advance["revision"]["revisionVersion"],
                "coordinate": advance["revision"]["coordinate"]
            })
            .to_string(),
        )
        .expect("owner");

        let payload = document
            .store_chapter_local_resource(&owner, RuntimeResourceKind::Image, "../Images/cover.png")
            .expect("resource lease resolves through display-href semantics");

        assert_eq!(payload.href, "../Images/cover.png");
        assert_eq!(payload.media_type, "image/png");
    }

    #[test]
    fn resource_payload_encoder_failure_rolls_back_only_its_new_exact_lease() {
        let mut document = fixture::pinned_fixture_wasm_document();
        let advance = document
            .create_bounded_chapter_local_revision_json(
                &json!({
                    "layoutConfig": fixture::layout(),
                    "targetChapterIndex": 0,
                    "targetLocator": { "href": "chapter.xhtml" },
                    "localPageCap": 4,
                    "budget": { "maxTopLevelNodes": 64 }
                })
                .to_string(),
            )
            .expect("local revision");
        let advance: Value = serde_json::from_str(&advance).expect("advance JSON");
        let owner = super::parse_owner(
            &json!({
                "revisionId": advance["revision"]["revisionId"],
                "revisionVersion": advance["revision"]["revisionVersion"],
                "coordinate": advance["revision"]["coordinate"]
            })
            .to_string(),
        )
        .expect("owner");
        let payload = document
            .store_chapter_local_resource(&owner, RuntimeResourceKind::Image, "Images/cover.png")
            .expect("resource lease");
        let transfer_id = payload.transfer_id.clone();
        let injected = WasmRuntimeError::internal_error("injected local encoder failure");

        let result = document.finish_local_resource_payload_transport(&owner, payload, |_| {
            Err::<String, _>(injected.clone())
        });

        assert_eq!(result, Err(injected));
        assert!(document
            .chapter_local_transfers
            .read_at(&owner, &transfer_id)
            .is_err());
    }
}
