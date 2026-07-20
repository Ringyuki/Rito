use rito_core::{
    epub::{EpubError, LoadedEpubDocument},
    runtime::{
        RuntimeDocument, RuntimeResourceKind, RuntimeResourceTransferPayload,
        RuntimeResourceTransferStore, RuntimeRevisionHandle,
    },
};

use crate::{
    chapter_local::WasmChapterLocalTransferStore, wire::serialize_json,
    wire_metrics::ViewRevisionWireMeasurement, WasmRuntimeError,
};

pub struct WasmRuntimeDocument {
    pub(crate) document: RuntimeDocument,
    pub(crate) transfers: RuntimeResourceTransferStore,
    pub(crate) chapter_local_transfers: WasmChapterLocalTransferStore,
    pub(crate) view_revision_wire_measurement: ViewRevisionWireMeasurement,
}

impl WasmRuntimeDocument {
    pub fn open(bytes: Vec<u8>) -> Result<Self, WasmRuntimeError> {
        RuntimeDocument::open_owned(bytes)
            .map(Self::from_runtime_document)
            .map_err(WasmRuntimeError::from_engine)
    }

    pub fn from_loaded_document(document: LoadedEpubDocument) -> Self {
        Self::from_runtime_document(RuntimeDocument::from_loaded_document(document))
    }

    pub fn publication_json(&self) -> Result<String, WasmRuntimeError> {
        serialize_json(&self.document.publication_info())
    }

    pub(crate) fn store_resource_transfer(
        &mut self,
        revision_id: &str,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Result<RuntimeResourceTransferPayload, WasmRuntimeError> {
        let summary = self
            .document
            .get_revision_summary(revision_id)
            .map_err(WasmRuntimeError::from_continuation)?;
        let handle = RuntimeRevisionHandle::from(&summary);
        let resource = self
            .document
            .get_resource_at(&handle, kind, href)
            .map_err(WasmRuntimeError::from_revision_access)?;
        self.transfers
            .store_at(&resource.revision, resource.value)
            .map_err(WasmRuntimeError::from_engine)
    }

    pub(crate) fn assert_revision_exists(&self, revision_id: &str) -> Result<(), WasmRuntimeError> {
        if self.document.has_revision(revision_id) {
            Ok(())
        } else {
            Err(WasmRuntimeError::from_engine(EpubError::new(format!(
                "unknown revision: {revision_id}"
            ))))
        }
    }

    pub(crate) fn from_runtime_document(document: RuntimeDocument) -> Self {
        Self {
            document,
            transfers: RuntimeResourceTransferStore::new(),
            chapter_local_transfers: WasmChapterLocalTransferStore::default(),
            view_revision_wire_measurement: ViewRevisionWireMeasurement::default(),
        }
    }
}
