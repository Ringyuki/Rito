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

    use crate::{tests::fixture, WasmRuntimeError};

    #[test]
    fn create_encoder_failure_releases_the_new_local_revision() {
        let mut document = fixture::pinned_fixture_wasm_document();
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
    fn continue_on_a_one_pass_revision_fails_typed_and_preserves_leases() {
        // One-pass revisions never yield a continuation; a replayed
        // cursor fails through the non-committed error path, which must
        // leave the predecessor revision and its leases untouched.
        let mut document = fixture::pinned_fixture_wasm_document();
        let request = super::parse_create_request(&request_json(1)).expect("request");
        let initial = document
            .document
            .create_bounded_chapter_local_revision(request)
            .expect("one-pass local revision");
        assert!(initial.continuation.is_none(), "advances are complete");
        let previous_owner = super::owner_from_advance(&initial);
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

        let error = document
            .document
            .continue_chapter_local_revision(RuntimeContinueChapterLocalRevisionRequest {
                continuation: rito_core::runtime::RuntimeChapterLocalRevisionCursor {
                    owner: previous_owner.clone(),
                    cursor: "windowed-era-cursor".to_owned(),
                    target_locator: rito_core::runtime::RuntimeSourceLocator {
                        href: "chapter.xhtml".to_owned(),
                        anchor_id: None,
                        source_point: None,
                        source_range: None,
                        progression: None,
                    },
                },
                budget: RuntimeRevisionWorkBudget {
                    max_top_level_nodes: 64,
                },
                max_quanta: None,
            })
            .expect_err("one-pass revisions are not continuable");
        let error = document.finish_local_continuation_error(previous_owner.clone(), error);
        assert_eq!(error.code(), crate::WasmRuntimeErrorCode::BadRequest);
        assert!(document
            .chapter_local_transfers
            .read_at(&previous_owner, &payload.transfer_id)
            .is_ok());
        assert!(document
            .document
            .get_chapter_local_revision_summary(&previous_owner)
            .is_ok());
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
