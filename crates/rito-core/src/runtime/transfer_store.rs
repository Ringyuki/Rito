use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{RuntimeResource, RuntimeResourceKind, RuntimeRevisionHandle};
use crate::epub::{EpubError, EpubResult};

#[derive(Debug)]
pub struct RuntimeResourceTransferStore {
    next_transfer_index: usize,
    transfers: BTreeMap<String, RuntimeResourceTransfer>,
}

impl Default for RuntimeResourceTransferStore {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeResourceTransferStore {
    pub fn new() -> Self {
        Self {
            next_transfer_index: 1,
            transfers: BTreeMap::new(),
        }
    }

    pub fn store(&mut self, resource: RuntimeResource) -> RuntimeResourceTransferPayload {
        let revision = RuntimeRevisionHandle::new(&resource.revision_id, 0);
        self.store_matching(&revision, resource)
    }

    pub fn store_at(
        &mut self,
        revision: &RuntimeRevisionHandle,
        resource: RuntimeResource,
    ) -> EpubResult<RuntimeResourceTransferPayload> {
        if revision.revision_id != resource.revision_id {
            return Err(EpubError::new(format!(
                "resource transfer owner {} does not match resource revision {}",
                revision.revision_id, resource.revision_id
            )));
        }
        Ok(self.store_matching(revision, resource))
    }

    fn store_matching(
        &mut self,
        revision: &RuntimeRevisionHandle,
        resource: RuntimeResource,
    ) -> RuntimeResourceTransferPayload {
        let transfer_id = self.create_transfer_id();
        let payload = RuntimeResourceTransferPayload::from_resource(
            &transfer_id,
            &revision.revision_id,
            &resource,
        );
        self.transfers.insert(
            transfer_id,
            RuntimeResourceTransfer {
                revision: revision.clone(),
                bytes: resource.bytes,
            },
        );
        payload
    }

    pub fn read(&self, transfer_id: &str) -> EpubResult<&[u8]> {
        self.transfers
            .get(transfer_id)
            .map(|transfer| transfer.bytes.as_slice())
            .ok_or_else(|| EpubError::new(format!("unknown resource transfer: {transfer_id}")))
    }

    pub fn take(&mut self, transfer_id: &str) -> EpubResult<Vec<u8>> {
        self.transfers
            .remove(transfer_id)
            .map(|transfer| transfer.bytes)
            .ok_or_else(|| EpubError::new(format!("unknown resource transfer: {transfer_id}")))
    }

    pub fn release(&mut self, transfer_id: &str) -> bool {
        self.transfers.remove(transfer_id).is_some()
    }

    pub fn release_revision(&mut self, revision_id: &str) -> usize {
        let before = self.transfers.len();
        self.transfers
            .retain(|_, transfer| transfer.revision.revision_id != revision_id);
        before - self.transfers.len()
    }

    pub fn release_revision_at(&mut self, revision: &RuntimeRevisionHandle) -> usize {
        let before = self.transfers.len();
        self.transfers
            .retain(|_, transfer| transfer.revision != *revision);
        before - self.transfers.len()
    }

    pub fn revision_transfer_count(&self, revision_id: &str) -> usize {
        self.transfers
            .values()
            .filter(|transfer| transfer.revision.revision_id == revision_id)
            .count()
    }

    pub fn len(&self) -> usize {
        self.transfers.len()
    }

    pub fn is_empty(&self) -> bool {
        self.transfers.is_empty()
    }

