mod memory;

pub(crate) use memory::{copy_bytes, copy_face_descriptors};
pub use memory::{
    rito_adopt_background_candidate, rito_adopt_foreground_candidate, rito_advance_background,
    rito_buffer_free, rito_commit_peeked_artifact, rito_dispose, rito_get_text_range_geometry,
    rito_open, rito_open_with_pinned_fonts, rito_peek_adjacent, rito_read_footnote,
    rito_read_publication, rito_read_resource, rito_release_artifact, rito_request_adjacent,
    rito_request_artifact, rito_search,
};

#[cfg(test)]
pub(crate) use memory::copy_owned_buffer_for_test;

use std::ptr;

pub const RITO_ABI_VERSION: u32 = 1;
pub const RITO_PUBLICATION_WIRE_BYTES_MAX: u64 =
    rito_core::runtime::READER_PUBLICATION_WIRE_BYTES_MAX;
pub const RITO_RESOURCE_KIND_IMAGE: u32 = 0;
pub const RITO_RESOURCE_KIND_FONT: u32 = 1;
pub const RITO_RESOURCE_KIND_STYLESHEET: u32 = 2;
pub const RITO_PINNED_FONT_ROLE_SERIF: u32 = 0;
pub const RITO_PINNED_FONT_ROLE_SANS_SERIF: u32 = 1;
pub const RITO_PINNED_FONT_ROLE_MONOSPACE: u32 = 2;

/// One pinned measurement-fallback face crossing the open ABI.
///
/// `sha256_hex` carries the face digest as 64 lowercase hexadecimal
/// bytes. `language_data`/`language_len` are optional (null/0 for the
/// `und` default) and name an ASCII BCP47-style tag. Bytes are copied
/// before `rito_open_with_pinned_fonts` returns; the caller keeps
/// ownership of every pointer.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RitoPinnedFontFace {
    pub bytes_data: *const u8,
    pub bytes_len: u64,
    pub sha256_hex: [u8; 64],
    pub generic_role: u32,
    pub language_data: *const u8,
    pub language_len: u64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RitoOwnedBuffer {
    pub data: *mut u8,
    pub len: u64,
    pub capacity: u64,
}

impl RitoOwnedBuffer {
    pub const EMPTY: Self = Self {
        data: ptr::null_mut(),
        len: 0,
        capacity: 0,
    };
}
