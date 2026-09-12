use rito_core::runtime::RuntimeChapterLocalRevisionHandle;

use super::wire::{
    parse_create_request, parse_locator, parse_owner, WasmChapterLocalRevisionRelease,
};
use crate::{wire::serialize_json, WasmRuntimeDocument, WasmRuntimeError};

impl WasmRuntimeDocument {
    pub fn create_bounded_chapter_local_revision_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_create_request(request_json)?;
        let advance = self
            .document
            .create_bounded_chapter_local_revision(request)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        self.finish_created_local_transport(advance, serialize_json)
    }

    fn finish_created_local_transport<T>(
        &mut self,
        advance: rito_core::runtime::RuntimeChapterLocalRevisionAdvance,
        encode: impl FnOnce(
            &rito_core::runtime::RuntimeChapterLocalRevisionAdvance,
        ) -> Result<T, WasmRuntimeError>,
    ) -> Result<T, WasmRuntimeError> {
        let owner = owner_from_advance(&advance);
        match encode(&advance) {
            Ok(json) => Ok(json),
            Err(error) => {
                self.release_local_after_transport_failure(&owner);
                Err(error)
            }
        }
    }

    pub fn get_chapter_local_revision_summary_json(
        &self,
        owner_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        let summary = self
            .document
            .get_chapter_local_revision_summary(&owner)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        serialize_json(&summary)
    }

    pub fn resolve_chapter_local_source_locator_json(
        &mut self,
        owner_json: &str,
        locator_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        let locator = parse_locator(locator_json)?;
        let resolution = self
            .document
            .resolve_chapter_local_source_locator(&owner, locator)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        serialize_json(&resolution)
    }

    pub fn release_chapter_local_revision_json(
        &mut self,
        owner_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let owner = parse_owner(owner_json)?;
        self.document
            .get_chapter_local_revision_summary(&owner)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        let released_transfer_count = self.chapter_local_transfers.release_owner(&owner);
        let released_revision = self
            .document
            .release_chapter_local_revision(&owner)
            .map_err(WasmRuntimeError::from_chapter_local)?;
        serialize_json(&WasmChapterLocalRevisionRelease {
            owner,
            released_revision,
            released_transfer_count,
        })
    }

    fn release_local_after_transport_failure(&mut self, owner: &RuntimeChapterLocalRevisionHandle) {
        self.chapter_local_transfers.release_owner(owner);
        let released = self.document.release_chapter_local_revision(owner);
        debug_assert!(released.is_ok_and(|released| released));
    }
}

fn owner_from_advance(
    advance: &rito_core::runtime::RuntimeChapterLocalRevisionAdvance,
) -> RuntimeChapterLocalRevisionHandle {
    RuntimeChapterLocalRevisionHandle {
        revision_id: advance.revision.revision_id.clone(),
        revision_version: advance.revision.revision_version,
        coordinate: advance.revision.coordinate.clone(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{tests::fixture, WasmRuntimeError};

    #[test]
    fn create_encoder_failure_releases_the_new_local_revision() {
        let mut document = fixture::pinned_fixture_wasm_document();
        let request = super::parse_create_request(&request_json()).expect("request");
        let advance = document
            .document
            .create_bounded_chapter_local_revision(request)
            .expect("local revision");
        let owner = super::owner_from_advance(&advance);
        let injected = WasmRuntimeError::internal_error("injected create encoder failure");

        let result = document
            .finish_created_local_transport(advance, |_| Err::<String, _>(injected.clone()));

        assert_eq!(result, Err(injected));
        assert!(document
            .document
            .get_chapter_local_revision_summary(&owner)
            .is_err());
        assert_eq!(document.chapter_local_transfers.len(), 0);
    }

    fn request_json() -> String {
        json!({
            "layoutConfig": fixture::layout(),
            "targetChapterIndex": 0,
            "targetLocator": { "href": "chapter.xhtml" }
        })
        .to_string()
    }
}
