#![allow(unsafe_code)]

use std::{
    mem,
    panic::{self, AssertUnwindSafe},
    ptr, slice,
};

use crate::{
    abi::RitoOwnedBuffer,
    error::{FfiError, RITO_STATUS_OK},
    input, registry,
};

/// Copies the pinned-font face descriptor array crossing
/// `rito_open_with_pinned_fonts`. Nested byte pointers are copied
/// separately via `copy_bytes` by the caller.
pub(crate) fn copy_face_descriptors(
    faces: *const super::RitoPinnedFontFace,
    face_count: u32,
) -> Result<Vec<super::RitoPinnedFontFace>, FfiError> {
    if faces.is_null() {
        return Err(FfiError::invalid("pinned font face array must not be null"));
    }
    // SAFETY: The native caller owns the pointer validity contract for
    // `face_count` face descriptors; the descriptors are copied before use.
    Ok(unsafe { slice::from_raw_parts(faces, face_count as usize) }.to_vec())
}

pub(crate) fn copy_bytes(
    source: *const u8,
    len: u64,
    limit: u64,
    field: &str,
) -> Result<Vec<u8>, FfiError> {
    let len = checked_len(source, len, limit, field)?;
    if len == 0 {
        return Ok(Vec::new());
    }
    // SAFETY: The native caller owns the pointer validity contract for `len`
    // readable bytes. We copy before returning across the ABI boundary.
    Ok(unsafe { slice::from_raw_parts(source, len) }.to_vec())
}

fn checked_len(source: *const u8, len: u64, limit: u64, field: &str) -> Result<usize, FfiError> {
    if len > limit {
        return Err(FfiError::invalid(format!(
            "{field} exceeds the {limit}-byte ABI limit"
        )));
    }
    if len > 0 && source.is_null() {
        return Err(FfiError::invalid(format!("{field} pointer is null")));
    }
    usize::try_from(len)
        .map_err(|_| FfiError::invalid(format!("{field} length is not representable")))
}

fn validate_external_id(value: u64, field: &str) -> Result<(), FfiError> {
    if value == 0 || value > i64::MAX as u64 {
        return Err(FfiError::invalid(format!(
            "{field} must be in 1..=i64::MAX"
        )));
    }
    Ok(())
}

fn clear_buffer(target: *mut RitoOwnedBuffer) -> Result<(), FfiError> {
    if target.is_null() {
        return Err(FfiError::invalid("output buffer pointer is null"));
    }
    // SAFETY: The caller supplies one writable `RitoOwnedBuffer`.
    unsafe { ptr::write(target, RitoOwnedBuffer::EMPTY) };
    Ok(())
}

fn write_buffer(target: *mut RitoOwnedBuffer, mut bytes: Vec<u8>) -> Result<(), FfiError> {
    clear_buffer(target)?;
    if bytes.is_empty() {
        return Ok(());
    }
    let len = u64::try_from(bytes.len())
        .map_err(|_| FfiError::invalid("output buffer length is not representable"))?;
    let capacity = u64::try_from(bytes.capacity())
        .map_err(|_| FfiError::invalid("output buffer capacity is not representable"))?;
    let buffer = RitoOwnedBuffer {
        data: bytes.as_mut_ptr(),
        len,
        capacity,
    };
    mem::forget(bytes);
    // SAFETY: `clear_buffer` established that `target` is writable.
    unsafe { ptr::write(target, buffer) };
    Ok(())
}

fn write_session_result(
    session_id: u64,
    target: *mut RitoOwnedBuffer,
    bytes: Vec<u8>,
    field: &str,
) -> Result<(), FfiError> {
    match write_buffer(target, bytes) {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = format!(
                "reader session terminated after {field} could not cross the ABI: {}",
                error.message
            );
            let _ = registry::dispose(session_id);
            Err(FfiError::session_terminated(message))
        }
    }
}

