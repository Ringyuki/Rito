//! A publication opened from shards reads exactly like the same publication
//! opened from its archive: every operation that reaches a missing shard
//! fails as `ResourcePending` naming it, and once the host supplies it the
//! retried operation returns what the archive-backed session returns.

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

struct Sharded {
    session: ReaderSession,
    packed: PackedPublication,
    next_request_id: u64,
    supplied: Vec<u32>,
}

impl Sharded {
    fn open(session_id: u64, epub: &[u8], encrypt: bool) -> Self {
        let packed =
            pack_publication(epub, PackOptions { encrypt }, &mut counter_random()).expect("packs");
        let session = ReaderSession::open_shards_with_pinned_font_policy(
            session_id,
            &packed.skeleton.bytes,
            packed.skeleton.key.as_ref(),
            pinned_test_font_policy(),
        )
        .expect("opens from the skeleton");
        Self {
            session,
            packed,
            next_request_id: 1,
            supplied: Vec::new(),
        }
    }

    fn supply(&mut self, shard_ids: &[u32]) {
        assert!(!shard_ids.is_empty(), "a pending failure names its shards");
        for shard_id in shard_ids {
            let shard = &self.packed.shards[*shard_id as usize - 1];
            assert_eq!(
                self.session
                    .supply_shard(&shard.bytes, shard.key.as_ref())
                    .expect("supplies"),
                *shard_id
            );
            self.supplied.push(*shard_id);
        }
    }

    /// Requests `href`, supplying whatever the engine reports missing.
    fn request(&mut self, href: &str) -> ReaderArtifact {
        loop {
            let request_id = self.next_request_id;
            self.next_request_id += 1;
            let session_id = self.session.session_id();
            match self
                .session
                .request_artifact(request(session_id, request_id, href))
            {
                Ok(artifact) => return artifact,
                Err(error) if error.kind == ReaderErrorKind::ResourcePending => {
                    self.supply(&error.pending_shards.clone());
                }
                Err(error) => panic!("request for {href:?} failed: {error:?}"),
            }
        }
    }
}

fn open_archive(session_id: u64, epub: Vec<u8>) -> ReaderSession {
    ReaderSession::open_owned_with_pinned_font_policy(session_id, epub, pinned_test_font_policy())
        .expect("opens from the archive")
}

/// Identity fields differ between two sessions by construction, and a
/// footnote whose definition lives in a chapter not yet supplied is still
/// pending; everything the host draws must not differ.
fn drawn(mut artifact: ReaderArtifact) -> ReaderArtifact {
    artifact.request_id = 0;
    artifact.artifact_id = 0;
    artifact.revision_id = 0;
    for page in &mut artifact.pages {
        for hit in &mut page.hits {
            hit.footnote_pending = false;
        }
    }
    artifact
}

impl Sharded {
    fn assert_footnotes_wait_only_on_unsupplied_chapters(
        &self,
        actual: &ReaderArtifact,
        expected: &ReaderArtifact,
    ) {
        for (page, expected_page) in actual.pages.iter().zip(&expected.pages) {
            for (hit, expected_hit) in page.hits.iter().zip(&expected_page.hits) {
                if hit.footnote_pending == expected_hit.footnote_pending {
                    continue;
                }
                assert!(
                    hit.footnote_pending,
                    "shards never resolve more than the archive"
                );
                let key = hit
                    .footnote_key
                    .as_deref()
                    .expect("a pending hit names its footnote");
                let chapter = format!("OPS/{}", key.split('#').next().unwrap_or_default());
                let holder = self
                    .packed
                    .shards
                    .iter()
                    .find(|shard| shard.files.contains(&chapter))
                    .expect("the defining chapter has a shard");
                assert!(
                    !self.supplied.contains(&holder.shard_id),
                    "{key} stays pending although its chapter arrived"
                );
            }
        }
    }
}

#[test]
fn every_chapter_draws_the_same_from_shards_as_from_the_archive() {
    for epub in [
        multi_chapter_fixture_epub(),
        multi_chapter_image_fixture_epub(),
        cross_chapter_footnote_fixture_epub(),
    ] {
        for encrypt in [false, true] {
            let mut archive = open_archive(7, epub.clone());
            let mut sharded = Sharded::open(7, &epub, encrypt);
            assert_eq!(archive.publication(), sharded.session.publication());
            let hrefs = archive
                .publication()
                .spine
                .iter()
                .map(|item| item.href.clone())
                .collect::<Vec<_>>();
            for (index, href) in hrefs.iter().enumerate() {
                let expected = archive
                    .request_artifact(request(7, index as u64 + 1, href))
                    .expect("archive artifact");
                let actual = sharded.request(href);
                assert_eq!(drawn(actual.clone()), drawn(expected.clone()), "{href}");
                sharded.assert_footnotes_wait_only_on_unsupplied_chapters(&actual, &expected);
                archive
                    .release_artifact(expected.artifact_id)
                    .expect("releases");
                sharded
                    .session
                    .release_artifact(actual.artifact_id)
                    .expect("releases");
            }
        }
    }
}

