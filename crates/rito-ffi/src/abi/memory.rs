#![allow(unsafe_code)]

use std::{
    mem,
    panic::{self, AssertUnwindSafe},
    ptr, slice,
};

use crate::{
    abi::RitoOwnedBufferV1,
    error::{FfiError, RITO_STATUS_OK_V1},
    input, registry,
};

/// Copies the pinned-font face descriptor array crossing
/// `rito_open_with_pinned_fonts_v1`. Nested byte pointers are copied
/// separately via `copy_bytes` by the caller.
pub(crate) fn copy_face_descriptors(
    faces: *const super::RitoPinnedFontFaceV1,
    face_count: u32,
) -> Result<Vec<super::RitoPinnedFontFaceV1>, FfiError> {
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

fn clear_buffer(target: *mut RitoOwnedBufferV1) -> Result<(), FfiError> {
    if target.is_null() {
        return Err(FfiError::invalid("output buffer pointer is null"));
    }
    // SAFETY: The caller supplies one writable `RitoOwnedBufferV1`.
    unsafe { ptr::write(target, RitoOwnedBufferV1::EMPTY) };
    Ok(())
}

fn write_buffer(target: *mut RitoOwnedBufferV1, mut bytes: Vec<u8>) -> Result<(), FfiError> {
    clear_buffer(target)?;
    if bytes.is_empty() {
        return Ok(());
    }
    let len = u64::try_from(bytes.len())
        .map_err(|_| FfiError::invalid("output buffer length is not representable"))?;
    let capacity = u64::try_from(bytes.capacity())
        .map_err(|_| FfiError::invalid("output buffer capacity is not representable"))?;
    let buffer = RitoOwnedBufferV1 {
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
    target: *mut RitoOwnedBufferV1,
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

fn free_buffer(target: *mut RitoOwnedBufferV1) {
    if target.is_null() {
        return;
    }
    // SAFETY: The caller passes a writable buffer descriptor previously returned
    // by this crate. It is zeroed before reclaiming ownership, making repeats safe.
    let buffer = unsafe { ptr::replace(target, RitoOwnedBufferV1::EMPTY) };
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
/// `RITO_STATUS_EXACT_SEEK_PENDING_V1` means the actor remains registered and a
/// newer RITOREQ1 request for the same target resumes bounded work. A terminal
/// `RITO_STATUS_TARGET_NOT_PUBLISHED_V1` leaves no session.
pub extern "C" fn rito_open_v1(
    publication_data: *const u8,
    publication_len: u64,
    request_data: *const u8,
    request_len: u64,
    artifact_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
/// call returns. Pending/terminal semantics match `rito_open_v1`.
pub extern "C" fn rito_open_with_pinned_fonts_v1(
    publication_data: *const u8,
    publication_len: u64,
    request_data: *const u8,
    request_len: u64,
    faces: *const super::RitoPinnedFontFaceV1,
    face_count: u32,
    artifact_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
pub extern "C" fn rito_read_publication_v1(
    session_id: u64,
    publication_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
pub extern "C" fn rito_request_artifact_v1(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    artifact_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
pub extern "C" fn rito_request_adjacent_v1(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    artifact_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
        // RITONAV1 is a fixed 60-byte message. Validate its identity before
        // reserving actor capacity so a mismatched ABI/session pair is always
        // rejected as malformed instead of leaking registry membership.
        let admission = registry::try_admit(session_id)?;
        let artifact = registry::request_adjacent(admission, request)?;
        write_session_result(session_id, artifact_out, artifact, "adjacent artifact")
    })
}

#[no_mangle]
/// Atomically adopts one prepared foreground candidate as visible.
///
/// The fixed 48-byte RITOFGH1 message is decoded before actor admission. A
/// stale compare-and-swap result is returned to the caller without removing
/// or disposing the session.
pub extern "C" fn rito_adopt_foreground_candidate_v1(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    ack_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
pub extern "C" fn rito_advance_background_v1(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    advance_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
pub extern "C" fn rito_adopt_background_candidate_v1(
    session_id: u64,
    request_data: *const u8,
    request_len: u64,
    ack_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
pub extern "C" fn rito_read_resource_v1(
    session_id: u64,
    artifact_id: u64,
    kind_u32: u32,
    href_data: *const u8,
    href_len: u64,
    resource_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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

#[no_mangle]
pub extern "C" fn rito_release_artifact_v1(
    session_id: u64,
    artifact_id: u64,
    error_out: *mut RitoOwnedBufferV1,
) -> u32 {
    invoke(error_out, || {
        validate_external_id(session_id, "session_id")?;
        validate_external_id(artifact_id, "artifact_id")?;
        let admission = registry::try_admit(session_id)?;
        registry::release_artifact(admission, artifact_id)
    })
}

#[no_mangle]
pub extern "C" fn rito_dispose_v1(session_id: u64, error_out: *mut RitoOwnedBufferV1) -> u32 {
    invoke(error_out, || {
        validate_external_id(session_id, "session_id")?;
        registry::dispose(session_id)
    })
}

#[no_mangle]
pub extern "C" fn rito_buffer_free_v1(buffer: *mut RitoOwnedBufferV1) {
    let _ = panic::catch_unwind(AssertUnwindSafe(|| free_buffer(buffer)));
}

fn prepare_artifact_output(
    artifact_out: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
) -> Result<(), FfiError> {
    prepare_owned_output(artifact_out, error_out, "artifact_out")
}

fn prepare_owned_output(
    output: *mut RitoOwnedBufferV1,
    error_out: *mut RitoOwnedBufferV1,
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
    error_out: *mut RitoOwnedBufferV1,
    operation: impl FnOnce() -> Result<(), FfiError>,
) -> u32 {
    if clear_buffer(error_out).is_err() {
        return crate::error::RITO_STATUS_INVALID_ARGUMENT_V1;
    }
    let result = panic::catch_unwind(AssertUnwindSafe(operation));
    match result {
        Ok(Ok(())) => RITO_STATUS_OK_V1,
        Ok(Err(error)) => return_error(error_out, error),
        Err(_) => return_error(error_out, FfiError::panic()),
    }
}

fn return_error(error_out: *mut RitoOwnedBufferV1, error: FfiError) -> u32 {
    let status = error.status;
    let _ = write_buffer(error_out, error.message.into_bytes());
    status
}

#[cfg(test)]
pub(crate) fn copy_owned_buffer_for_test(buffer: &RitoOwnedBufferV1) -> Vec<u8> {
    if buffer.data.is_null() || buffer.len == 0 {
        return Vec::new();
    }
    let len = usize::try_from(buffer.len).expect("test buffer length is representable");
    // SAFETY: Unit tests only pass live descriptors returned by `write_buffer`.
    unsafe { slice::from_raw_parts(buffer.data, len) }.to_vec()
}
