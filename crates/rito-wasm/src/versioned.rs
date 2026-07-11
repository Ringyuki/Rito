//! Version-gated WASM reads for incrementally published revisions.

mod frame;
mod interaction;
mod resource;
mod revision;

use rito_core::runtime::RuntimeRevisionHandle;

fn revision_handle(revision_id: &str, revision_version: u32) -> RuntimeRevisionHandle {
    RuntimeRevisionHandle::new(revision_id, revision_version)
}
