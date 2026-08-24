use std::collections::BTreeMap;

use rito_core::runtime::{RuntimeChapterLocalRevisionHandle, RuntimeResource};

use super::wire::WasmChapterLocalResourceTransferPayload;
use crate::WasmRuntimeError;

#[derive(Debug, Default)]
pub(crate) struct WasmChapterLocalTransferStore {
    next_transfer_index: usize,
    transfers: BTreeMap<String, WasmChapterLocalTransfer>,
}

#[derive(Debug)]
struct WasmChapterLocalTransfer {
    owner: RuntimeChapterLocalRevisionHandle,
    bytes: Vec<u8>,
}

impl WasmChapterLocalTransferStore {
    pub(super) fn store_at(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        resource: RuntimeResource,
    ) -> Result<WasmChapterLocalResourceTransferPayload, WasmRuntimeError> {
        if resource.revision_id != owner.revision_id {
            return Err(WasmRuntimeError::internal_error(
                "chapter-local resource does not match its exact owner",
            ));
        }
        self.next_transfer_index = self.next_transfer_index.checked_add(1).ok_or_else(|| {
            WasmRuntimeError::internal_error("chapter-local transfer ID overflow")
        })?;
        let transfer_id = format!("local-transfer-{}", self.next_transfer_index);
        let payload = WasmChapterLocalResourceTransferPayload::from_resource(
            owner.clone(),
            transfer_id.clone(),
            &resource,
        );
        let previous = self.transfers.insert(
            transfer_id,
            WasmChapterLocalTransfer {
                owner: owner.clone(),
                bytes: resource.bytes,
            },
        );
        debug_assert!(previous.is_none(), "chapter-local transfer IDs are unique");
        Ok(payload)
    }

    pub(super) fn read_at(
        &self,
        owner: &RuntimeChapterLocalRevisionHandle,
        transfer_id: &str,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        let transfer = self.require_owner(owner, transfer_id)?;
        Ok(transfer.bytes.clone())
    }

    pub(super) fn take_at(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        transfer_id: &str,
    ) -> Result<Vec<u8>, WasmRuntimeError> {
        self.require_owner(owner, transfer_id)?;
        Ok(self
            .transfers
            .remove(transfer_id)
            .expect("validated chapter-local transfer remains")
            .bytes)
    }

    pub(super) fn release_at(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        transfer_id: &str,
    ) -> Result<bool, WasmRuntimeError> {
        let Some(transfer) = self.transfers.get(transfer_id) else {
            return Ok(false);
        };
        validate_owner(owner, transfer_id, &transfer.owner)?;
        Ok(self.transfers.remove(transfer_id).is_some())
    }

    pub(super) fn release_owner(&mut self, owner: &RuntimeChapterLocalRevisionHandle) -> usize {
        let before = self.transfers.len();
        self.transfers
            .retain(|_, transfer| transfer.owner != *owner);
        before - self.transfers.len()
    }

    pub(super) fn len(&self) -> usize {
        self.transfers.len()
    }

    fn require_owner(
        &self,
        owner: &RuntimeChapterLocalRevisionHandle,
        transfer_id: &str,
    ) -> Result<&WasmChapterLocalTransfer, WasmRuntimeError> {
        let transfer = self.transfers.get(transfer_id).ok_or_else(|| {
            WasmRuntimeError::bad_request(format!(
                "unknown chapter-local resource transfer: {transfer_id}"
            ))
        })?;
        validate_owner(owner, transfer_id, &transfer.owner)?;
        Ok(transfer)
    }
}

fn validate_owner(
    owner: &RuntimeChapterLocalRevisionHandle,
    transfer_id: &str,
    actual: &RuntimeChapterLocalRevisionHandle,
) -> Result<(), WasmRuntimeError> {
    if owner == actual {
        return Ok(());
    }
    Err(WasmRuntimeError::bad_request(format!(
        "chapter-local transfer owner mismatch: {transfer_id}"
    )))
}
