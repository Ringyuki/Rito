use super::{bounded_request, complete_revision};
use crate::layout::LineBreaking;
use crate::runtime::tests::fixture::{fixture_epub, layout, multi_chapter_image_fixture_epub};
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
