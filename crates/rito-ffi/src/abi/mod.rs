mod memory;

pub(crate) use memory::{copy_bytes, copy_face_descriptors};
pub use memory::{
    rito_adopt_background_candidate_v1, rito_adopt_foreground_candidate_v1,
    rito_advance_background_v1, rito_buffer_free_v1, rito_commit_peeked_artifact_v1,
    rito_dispose_v1, rito_open_v1, rito_open_with_pinned_fonts_v1, rito_peek_adjacent_v1,
    rito_read_footnote_v1, rito_read_publication_v1, rito_read_resource_v1,
    rito_release_artifact_v1,
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
pub const RITO_PINNED_FONT_ROLE_SERIF_V1: u32 = 0;
pub const RITO_PINNED_FONT_ROLE_SANS_SERIF_V1: u32 = 1;
pub const RITO_PINNED_FONT_ROLE_MONOSPACE_V1: u32 = 2;

/// One pinned measurement-fallback face crossing the open ABI.
///
/// `sha256_hex` carries the face digest as 64 lowercase hexadecimal
/// bytes. `language_data`/`language_len` are optional (null/0 for the
/// `und` default) and name an ASCII BCP47-style tag. Bytes are copied
/// before `rito_open_with_pinned_fonts_v1` returns; the caller keeps
/// ownership of every pointer.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RitoPinnedFontFaceV1 {
    pub bytes_data: *const u8,
    pub bytes_len: u64,
    pub sha256_hex: [u8; 64],
    pub generic_role: u32,
    pub language_data: *const u8,
    pub language_len: u64,
}

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
