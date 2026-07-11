use std::io::Cursor;

use zip::{write::FileOptions, ZipWriter};

use super::super::{open_document, open_runtime_document_owned};
use super::{add_file, fixture_epub, minimal_png};

#[test]
fn opens_percent_encoded_manifest_hrefs_against_literal_zip_names() {
    let bytes = percent_encoded_fixture_epub();

    let document = open_document(&bytes).expect("encoded manifest hrefs open eagerly");
    assert!(document
        .read_chapter("chapter")
        .is_some_and(|chapter| chapter.contains("Encoded chapter")));
    assert_eq!(
        document.image("Images/Cover%20One.png"),
        Some(minimal_png().as_slice())
    );

    let mut runtime = open_runtime_document_owned(bytes).expect("encoded hrefs index lazily");
    assert_eq!(runtime.images[0].byte_length, minimal_png().len());
    assert!(runtime.images[0].bytes.is_empty());
    assert_eq!(
        runtime
            .read_image_bytes("Images/Cover%20One.png")
            .expect("encoded image href reads lazily"),
        Some(minimal_png())
    );
}

#[test]
fn resolves_source_paths_that_contain_the_manifest_href() {
    let mut runtime =
        open_runtime_document_owned(fixture_epub()).expect("runtime fixture indexes lazily");
    runtime.chapters[0].xhtml_source =
        r#"<html><body><img src="OPS/Images/cover.png"/></body></html>"#.to_owned();
    runtime.chapters[0].image_refs = None;

    runtime
        .ensure_chapter_image_dimensions_loaded(0, 1)
        .expect("long source path resolves for dimension loading");

    assert_eq!(runtime.images[0].width, Some(2));
    assert_eq!(
        runtime
            .read_image_bytes("OPS/Images/cover.png")
            .expect("long source path resolves for byte loading"),
        Some(minimal_png())
    );
}

#[test]
fn resolves_percent_encoded_content_href_to_literal_manifest_resource() {
    let mut runtime = open_runtime_document_owned(literal_space_image_fixture_epub())
        .expect("literal-space fixture indexes lazily");

    runtime
        .ensure_chapter_image_dimensions_loaded(0, 1)
        .expect("encoded content href resolves for dimension loading");

    assert_eq!(runtime.images[0].href, "Images/Cover One.png");
    assert_eq!(runtime.images[0].width, Some(2));
    assert_eq!(
        runtime
            .read_image_bytes("../Images/Cover%20One.png")
            .expect("encoded content href resolves for byte loading"),
        Some(minimal_png())
    );
}

fn percent_encoded_fixture_epub() -> Vec<u8> {
    image_href_fixture_epub(
        "Text/Chapter%20One.xhtml",
        "Text/Chapter One.xhtml",
        "Images/Cover%20One.png",
        "Images/Cover One.png",
        "<p>Encoded chapter</p>",
    )
}

fn literal_space_image_fixture_epub() -> Vec<u8> {
    image_href_fixture_epub(
        "Text/chapter.xhtml",
        "Text/chapter.xhtml",
        "Images/Cover One.png",
        "Images/Cover One.png",
        r#"<img src="../Images/Cover%20One.png"/>"#,
    )
}

fn image_href_fixture_epub(
    chapter_manifest_href: &str,
    chapter_archive_href: &str,
    image_manifest_href: &str,
    image_archive_href: &str,
    chapter_body: &str,
) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
    );
    let package = format!(
        r#"<package xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata>
            <dc:title>Image href fixture</dc:title>
            <dc:language>en</dc:language>
            <dc:identifier>image-href-id</dc:identifier>
          </metadata>
          <manifest>
            <item id="chapter" href="{chapter_manifest_href}" media-type="application/xhtml+xml"/>
            <item id="cover" href="{image_manifest_href}" media-type="image/png"/>
          </manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>"#
    );
    add_file(
        &mut writer,
        options,
        "OEBPS/content.opf",
        package.as_bytes(),
    );
    add_file(
        &mut writer,
        options,
        &format!("OEBPS/{chapter_archive_href}"),
        format!("<html><body>{chapter_body}</body></html>").as_bytes(),
    );
    add_file(
        &mut writer,
        options,
        &format!("OEBPS/{image_archive_href}"),
        &minimal_png(),
    );
    writer.finish().expect("zip finalizes").into_inner()
}
