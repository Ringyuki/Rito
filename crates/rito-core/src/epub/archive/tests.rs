use std::io::{Cursor, Write};

use zip::{write::FileOptions, ZipWriter};

use super::{
    preflight::{
        self, validate_entry_limits, MAX_ARCHIVE_ENTRIES, MAX_COMPRESSION_RATIO,
        MAX_ENTRY_UNCOMPRESSED_BYTES,
    },
    EpubArchive,
};

#[test]
fn falls_back_to_percent_decoded_entry_names() {
    let bytes = fixture_zip(&[
        ("Text/Chapter One.xhtml", b"decoded"),
        ("Text/\u{4e2d}.xhtml", b"unicode"),
    ]);
    let mut archive = EpubArchive::new(&bytes).expect("archive opens");

    assert_eq!(
        archive
            .read_bytes("Text/Chapter%20One.xhtml")
            .expect("encoded href resolves"),
        b"decoded"
    );
    assert_eq!(
        archive
            .read_text("Text/%E4%B8%AD.xhtml")
            .expect("encoded Unicode href resolves"),
        "unicode"
    );
    assert_eq!(
        archive
            .entry_size("Text/Chapter%20One.xhtml")
            .expect("encoded href size resolves"),
        b"decoded".len()
    );
}

#[test]
fn prefers_exact_entry_names_before_percent_decoding() {
    let bytes = fixture_zip(&[
        ("Text/Chapter%20One.xhtml", b"literal-long"),
        ("Text/Chapter One.xhtml", b"x"),
        ("Text/malformed%2.xhtml", b"malformed-literal"),
    ]);
    let mut archive = EpubArchive::new(&bytes).expect("archive opens");

    assert_eq!(
        archive
            .read_text("Text/Chapter%20One.xhtml")
            .expect("literal href resolves first"),
        "literal-long"
    );
    assert_eq!(
        archive
            .entry_size("Text/Chapter%20One.xhtml")
            .expect("literal size resolves first"),
        b"literal-long".len()
    );
    assert_eq!(
        archive
            .read_text("Text/malformed%2.xhtml")
            .expect("malformed literal entry still resolves exactly"),
        "malformed-literal"
    );
}

#[test]
fn exposes_only_safe_canonical_file_metadata() {
    let bytes = fixture_zip(&[
        ("OPS/Images/cover.png", b"cover"),
        ("OPS/Images/old/../hidden.png", b"hidden"),
        ("../unsafe.png", b"unsafe"),
    ]);
    let mut archive = EpubArchive::new(&bytes).expect("archive opens");

    let entries = archive.file_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "OPS/Images/cover.png");
    assert_eq!(entries[0].byte_length, b"cover".len());
}

#[test]
fn percent_encoded_lookups_return_the_physical_entry_identity() {
    let bytes = fixture_zip(&[("Images/Cover One.png", b"cover")]);
    let mut archive = EpubArchive::new(&bytes).expect("archive opens");

    let entries = archive.file_entries();
    let selected = archive
        .entry_metadata("Images/Cover%20One.png")
        .expect("selected metadata exists");
    assert_eq!(entries.as_slice(), std::slice::from_ref(&selected));
    assert_eq!(selected.path, "Images/Cover One.png");
    assert_eq!(
        archive
            .read_entry_bytes(&selected)
            .expect("selected entry reads"),
        b"cover"
    );
}

#[test]
fn rejects_malformed_percent_escapes_after_exact_miss() {
    let bytes = fixture_zip(&[("Text/chapter.xhtml", b"chapter")]);
    for path in [
        "Text/missing%2.xhtml",
        "Text/missing%GG.xhtml",
        "Text/missing%FF.xhtml",
        "Text/missing%E4%B8.xhtml",
    ] {
        let mut archive = EpubArchive::new(&bytes).expect("archive opens");
        let error = archive
            .read_bytes(path)
            .expect_err("malformed escape must fail");
        assert!(error.message().contains("Invalid percent escape"));
    }
}

#[test]
fn normalizes_only_percent_decoded_dot_segments() {
    let bytes = fixture_zip(&[
        ("OPS/Chapter.xhtml", b"encoded-dot"),
        ("b.xhtml", b"plain-dot"),
    ]);
    let mut archive = EpubArchive::new(&bytes).expect("archive opens");

    assert_eq!(
        archive
            .read_text("OPS/Text/%2E%2E/Chapter.xhtml")
            .expect("encoded dot segment resolves"),
        "encoded-dot"
    );
    let error = archive
        .read_text("a/../b.xhtml")
        .expect_err("plain missing path must not gain a normalization fallback");
    assert!(error.message().contains("Failed to read EPUB entry"));
}

#[test]
fn rejects_entries_over_the_uncompressed_byte_limit_before_reading() {
    let error = validate_entry_limits(MAX_ENTRY_UNCOMPRESSED_BYTES + 1, 1, "huge.xhtml")
        .expect_err("oversized entry must fail");

    assert!(error.message().contains("uncompressed byte length"));
}

