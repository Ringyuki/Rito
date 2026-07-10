use std::io::{Cursor, Write};

use zip::{write::FileOptions, ZipWriter};

use super::{open_document, open_runtime_document_owned};

#[test]
fn opens_document_with_runtime_resources_and_chapters() {
    let bytes = fixture_epub();

    let document = open_document(&bytes).expect("document opens");

    assert_eq!(document.package.metadata.title, "Runtime fixture");
    assert_eq!(document.chapters.len(), 1);
    assert!(document
        .read_chapter("chapter")
        .is_some_and(|chapter| { chapter.contains("<p>Hello</p>") }));
    assert_eq!(
        document.stylesheet("styles/main.css"),
        Some("p { color: red; }")
    );
    assert_eq!(document.font("Fonts/book.otf"), Some(&b"font-bytes"[..]));
    assert_eq!(
        document.image("Images/cover.png"),
        Some(minimal_png().as_slice())
    );
    assert_eq!(document.images[0].width, Some(2));
    assert_eq!(document.images[0].height, Some(3));
}

#[test]
fn caches_lazy_binary_resources_after_first_read() {
    let bytes = fixture_epub();
    let mut document = open_runtime_document_owned(bytes).expect("document opens");

    assert!(document.images[0].bytes.is_empty());
    let image = document
        .read_image_bytes("Images/cover.png")
        .expect("image read succeeds")
        .expect("image exists");

    assert_eq!(image, minimal_png());
    assert_eq!(document.images[0].bytes, minimal_png());
    assert!(document.images[0].byte_hash.is_some());
}

#[test]
fn caches_lazy_font_resources_after_batch_load() {
    let bytes = fixture_epub();
    let mut document = open_runtime_document_owned(bytes).expect("document opens");

    assert!(document.fonts[0].bytes.is_empty());
    document
        .ensure_all_fonts_loaded()
        .expect("font loading succeeds");

    assert_eq!(document.fonts[0].bytes, b"font-bytes");
    assert_eq!(document.fonts[0].byte_length, b"font-bytes".len());
    assert!(document.fonts[0].byte_hash.is_some());
}

#[test]
fn caches_image_bytes_loaded_for_dimension_detection() {
    let bytes = fixture_epub();
    let mut document = open_runtime_document_owned(bytes).expect("document opens");

    assert!(document.images[0].bytes.is_empty());
    document
        .ensure_image_dimensions_loaded("Images/cover.png")
        .expect("dimensions load succeeds");

    assert_eq!(document.images[0].width, Some(2));
    assert_eq!(document.images[0].height, Some(3));
    assert_eq!(document.images[0].bytes, minimal_png());
}

fn fixture_epub() -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
        <container>
          <rootfiles>
            <rootfile full-path="OEBPS/content.opf"/>
          </rootfiles>
        </container>"#,
    );
    add_file(
        &mut writer,
        options,
        "OEBPS/content.opf",
        br#"<package xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata>
            <dc:title>Runtime fixture</dc:title>
            <dc:language>en</dc:language>
            <dc:identifier>fixture-id</dc:identifier>
          </metadata>
          <manifest>
            <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
            <item id="css" href="styles/main.css" media-type="text/css"/>
            <item id="font" href="Fonts/book.otf" media-type="font/otf"/>
            <item id="cover" href="Images/cover.png" media-type="image/png"/>
          </manifest>
          <spine>
            <itemref idref="chapter"/>
          </spine>
        </package>"#,
    );
    add_file(
        &mut writer,
        options,
        "OEBPS/Text/chapter.xhtml",
        br#"<html><body><p>Hello</p></body></html>"#,
    );
    add_file(
        &mut writer,
        options,
        "OEBPS/styles/main.css",
        b"p { color: red; }",
    );
    add_file(&mut writer, options, "OEBPS/Fonts/book.otf", b"font-bytes");
    add_file(
        &mut writer,
        options,
        "OEBPS/Images/cover.png",
        &minimal_png(),
    );
    writer.finish().expect("zip finalizes").into_inner()
}

fn add_file(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: FileOptions<'_, ()>,
    path: &str,
    bytes: &[u8],
) {
    writer.start_file(path, options).expect("file starts");
    writer.write_all(bytes).expect("file writes");
}

fn minimal_png() -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&2u32.to_be_bytes());
    bytes.extend_from_slice(&3u32.to_be_bytes());
    bytes.extend_from_slice(&[8, 2, 0, 0, 0]);
    bytes
}
