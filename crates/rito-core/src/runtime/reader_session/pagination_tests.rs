//! A chapter-local revision paginates only as far as its reader needs, and
//! publishes exactly what one paginating its whole chapter would: a reader
//! resizing through a run of widths, turning forward past the pages
//! paginated so far and back, and searching sees the same artifacts from
//! both.

use super::{
    tests::{adopt_initial, open_test_session, request},
    ReaderAdjacentDirection, ReaderAdjacentRequest, ReaderArtifact, ReaderForegroundHandoff,
    ReaderLocator, ReaderNavigationQuery, ReaderNavigationRequest, ReaderNavigationResult,
    ReaderRevisionLayout, ReaderSearchRequest, ReaderSession,
};

const SESSION: u64 = 171;

#[derive(Debug, Clone, Copy)]
enum Step {
    Resize(f64),
    Turn(ReaderAdjacentDirection),
}

struct Reader {
    session: ReaderSession,
    request_id: u64,
    visible: u64,
    locator: ReaderLocator,
    width: f64,
}

impl Reader {
    /// Opens a fifth of the way into a chapter whose paragraphs run over
    /// several pages and turns a page, so the position kept across sizes
    /// is a source point inside a paragraph begun on an earlier page.
    fn open(whole: bool) -> Self {
        let publication = crate::runtime::tests::fixture::long_paragraphs_fixture_epub();
        let mut session = open_test_session(SESSION, publication).expect("reader session");
        session.paginate_whole_chapters(whole);
        let mut opening = request(SESSION, 1, "chapter.xhtml");
        opening.locator.progression = Some(0.2);
        let opened = session
            .request_artifact(opening)
            .expect("the chapter opens");
        adopt_initial(&mut session, SESSION, opened.artifact_id);
        let mut reader = Self {
            session,
            request_id: 1,
            visible: opened.artifact_id,
            locator: opened.locator,
            width: 420.0,
        };
        reader.step(Step::Turn(ReaderAdjacentDirection::Next));
        reader
    }

    fn step(&mut self, step: Step) -> ReaderArtifact {
        self.request_id += 1;
        let artifact = match step {
            Step::Resize(width) => {
                let mut resized = request(SESSION, self.request_id, "chapter.xhtml");
                resized.layout.viewport_width = width;
                resized.locator = self.locator.clone();
                self.width = width;
                self.session.request_artifact(resized)
            }
            Step::Turn(direction) => self.session.request_adjacent(ReaderAdjacentRequest {
                session_id: SESSION,
                request_id: self.request_id,
                from_artifact_id: self.visible,
                direction,
            }),
        }
        .expect("the step publishes");
        self.session
            .adopt_foreground_candidate(ReaderForegroundHandoff {
                session_id: SESSION,
                expected_visible_artifact_id: Some(self.visible),
                candidate_artifact_id: artifact.artifact_id,
            })
            .expect("the step's artifact adopts");
        self.session
            .release_artifact(self.visible)
            .expect("the artifact it replaces releases");
        self.visible = artifact.artifact_id;
        self.locator = artifact.locator.clone();
        artifact
    }
}

/// What an artifact shows, its identities aside.
fn shown(artifact: &ReaderArtifact) -> impl PartialEq + std::fmt::Debug + '_ {
    (
        &artifact.locator,
        artifact.matched_by,
        artifact.local_page_index,
        artifact.local_spread_index,
        &artifact.local_page_indexes,
        &artifact.navigation,
        &artifact.display_list,
        &artifact.resources,
        &artifact.fonts,
        &artifact.pages,
    )
}

#[test]
fn a_chapter_paginated_as_far_as_its_reader_needs_publishes_what_the_whole_chapter_does() {
    let mut whole = Reader::open(true);
    let mut settled = Reader::open(false);
    let next = ReaderAdjacentDirection::Next;
    let steps = [404.0, 388.0, 371.5, 350.0, 420.0]
        .map(Step::Resize)
        .into_iter()
        .chain(std::iter::repeat_n(Step::Turn(next), 6))
        .chain([
            Step::Turn(ReaderAdjacentDirection::Previous),
            Step::Resize(397.0),
        ]);
    let mut stopped_short = false;
    for step in steps {
        let expected = whole.step(step);
        let actual = settled.step(step);
        assert_eq!(shown(&actual), shown(&expected), "{step:?}");
        let (pages, complete) = settled
            .session
            .artifact_pagination(settled.visible)
            .expect("a chapter-local artifact");
        stopped_short |= !complete;
        assert!(
            complete || pages <= actual.local_page_index as usize + 3,
            "{step:?}: {pages} pages paginated for page {}",
            actual.local_page_index
        );
    }
    assert!(
        stopped_short,
        "the reader never needed less than the whole chapter"
    );

    let search = |reader: &mut Reader| {
        reader
            .session
            .search(ReaderSearchRequest {
                session_id: SESSION,
                artifact_id: reader.visible,
                query: "the".to_owned(),
                case_sensitive: false,
                whole_word: true,
                limit: 0,
            })
            .expect("the chapter searches")
    };
    assert_eq!(search(&mut settled), search(&mut whole));
    assert_eq!(
        settled.session.artifact_pagination(settled.visible),
        whole.session.artifact_pagination(whole.visible),
        "a search reads the whole chapter"
    );
}

fn navigate(reader: &mut Reader, query: ReaderNavigationQuery) -> ReaderNavigationResult {
    reader
        .session
        .resolve_navigation(ReaderNavigationRequest {
            session_id: SESSION,
            query,
        })
        .expect("the navigation query answers")
}

fn page_table(reader: &mut Reader, whole: bool) -> ReaderRevisionLayout {
    let artifact_id = reader.visible;
    match navigate(reader, ReaderNavigationQuery::Layout { artifact_id, whole }) {
        ReaderNavigationResult::Layout(layout) => layout,
        other => panic!("a layout query answered {other:?}"),
    }
}

#[test]
fn a_page_table_and_a_locator_read_only_the_pages_laid_out_so_far() {
    let mut whole = Reader::open(true);
    let mut settled = Reader::open(false);
    for reader in [&mut whole, &mut settled] {
        reader.step(Step::Resize(388.0));
    }
    // The position the reader keeps lands where it does among all pages,
    // and asking it lays nothing more out.
    let locate = |reader: &mut Reader| {
        let (artifact_id, locator) = (reader.visible, reader.locator.clone());
        navigate(
            reader,
            ReaderNavigationQuery::Locate {
                artifact_id,
                locator,
            },
        )
    };
    let paginated = settled.session.artifact_pagination(settled.visible);
    assert_eq!(locate(&mut settled), locate(&mut whole));
    assert_eq!(
        settled.session.artifact_pagination(settled.visible),
        paginated,
        "locating the shown position paginates nothing more"
    );
    let all = page_table(&mut whole, true);
    let part = page_table(&mut settled, false);
    assert!(all.complete);
    assert!(!part.complete, "the chapter was laid out only in part");
    assert!(part.page_count < all.page_count);
    assert_eq!(part.spreads[..], all.spreads[..part.spreads.len()]);
    assert_eq!(
        part.active_toc_entry_by_page[..],
        all.active_toc_entry_by_page[..part.active_toc_entry_by_page.len()]
    );
    assert_eq!(page_table(&mut settled, true), all);
}