#[test]
fn rejects_entries_over_the_compression_ratio_limit_before_reading() {
    validate_entry_limits(MAX_COMPRESSION_RATIO, 1, "allowed.xhtml")
        .expect("boundary ratio remains valid");
    let error = validate_entry_limits(MAX_COMPRESSION_RATIO + 1, 1, "bomb.xhtml")
        .expect_err("compression bomb must fail");

    assert!(error.message().contains("compression ratio"));
}

#[test]
fn rejects_raw_central_directory_count_before_building_the_zip_index() {
    let mut bytes = vec![0_u8; 22];
    bytes[0..4].copy_from_slice(&0x0605_4b50_u32.to_le_bytes());
    let oversized = u16::try_from(MAX_ARCHIVE_ENTRIES + 1).expect("test count fits ZIP32");
    bytes[8..10].copy_from_slice(&oversized.to_le_bytes());
    bytes[10..12].copy_from_slice(&oversized.to_le_bytes());

    let error = preflight::validate(&bytes).expect_err("raw oversized count must fail first");
    assert!(error.message().contains("entry count"));
}

#[test]
fn rejects_duplicate_raw_entry_paths_before_zip_index_deduplication() {
    // `ZipWriter` itself rejects duplicate names, so write a same-length
    // placeholder and patch the raw path bytes afterwards.
    let mut bytes = fixture_zip(&[("duplicate.txt", b"first"), ("duplicatX.txt", b"second")]);
    replace_entry_path(&mut bytes, b"duplicatX.txt", b"duplicate.txt");

    let error = match EpubArchive::new(&bytes) {
        Ok(_) => panic!("duplicate central paths must fail"),
        Err(error) => error,
    };
    assert!(error.message().contains("Duplicate EPUB ZIP entry path"));
}

#[test]
fn bounds_inflate_by_the_declared_entry_size_before_length_mismatch() {
    let mut bytes = fixture_zip(&[("mismatch.bin", &[0x5a; 64])]);
    let central = bytes
        .windows(4)
        .position(|window| window == 0x0201_4b50_u32.to_le_bytes())
        .expect("central directory exists");
    bytes[central + 24..central + 28].copy_from_slice(&1_u32.to_le_bytes());
    let mut archive = EpubArchive::new(&bytes).expect("bounded metadata opens");

    let error = archive
        .read_bytes("mismatch.bin")
        .expect_err("decoded bytes cannot exceed their declared size");
    assert!(error.message().contains("decoded length does not match"));
}

#[test]
fn zip_parser_cannot_fall_back_to_an_unvalidated_earlier_footer() {
    let mut bytes = fixture_zip(&[("real.txt", b"real")]);
    append_invalid_fallback_footer(&mut bytes);

    let error = match EpubArchive::new(&bytes) {
        Ok(_) => panic!("invalid selected footer must not fall back to the earlier archive"),
        Err(error) => error,
    };
    assert!(error.message().contains("Invalid EPUB ZIP archive"));
}

#[test]
fn zip_parser_ignores_a_shadow_archive_inside_the_selected_comment() {
    let mut bytes = fixture_zip(&[("real.txt", b"real")]);
    append_shadow_archive_comment(&mut bytes);

    let mut archive = EpubArchive::new(&bytes).expect("validated archive opens");
    assert_eq!(archive.entry_size("real.txt").expect("entry exists"), 4);
}

#[test]
fn accepts_a_trailing_upload_boundary_after_the_footer_comment() {
    let mut bytes = fixture_zip(&[("real.txt", b"real")]);
    bytes.extend_from_slice(b"\r\n------WebKitFormBoundaryMIR0kn1Fdy9b4SAa--\r\n");

    let mut archive = EpubArchive::new(&bytes).expect("trailing transport bytes are tolerated");
    assert_eq!(archive.read_bytes("real.txt").expect("entry reads"), b"real");
}

#[test]
fn accepts_a_multipart_wrapped_archive_with_prefix_and_trailer() {
    let zip = fixture_zip(&[("real.txt", b"real")]);
    let mut bytes = Vec::new();
    bytes.extend_from_slice(
        b"------WebKitFormBoundaryMIR0kn1Fdy9b4SAa\r\nContent-Disposition: form-data; name=\"file\"; filename=\"book.epub\"\r\nContent-Type: application/epub+zip\r\n\r\n",
    );
    bytes.extend_from_slice(&zip);
    bytes.extend_from_slice(b"\r\n------WebKitFormBoundaryMIR0kn1Fdy9b4SAa--\r\n");

    let mut archive = EpubArchive::new(&bytes).expect("multipart-wrapped archive opens");
    assert_eq!(archive.read_bytes("real.txt").expect("entry reads"), b"real");
}

#[test]
fn rejects_ambiguous_footers_inside_trailing_garbage() {
    let mut bytes = fixture_zip(&[("real.txt", b"real")]);
    // A second parseable in-bounds footer signature in the trailing bytes makes
    // footer selection non-deterministic across parsers; that fails closed.
    let mut fake_footer = [0_u8; 22];
    fake_footer[0..4].copy_from_slice(&0x0605_4b50_u32.to_le_bytes());
    bytes.extend_from_slice(&fake_footer);
    bytes.extend_from_slice(b"trailing-garbage");

    let error = match EpubArchive::new(&bytes) {
        Ok(_) => panic!("ambiguous trailing footers must not be resolved by guessing"),
        Err(error) => error,
    };
    assert!(error.message().contains("Invalid EPUB ZIP"));
}

