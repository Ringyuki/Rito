use std::io::Cursor;

use zip::{write::FileOptions, ZipWriter};

use super::super::{open_document, open_runtime_document_owned};
use super::{add_file, minimal_png};
use crate::{
    layout::{create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode},
    runtime::{RuntimeDocument, RuntimeResourceKind},
};

#[test]
fn eagerly_loads_safe_archive_images_missing_from_the_manifest() {
    let document = open_document(&unmanifested_image_epub()).expect("document opens eagerly");

    assert_eq!(document.images.len(), 4);
    let nested = image(&document, "Images/Undeclared Tile.png");
    assert_eq!(nested.media_type, "image/png");
    assert_eq!(nested.bytes, minimal_png());
    assert!(nested.byte_hash.is_some());
    assert_eq!((nested.width, nested.height), (Some(2), Some(3)));

    let outside = image(&document, "../Shared/Outside.PNG");
    assert_eq!(outside.media_type, "image/png");
    assert_eq!(outside.bytes, minimal_png());

    let mislabeled = image(&document, "Images/Mislabeled.PNG");
    assert_eq!(mislabeled.media_type, "image/png");
    assert!(document
        .images
        .iter()
        .all(|resource| !resource.href.contains("unsafe") && !resource.href.contains("hidden")));
}

#[test]
fn keeps_unreferenced_archive_images_lazy_during_runtime_layout() {
    let bytes = unmanifested_image_epub();
    let mut document = open_runtime_document_owned(bytes).expect("runtime document opens");

    assert_eq!(document.images.len(), 4);
    assert!(document
        .images
        .iter()
        .all(|resource| !resource.href.contains("unsafe") && !resource.href.contains("hidden")));
    for resource in &document.images {
        assert!(resource.bytes.is_empty());
        assert!(resource.byte_hash.is_none());
        assert!(resource.width.is_none());
        assert!(!resource.dimensions_loaded);
    }
    document
        .ensure_chapter_image_dimensions_loaded(0, 1)
        .expect("referenced dimensions load");

    let nested = image(&document, "Images/Undeclared Tile.png");
    assert_eq!(nested.bytes, minimal_png());
    assert!(nested.byte_hash.is_some());
    assert_eq!((nested.width, nested.height), (Some(2), Some(3)));
    assert!(image(&document, "Images/Decoy.png").bytes.is_empty());
    assert!(image(&document, "../Shared/Outside.PNG").bytes.is_empty());

    assert_eq!(
        document
            .read_image_bytes("../Images/Undeclared%20Tile.png")
            .expect("encoded source resolves"),
        Some(minimal_png())
    );
    assert_eq!(
        document
            .read_image_bytes("../Shared/Outside.PNG")
            .expect("image outside the OPF directory resolves"),
        Some(minimal_png())
    );
}

#[test]
fn preserves_manifest_identity_and_media_type_before_archive_fallbacks() {
    let eager = open_document(&declared_percent_image_epub()).expect("declared image opens");
    assert_eq!(eager.images.len(), 1);
    assert_eq!(eager.images[0].href, "Images/Declared%20Tile.png");
    assert_eq!(eager.images[0].media_type, "image/custom-declared");

    let runtime = open_runtime_document_owned(declared_percent_image_epub())
        .expect("declared image indexes lazily");
    assert_eq!(runtime.images.len(), 1);
    assert_eq!(runtime.images[0].href, "Images/Declared%20Tile.png");
    assert!(runtime.images[0].bytes.is_empty());
}

#[test]
fn transfers_an_unmanifested_image_through_the_runtime_resource_path() {
    let mut runtime = RuntimeDocument::open(&unmanifested_image_epub()).expect("runtime opens");
    let before = runtime.publication_info();
    let summary = before
        .resources
        .images
        .iter()
        .find(|resource| resource.href == "Images/Undeclared Tile.png")
        .expect("archive image metadata is published");
    assert_eq!(summary.byte_length, minimal_png().len());
    assert!(summary.byte_hash.is_none());
    assert!(summary.width.is_none());

    let revision = runtime
        .create_revision(&layout())
        .expect("revision is created");
    let frame = runtime
        .get_frame(&revision.revision_id, 0)
        .expect("frame is available");
    assert!(frame
        .resource_refs
        .images
        .contains(&"../Images/Undeclared%20Tile.png".to_owned()));

    let resource = runtime
        .get_resource(
            &revision.revision_id,
            RuntimeResourceKind::Image,
            "../Images/Undeclared%20Tile.png",
        )
        .expect("archive image transfers");
    assert_eq!(resource.href, "Images/Undeclared Tile.png");
    assert_eq!(resource.media_type, "image/png");
    assert_eq!(resource.bytes, minimal_png());
    assert_eq!((resource.width, resource.height), (Some(2), Some(3)));
}

fn image<'a>(
    document: &'a super::super::LoadedEpubDocument,
    href: &str,
) -> &'a super::super::LoadedBinaryResource {
    document
        .images
        .iter()
        .find(|resource| resource.href == href)
        .unwrap_or_else(|| panic!("missing image: {href}"))
}

fn unmanifested_image_epub() -> Vec<u8> {
    build_epub(
        r#"<item id="mislabeled" href="Images/Mislabeled.PNG" media-type="application/octet-stream"/>"#,
        r#"<img src="../Images/Undeclared%20Tile.png"/>"#,
        &[
            ("OPS/Images/Undeclared Tile.png", minimal_png()),
            ("OPS/Images/Decoy.png", minimal_png()),
            ("OPS/Images/Mislabeled.PNG", minimal_png()),
            ("Shared/Outside.PNG", minimal_png()),
            ("OPS/Images/not-image.bin", vec![1, 2, 3]),
            ("../unsafe.png", minimal_png()),
            ("OPS/Images/old/../hidden.png", minimal_png()),
        ],
    )
}

fn declared_percent_image_epub() -> Vec<u8> {
    build_epub(
        r#"<item id="declared" href="Images/Declared%20Tile.png" media-type="image/custom-declared"/>"#,
        r#"<img src="../Images/Declared%20Tile.png"/>"#,
        &[("OPS/Images/Declared Tile.png", minimal_png())],
    )
}

fn build_epub(manifest: &str, chapter_body: &str, entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>"#,
    );
    let package = format!(
        r#"<package xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata><dc:title>Archive images</dc:title></metadata>
          <manifest>
            <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
            {manifest}
          </manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>"#
    );
    add_file(&mut writer, options, "OPS/package.opf", package.as_bytes());
    add_file(
        &mut writer,
        options,
        "OPS/Text/chapter.xhtml",
        format!("<html><body>{chapter_body}</body></html>").as_bytes(),
    );
    for (path, bytes) in entries {
        add_file(&mut writer, options, path, bytes);
    }
    writer.finish().expect("zip finalizes").into_inner()
}

fn layout() -> LayoutConfig {
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
