use std::io::Cursor;

use zip::{write::FileOptions, ZipWriter};

use super::{bounded_request, complete_revision};
use crate::layout::LineBreaking;
use crate::runtime::tests::fixture::{
    add_file, fixture_epub, layout, minimal_png, multi_chapter_image_fixture_epub,
};
use crate::runtime::RuntimeDocument;

#[test]
fn same_chapter_footnote_and_image_revision_matches_eager() {
    let bytes = fixture_epub();
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager.create_revision(&layout()).expect("eager completes");
    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let initial = bounded
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded starts");
    assert_eq!(
        bounded
            .get_footnotes(&initial.revision.revision_id)
            .expect("started chapter footnotes are immediately available")
            .entries,
        eager
            .get_footnotes(&eager_revision.revision_id)
            .expect("eager footnotes")
            .entries
    );
    let completed = complete_revision(&mut bounded, initial);

    assert_eq!(
        bounded.revisions[&completed.revision.revision_id]
            .layout
            .pages,
        eager.revisions[&eager_revision.revision_id].layout.pages
    );
    assert_eq!(
        bounded
            .get_footnotes(&completed.revision.revision_id)
            .expect("bounded footnotes")
            .entries,
        eager
            .get_footnotes(&eager_revision.revision_id)
            .expect("eager footnotes")
            .entries
    );
}

#[test]
fn later_chapter_image_dimensions_are_loaded_live_without_preloading_the_chapter() {
    let bytes = multi_chapter_image_fixture_epub();
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager.create_revision(&layout()).expect("eager completes");
    let mut window_reference = RuntimeDocument::open(&bytes).expect("window reference opens");
    let window_reference_revision = window_reference
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 1, 1)
        .expect("reference window completes");
    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let initial = bounded
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded starts");

    assert!(!bounded.document().chapters[1].source_loaded);
    assert_eq!(bounded.document().images[0].width, None);
    assert_eq!(bounded.document().images[0].height, None);
    let window_revision = bounded
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 1, 1)
        .expect("window after bounded start completes");
    assert_eq!(
        bounded.revisions[&window_revision.revision_id].layout.pages,
        window_reference.revisions[&window_reference_revision.revision_id]
            .layout
            .pages,
        "a bounded start must not leave the shared prepared base with stale image dimensions"
    );
    let completed = complete_revision(&mut bounded, initial);
    assert_eq!(bounded.document().images[0].width, Some(2));
    assert_eq!(bounded.document().images[0].height, Some(3));
    assert_eq!(
        bounded.revisions[&completed.revision.revision_id]
            .layout
            .pages,
        eager.revisions[&eager_revision.revision_id].layout.pages
    );
}

#[test]
fn first_artifact_does_not_inspect_images_beyond_the_layout_frontier() {
    let bytes = image_frontier_fixture_epub(24);
    let mut bounded = RuntimeDocument::open(&bytes).expect("frontier fixture opens");
    assert!(bounded
        .document()
        .images
        .iter()
        .all(|image| !image.dimensions_loaded));

    let initial = bounded
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("first bounded artifact is prepared");

    let head = bounded
        .document()
        .images
        .iter()
        .find(|image| image.href == "Images/head.png")
        .expect("head image is indexed");
    assert!(head.dimensions_loaded);
    assert_eq!((head.width, head.height), (Some(2), Some(3)));
    assert!(bounded.document().chapters[0].image_refs.is_none());
    assert!(bounded
        .document()
        .images
        .iter()
        .filter(|image| image.href.contains("tail-"))
        .all(|image| !image.dimensions_loaded));

    let completed = complete_revision(&mut bounded, initial);
    assert!(bounded
        .document()
        .images
        .iter()
        .all(|image| image.dimensions_loaded));

    let mut eager = RuntimeDocument::open(&bytes).expect("eager frontier fixture opens");
    let eager_revision = eager
        .create_revision(&layout())
        .expect("eager layout completes");
    assert_eq!(
        bounded.revisions[&completed.revision.revision_id]
            .layout
            .pages,
        eager.revisions[&eager_revision.revision_id].layout.pages
    );
}

fn image_frontier_fixture_epub(tail_image_count: usize) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#,
    );
    let tail_manifest = (0..tail_image_count)
        .map(|index| {
            format!(
                r#"<item id="tail-{index}" href="Images/tail-{index:03}.png" media-type="image/png"/>"#
            )
        })
        .collect::<String>();
    let package = format!(
        r#"<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Image frontier</dc:title><dc:language>en</dc:language><dc:identifier id="id">image-frontier</dc:identifier></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="head" href="Images/head.png" media-type="image/png"/>{tail_manifest}</manifest><spine><itemref idref="chapter"/></spine></package>"#
    );
    add_file(&mut writer, options, "OPS/package.opf", package.as_bytes());
    let tail_nodes = (0..tail_image_count)
        .map(|index| {
            format!(r#"<div><img src="Images/tail-{index:03}.png" alt="tail {index}"/></div>"#)
        })
        .collect::<String>();
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p><img src="Images/head.png" alt="head"/>The first root block is the only image frontier admitted by the first bounded artifact.</p>{tail_nodes}</body></html>"#
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter.xhtml",
        chapter.as_bytes(),
    );
    let png = minimal_png();
    add_file(&mut writer, options, "OPS/Images/head.png", &png);
    for index in 0..tail_image_count {
        add_file(
            &mut writer,
            options,
            &format!("OPS/Images/tail-{index:03}.png"),
            &png,
        );
    }
    writer.finish().expect("zip finalizes").into_inner()
}
