//! A session artifact's hits are the page targets a browser revision reads:
//! one classifier says what each is, where its link leads and which TOC
//! entry names that place.

use std::collections::BTreeSet;

use crate::runtime::{
    tests::{
        fixture::{interaction_target_fixture_epub, multi_chapter_fixture_epub},
        revisions::whole_book_pages,
    },
    RuntimeDocument, RuntimePageTarget, RuntimePageTargetKind,
};

use super::{
    convert::{layout_config, reader_locator},
    tests::{open_test_session, request},
    *,
};

const SESSION: u64 = 341;

fn kind_of(target: &RuntimePageTarget) -> ReaderHitKind {
    match target.kind {
        RuntimePageTargetKind::Text => ReaderHitKind::Text,
        RuntimePageTargetKind::Link => ReaderHitKind::Link,
        RuntimePageTargetKind::Image => ReaderHitKind::Image,
        RuntimePageTargetKind::Footnote => ReaderHitKind::Footnote,
        RuntimePageTargetKind::FootnotePending => ReaderHitKind::FootnotePending,
    }
}

#[test]
fn hits_are_the_page_targets_of_the_whole_book_revision() {
    let mut kinds = BTreeSet::new();
    let mut destination_labels = BTreeSet::new();
    let mut image_sources = BTreeSet::new();
    let mut images_read = 0;
    for fixture in [
        interaction_target_fixture_epub(),
        multi_chapter_fixture_epub(),
    ] {
        let layout = request(SESSION, 1, "").layout;
        let mut document = RuntimeDocument::open_pinned_for_tests(&fixture).expect("opens");
        let revision = document
            .create_revision(&layout_config(layout).expect("layout"))
            .expect("revision");
        let chapters = whole_book_pages(&mut document, &revision.revision_id).chapters;
        let mut session = open_test_session(SESSION, fixture).expect("opens");
        let mut request_id = 0;
        for chapter in chapters {
            let (start, end) = (chapter.start_page, chapter.end_page);
            request_id += 1;
            let first = session
                .request_artifact(request(SESSION, request_id, &chapter.href))
                .expect("chapter resolves");
            for local_page in 0..=(end - start) {
                request_id += 1;
                let artifact = session
                    .peek_spread(ReaderSpreadRequest {
                        session_id: SESSION,
                        request_id,
                        from_artifact_id: first.artifact_id,
                        spread_index: u32::try_from(local_page).expect("fits"),
                    })
                    .expect("spread publishes");
                let targets = document
                    .get_page_targets(&revision.revision_id, start + local_page)
                    .expect("page targets")
                    .entries;
                let hits = &artifact.pages[0].hits;
                assert_eq!(
                    hits.len(),
                    targets.len(),
                    "{} page {local_page}",
                    chapter.href
                );
                for (hit, target) in hits.iter().zip(&targets) {
                    assert_eq!(hit.kind, kind_of(target), "{hit:?}");
                    assert_eq!(hit.href, target.href);
                    assert_eq!(
                        hit.target_locator,
                        target
                            .target_locator
                            .clone()
                            .map(|locator| reader_locator(locator).expect("locator")),
                        "{hit:?}"
                    );
                    assert_eq!(hit.destination_label, target.destination_label);
                    assert_eq!(hit.image_src, target.image_src);
                    assert_eq!(hit.image_alt, target.image_alt);
                    assert_eq!(hit.footnote_key, target.footnote_key);
                    // The label a page target carries is the hit's text, or
                    // its image's alternative text when it has none.
                    let label = if hit.text.is_empty() {
                        hit.image_alt.clone().unwrap_or_default()
                    } else {
                        hit.text.clone()
                    };
                    assert_eq!(label, target.label);
                    // An image hit names its image by the href the artifact
                    // lists and reads it under.
                    if let (ReaderHitKind::Image, Some(src)) = (hit.kind, &hit.image_src) {
                        assert!(artifact.resources.iter().any(|resource| {
                            resource.kind == ReaderResourceKind::Image && &resource.href == src
                        }));
                        image_sources.insert((artifact.artifact_id, src.clone()));
                    }
                    kinds.insert(format!("{:?}", hit.kind));
                    destination_labels.extend(hit.destination_label.clone());
                }
                for (artifact_id, src) in std::mem::take(&mut image_sources) {
                    session
                        .read_resource(artifact_id, ReaderResourceKind::Image, &src)
                        .expect("an image hit's source reads as the artifact's resource");
                    images_read += 1;
                }
                session
                    .release_artifact(artifact.artifact_id)
                    .expect("spread releases");
            }
            session
                .release_artifact(first.artifact_id)
                .expect("chapter releases");
        }
    }
    assert_eq!(
        kinds.into_iter().collect::<Vec<_>>(),
        ["Footnote", "Image", "Link", "Text"],
        "the fixtures hold every kind a laid-out definition gives"
    );
    assert!(images_read > 0, "the fixtures hold an image outside a link");
    assert!(
        destination_labels.contains("Two"),
        "a link into chapter two carries that chapter's TOC label: {destination_labels:?}"
    );
}
