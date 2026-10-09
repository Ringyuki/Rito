//! The session's fonts across the C ABI.

use std::{fs, path::Path};

use rito_core::runtime::{
    decode_reader_font_catalog, decode_reader_font_names, encode_reader_artifact_request,
    RuntimeFontSource,
};

use crate::{
    rito_add_host_font_faces, rito_buffer_free, rito_dispose, rito_font_catalog,
    rito_mark_font_family_unavailable, rito_remove_host_font_faces, rito_unresolved_font_families,
    RitoOwnedBuffer, RitoPinnedFontFace, RITO_PINNED_FONT_ROLE_SANS_SERIF,
    RITO_STATUS_INVALID_ARGUMENT, RITO_STATUS_OK,
};

use super::tests::{call_open, call_owned_wire, next_session_id, publication, request};

fn arimo() -> (Vec<u8>, [u8; 64]) {
    use sha2::{Digest, Sha256};
    let bytes = fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/reader/src/assets/fonts/Arimo-Regular.ttf"),
    )
    .expect("bundled font reads");
    let digest: [u8; 32] = Sha256::digest(&bytes).into();
    let mut hex = [0u8; 64];
    for (index, byte) in digest.iter().enumerate() {
        let table = b"0123456789abcdef";
        hex[index * 2] = table[usize::from(byte >> 4)];
        hex[index * 2 + 1] = table[usize::from(byte & 0x0f)];
    }
    (bytes, hex)
}

fn unresolved(session_id: u64, list: &str) -> Vec<String> {
    let result = call_owned_wire(|out, error| {
        rito_unresolved_font_families(session_id, list.as_ptr(), list.len() as u64, out, error)
    });
    assert_eq!(result.status, RITO_STATUS_OK, "{}", result.error);
    decode_reader_font_names(&result.wire).expect("a RITOFNN1 message")
}

fn status(call: impl FnOnce(&mut RitoOwnedBuffer) -> u32) -> u32 {
    let mut error = RitoOwnedBuffer::EMPTY;
    let status = call(&mut error);
    rito_buffer_free(&mut error);
    status
}

#[test]
fn host_faces_are_listed_added_and_removed_across_the_abi() {
    let session_id = next_session_id();
    let request = encode_reader_artifact_request(&request(session_id)).expect("request encodes");
    let opened = call_open(&publication(), &request);
    assert_eq!(opened.status, RITO_STATUS_OK, "{}", opened.error);

    let catalog = call_owned_wire(|out, error| rito_font_catalog(session_id, out, error));
    assert_eq!(catalog.status, RITO_STATUS_OK, "{}", catalog.error);
    let catalog = decode_reader_font_catalog(&catalog.wire).expect("a RITOFNT1 message");
    assert_eq!(catalog.families[0].name, "Tinos");
    assert_eq!(catalog.families[0].source, RuntimeFontSource::Host);
    let tinos = catalog.families[0].faces[0]
        .sha256
        .clone()
        .expect("a host digest");
    assert_eq!(unresolved(session_id, "Arimo, serif"), ["Arimo"]);

    let (bytes, sha256_hex) = arimo();
    let face = RitoPinnedFontFace {
        bytes_data: bytes.as_ptr(),
        bytes_len: bytes.len() as u64,
        sha256_hex,
        generic_role: RITO_PINNED_FONT_ROLE_SANS_SERIF,
        language_data: std::ptr::null(),
        language_len: 0,
    };
    assert_eq!(
        status(|error| rito_add_host_font_faces(session_id, &face, 1, error)),
        RITO_STATUS_OK
    );
    assert!(unresolved(session_id, "Arimo, serif").is_empty());

    assert_eq!(
        status(|error| rito_remove_host_font_faces(session_id, sha256_hex.as_ptr(), 1, error)),
        RITO_STATUS_OK
    );
    assert_eq!(unresolved(session_id, "Arimo"), ["Arimo"]);

    // The last face cannot go.
    assert_eq!(
        status(|error| rito_remove_host_font_faces(session_id, tinos.as_ptr(), 1, error)),
        RITO_STATUS_INVALID_ARGUMENT
    );

    // A family the host could not load is marked by its UTF-8 name.
    let family = "Book Face";
    assert_eq!(
        status(|error| rito_mark_font_family_unavailable(
            session_id,
            family.as_ptr(),
            family.len() as u64,
            error
        )),
        RITO_STATUS_OK
    );
    assert_eq!(
        status(|error| rito_mark_font_family_unavailable(session_id, std::ptr::null(), 4, error)),
        RITO_STATUS_INVALID_ARGUMENT
    );
    assert_eq!(
        status(|error| rito_dispose(session_id, error)),
        RITO_STATUS_OK
    );
}