fn free_buffer(target: *mut RitoOwnedBuffer) {
    if target.is_null() {
        return;
    }
    // SAFETY: The caller passes a writable buffer descriptor previously returned
    // by this crate. It is zeroed before reclaiming ownership, making repeats safe.
    let buffer = unsafe { ptr::replace(target, RitoOwnedBuffer::EMPTY) };
    if buffer.data.is_null() || buffer.capacity == 0 || buffer.len > buffer.capacity {
        return;
    }
    let Ok(len) = usize::try_from(buffer.len) else {
        return;
    };
    let Ok(capacity) = usize::try_from(buffer.capacity) else {
        return;
    };
    // SAFETY: This exact pointer/length/capacity triple originated from `write_buffer`.
    drop(unsafe { Vec::from_raw_parts(buffer.data, len, capacity) });
}

#[no_mangle]
/// Opens a reader and requests its exact initial artifact.
///
/// The target chapter is paginated whole in this call. Every failure,
/// including `RITO_STATUS_TARGET_NOT_PUBLISHED`, leaves no session.
pub extern "C" fn rito_open(
    publication_data: *const u8,
    publication_len: u64,
    request_data: *const u8,
    request_len: u64,
    artifact_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_artifact_output(artifact_out, error_out)?;
        let request = input::request(request_data, request_len)?;
        validate_external_id(request.session_id, "RITOREQ1 session_id")?;
        validate_external_id(request.request_id, "RITOREQ1 request_id")?;
        let session_id = request.session_id;
        let reservation = registry::reserve_open(session_id)?;
        let publication = input::publication(publication_data, publication_len)?;
        let artifact = registry::open(reservation, publication, request, None)?;
        write_session_result(session_id, artifact_out, artifact, "initial artifact")
    })
}

#[no_mangle]
/// Opens a reader with a pinned measurement-font policy and requests its
/// exact initial artifact.
///
/// The policy is what switches on the required-font-face catalog: with it
/// the runtime measures text against real face bytes and every artifact
/// declares the embedded publication faces its layout used, so the host
/// can register them before paint. Face bytes are copied before this
/// call returns. Pending/terminal semantics match `rito_open`.
pub extern "C" fn rito_open_with_pinned_fonts(
    publication_data: *const u8,
    publication_len: u64,
    request_data: *const u8,
    request_len: u64,
    faces: *const super::RitoPinnedFontFace,
    face_count: u32,
    artifact_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_artifact_output(artifact_out, error_out)?;
        let request = input::request(request_data, request_len)?;
        validate_external_id(request.session_id, "RITOREQ1 session_id")?;
        validate_external_id(request.request_id, "RITOREQ1 request_id")?;
        let policy = input::pinned_font_policy(faces, face_count)?;
        let session_id = request.session_id;
        let reservation = registry::reserve_open(session_id)?;
        let publication = input::publication(publication_data, publication_len)?;
        let artifact = registry::open(reservation, publication, request, Some(policy))?;
        write_session_result(session_id, artifact_out, artifact, "initial artifact")
    })
}

#[no_mangle]
pub extern "C" fn rito_read_publication(
    session_id: u64,
    publication_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(publication_out, error_out, "publication_out")?;
        validate_external_id(session_id, "session_id")?;
        let admission = registry::try_admit(session_id)?;
        let publication = registry::read_publication(admission)?;
        write_buffer(publication_out, publication)
    })
}

#[no_mangle]
pub extern "C" fn rito_request_artifact(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    artifact_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_artifact_output(artifact_out, error_out)?;
        validate_external_id(session_id, "session_id")?;
        let admission = registry::try_admit(session_id)?;
        let request = input::request(request_data, request_len)?;
        validate_external_id(request.session_id, "RITOREQ1 session_id")?;
        validate_external_id(request.request_id, "RITOREQ1 request_id")?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITOREQ1 session_id does not match the ABI session_id",
            ));
        }
        let artifact = registry::request_artifact(admission, request)?;
        write_session_result(session_id, artifact_out, artifact, "artifact")
    })
}

