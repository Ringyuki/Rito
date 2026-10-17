//! A publication opened from shards reads exactly like the same publication
//! opened from its archive. Layout never waits: the skeleton carries every
//! chapter, stylesheet and font and every image's dimensions. Only reading
//! an image fails as `ResourcePending` naming its shard, and once the host
//! supplies it the read returns the archive's bytes.

use crate::{
    epub::shard::{pack_publication, PackOptions, PackedPublication},
    runtime::tests::fixture::{
        cross_chapter_footnote_fixture_epub, multi_chapter_fixture_epub,
        multi_chapter_image_fixture_epub, pinned_test_font_policy,
    },
};

use super::{tests::request, *};

fn counter_random() -> impl FnMut(&mut [u8]) {
    let mut state = 0x2545_f491_u32;
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

fn open_shards(session_id: u64, packed: &PackedPublication) -> ReaderSession {
    ReaderSession::open_shards_with_pinned_font_policy(
        session_id,
        &packed.skeleton.bytes,
        packed.skeleton.key.as_ref(),
        pinned_test_font_policy(),
    )
    .expect("opens from the skeleton")
}

fn open_archive(session_id: u64, epub: Vec<u8>) -> ReaderSession {
    ReaderSession::open_owned_with_pinned_font_policy(session_id, epub, pinned_test_font_policy())
        .expect("opens from the archive")
}

/// Identity fields differ between two sessions by construction; everything
/// the host draws must not.
fn drawn(mut artifact: ReaderArtifact) -> ReaderArtifact {
    artifact.request_id = 0;
    artifact.artifact_id = 0;
    artifact.revision_id = 0;
    artifact
}

#[test]
fn every_chapter_draws_the_same_from_the_skeleton_alone() {
    for epub in [
        multi_chapter_fixture_epub(),
        multi_chapter_image_fixture_epub(),
        cross_chapter_footnote_fixture_epub(),
    ] {
        for encrypt in [false, true] {
            let packed = pack(&epub, encrypt);
            let mut archive = open_archive(7, epub.clone());
            let mut sharded = open_shards(7, &packed);
            assert_eq!(archive.publication(), sharded.publication());
            let hrefs = archive
                .publication()
                .spine
                .iter()
                .map(|item| item.href.clone())
                .collect::<Vec<_>>();
            for (index, href) in hrefs.iter().enumerate() {
                let request_id = index as u64 + 1;
                let expected = archive
                    .request_artifact(request(7, request_id, href))
                    .expect("archive artifact");
                let actual = sharded
                    .request_artifact(request(7, request_id, href))
                    .expect("no shard is needed to lay a chapter out");
                assert_eq!(drawn(actual.clone()), drawn(expected.clone()), "{href}");
                archive
                    .release_artifact(expected.artifact_id)
                    .expect("releases");
                sharded
                    .release_artifact(actual.artifact_id)
                    .expect("releases");
            }
        }
    }
}

#[test]
fn an_image_resource_names_its_shard_until_it_is_supplied() {
    let epub = multi_chapter_image_fixture_epub();
    let packed = pack(&epub, true);
    let mut archive = open_archive(8, epub);
    let mut sharded = open_shards(8, &packed);
    let expected_artifact = archive
        .request_artifact(request(8, 1, "chapter-2.xhtml"))
        .expect("archive artifact");
    let artifact = sharded
        .request_artifact(request(8, 1, "chapter-2.xhtml"))
        .expect("laid out from the skeleton");
    let image = artifact
        .resources
        .iter()
        .find(|resource| resource.kind == ReaderResourceKind::Image)
        .expect("chapter two draws its image")
        .href
        .clone();

    let error = sharded
        .read_resource(artifact.artifact_id, ReaderResourceKind::Image, &image)
        .expect_err("the image has not arrived");
    assert_eq!(error.kind, ReaderErrorKind::ResourcePending);
    assert_eq!(error.pending_shards, vec![1]);

    let shard = &packed.shards[0];
    assert_eq!(
        sharded
            .supply_shard(&shard.bytes, shard.key.as_ref())
            .expect("supplies"),
        1
    );
    let read = sharded
        .read_resource(artifact.artifact_id, ReaderResourceKind::Image, &image)
        .expect("reads once supplied");
    let expected = archive
        .read_resource(
            expected_artifact.artifact_id,
            ReaderResourceKind::Image,
            &image,
        )
        .expect("archive reads");
    assert_eq!(read.bytes, expected.bytes);
    assert_eq!((read.width, read.height), (expected.width, expected.height));
}

#[test]
fn background_pagination_needs_no_shard_and_matches_the_archive() {
    let epub = cross_chapter_footnote_fixture_epub();
    let packed = pack(&epub, false);
    let mut archive = open_archive(10, epub);
    let mut sharded = open_shards(10, &packed);
    let archived = archive
        .request_artifact(request(10, 1, "chapter-2.xhtml"))
        .expect("archive artifact");
    let visible = sharded
        .request_artifact(request(10, 1, "chapter-2.xhtml"))
        .expect("sharded artifact");
    for (session, artifact) in [
        (&mut archive, archived.artifact_id),
        (&mut sharded, visible.artifact_id),
    ] {
        session
            .adopt_foreground_candidate(ReaderForegroundHandoff {
                session_id: 10,
                expected_visible_artifact_id: None,
                candidate_artifact_id: artifact,
            })
            .expect("adopts");
    }
    let expected = drive_background(&mut archive, archived.artifact_id);
    let actual = drive_background(&mut sharded, visible.artifact_id);
    assert_eq!(drawn(actual), drawn(expected));
}

fn drive_background(session: &mut ReaderSession, visible_artifact_id: u64) -> ReaderArtifact {
    for _ in 0..64 {
        let advance = session
            .advance_background_once(ReaderBackgroundRequest {
                session_id: session.session_id(),
                expected_visible_artifact_id: visible_artifact_id,
                max_pages_per_quantum: 64,
            })
            .expect("background never waits on a shard");
        if let Some(artifact) = advance.artifact {
            return artifact;
        }
    }
    panic!("background never offered a publication candidate");
}
