use rito_core::runtime::{
    RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionHandle,
    RuntimeContinuationErrorKind, RuntimeRevisionStatus,
};

use super::wire::{
    parse_continue_request, parse_create_request, parse_locator, parse_owner,
    WasmChapterLocalRevisionAdvance, WasmChapterLocalRevisionRelease,
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

    pub fn continue_chapter_local_revision_json(
        &mut self,
        request_json: &str,
    ) -> Result<String, WasmRuntimeError> {
        let request = parse_continue_request(request_json)?;
        let previous_owner = request.continuation.owner.clone();
        match self.document.continue_chapter_local_revision(request) {
            Ok(advance) => self.finish_local_continuation(previous_owner, advance, serialize_json),
            Err(error) => Err(self.finish_local_continuation_error(previous_owner, error)),
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

    fn finish_local_continuation<T>(
        &mut self,
        previous_owner: RuntimeChapterLocalRevisionHandle,
        advance: rito_core::runtime::RuntimeChapterLocalRevisionAdvance,
        encode: impl FnOnce(&WasmChapterLocalRevisionAdvance) -> Result<T, WasmRuntimeError>,
    ) -> Result<T, WasmRuntimeError> {
        let owner = owner_from_advance(&advance);
        let released = self.chapter_local_transfers.release_owner(&previous_owner);
        let response = WasmChapterLocalRevisionAdvance {
            advance,
            released_previous_owner: previous_owner,
            released_previous_owner_transfer_count: released,
        };
        match encode(&response) {
            Ok(json) => Ok(json),
            Err(error) => {
                self.release_local_after_transport_failure(&owner);
                Err(error)
            }
        }
    }

    fn finish_local_continuation_error(
        &mut self,
        previous_owner: RuntimeChapterLocalRevisionHandle,
        error: RuntimeChapterLocalRevisionError,
    ) -> WasmRuntimeError {
        if let Some(failed_owner) = committed_failed_owner(&error, &previous_owner) {
            self.chapter_local_transfers.release_owner(&previous_owner);
            self.release_local_after_transport_failure(&failed_owner);
            return WasmRuntimeError::from_released_chapter_local(error);
        }
        WasmRuntimeError::from_chapter_local(error)
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

fn committed_failed_owner(
    error: &RuntimeChapterLocalRevisionError,
    previous: &RuntimeChapterLocalRevisionHandle,
) -> Option<RuntimeChapterLocalRevisionHandle> {
    let next_version = previous.revision_version.checked_add(1)?;
    let revision = error.revision.as_deref()?;
    (error.kind == RuntimeContinuationErrorKind::EngineFailure
        && revision.status == RuntimeRevisionStatus::Failed
        && revision.revision_id == previous.revision_id
        && revision.revision_version == next_version
        && revision.coordinate == previous.coordinate)
        .then(|| RuntimeChapterLocalRevisionHandle {
            revision_id: revision.revision_id.clone(),
            revision_version: revision.revision_version,
            coordinate: revision.coordinate.clone(),
        })
}

#[cfg(test)]
mod tests {
    use rito_core::runtime::{
        RuntimeContinueChapterLocalRevisionRequest, RuntimeResourceKind, RuntimeRevisionWorkBudget,
    };
    use serde_json::json;

    use crate::{tests::fixture, WasmRuntimeDocument, WasmRuntimeError};

    #[test]
    fn create_encoder_failure_releases_the_new_local_revision() {
        let mut document = WasmRuntimeDocument::from_loaded_document(fixture::fixture_document());
        let request = super::parse_create_request(&request_json(64)).expect("request");
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

    #[test]
    fn continuation_encoder_failure_releases_predecessor_leases_and_candidate() {
        let mut document = WasmRuntimeDocument::from_loaded_document(fixture::fixture_document());
        let request = super::parse_create_request(&request_json(1)).expect("request");
        let initial = document
            .document
            .create_bounded_chapter_local_revision(request)
            .expect("partial local revision");
        let continuation = initial.continuation.expect("fixture remains continuable");
        let previous_owner = continuation.owner.clone();
        let resource = document
            .document
            .get_chapter_local_resource(
                &previous_owner,
                RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("local resource");
        let payload = document
            .chapter_local_transfers
            .store_at(&previous_owner, resource)
            .expect("predecessor lease");
        let advance = document
            .document
            .continue_chapter_local_revision(RuntimeContinueChapterLocalRevisionRequest {
                continuation,
                budget: RuntimeRevisionWorkBudget {
                    max_top_level_nodes: 64,
                },
            })
            .expect("local continuation");
        let candidate_owner = super::owner_from_advance(&advance);
        let injected = WasmRuntimeError::internal_error("injected continue encoder failure");

        let result = document.finish_local_continuation(previous_owner.clone(), advance, |_| {
            Err::<String, _>(injected.clone())
        });

        assert_eq!(result, Err(injected));
        assert!(document
            .chapter_local_transfers
            .read_at(&previous_owner, &payload.transfer_id)
            .is_err());
        assert!(document
            .document
            .get_chapter_local_revision_summary(&candidate_owner)
            .is_err());
        assert_eq!(document.chapter_local_transfers.len(), 0);
    }

    fn request_json(max_top_level_nodes: usize) -> String {
        json!({
            "layoutConfig": fixture::layout(),
            "targetChapterIndex": 0,
            "targetLocator": { "href": "chapter.xhtml" },
            "localPageCap": 4,
            "budget": { "maxTopLevelNodes": max_top_level_nodes }
        })
        .to_string()
    }
}
