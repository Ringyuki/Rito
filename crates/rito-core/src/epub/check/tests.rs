use std::io::{Cursor, Write};

use zip::{write::FileOptions, ZipWriter};

use super::{check_publication, PublicationProblem};
use crate::runtime::{
    tests::fixture::{layout, minimal_png},
    RuntimeDocument,
};

const GOOD_CHAPTER: &[u8] = br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/></head><body><p>A chapter.</p><img src="Images/plate.png" alt="plate"/></body></html>"#;

/// A two-chapter book listing a stylesheet and an image. `files` replaces
/// or removes (with `None`) the archive files under `OPS/`.
fn book(files: &[(&str, Option<&[u8]>)]) -> Vec<u8> {
    let png = minimal_png();
    let mut archive: Vec<(&str, &[u8])> = vec![
        ("chapter-1.xhtml", GOOD_CHAPTER),
        ("chapter-2.xhtml", GOOD_CHAPTER),
        ("style.css", b"p { margin: 0 }"),
        ("Images/plate.png", &png),
    ];
    for (path, bytes) in files {
        archive.retain(|(existing, _)| existing != path);
        if let Some(bytes) = bytes {
            archive.push((path, bytes));
        }
    }
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let mut add = |path: &str, bytes: &[u8]| {
        let options: FileOptions<'_, ()> = FileOptions::default();
        writer.start_file(path, options).expect("file starts");
        writer.write_all(bytes).expect("file writes");
    };
    add(
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#,
    );
    add(
        "OPS/package.opf",
        br#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Checked</dc:title><dc:language>en</dc:language><dc:identifier id="id">checked</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="plate" href="Images/plate.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
</package>"#,
    );
    for (path, bytes) in archive {
        add(&format!("OPS/{path}"), bytes);
    }
    writer.finish().expect("zip finalizes").into_inner()
}

/// What the reader does with the book: open it and lay the whole of it out.
fn reader_verdict(epub: &[u8]) -> Result<(), String> {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(epub).map_err(|error| error.to_string())?;
    document
        .create_revision(&layout())
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn problem(path: &str, message: &str) -> PublicationProblem {
    PublicationProblem {
        path: path.to_owned(),
        message: message.to_owned(),
    }
}

#[test]
fn a_well_formed_book_is_readable_without_problems() {
    let epub = book(&[]);
    assert_eq!(check_publication(&epub), Ok(Vec::new()));
    assert_eq!(reader_verdict(&epub), Ok(()));
}

#[test]
fn a_chapter_missing_from_the_archive_fails_the_book_as_layout_does() {
    let epub = book(&[("chapter-2.xhtml", None)]);
    let error = check_publication(&epub).expect_err("unreadable");
    assert!(
        error.message().contains("OPS/chapter-2.xhtml"),
        "{}",
        error.message()
    );
    let reader = reader_verdict(&epub).expect_err("the reader fails too");
    assert!(reader.contains(error.message()), "{reader}");
}

#[test]
fn a_chapter_that_does_not_parse_shows_empty_and_the_book_still_lays_out() {
    let epub = book(&[("chapter-2.xhtml", Some(b"not markup <<<".as_slice()))]);
    let problems = check_publication(&epub).expect("readable");
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].path, "OPS/chapter-2.xhtml");
    assert!(
        problems[0]
            .message
            .starts_with("shows no content: Invalid XHTML"),
        "{}",
        problems[0].message
    );
    assert_eq!(reader_verdict(&epub), Ok(()));
}

#[test]
fn listed_files_missing_from_the_archive_are_problems_not_failures() {
    let unlinked: &[u8] =
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="Images/plate.png" alt="plate"/></body></html>"#;
    let epub = book(&[
        ("chapter-1.xhtml", Some(unlinked)),
        ("chapter-2.xhtml", Some(unlinked)),
        ("style.css", None),
        ("Images/plate.png", None),
    ]);
    let missing = "listed in the package but not readable from the archive";
    assert_eq!(
        check_publication(&epub),
        Ok(vec![
            problem("OPS/style.css", missing),
            problem("OPS/Images/plate.png", missing),
        ])
    );
    assert_eq!(reader_verdict(&epub), Ok(()));
}

#[test]
fn a_linked_stylesheet_missing_from_the_archive_fails_the_book_as_styling_does() {
    let epub = book(&[("style.css", None)]);
    let error = check_publication(&epub).expect_err("unreadable");
    assert!(
        error.message().contains("ExternalStylesheetMissing"),
        "{}",
        error.message()
    );
    let reader = reader_verdict(&epub).expect_err("the reader fails too");
    assert!(reader.contains(error.message()), "{reader}");
}

#[test]
fn bytes_that_are_not_an_epub_fail_as_opening_does() {
    let error = check_publication(b"plain text").expect_err("unreadable");
    let reader = reader_verdict(b"plain text").expect_err("the reader fails too");
    assert!(reader.contains(error.message()), "{reader}");
}
