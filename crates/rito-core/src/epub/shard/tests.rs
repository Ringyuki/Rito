use super::{
    container::{seal_shard, ShardHeader},
    pack::{pack_publication, PackOptions, PackedPublication},
    payload::{ContentPayload, FileLocation, ShardMedia, SkeletonFile, SkeletonPayload},
    ShardKey, ShardKind,
};
use crate::{
    epub::{open_runtime_document, open_runtime_document_from_shards, LoadedEpubDocument},
    resources::IMAGE_DIMENSION_RULE_REVISION,
    runtime::tests::fixture::{
        cross_chapter_footnote_fixture_epub, multi_chapter_fixture_epub,
        multi_chapter_image_fixture_epub,
    },
};

/// A deterministic stand-in for a secure random source.
fn counter_random() -> impl FnMut(&mut [u8]) {
    let mut state = 0x9e37_79b9_u32;
    move |buffer: &mut [u8]| {
        for byte in buffer {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            *byte = (state >> 24) as u8;
        }
    }
}

fn pack(epub: &[u8], encrypt: bool) -> PackedPublication {
    pack_publication(epub, PackOptions { encrypt }, &mut counter_random()).expect("packs")
}

fn open(packed: &PackedPublication) -> LoadedEpubDocument {
    open_runtime_document_from_shards(&packed.skeleton.bytes, packed.skeleton.key.as_ref())
        .expect("opens from the skeleton")
}

fn supply_all(document: &LoadedEpubDocument, packed: &PackedPublication) {
    let store = document.shard_store().expect("shard storage");
    for shard in &packed.shards {
        store
            .supply(&shard.bytes, shard.key.as_ref())
            .expect("supplies");
    }
}

#[test]
fn only_images_leave_the_skeleton() {
    let packed = pack(&cross_chapter_footnote_fixture_epub(), false);
    let shard_files = packed
        .shards
        .iter()
        .map(|shard| (shard.shard_id, shard.files.clone()))
        .collect::<Vec<_>>();
    assert_eq!(
        shard_files,
        vec![(1, vec!["OPS/Images/late.png".to_owned()])]
    );
    for carried in [
        "OPS/chapter-1.xhtml",
        "OPS/chapter-3.xhtml",
        "OPS/Fonts/book.otf",
        "OPS/package.opf",
    ] {
        assert!(
            packed.skeleton.files.contains(&carried.to_owned()),
            "{carried}"
        );
    }
}

