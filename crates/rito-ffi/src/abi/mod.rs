mod memory;

pub(crate) use memory::copy_bytes;
pub use memory::{
    rito_adopt_background_candidate_v1, rito_adopt_foreground_candidate_v1,
    rito_advance_background_v1, rito_buffer_free_v1, rito_dispose_v1, rito_open_v1,
    rito_read_publication_v1, rito_read_resource_v1, rito_release_artifact_v1,
    rito_request_adjacent_v1, rito_request_artifact_v1,
};

#[cfg(test)]
pub(crate) use memory::copy_owned_buffer_for_test;

use std::ptr;

pub const RITO_ABI_VERSION_V1: u32 = 1;
pub const RITO_PUBLICATION_WIRE_BYTES_MAX_V1: u64 =
    rito_core::runtime::READER_PUBLICATION_WIRE_BYTES_MAX_V1;
pub const RITO_RESOURCE_KIND_IMAGE_V1: u32 = 0;
pub const RITO_RESOURCE_KIND_FONT_V1: u32 = 1;
pub const RITO_RESOURCE_KIND_STYLESHEET_V1: u32 = 2;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RitoOwnedBufferV1 {
    pub data: *mut u8,
    pub len: u64,
    pub capacity: u64,
}

impl RitoOwnedBufferV1 {
    pub const EMPTY: Self = Self {
        data: ptr::null_mut(),
        len: 0,
        capacity: 0,
    };
}
