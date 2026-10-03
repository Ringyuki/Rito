//! The session's fonts across the C ABI: the catalog of families a
//! `font-family` list can name (`RITOFNT1`), the names a list would skip
//! (`RITOFNN1`), and host faces added or removed while the session is open.

// `#[no_mangle]` exports only; no raw memory is touched here.
#![allow(unsafe_code)]

use crate::{input, registry};

use super::{
    memory::{invoke, prepare_owned_output, write_buffer},
    RitoOwnedBuffer, RitoPinnedFontFace,
};

/// Writes the session's font catalog as one complete `RITOFNT1` message:
/// every family a `font-family` list can name, host families first.
#[no_mangle]
pub extern "C" fn rito_font_catalog(
    session_id: u64,
    catalog_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(catalog_out, error_out, "catalog_out")?;
        let admission = registry::try_admit(session_id)?;
        write_buffer(catalog_out, registry::font_catalog(admission)?)
    })
}

/// Writes, as one complete `RITOFNN1` message, the names in the UTF-8 CSS
/// `font-family` list that no family in the catalog answers to.
#[no_mangle]
pub extern "C" fn rito_unresolved_font_families(
    session_id: u64,
    list_data: *const u8,
    list_len: u64,
    names_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(names_out, error_out, "names_out")?;
        let list = input::text(list_data, list_len, "font-family list")?;
        let admission = registry::try_admit(session_id)?;
        write_buffer(
            names_out,
            registry::unresolved_font_families(admission, list)?,
        )
    })
}

/// Adds host faces (descriptors as for `rito_open_with_pinned_fonts`; a
/// face may share its role and language with another). Artifacts already
/// published keep their layout; the next request lays out with the new
/// faces nameable.
#[no_mangle]
pub extern "C" fn rito_add_host_font_faces(
    session_id: u64,
    faces: *const RitoPinnedFontFace,
    face_count: u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let faces = input::pinned_font_policy(faces, face_count)?.faces;
        let admission = registry::try_admit(session_id)?;
        registry::add_host_font_faces(admission, faces)
    })
}

/// Removes host faces named by `count` SHA-256 digests, each 64 hex bytes,
/// laid end to end at `sha256_hex`. At least one face must remain.
#[no_mangle]
pub extern "C" fn rito_remove_host_font_faces(
    session_id: u64,
    sha256_hex: *const u8,
    count: u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let sha256s = input::sha256_digests(sha256_hex, count)?;
        let admission = registry::try_admit(session_id)?;
        registry::remove_host_font_faces(admission, sha256s)
    })
}
