use rito_core::runtime::{RuntimeRevisionHandle, RuntimeViewRevisionMetadata};

use super::{frame_selection, WasmRevisionBundleResponse, WasmViewRevisionResponse};
use crate::{wire::parse_view_revision_request, WasmRuntimeDocument, WasmRuntimeError};

impl WasmRuntimeDocument {
    pub(crate) fn finish_view_revision_transport<T, Encode>(
        &mut self,
        request_json: &str,
        metadata: RuntimeViewRevisionMetadata,
        encode: Encode,
    ) -> Result<T, WasmRuntimeError>
    where
        Encode: FnOnce(&WasmViewRevisionResponse) -> Result<T, WasmRuntimeError>,
    {
        let request = parse_view_revision_request(request_json)?;
        let previous_revision_id = request.previous_revision_id.clone();
        let view = self
            .document
            .create_view_revision_bundle_with_metadata(request, metadata)
            .map_err(WasmRuntimeError::from_engine)?;
        let revision = RuntimeRevisionHandle::from(&view.revision.bundle.revision);
        self.finish_created_revision_transport(
            revision,
            previous_revision_id.as_deref(),
            move |document, revision, released_previous_revision_transfer_count| {
                let initial_frame_window = document.initial_frame_window(
                    revision,
                    view.revision.initial_frame.as_ref(),
                    released_previous_revision_transfer_count,
                )?;
                encode(&WasmViewRevisionResponse {
                    kind: view.kind,
                    display: view.display,
                    follow_up: view.follow_up,
                    result: WasmRevisionBundleResponse {
                        bundle: view.revision.bundle,
                        frame_selection: view.revision.initial_frame.as_ref().map(frame_selection),
                        initial_frame_window,
                        preview: view.revision.preview,
                        released_previous_revision_transfer_count,
                    },
                })
            },
        )
    }

    pub(crate) fn finish_created_revision_transport<T, Finish>(
        &mut self,
        revision: RuntimeRevisionHandle,
        previous_revision_id: Option<&str>,
        finish: Finish,
    ) -> Result<T, WasmRuntimeError>
    where
        Finish: FnOnce(&mut Self, &RuntimeRevisionHandle, usize) -> Result<T, WasmRuntimeError>,
    {
        let previous_revision_id = previous_revision_id
            .filter(|revision_id| *revision_id != revision.revision_id.as_str());
        let released_previous_revision_transfer_count = previous_revision_id
            .map(|revision_id| self.transfers.revision_transfer_count(revision_id))
            .unwrap_or(0);
        match finish(self, &revision, released_previous_revision_transfer_count) {
            Ok(output) => {
                if let Some(previous_revision_id) = previous_revision_id {
                    let released = self.transfers.release_revision(previous_revision_id);
                    debug_assert_eq!(
                        released, released_previous_revision_transfer_count,
                        "previous revision transfers must remain owned until commit"
                    );
                }
                Ok(output)
            }
            Err(error) => {
                self.transfers.release_revision(&revision.revision_id);
                let released = self.document.release_revision(&revision.revision_id);
                debug_assert!(
                    released,
                    "created revision must remain owned until transport rollback"
                );
                Err(error)
            }
        }
    }
}