#[no_mangle]
pub extern "C" fn rito_request_adjacent(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    artifact_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_artifact_output(artifact_out, error_out)?;
        validate_external_id(session_id, "session_id")?;
        let request = input::adjacent_request(request_data, request_len)?;
        validate_external_id(request.session_id, "RITONAV1 session_id")?;
        validate_external_id(request.request_id, "RITONAV1 request_id")?;
        validate_external_id(request.from_artifact_id, "RITONAV1 from_artifact_id")?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITONAV1 session_id does not match the ABI session_id",
            ));
        }
        // RITONAV1 is a fixed 48-byte message. Validate its identity before
        // reserving actor capacity so a mismatched ABI/session pair is always
        // rejected as malformed instead of leaking registry membership.
        let admission = registry::try_admit(session_id)?;
        let artifact = registry::request_adjacent(admission, request)?;
        write_session_result(session_id, artifact_out, artifact, "adjacent artifact")
    })
}

#[no_mangle]
/// Publishes the adjacent spread as a read-only artifact without any
/// foreground side effect. The visible artifact and all pending
/// navigation stay untouched. A neighbor in another chapter is
/// paginated on demand; the publication's terminal boundary returns
/// `RITO_STATUS_TARGET_NOT_PUBLISHED` (hosts surface this as "not
/// peekable"), never retaining a continuation. The peeked artifact
/// occupies one live slot and must be released by the caller.
pub extern "C" fn rito_peek_adjacent(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    artifact_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_artifact_output(artifact_out, error_out)?;
        validate_external_id(session_id, "session_id")?;
        let request = input::adjacent_request(request_data, request_len)?;
        validate_external_id(request.session_id, "RITONAV1 session_id")?;
        validate_external_id(request.request_id, "RITONAV1 request_id")?;
        validate_external_id(request.from_artifact_id, "RITONAV1 from_artifact_id")?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITONAV1 session_id does not match the ABI session_id",
            ));
        }
        let admission = registry::try_admit(session_id)?;
        let artifact = registry::peek_adjacent(admission, request)?;
        write_session_result(session_id, artifact_out, artifact, "peeked artifact")
    })
}

#[no_mangle]
/// Commits a previously peeked artifact as the visible foreground with a
/// visible-artifact CAS and zero layout work. Only artifacts produced by
/// `rito_peek_adjacent` qualify; a successful commit supersedes any
/// in-flight foreground intent exactly as a fresh navigation would.
pub extern "C" fn rito_commit_peeked_artifact(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    ack_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(ack_out, error_out, "ack_out")?;
        validate_external_id(session_id, "session_id")?;
        let request = input::foreground_handoff(request_data, request_len)?;
        validate_external_id(request.session_id, "RITOFGH1 session_id")?;
        validate_external_id(
            request.candidate_artifact_id,
            "RITOFGH1 candidate_artifact_id",
        )?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITOFGH1 session_id does not match the ABI session_id",
            ));
        }
        let admission = registry::try_admit(session_id)?;
        let ack = registry::commit_peeked_artifact(admission, request)?;
        write_session_result(session_id, ack_out, ack, "peeked commit acknowledgement")
    })
}

#[no_mangle]
/// Atomically adopts one prepared foreground candidate as visible.
///
/// The fixed 48-byte RITOFGH1 message is decoded before actor admission. A
/// stale compare-and-swap result is returned to the caller without removing
/// or disposing the session.
pub extern "C" fn rito_adopt_foreground_candidate(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    ack_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(ack_out, error_out, "ack_out")?;
        validate_external_id(session_id, "session_id")?;
        let request = input::foreground_handoff(request_data, request_len)?;
        validate_external_id(request.session_id, "RITOFGH1 session_id")?;
        validate_external_id(
            request.candidate_artifact_id,
            "RITOFGH1 candidate_artifact_id",
        )?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITOFGH1 session_id does not match the ABI session_id",
            ));
        }
        let admission = registry::try_admit(session_id)?;
        let ack = registry::adopt_foreground_candidate(admission, request)?;
        write_session_result(
            session_id,
            ack_out,
            ack,
            "foreground handoff acknowledgement",
        )
    })
}

