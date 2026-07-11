use std::io::{Cursor, Write};

use zip::{write::FileOptions, ZipWriter};

use super::EpubArchive;

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

fn fixture_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    for (path, bytes) in entries {
        writer.start_file(path, options).expect("file starts");
        writer.write_all(bytes).expect("file writes");
    }
    writer.finish().expect("zip finalizes").into_inner()
}
