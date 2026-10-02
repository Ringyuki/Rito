use super::{
    pack::{pack_publication, PackOptions, PackedPublication},
    payload::{ContentPayload, FileLocation, SkeletonFile, SkeletonPayload},
    ShardKey,
};
use crate::{
    epub::{open_runtime_document, open_runtime_document_from_shards, LoadedEpubDocument},
    runtime::tests::fixture::{
        cross_chapter_footnote_fixture_epub, multi_chapter_fixture_epub,
        multi_chapter_image_fixture_epub,
    },
    xhtml::{scan_epub_type_attribute_hints, EpubTypeAttributeHint},
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
fn the_skeleton_holds_exactly_what_opening_reads() {
    let packed = pack(&multi_chapter_fixture_epub(), false);
    assert_eq!(
        packed.skeleton.files,
        vec![
            "META-INF/container.xml".to_owned(),
            "OPS/package.opf".to_owned(),
            "OPS/nav.xhtml".to_owned(),
        ]
    );
    let shard_files = packed
        .shards
        .iter()
        .map(|shard| (shard.shard_id, shard.files.clone()))
        .collect::<Vec<_>>();
    assert_eq!(
        shard_files,
        vec![
            (1, vec!["OPS/chapter-1.xhtml".to_owned()]),
            (2, vec!["OPS/chapter-2.xhtml".to_owned()]),
            (3, vec!["OPS/chapter-3.xhtml".to_owned()]),
        ]
    );
}

#[test]
fn an_image_only_one_chapter_uses_travels_with_that_chapter() {
    let packed = pack(&multi_chapter_image_fixture_epub(), false);
    let chapter_two = packed
        .shards
        .iter()
        .find(|shard| shard.files.contains(&"OPS/chapter-2.xhtml".to_owned()))
        .expect("chapter two shard");
    assert_eq!(
        chapter_two.files,
        vec![
            "OPS/chapter-2.xhtml".to_owned(),
            "OPS/Images/late.png".to_owned()
        ]
    );
}

#[test]
fn a_chapter_loads_once_its_shard_arrives_and_names_the_shard_until_then() {
    let epub = multi_chapter_image_fixture_epub();
    let packed = pack(&epub, false);
    let mut document = open(&packed);
    assert!(document
        .chapters
        .iter()
        .all(|chapter| !chapter.source_loaded));

    let error = document
        .ensure_chapter_loaded(1)
        .expect_err("chapter two has not arrived");
    assert_eq!(error.pending_shards(), &[2]);
    assert_eq!(document.pending_shards(), vec![2]);

    let store = document.shard_store().expect("shard storage").clone();
    let chapter_two = &packed.shards[1];
    assert_eq!(store.supply(&chapter_two.bytes, None).expect("supplies"), 2);
    assert!(document.pending_shards().is_empty());
    document
        .ensure_chapter_loaded(1)
        .expect("chapter two loads");
    document
        .ensure_chapter_image_dimensions_loaded(1, 1)
        .expect("its image came with it");

    let mut whole = open_runtime_document(&epub).expect("whole archive opens");
    whole.ensure_chapter_loaded(1).expect("loads");
    assert_eq!(
        document.chapters[1].xhtml_source,
        whole.chapters[1].xhtml_source
    );
}

#[test]
fn a_batch_names_every_missing_shard_at_once() {
    let packed = pack(&multi_chapter_fixture_epub(), false);
    let mut document = open(&packed);
    let error = document
        .ensure_all_chapters_loaded()
        .expect_err("no chapter has arrived");
    assert_eq!(error.pending_shards(), &[1, 2, 3]);
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
        let mut whole = open_runtime_document(&epub).expect("opens");
        whole.ensure_all_chapters_loaded().expect("loads");
        whole.ensure_all_fonts_loaded().expect("fonts load");
        assert_eq!(sharded.package, whole.package);
        assert_eq!(sharded.stylesheets, whole.stylesheets);
        assert_eq!(sharded.fonts, whole.fonts);
        assert_eq!(sharded.images, whole.images);
        assert_eq!(sharded.chapters, whole.chapters);
    }
}

#[test]
fn the_skeleton_carries_each_chapters_footnote_scan() {
    let epub = cross_chapter_footnote_fixture_epub();
    let packed = pack(&epub, false);
    let document = open(&packed);
    let store = document.shard_store().expect("shard storage");
    let mut whole = open_runtime_document(&epub).expect("opens");
    whole.ensure_all_chapters_loaded().expect("loads");
    for (index, chapter) in whole.chapters.iter().enumerate() {
        let expected = scan_epub_type_attribute_hints(&chapter.xhtml_source).unwrap_or_default();
        assert_eq!(
            store.footnote_hints(index),
            Some(expected),
            "chapter {index}"
        );
    }
}

#[test]
fn encrypted_shards_need_their_own_key() {
    let packed = pack(&multi_chapter_fixture_epub(), true);
    assert!(open_runtime_document_from_shards(&packed.skeleton.bytes, None).is_err());
    let wrong = ShardKey::from_bytes([7; 32]);
    assert!(open_runtime_document_from_shards(&packed.skeleton.bytes, Some(&wrong)).is_err());

    let document = open(&packed);
    let store = document.shard_store().expect("shard storage");
    let first = &packed.shards[0];
    let second = &packed.shards[1];
    assert!(store.supply(&first.bytes, second.key.as_ref()).is_err());
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
    let epub = multi_chapter_fixture_epub();
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
        hint_scan_revision: 1,
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
                location: FileLocation::Shard(4),
            },
            SkeletonFile {
                path: "c.css".to_owned(),
                byte_length: 1,
                listed: true,
                location: FileLocation::Unreadable("bad".to_owned()),
            },
        ],
        footnote_hints: vec![
            vec![EpubTypeAttributeHint {
                is_block: true,
                epub_type: "footnote".to_owned(),
                href: None,
                id: Some("n1".to_owned()),
            }],
            Vec::new(),
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