#[no_mangle]
pub extern "C" fn rito_advance_background(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    advance_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(advance_out, error_out, "advance_out")?;
        validate_external_id(session_id, "session_id")?;
        let request = input::background_request(request_data, request_len)?;
        validate_external_id(request.session_id, "RITOBGQ1 session_id")?;
        validate_external_id(
            request.expected_visible_artifact_id,
            "RITOBGQ1 expected_visible_artifact_id",
        )?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITOBGQ1 session_id does not match the ABI session_id",
            ));
        }
        let admission = registry::try_admit(session_id)?;
        let advance = registry::advance_background(admission, request)?;
        write_session_result(session_id, advance_out, advance, "background advance")
    })
}

#[no_mangle]
pub extern "C" fn rito_adopt_background_candidate(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    ack_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(ack_out, error_out, "ack_out")?;
        validate_external_id(session_id, "session_id")?;
        let request = input::background_handoff(request_data, request_len)?;
        validate_external_id(request.session_id, "RITOHOF1 session_id")?;
        validate_external_id(
            request.expected_visible_artifact_id,
            "RITOHOF1 expected_visible_artifact_id",
        )?;
        validate_external_id(
            request.candidate_artifact_id,
            "RITOHOF1 candidate_artifact_id",
        )?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITOHOF1 session_id does not match the ABI session_id",
            ));
        }
        let admission = registry::try_admit(session_id)?;
        let ack = registry::adopt_background_candidate(admission, request)?;
        write_session_result(
            session_id,
            ack_out,
            ack,
            "background handoff acknowledgement",
        )
    })
}

#[no_mangle]
pub extern "C" fn rito_read_resource(
    session_id: u64,
    artifact_id: u64,
    kind_u32: u32,
    href_data: *const u8,
    href_len: u64,
    resource_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(resource_out, error_out, "resource_out")?;
        validate_external_id(session_id, "session_id")?;
        validate_external_id(artifact_id, "artifact_id")?;
        let kind = input::resource_kind(kind_u32)?;
        let admission = registry::try_admit(session_id)?;
        let href = input::resource_href(href_data, href_len)?;
        let resource = registry::read_resource(admission, artifact_id, kind, href)?;
        write_buffer(resource_out, resource)
    })
}

/// Searches the revision behind a live artifact and returns a complete
/// RITOSRS1 message. request_data is a RITOSRQ1 message, copied before
/// this call returns. Scope follows the artifact's revision: a
/// chapter-local artifact searches that chapter's laid-out pages, a
/// publication artifact searches the book as far as background
/// pagination has reached.
#[no_mangle]
pub extern "C" fn rito_search(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    response_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(response_out, error_out, "response_out")?;
        validate_external_id(session_id, "session_id")?;
        let request = input::search_request(request_data, request_len)?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITOSRQ1 session_id must match the session",
            ));
        }
        let admission = registry::try_admit(session_id)?;
        let response = registry::search(admission, request)?;
        write_buffer(response_out, response)
    })
}

/// Resolves where a text range sits on one of a live artifact's pages
/// and returns a complete RITOTRG1 message. The rects are in the
/// artifact's display-list space — the same space its hit bounds use —
/// so a host paints them straight onto the surface it drew the page on.
#[no_mangle]
pub extern "C" fn rito_get_text_range_geometry(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    geometry_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(geometry_out, error_out, "geometry_out")?;
        validate_external_id(session_id, "session_id")?;
        let request = input::text_range_request(request_data, request_len)?;
        if request.session_id != session_id {
            return Err(FfiError::invalid(
                "RITOTRQ1 session_id must match the session",
            ));
        }
        let admission = registry::try_admit(session_id)?;
        let geometry = registry::text_range_geometry(admission, request)?;
        write_buffer(geometry_out, geometry)
    })
}

