use rito_core::runtime::RuntimeRevisionHandle;

use crate::{WasmRuntimeDocument, WasmRuntimeError};

impl WasmRuntimeDocument {
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