    fn create_transfer_id(&mut self) -> String {
        let transfer_id = format!("transfer-{}", self.next_transfer_index);
        self.next_transfer_index += 1;
        transfer_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResourceTransferPayload {
    pub revision_id: String,
    pub transfer_id: String,
    pub kind: RuntimeResourceKind,
    pub href: String,
    pub media_type: String,
    pub byte_length: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

impl RuntimeResourceTransferPayload {
    fn from_resource(transfer_id: &str, revision_id: &str, resource: &RuntimeResource) -> Self {
        Self {
            revision_id: revision_id.to_owned(),
            transfer_id: transfer_id.to_owned(),
            kind: resource.kind,
            href: resource.href.clone(),
            media_type: resource.media_type.clone(),
            byte_length: resource.byte_length(),
            width: resource.width,
            height: resource.height,
        }
    }
}

#[derive(Debug)]
struct RuntimeResourceTransfer {
    revision: RuntimeRevisionHandle,
    bytes: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::RuntimeResourceTransferStore;
    use crate::runtime::{RuntimeResource, RuntimeResourceKind, RuntimeRevisionHandle};

    #[test]
    fn creates_independent_transfer_leases_for_reused_resources() {
        let mut store = RuntimeResourceTransferStore::new();

        let first = store.store(resource("rev-1", b"image-bytes"));
        let second = store.store(resource("rev-1", b"image-bytes"));

        assert_ne!(first.transfer_id, second.transfer_id);
        assert_eq!(first.byte_length, 11);
        assert_eq!(store.len(), 2);
        assert!(store.release(&first.transfer_id));
        assert!(store.read(&first.transfer_id).is_err());
        assert_eq!(
            store.read(&second.transfer_id).expect("second remains"),
            b"image-bytes"
        );
    }

    #[test]
    fn default_uses_the_same_transfer_id_sequence_as_new() {
        let mut store = RuntimeResourceTransferStore::default();

        let first = store.store(resource("rev-1", b"image-bytes"));

        assert_eq!(first.transfer_id, "transfer-1");
    }

    #[test]
    fn takes_bytes_and_consumes_only_the_selected_transfer() {
        let mut store = RuntimeResourceTransferStore::new();
        let first = store.store(resource("rev-1", b"first"));
        let second = store.store(resource("rev-1", b"second"));

        assert_eq!(
            store.take(&first.transfer_id).expect("first is taken"),
            b"first"
        );

        assert_eq!(store.len(), 1);
        assert!(store.read(&first.transfer_id).is_err());
        assert!(store.take(&first.transfer_id).is_err());
        assert!(!store.release(&first.transfer_id));
        assert_eq!(
            store.read(&second.transfer_id).expect("second remains"),
            b"second"
        );
        assert_eq!(store.release_revision("rev-1"), 1);
        assert!(store.is_empty());
    }

    #[test]
    fn releases_transfers_by_revision() {
        let mut store = RuntimeResourceTransferStore::new();
        let rev1 = store.store(resource("rev-1", b"one"));
        let rev2 = store.store(resource("rev-2", b"two"));

        assert_eq!(store.revision_transfer_count("rev-1"), 1);
        assert_eq!(store.revision_transfer_count("rev-2"), 1);
        assert_eq!(store.revision_transfer_count("rev-missing"), 0);
        assert_eq!(store.release_revision("rev-1"), 1);

        assert!(store.read(&rev1.transfer_id).is_err());
        assert_eq!(store.read(&rev2.transfer_id).expect("rev2 remains"), b"two");
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn releases_only_the_exact_revision_version() {
        let mut store = RuntimeResourceTransferStore::new();
        let version_zero = RuntimeRevisionHandle::new("rev-1", 0);
        let version_one = RuntimeRevisionHandle::new("rev-1", 1);
        let legacy = store.store(resource("rev-1", b"legacy"));
        let current = store
            .store_at(&version_one, resource("rev-1", b"current"))
            .expect("matching owner");

        assert_eq!(store.release_revision_at(&version_zero), 1);
        assert!(store.read(&legacy.transfer_id).is_err());
        assert_eq!(
            store
                .read(&current.transfer_id)
                .expect("version one remains"),
            b"current"
        );

        assert_eq!(store.release_revision_at(&version_zero), 0);
        assert_eq!(store.release_revision_at(&version_one), 1);
        assert!(store.is_empty());
    }

    #[test]
    fn legacy_revision_release_covers_all_versions() {
        let mut store = RuntimeResourceTransferStore::new();
        let version_zero = RuntimeRevisionHandle::new("rev-1", 0);
        let version_one = RuntimeRevisionHandle::new("rev-1", 1);
        store
            .store_at(&version_zero, resource("rev-1", b"old"))
            .expect("matching version zero owner");
        store
            .store_at(&version_one, resource("rev-1", b"new"))
            .expect("matching version one owner");

        assert_eq!(store.release_revision("rev-1"), 2);
        assert!(store.is_empty());
    }

    #[test]
    fn rejects_a_resource_owned_by_another_revision() {
        let mut store = RuntimeResourceTransferStore::new();
        let owner = RuntimeRevisionHandle::new("rev-2", 1);

        let error = store
            .store_at(&owner, resource("rev-1", b"wrong-owner"))
            .expect_err("mismatched owner is rejected in every build");

        assert_eq!(
            error.to_string(),
            "resource transfer owner rev-2 does not match resource revision rev-1"
        );
        assert!(store.is_empty());
    }

    fn resource(revision_id: &str, bytes: &[u8]) -> RuntimeResource {
        RuntimeResource {
            revision_id: revision_id.to_owned(),
            kind: RuntimeResourceKind::Image,
            href: "Images/cover.png".to_owned(),
            media_type: "image/png".to_owned(),
            bytes: bytes.to_vec(),
            width: Some(2),
            height: Some(3),
        }
    }
}
