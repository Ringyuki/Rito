//! A reader opened from shards through the C ABI lays out from its
//! skeleton alone and draws exactly what an archive-opened reader draws; a
//! resource read that needs an image shard names it in a `RITOPSH1`
//! message, and once it is supplied the same read returns the archive's
//! bytes.

use std::{fs, path::Path, sync::atomic::Ordering};

use rito_core::{
    epub::shard::{pack_publication, PackOptions, PackedPublication},
    runtime::{
        decode_reader_artifact, decode_reader_pending_shards, decode_reader_resource,
        encode_reader_artifact_request, ReaderArtifact, ReaderErrorKind, ReaderResourceKind,
    },
};

use crate::{
    abi::copy_owned_buffer_for_test, rito_buffer_free, rito_dispose,
    rito_open_shards_with_pinned_fonts, rito_open_with_pinned_fonts, rito_read_resource,
    rito_supply_shard, RitoOwnedBuffer, RitoPinnedFontFace, RITO_PINNED_FONT_ROLE_SERIF,
    RITO_RESOURCE_KIND_IMAGE, RITO_STATUS_INVALID_ARGUMENT, RITO_STATUS_OK,
    RITO_STATUS_RESOURCE_PENDING,
};

static NEXT_SESSION_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(90_000);

fn next_session_id() -> u64 {
    NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
}

fn publication() -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/rito/tests/fixtures/books/book-10.epub"),
    )
    .expect("book-10 fixture is readable")
}

fn pinned_font() -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"),
    )
    .expect("pinned face is readable")
}

fn face(bytes: &[u8]) -> RitoPinnedFontFace {
    use sha2::{Digest, Sha256};
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    let mut sha256_hex = [0u8; 64];
    for (index, byte) in digest.iter().enumerate() {
        let table = b"0123456789abcdef";
        sha256_hex[index * 2] = table[usize::from(byte >> 4)];
        sha256_hex[index * 2 + 1] = table[usize::from(byte & 0x0f)];
    }
    RitoPinnedFontFace {
        bytes_data: bytes.as_ptr(),
        bytes_len: bytes.len() as u64,
        sha256_hex,
        generic_role: RITO_PINNED_FONT_ROLE_SERIF,
        language_data: std::ptr::null(),
        language_len: 0,
    }
}

fn request_wire(session_id: u64, request_id: u64) -> Vec<u8> {
    let mut request = crate::tests::request(session_id);
    request.request_id = request_id;
    encode_reader_artifact_request(&request).expect("request encodes")
}

struct Called {
    status: u32,
    output: Vec<u8>,
    error: Vec<u8>,
}

fn take(status: u32, mut output: RitoOwnedBuffer, mut error: RitoOwnedBuffer) -> Called {
    let called = Called {
        status,
        output: copy_owned_buffer_for_test(&output),
        error: copy_owned_buffer_for_test(&error),
    };
    rito_buffer_free(&mut output);
    rito_buffer_free(&mut error);
    called
}

fn open_shards(packed: &PackedPublication, request: &[u8], font: &[u8]) -> Called {
    let key = packed
        .skeleton
        .key
        .as_ref()
        .map(|key| key.as_bytes().to_vec())
        .unwrap_or_default();
    let face = face(font);
    let mut artifact = RitoOwnedBuffer::EMPTY;
    let mut error = RitoOwnedBuffer::EMPTY;
    let status = rito_open_shards_with_pinned_fonts(
        packed.skeleton.bytes.as_ptr(),
        packed.skeleton.bytes.len() as u64,
        key.as_ptr(),
        key.len() as u64,
        request.as_ptr(),
        request.len() as u64,
        &face,
        1,
        &mut artifact,
        &mut error,
    );
    take(status, artifact, error)
}

fn open_archive(epub: &[u8], request: &[u8], font: &[u8]) -> Called {
    let face = face(font);
    let mut artifact = RitoOwnedBuffer::EMPTY;
    let mut error = RitoOwnedBuffer::EMPTY;
    let status = rito_open_with_pinned_fonts(
        epub.as_ptr(),
        epub.len() as u64,
        request.as_ptr(),
        request.len() as u64,
        &face,
        1,
        &mut artifact,
        &mut error,
    );
    take(status, artifact, error)
}

