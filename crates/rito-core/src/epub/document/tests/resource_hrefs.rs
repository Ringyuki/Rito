use std::io::Cursor;

use zip::{write::FileOptions, ZipWriter};

use super::super::{open_document, open_runtime_document_owned};
use super::{add_file, fixture_epub, minimal_png};
use crate::{
    layout::{create_layout_config, LayoutConfigInput, MarginInput, SpreadMode},
    runtime::{RuntimeDocument, RuntimeResourceKind},
};

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

#[test]
fn resolves_literal_content_href_to_percent_encoded_manifest_resource() {
    let bytes = percent_manifest_literal_content_fixture_epub();
    let mut document =
        open_runtime_document_owned(bytes.clone()).expect("encoded manifest indexes lazily");

    document
        .ensure_chapter_image_dimensions_loaded(0, 1)
        .expect("literal content href resolves for dimension loading");

    assert_eq!(document.images.len(), 1);
    assert_eq!(document.images[0].href, "Images/Cover%20One.png");
    assert_eq!(
        (document.images[0].width, document.images[0].height),
        (Some(2), Some(3))
    );
    assert_eq!(
        document
            .read_image_bytes("../Images/Cover One.png")
            .expect("literal content href resolves for byte loading"),
        Some(minimal_png())
    );

    let mut runtime = RuntimeDocument::open(&bytes).expect("runtime opens encoded manifest");
    let revision = runtime
        .create_revision(&layout())
        .expect("revision resolves literal image source");
    let frame = runtime
        .get_frame(&revision.revision_id, 0)
        .expect("image frame is available");
    assert!(frame
        .resource_refs
        .images
        .contains(&"../Images/Cover One.png".to_owned()));
    let resource = runtime
        .get_resource(
            &revision.revision_id,
            RuntimeResourceKind::Image,
            "../Images/Cover One.png",
        )
        .expect("literal image source transfers");
    assert_eq!(resource.href, "Images/Cover%20One.png");
    assert_eq!(resource.bytes, minimal_png());
    assert_eq!((resource.width, resource.height), (Some(2), Some(3)));
}

#[test]
fn resolves_query_and_fragment_hrefs_for_lazy_image_loading() {
    let mut document = open_runtime_document_owned(query_fragment_fixture_epub())
        .expect("query href fixture indexes lazily");

    document
        .ensure_chapter_image_dimensions_loaded(0, 1)
        .expect("query image source resolves for dimension loading");

    assert_eq!(document.images.len(), 1);
    assert_eq!(
        document.images[0].href,
        "Images/Cover%20One.png?manifest=%zz"
    );
    assert_eq!(document.images[0].media_type, "image/png");
    assert_eq!(
        (document.images[0].width, document.images[0].height),
        (Some(2), Some(3))
    );
    assert_eq!(
        document
            .read_image_bytes("../Images/Cover One.png?size=2#view")
            .expect("query image source resolves for byte loading"),
        Some(minimal_png())
    );
}

#[test]
fn transfers_query_and_fragment_image_refs_through_the_runtime() {
    let bytes = query_fragment_fixture_epub();
    let mut runtime = RuntimeDocument::open(&bytes).expect("runtime opens query href fixture");
    let revision = runtime
        .create_revision(&layout())
        .expect("revision resolves query image source");
    let source_href = "../Images/Cover One.png?size=2#view";
    let frame = runtime
        .get_frame(&revision.revision_id, 0)
        .expect("query image frame is available");
    assert!(frame.resource_refs.images.contains(&source_href.to_owned()));
    let resource = runtime
        .get_resource(
            &revision.revision_id,
            RuntimeResourceKind::Image,
            source_href,
        )
        .expect("query image resource transfers");
    assert_eq!(resource.href, "Images/Cover%20One.png?manifest=%zz");
    assert_eq!(resource.bytes, minimal_png());
    assert_eq!((resource.width, resource.height), (Some(2), Some(3)));
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

fn percent_manifest_literal_content_fixture_epub() -> Vec<u8> {
    image_href_fixture_epub(
        "Text/chapter.xhtml",
        "Text/chapter.xhtml",
        "Images/Cover%20One.png",
        "Images/Cover One.png",
        r#"<img src="../Images/Cover One.png"/>"#,
    )
}

fn query_fragment_fixture_epub() -> Vec<u8> {
    image_href_fixture_epub(
        "Text/chapter.xhtml?edition=1#start",
        "Text/chapter.xhtml",
        "Images/Cover%20One.png?manifest=%zz",
        "Images/Cover One.png",
        r#"<img src="../Images/Cover One.png?size=2#view"/>"#,
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

fn layout() -> crate::layout::LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 420.0,
        height: 640.0,
        margin: MarginInput::All(24.0),
        spread: SpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}