#[test]
fn opening_a_chapter_asks_only_for_that_chapter_and_the_fonts() {
    let epub = cross_chapter_footnote_fixture_epub();
    let mut sharded = Sharded::open(8, &epub, true);
    sharded.request("chapter-1.xhtml");
    let mut files = sharded
        .supplied
        .iter()
        .flat_map(|shard_id| sharded.packed.shards[*shard_id as usize - 1].files.clone())
        .collect::<Vec<_>>();
    files.sort();
    assert_eq!(
        files,
        vec![
            "OPS/Fonts/book.otf".to_owned(),
            "OPS/chapter-1.xhtml".to_owned()
        ]
    );
}

#[test]
fn a_footnote_in_an_unsupplied_chapter_names_that_chapter() {
    let epub = cross_chapter_footnote_fixture_epub();
    let mut archive = open_archive(9, epub.clone());
    let archived = archive
        .request_artifact(request(9, 1, "chapter-1.xhtml"))
        .expect("archive artifact");
    let expected = archive
        .read_footnote(archived.artifact_id, "chapter-2.xhtml#forward")
        .expect("archive reads the footnote");

    let mut sharded = Sharded::open(9, &epub, false);
    let artifact = sharded.request("chapter-1.xhtml");
    let error = sharded
        .session
        .read_footnote(artifact.artifact_id, "chapter-2.xhtml#forward")
        .expect_err("chapter two has not arrived");
    assert_eq!(error.kind, ReaderErrorKind::ResourcePending);
    let chapter_two = sharded
        .packed
        .shards
        .iter()
        .find(|shard| shard.files.contains(&"OPS/chapter-2.xhtml".to_owned()))
        .expect("chapter two shard")
        .shard_id;
    assert_eq!(error.pending_shards, vec![chapter_two]);

    sharded.supply(&[chapter_two]);
    let footnote = sharded
        .session
        .read_footnote(artifact.artifact_id, "chapter-2.xhtml#forward")
        .expect("reads once its chapter arrived");
    assert_eq!(footnote.text, expected.text);
    assert_eq!(footnote.html, expected.html);
    assert_eq!(footnote.kind, expected.kind);
}

#[test]
fn background_pagination_waits_for_every_chapter_and_then_matches_the_archive() {
    let epub = multi_chapter_fixture_epub();
    let mut archive = open_archive(10, epub.clone());
    let mut sharded = Sharded::open(10, &epub, false);

    let archived = archive
        .request_artifact(request(10, 1, "chapter-2.xhtml"))
        .expect("archive artifact");
    let visible = sharded.request("chapter-2.xhtml");
    for (session, artifact) in [
        (&mut archive, archived.artifact_id),
        (&mut sharded.session, visible.artifact_id),
    ] {
        session
            .adopt_foreground_candidate(ReaderForegroundHandoff {
                session_id: 10,
                expected_visible_artifact_id: None,
                candidate_artifact_id: artifact,
            })
            .expect("adopts");
    }

    let expected = drive_background(&mut archive, archived.artifact_id, |_, _| {
        panic!("an archive never waits on a shard")
    });
    let packed = sharded.packed.clone();
    let mut waited = Vec::new();
    let actual = drive_background(&mut sharded.session, visible.artifact_id, |session, ids| {
        waited.extend_from_slice(ids);
        for shard_id in ids {
            let shard = &packed.shards[*shard_id as usize - 1];
            session
                .supply_shard(&shard.bytes, shard.key.as_ref())
                .expect("supplies");
        }
    });
    waited.sort_unstable();
    assert_eq!(waited, vec![1, 3], "only the chapters not yet read");
    assert_eq!(drawn(actual), drawn(expected));
}

fn drive_background(
    session: &mut ReaderSession,
    visible_artifact_id: u64,
    mut on_pending: impl FnMut(&mut ReaderSession, &[u32]),
) -> ReaderArtifact {
    for _ in 0..64 {
        let advance = session.advance_background_once(ReaderBackgroundRequest {
            session_id: session.session_id(),
            expected_visible_artifact_id: visible_artifact_id,
            max_top_level_nodes_per_quantum: 64,
        });
        match advance {
            Ok(advance) => {
                if let Some(artifact) = advance.artifact {
                    return artifact;
                }
            }
            Err(error) if error.kind == ReaderErrorKind::ResourcePending => {
                on_pending(session, &error.pending_shards);
            }
            Err(error) => panic!("background failed: {error:?}"),
        }
    }
    panic!("background never offered a publication candidate");
}