fn supply(session_id: u64, bytes: &[u8], key: &[u8]) -> (u32, u32, Vec<u8>) {
    let mut shard_id = u32::MAX;
    let mut error = RitoOwnedBuffer::EMPTY;
    let status = rito_supply_shard(
        session_id,
        bytes.as_ptr(),
        bytes.len() as u64,
        key.as_ptr(),
        key.len() as u64,
        &mut shard_id,
        &mut error,
    );
    let called = take(status, RitoOwnedBuffer::EMPTY, error);
    (status, shard_id, called.error)
}

fn read_image(session_id: u64, artifact_id: u64, href: &str) -> Called {
    let mut resource = RitoOwnedBuffer::EMPTY;
    let mut error = RitoOwnedBuffer::EMPTY;
    let status = rito_read_resource(
        session_id,
        artifact_id,
        RITO_RESOURCE_KIND_IMAGE,
        href.as_ptr(),
        href.len() as u64,
        &mut resource,
        &mut error,
    );
    take(status, resource, error)
}

fn drawn(mut artifact: ReaderArtifact) -> ReaderArtifact {
    artifact.request_id = 0;
    artifact.artifact_id = 0;
    artifact.revision_id = 0;
    artifact.session_id = 0;
    artifact
}

#[test]
fn a_sharded_reader_lays_out_from_its_skeleton_and_reads_images_as_they_arrive() {
    let font = pinned_font();
    let epub = publication();
    let mut counter = 1u8;
    let mut random = |buffer: &mut [u8]| {
        for byte in buffer {
            counter = counter.wrapping_mul(37).wrapping_add(5);
            *byte = counter;
        }
    };
    let packed =
        pack_publication(&epub, PackOptions { encrypt: true }, &mut random).expect("packs");
    let session_id = next_session_id();
    let opened = open_shards(&packed, &request_wire(session_id, 1), &font);
    assert_eq!(
        opened.status,
        RITO_STATUS_OK,
        "{}",
        String::from_utf8_lossy(&opened.error)
    );
    let artifact = decode_reader_artifact(&opened.output).expect("decodes");

    let archive_session = next_session_id();
    let archived = open_archive(&epub, &request_wire(archive_session, 1), &font);
    assert_eq!(archived.status, RITO_STATUS_OK);
    let expected = decode_reader_artifact(&archived.output).expect("decodes");
    assert_eq!(drawn(artifact.clone()), drawn(expected.clone()));

    let href = artifact
        .resources
        .iter()
        .find(|resource| resource.kind == ReaderResourceKind::Image)
        .expect("the chapter draws an image")
        .href
        .clone();
    let waiting = read_image(session_id, artifact.artifact_id, &href);
    assert_eq!(waiting.status, RITO_STATUS_RESOURCE_PENDING);
    let pending = decode_reader_pending_shards(&waiting.error).expect("RITOPSH1 decodes");
    assert_eq!(pending.kind, ReaderErrorKind::ResourcePending);
    assert_eq!(pending.pending_shards.len(), 1);

    let (status, _, _) = supply(session_id, &[1, 2, 3], &[]);
    assert_eq!(status, RITO_STATUS_INVALID_ARGUMENT);
    let shard_id = pending.pending_shards[0];
    let shard = &packed.shards[shard_id as usize - 1];
    let (status, _, _) = supply(session_id, &shard.bytes, &[7; 5]);
    assert_eq!(
        status, RITO_STATUS_INVALID_ARGUMENT,
        "a short key is refused"
    );
    let key = shard.key.as_ref().expect("encrypted").as_bytes().to_vec();
    let (status, supplied, error) = supply(session_id, &shard.bytes, &key);
    assert_eq!(
        status,
        RITO_STATUS_OK,
        "{}",
        String::from_utf8_lossy(&error)
    );
    assert_eq!(supplied, shard_id);

    let read = read_image(session_id, artifact.artifact_id, &href);
    assert_eq!(read.status, RITO_STATUS_OK);
    let expected_read = read_image(archive_session, expected.artifact_id, &href);
    assert_eq!(
        decode_reader_resource(&read.output).expect("decodes").bytes,
        decode_reader_resource(&expected_read.output)
            .expect("decodes")
            .bytes
    );

    let mut error = RitoOwnedBuffer::EMPTY;
    assert_eq!(rito_dispose(session_id, &mut error), RITO_STATUS_OK);
    assert_eq!(rito_dispose(archive_session, &mut error), RITO_STATUS_OK);
}