#[test]
fn rejects_a_truncated_footer_comment() {
    let mut bytes = fixture_zip(&[("real.txt", b"real")]);
    let eocd = bytes
        .windows(4)
        .rposition(|window| window == 0x0605_4b50_u32.to_le_bytes())
        .expect("fixture footer exists");
    // Declare a comment longer than the remaining file: a truncated download.
    bytes[eocd + 20..eocd + 22].copy_from_slice(&64_u16.to_le_bytes());

    let error = match EpubArchive::new(&bytes) {
        Ok(_) => panic!("a truncated footer comment must stay invalid"),
        Err(error) => error,
    };
    assert!(error
        .message()
        .contains("Invalid EPUB ZIP end of central directory"));
}

fn replace_entry_path(bytes: &mut [u8], from: &[u8], to: &[u8]) {
    assert_eq!(from.len(), to.len(), "in-place patch must keep offsets");
    let mut replaced = 0_usize;
    let mut offset = 0_usize;
    while offset + from.len() <= bytes.len() {
        if &bytes[offset..offset + from.len()] == from {
            bytes[offset..offset + from.len()].copy_from_slice(to);
            replaced += 1;
            offset += from.len();
        } else {
            offset += 1;
        }
    }
    assert!(replaced > 0, "placeholder path exists in the fixture");
}

fn fixture_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    for (path, bytes) in entries {
        writer.start_file(path, options).expect("file starts");
        writer.write_all(bytes).expect("file writes");
    }
    writer.finish().expect("zip finalizes").into_inner()
}

fn append_invalid_fallback_footer(bytes: &mut Vec<u8>) {
    let filename = b"fake.txt";
    let central_offset = u32::try_from(bytes.len()).expect("fixture offset fits ZIP32");
    let mut central = vec![0_u8; 46 + filename.len()];
    central[0..4].copy_from_slice(&0x0201_4b50_u32.to_le_bytes());
    central[28..30].copy_from_slice(
        &u16::try_from(filename.len())
            .expect("fixture filename fits ZIP32")
            .to_le_bytes(),
    );
    central[42..46].copy_from_slice(&u32::MAX.to_le_bytes());
    central[46..].copy_from_slice(filename);
    let central_length = u32::try_from(central.len()).expect("fixture directory fits ZIP32");
    bytes.extend_from_slice(&central);

    let mut footer = [0_u8; 22];
    footer[0..4].copy_from_slice(&0x0605_4b50_u32.to_le_bytes());
    footer[8..10].copy_from_slice(&1_u16.to_le_bytes());
    footer[10..12].copy_from_slice(&1_u16.to_le_bytes());
    footer[12..16].copy_from_slice(&central_length.to_le_bytes());
    footer[16..20].copy_from_slice(&central_offset.to_le_bytes());
    bytes.extend_from_slice(&footer);
}

fn append_shadow_archive_comment(bytes: &mut Vec<u8>) {
    let eocd = bytes
        .windows(4)
        .rposition(|window| window == 0x0605_4b50_u32.to_le_bytes())
        .expect("fixture footer exists");
    let central_offset = u32::from_le_bytes(
        bytes[eocd + 16..eocd + 20]
            .try_into()
            .expect("central offset field exists"),
    ) as usize;
    let central_length = u32::from_le_bytes(
        bytes[eocd + 12..eocd + 16]
            .try_into()
            .expect("central length field exists"),
    ) as usize;
    let mut shadow_central = bytes[central_offset..central_offset + central_length].to_vec();
    shadow_central[24..28].copy_from_slice(&777_u32.to_le_bytes());

    let shadow_central_offset = u32::try_from(bytes.len()).expect("fixture offset fits ZIP32");
    let shadow_central_length =
        u32::try_from(shadow_central.len()).expect("fixture directory fits ZIP32");
    let comment_length =
        u16::try_from(shadow_central.len() + 22 + 1).expect("fixture comment fits ZIP32");
    bytes[eocd + 20..eocd + 22].copy_from_slice(&comment_length.to_le_bytes());
    bytes.extend_from_slice(&shadow_central);

    let mut shadow_footer = [0_u8; 22];
    shadow_footer[0..4].copy_from_slice(&0x0605_4b50_u32.to_le_bytes());
    shadow_footer[8..10].copy_from_slice(&1_u16.to_le_bytes());
    shadow_footer[10..12].copy_from_slice(&1_u16.to_le_bytes());
    shadow_footer[12..16].copy_from_slice(&shadow_central_length.to_le_bytes());
    shadow_footer[16..20].copy_from_slice(&shadow_central_offset.to_le_bytes());
    bytes.extend_from_slice(&shadow_footer);
    bytes.push(0);
}