#[test]
fn the_skeleton_alone_lays_the_book_out() {
    let epub = cross_chapter_footnote_fixture_epub();
    let packed = pack(&epub, true);
    let mut sharded = open(&packed);
    sharded
        .ensure_all_chapters_loaded()
        .expect("chapters are inline");
    sharded.ensure_all_fonts_loaded().expect("fonts are inline");
    sharded
        .ensure_chapter_image_dimensions_loaded(0, sharded.chapters.len())
        .expect("image dimensions come from the skeleton");

    let mut whole = open_runtime_document(&epub).expect("opens");
    whole.ensure_all_chapters_loaded().expect("loads");
    whole
        .ensure_chapter_image_dimensions_loaded(0, whole.chapters.len())
        .expect("dimensions load");
    let dimensions = |document: &LoadedEpubDocument| {
        document
            .images
            .iter()
            .map(|image| {
                (
                    image.href.clone(),
                    image.width,
                    image.height,
                    image.dimensions_loaded,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(dimensions(&sharded), dimensions(&whole));
}

#[test]
fn an_image_is_read_once_its_shard_arrives_and_names_the_shard_until_then() {
    let epub = multi_chapter_image_fixture_epub();
    let packed = pack(&epub, false);
    let mut document = open(&packed);
    let error = document
        .read_image_bytes("Images/late.png")
        .expect_err("the image has not arrived");
    assert_eq!(error.pending_shards(), &[1]);

    let store = document.shard_store().expect("shard storage").clone();
    assert_eq!(
        store
            .supply(&packed.shards[0].bytes, None)
            .expect("supplies"),
        1
    );
    let mut whole = open_runtime_document(&epub).expect("opens");
    assert_eq!(
        document.read_image_bytes("Images/late.png").expect("reads"),
        whole.read_image_bytes("Images/late.png").expect("reads")
    );
}

#[test]
fn a_document_opened_from_shards_matches_the_archive() {
    for epub in [
        multi_chapter_fixture_epub(),
        multi_chapter_image_fixture_epub(),
        cross_chapter_footnote_fixture_epub(),
    ] {
        let packed = pack(&epub, true);
        let mut sharded = open(&packed);
        supply_all(&sharded, &packed);
        sharded.ensure_all_chapters_loaded().expect("loads");
        sharded.ensure_all_fonts_loaded().expect("fonts load");
        sharded
            .ensure_chapter_image_dimensions_loaded(0, sharded.chapters.len())
            .expect("dimensions load");
        let mut whole = open_runtime_document(&epub).expect("opens");
        whole.ensure_all_chapters_loaded().expect("loads");
        whole.ensure_all_fonts_loaded().expect("fonts load");
        let images = whole.images.len();
        whole
            .ensure_chapter_image_dimensions_loaded(0, whole.chapters.len())
            .expect("dimensions load");
        for index in 0..images {
            let href = whole.images[index].href.clone();
            whole
                .ensure_image_dimensions_loaded(&href)
                .expect("dimensions load");
        }
        assert_eq!(sharded.package, whole.package);
        assert_eq!(sharded.stylesheets, whole.stylesheets);
        assert_eq!(sharded.fonts, whole.fonts);
        assert_eq!(sharded.images, whole.images);
        assert_eq!(sharded.chapters, whole.chapters);
    }
}

#[test]
fn a_skeleton_that_leaves_a_chapter_in_a_shard_is_refused() {
    let packed = pack(&multi_chapter_fixture_epub(), false);
    let (_, payload) = super::container::open_shard(&packed.skeleton.bytes, None).expect("opens");
    let mut skeleton = SkeletonPayload::decode(&payload).expect("decodes");
    let chapter = skeleton
        .files
        .iter_mut()
        .find(|file| file.path == "OPS/chapter-2.xhtml")
        .expect("chapter two");
    chapter.location = FileLocation::Shard {
        shard_id: 1,
        media: ShardMedia::Other,
        first_chapter: None,
    };
    let header = ShardHeader {
        kind: ShardKind::Skeleton,
        encrypted: false,
        compressed: false,
        book_id: packed.book_id,
        shard_id: 0,
        nonce: [0; 24],
    };
    let sealed = seal_shard(header, &skeleton.encode(), None).expect("seals");
    let error = open_runtime_document_from_shards(&sealed, None).expect_err("refused");
    assert!(
        error.message().contains("chapter-2.xhtml"),
        "{}",
        error.message()
    );
}

#[test]
fn a_skeleton_packed_under_another_dimension_rule_is_refused() {
    let packed = pack(&multi_chapter_fixture_epub(), false);
    let (_, payload) = super::container::open_shard(&packed.skeleton.bytes, None).expect("opens");
    let mut skeleton = SkeletonPayload::decode(&payload).expect("decodes");
    skeleton.dimension_rule_revision = IMAGE_DIMENSION_RULE_REVISION + 1;
    let header = ShardHeader {
        kind: ShardKind::Skeleton,
        encrypted: false,
        compressed: false,
        book_id: packed.book_id,
        shard_id: 0,
        nonce: [0; 24],
    };
    let sealed = seal_shard(header, &skeleton.encode(), None).expect("seals");
    let error = open_runtime_document_from_shards(&sealed, None).expect_err("refused");
    assert!(error.message().contains("pack the publication again"));
}

#[test]
fn encrypted_shards_need_their_own_key() {
    let packed = pack(&multi_chapter_image_fixture_epub(), true);
    assert!(open_runtime_document_from_shards(&packed.skeleton.bytes, None).is_err());
    let wrong = ShardKey::from_bytes([7; 32]);
    assert!(open_runtime_document_from_shards(&packed.skeleton.bytes, Some(&wrong)).is_err());

    let document = open(&packed);
    let store = document.shard_store().expect("shard storage");
    let first = &packed.shards[0];
    assert!(store
        .supply(&first.bytes, packed.skeleton.key.as_ref())
        .is_err());
    assert!(store.supply(&first.bytes, None).is_err());

    let mut altered = first.bytes.clone();
    *altered.last_mut().expect("bytes") ^= 1;
    assert!(store.supply(&altered, first.key.as_ref()).is_err());

    let mut moved = first.bytes.clone();
    moved[32..36].copy_from_slice(&2u32.to_le_bytes());
    assert!(
        store.supply(&moved, first.key.as_ref()).is_err(),
        "the header is authenticated"
    );
    assert_eq!(
        store
            .supply(&first.bytes, first.key.as_ref())
            .expect("supplies"),
        1
    );
}

#[test]
fn a_shard_from_another_packing_is_refused() {
    let epub = multi_chapter_image_fixture_epub();
    let first = pack(&epub, false);
    let mut random = counter_random();
    let mut skip = [0u8; 3];
    random(&mut skip);
    let second = pack_publication(&epub, PackOptions::default(), &mut random).expect("packs");
    assert_ne!(first.book_id, second.book_id);
    let document = open(&first);
    let store = document.shard_store().expect("shard storage");
    assert!(store.supply(&second.shards[0].bytes, None).is_err());
}

#[test]
fn payloads_round_trip() {
    let skeleton = SkeletonPayload {
        dimension_rule_revision: 1,
        files: vec![
            SkeletonFile {
                path: "a.xhtml".to_owned(),
                byte_length: 3,
                listed: true,
                location: FileLocation::Inline(b"abc".to_vec()),
            },
            SkeletonFile {
                path: "b.png".to_owned(),
                byte_length: 9,
                listed: false,
                location: FileLocation::Shard {
                    shard_id: 4,
                    media: ShardMedia::Image(Some((640, 480))),
                    first_chapter: Some(0),
                },
            },
            SkeletonFile {
                path: "c.svg".to_owned(),
                byte_length: 9,
                listed: true,
                location: FileLocation::Shard {
                    shard_id: 5,
                    media: ShardMedia::Image(None),
                    first_chapter: Some(7),
                },
            },
            SkeletonFile {
                path: "d.mp3".to_owned(),
                byte_length: 9,
                listed: true,
                location: FileLocation::Shard {
                    shard_id: 6,
                    media: ShardMedia::Other,
                    first_chapter: None,
                },
            },
            SkeletonFile {
                path: "e.css".to_owned(),
                byte_length: 1,
                listed: true,
                location: FileLocation::Unreadable("bad".to_owned()),
            },
        ],
    };
    assert_eq!(SkeletonPayload::decode(&skeleton.encode()), Ok(skeleton));
    let content = ContentPayload {
        files: vec![("x".to_owned(), vec![1, 2, 3])],
    };
    assert_eq!(ContentPayload::decode(&content.encode()), Ok(content));
    let mut trailing = ContentPayload { files: Vec::new() }.encode();
    trailing.push(0);
    assert!(ContentPayload::decode(&trailing).is_err());
}

#[test]
fn text_is_deflated_before_sealing_and_incompressible_bytes_are_not() {
    use super::container::open_shard;

    let key = ShardKey::from_bytes([9; 32]);
    let header = ShardHeader {
        kind: ShardKind::Content,
        encrypted: true,
        compressed: false,
        book_id: [1; 16],
        shard_id: 3,
        nonce: [2; 24],
    };
    let text = "<p>Repeated chapter text compresses well.</p>".repeat(200);
    let sealed = seal_shard(header, text.as_bytes(), Some(&key)).expect("seals");
    assert!(sealed.len() < text.len() / 4, "the text was deflated");
    let (opened, payload) = open_shard(&sealed, Some(&key)).expect("opens");
    assert!(opened.compressed);
    assert_eq!(payload, text.as_bytes());

    let mut noise = vec![0u8; 4096];
    let mut state = 0x1234_5678_u32;
    for byte in &mut noise {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        *byte = state as u8;
    }
    let sealed = seal_shard(header, &noise, Some(&key)).expect("seals");
    let (opened, payload) = open_shard(&sealed, Some(&key)).expect("opens");
    assert!(
        !opened.compressed,
        "bytes that do not shrink stay as they are"
    );
    assert_eq!(payload, noise);
}

#[test]
fn the_skeleton_is_deflated_harder_than_media_shards() {
    let text = "<p>Repeated chapter text compresses well.</p>".repeat(200);
    let body = |kind| {
        let header = ShardHeader {
            kind,
            encrypted: false,
            compressed: false,
            book_id: [1; 16],
            shard_id: u32::from(kind == ShardKind::Content),
            nonce: [0; 24],
        };
        seal_shard(header, text.as_bytes(), None).expect("seals")[super::container::HEADER_BYTES..]
            .to_vec()
    };
    let deflated = |level| miniz_oxide::deflate::compress_to_vec(text.as_bytes(), level);
    assert_ne!(deflated(6), deflated(1), "the two levels are told apart");
    assert_eq!(body(ShardKind::Skeleton), deflated(6));
    assert_eq!(body(ShardKind::Content), deflated(1));
}

#[test]
fn a_body_that_claims_deflate_but_does_not_inflate_is_refused() {
    use super::container::open_shard;

    let header = ShardHeader {
        kind: ShardKind::Content,
        encrypted: false,
        compressed: false,
        book_id: [1; 16],
        shard_id: 3,
        nonce: [0; 24],
    };
    let mut sealed = seal_shard(header, b"short", None).expect("seals");
    assert_eq!(sealed[14], 0, "five bytes do not shrink");
    sealed[14] = 1;
    assert!(open_shard(&sealed, None).is_err());
}

/// Four chapters drawing images out of archive order: chapter 0 draws b,
/// chapter 1 draws c, chapter 2 draws a, chapter 3 draws c again; d is
/// drawn by none.
fn scattered_images_fixture_epub() -> Vec<u8> {
    use std::io::{Cursor, Write};
    use zip::{write::FileOptions, ZipWriter};

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    let mut add = |name: &str, bytes: &[u8]| {
        writer.start_file(name, options).expect("starts entry");
        writer.write_all(bytes).expect("writes entry");
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
    <dc:title>Scattered images</dc:title><dc:language>en</dc:language><dc:identifier id="id">scattered</dc:identifier>
  </metadata>
  <manifest>
    <item id="c0" href="c0.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>
    <item id="a" href="Images/a.png" media-type="image/png"/>
    <item id="b" href="Images/b.png" media-type="image/png"/>
    <item id="c" href="Images/c.png" media-type="image/png"/>
    <item id="d" href="Images/d.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c0"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>"#,
    );
    for image in ["a", "b", "c", "d"] {
        add(
            &format!("OPS/Images/{image}.png"),
            &crate::runtime::tests::fixture::minimal_png(),
        );
    }
    for (chapter, image) in [("c0", "b"), ("c1", "c"), ("c2", "a"), ("c3", "c")] {
        add(
            &format!("OPS/{chapter}.xhtml"),
            format!(
                r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>{chapter}</p><img src="Images/{image}.png" alt=""/></body></html>"#
            )
            .as_bytes(),
        );
    }
    writer.finish().expect("finishes").into_inner()
}

#[test]
fn content_shards_are_ordered_by_reading_distance_from_a_chapter() {
    let packed = pack(&scattered_images_fixture_epub(), false);
    let shard_of = |image: &str| {
        packed
            .shards
            .iter()
            .find(|shard| shard.files == [format!("OPS/Images/{image}.png")])
            .expect("one shard per image")
            .shard_id
    };
    let ids = |images: &[&str]| {
        images
            .iter()
            .map(|image| shard_of(image))
            .collect::<Vec<_>>()
    };
    let document = open(&packed);

    // From chapter 2: its own image, then chapter 3 (next) - whose c was
    // first drawn by chapter 1, the previous one - then chapter 0's b,
    // and the undrawn d last.
    assert_eq!(
        document.content_shards_near("c2.xhtml"),
        ids(&["a", "c", "b", "d"])
    );
    assert_eq!(
        document.content_shards_near("c0.xhtml#top"),
        ids(&["b", "c", "a", "d"])
    );
    assert_eq!(
        open_runtime_document(&scattered_images_fixture_epub())
            .expect("opens")
            .content_shards_near("c0.xhtml"),
        Vec::<u32>::new(),
        "an archive-opened publication has no shards"
    );
}