/// Reads a footnote definition an artifact's hits referenced. The key
/// is the hit's `footnote_key` verbatim — it is already canonical, so
/// hosts must not normalize the link href themselves. A definition the
/// publication footnote index has not reached yet returns
/// `RITO_STATUS_TARGET_NOT_PUBLISHED`; the same read succeeds once
/// indexing completes, so hosts can retry rather than fail closed.
#[no_mangle]
pub extern "C" fn rito_read_footnote(
    session_id: u64,
    artifact_id: u64,
    key_data: *const u8,
    key_len: u64,
    footnote_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        prepare_owned_output(footnote_out, error_out, "footnote_out")?;
        validate_external_id(session_id, "session_id")?;
        validate_external_id(artifact_id, "artifact_id")?;
        let admission = registry::try_admit(session_id)?;
        let key = input::footnote_key(key_data, key_len)?;
        let footnote = registry::read_footnote(admission, artifact_id, key)?;
        write_buffer(footnote_out, footnote)
    })
}

#[no_mangle]
pub extern "C" fn rito_release_artifact(
    session_id: u64,
    artifact_id: u64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        validate_external_id(session_id, "session_id")?;
        validate_external_id(artifact_id, "artifact_id")?;
        let admission = registry::try_admit(session_id)?;
        registry::release_artifact(admission, artifact_id)
    })
}

#[no_mangle]
pub extern "C" fn rito_dispose(session_id: u64, error_out: *mut RitoOwnedBuffer) -> u32 {
    invoke(error_out, || {
        validate_external_id(session_id, "session_id")?;
        registry::dispose(session_id)
    })
}

#[no_mangle]
pub extern "C" fn rito_buffer_free(buffer: *mut RitoOwnedBuffer) {
    let _ = panic::catch_unwind(AssertUnwindSafe(|| free_buffer(buffer)));
}

fn prepare_artifact_output(
    artifact_out: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
) -> Result<(), FfiError> {
    prepare_owned_output(artifact_out, error_out, "artifact_out")
}

fn prepare_owned_output(
    output: *mut RitoOwnedBuffer,
    error_out: *mut RitoOwnedBuffer,
    field: &str,
) -> Result<(), FfiError> {
    if output == error_out {
        return Err(FfiError::invalid(format!(
            "{field} and error_out must be different pointers"
        )));
    }
    clear_buffer(output)
}

fn invoke(
    error_out: *mut RitoOwnedBuffer,
    operation: impl FnOnce() -> Result<(), FfiError>,
) -> u32 {
    if clear_buffer(error_out).is_err() {
        return crate::error::RITO_STATUS_INVALID_ARGUMENT;
    }
    let result = panic::catch_unwind(AssertUnwindSafe(operation));
    match result {
        Ok(Ok(())) => RITO_STATUS_OK,
        Ok(Err(error)) => return_error(error_out, error),
        Err(_) => return_error(error_out, FfiError::panic()),
    }
}

fn return_error(error_out: *mut RitoOwnedBuffer, error: FfiError) -> u32 {
    let status = error.status;
    let _ = write_buffer(error_out, error.message.into_bytes());
    status
}

#[cfg(test)]
pub(crate) fn copy_owned_buffer_for_test(buffer: &RitoOwnedBuffer) -> Vec<u8> {
    if buffer.data.is_null() || buffer.len == 0 {
        return Vec::new();
    }
    let len = usize::try_from(buffer.len).expect("test buffer length is representable");
    // SAFETY: Unit tests only pass live descriptors returned by `write_buffer`.
    unsafe { slice::from_raw_parts(buffer.data, len) }.to_vec()
}
