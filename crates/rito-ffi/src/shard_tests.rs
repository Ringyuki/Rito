//! A reader opened from shards through the C ABI: the first request that
//! waits on shards keeps the session and names them in a `RITOPSH1`
//! message; once they are supplied the next request draws exactly what an
//! archive-opened reader draws.

use std::{fs, path::Path, sync::atomic::Ordering};

use rito_core::{
    epub::shard::{pack_publication, PackOptions, PackedPublication},
    runtime::{
        decode_reader_artifact, decode_reader_pending_shards, encode_reader_artifact_request,
        ReaderArtifact, ReaderErrorKind,
    },
};

use crate::{
    abi::copy_owned_buffer_for_test, rito_buffer_free, rito_dispose,
    rito_open_shards_with_pinned_fonts, rito_open_with_pinned_fonts, rito_read_publication,
    rito_request_artifact, rito_supply_shard, RitoOwnedBuffer, RitoPinnedFontFace,
    RITO_PINNED_FONT_ROLE_SERIF, RITO_STATUS_INVALID_ARGUMENT, RITO_STATUS_OK,
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

fn request_artifact(session_id: u64, request: &[u8]) -> Called {
    let mut artifact = RitoOwnedBuffer::EMPTY;
    let mut error = RitoOwnedBuffer::EMPTY;
    let status = rito_request_artifact(
        session_id,
        request.as_ptr(),
        request.len() as u64,
        &mut artifact,
        &mut error,
    );
    take(status, artifact, error)
}

fn drawn(mut artifact: ReaderArtifact) -> ReaderArtifact {
    artifact.request_id = 0;
    artifact.artifact_id = 0;
    artifact.revision_id = 0;
    artifact.session_id = 0;
    for page in &mut artifact.pages {
        for hit in &mut page.hits {
            hit.footnote_pending = false;
        }
    }
    artifact
}

#[test]
fn a_sharded_open_keeps_its_session_until_the_shards_arrive() {
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
    assert_eq!(opened.status, RITO_STATUS_RESOURCE_PENDING);
    assert!(opened.output.is_empty());
    let pending = decode_reader_pending_shards(&opened.error).expect("RITOPSH1 decodes");
    assert_eq!(pending.kind, ReaderErrorKind::ResourcePending);
    assert!(!pending.pending_shards.is_empty());

    let mut publication_out = RitoOwnedBuffer::EMPTY;
    let mut error = RitoOwnedBuffer::EMPTY;
    let status = rito_read_publication(session_id, &mut publication_out, &mut error);
    let _ = take(status, publication_out, error);
    assert_eq!(
        status, RITO_STATUS_OK,
        "the session survived its pending open"
    );

    let (status, _, _) = supply(session_id, &[1, 2, 3], &[]);
    assert_eq!(status, RITO_STATUS_INVALID_ARGUMENT);
    let (status, _, _) = supply(session_id, &packed.shards[0].bytes, &[7; 5]);
    assert_eq!(
        status, RITO_STATUS_INVALID_ARGUMENT,
        "a short key is refused"
    );

    let mut request_id = 1;
    let mut pending_shards = pending.pending_shards;
    let artifact = loop {
        for shard_id in &pending_shards {
            let shard = &packed.shards[*shard_id as usize - 1];
            let key = shard.key.as_ref().expect("encrypted").as_bytes().to_vec();
            let (status, supplied, error) = supply(session_id, &shard.bytes, &key);
            assert_eq!(
                status,
                RITO_STATUS_OK,
                "{}",
                String::from_utf8_lossy(&error)
            );
            assert_eq!(supplied, *shard_id);
        }
        request_id += 1;
        let requested = request_artifact(session_id, &request_wire(session_id, request_id));
        match requested.status {
            RITO_STATUS_OK => break decode_reader_artifact(&requested.output).expect("decodes"),
            RITO_STATUS_RESOURCE_PENDING => {
                pending_shards = decode_reader_pending_shards(&requested.error)
                    .expect("RITOPSH1 decodes")
                    .pending_shards;
            }
            status => panic!(
                "request failed with {status}: {}",
                String::from_utf8_lossy(&requested.error)
            ),
        }
    };

    let archive_session = next_session_id();
    let archived = open_archive(&epub, &request_wire(archive_session, 1), &font);
    assert_eq!(archived.status, RITO_STATUS_OK);
    let expected = decode_reader_artifact(&archived.output).expect("decodes");
    assert_eq!(drawn(artifact), drawn(expected));

    let mut error = RitoOwnedBuffer::EMPTY;
    assert_eq!(rito_dispose(session_id, &mut error), RITO_STATUS_OK);
    assert_eq!(rito_dispose(archive_session, &mut error), RITO_STATUS_OK);
}
