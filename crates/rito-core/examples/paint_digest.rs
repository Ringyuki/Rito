//! Digests every spread a reader session paints for a set of books, as a
//! host resizing the reader would ask for them.
//!
//! Usage: `paint-digest <fonts-dir> <out.tsv> <epub>...`. Each book opens
//! on a session with the demo reader's four pinned faces, commits its
//! first chapter and then the whole book, moves to the middle of the book,
//! and lays out again under a fixed sequence of layouts (narrower, back,
//! single page, larger type, a 2x render ratio, the first layout again).
//! Each layout writes the chapter commit's spread and every spread of the
//! whole book as one row: book, step, scope, spread index and a SHA-256
//! over what the spread paints (display list bytes, pages, resources,
//! fonts, book page numbers). Engine work that must not change what is
//! painted keeps the file byte-identical.

use std::{env, fmt::Write as _, fs, process};

use rito_core::runtime::{
    ReaderArtifact, ReaderArtifactRequest, ReaderBackgroundHandoff, ReaderBackgroundRequest,
    ReaderForegroundHandoff, ReaderLayout, ReaderLocator, ReaderSession, ReaderSpreadMode,
    ReaderSpreadRequest, ReaderTextRenderingProfile, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole, RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
};
use sha2::{Digest, Sha256};

const SESSION: u64 = 1;

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 3 {
        eprintln!("usage: paint-digest <fonts-dir> <out.tsv> <epub>...");
        process::exit(2);
    }
    let policy = match production_policy(&args[0]) {
        Ok(policy) => policy,
        Err(error) => {
            eprintln!("paint-digest: {error}");
            process::exit(1);
        }
    };
    let mut out = String::from("book\tstep\tscope\tspread\tdigest\n");
    for path in &args[2..] {
        let name = path.rsplit('/').next().unwrap_or(path);
        match digest_book(path, policy.clone()) {
            Ok(rows) => {
                eprintln!("{name}: {} rows", rows.len());
                for row in rows {
                    let _ = writeln!(out, "{name}\t{row}");
                }
            }
            Err(error) => {
                eprintln!("{name}: {error}");
                let _ = writeln!(out, "{name}\t-\terror\t-\t{error}");
            }
        }
    }
    if let Err(error) = fs::write(&args[1], out) {
        eprintln!("paint-digest: write {}: {error}", args[1]);
        process::exit(1);
    }
}

fn production_policy(dir: &str) -> Result<RuntimePinnedFontPolicyInput, String> {
    let face = |file: &str, role: RuntimePinnedFontGenericRole, language: &str| {
        let bytes = fs::read(format!("{dir}/{file}")).map_err(|e| format!("read {file}: {e}"))?;
        Ok::<_, String>(RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
            generic_role: role,
            language: Some(
                RuntimePinnedFontLanguageTag::parse(language).map_err(|e| format!("{e:?}"))?,
            ),
        })
    };
    use RuntimePinnedFontGenericRole::{SansSerif, Serif};
    Ok(RuntimePinnedFontPolicyInput {
        faces: vec![
            face("Tinos-Regular.ttf", Serif, "und")?,
            face("SourceHanSerifCN-Regular.otf", Serif, "zh-Hans")?,
            face("Arimo-Regular.ttf", SansSerif, "und")?,
            face("SourceHanSansCN-Regular.otf", SansSerif, "zh-Hans")?,
        ],
    })
}

/// The layouts a book is laid out under, in order, after it opens.
fn steps() -> Vec<(&'static str, ReaderLayout)> {
    let double = |width: f64| ReaderLayout {
        render_ratio: 1.0,
        viewport_width: width,
        viewport_height: 900.0,
        margin_top: 50.0,
        margin_right: 50.0,
        margin_bottom: 50.0,
        margin_left: 50.0,
        spread_mode: ReaderSpreadMode::Double,
        first_page_alone: true,
        spread_gap: 20.0,
        root_font_size: 16.0,
        line_height_override: None,
        font_family_override: None,
        line_height_force: false,
        font_family_force: false,
    };
    let single = ReaderLayout {
        viewport_width: 600.0,
        margin_top: 40.0,
        margin_right: 40.0,
        margin_bottom: 40.0,
        margin_left: 40.0,
        spread_mode: ReaderSpreadMode::Single,
        spread_gap: 0.0,
        ..double(600.0)
    };
    vec![
        ("narrower", double(1150.0)),
        ("narrowest", double(1110.0)),
        ("back", double(1150.0)),
        ("single", single.clone()),
        (
            "larger-type",
            ReaderLayout {
                root_font_size: 20.0,
                ..single.clone()
            },
        ),
        (
            "ratio-2",
            ReaderLayout {
                render_ratio: 2.0,
                ..single
            },
        ),
        ("first", double(1190.0)),
    ]
}

struct Book {
    session: ReaderSession,
    request_id: u64,
    visible: u64,
    /// The position the page shown keeps, as a host lays out again from it.
    locator: ReaderLocator,
    rows: Vec<String>,
}

impl Book {
    fn next_id(&mut self) -> u64 {
        self.request_id += 1;
        self.request_id
    }

    /// Lays the chapter at `locator` out under `layout` and shows it.
    fn show_chapter(
        &mut self,
        step: &str,
        layout: &ReaderLayout,
        locator: ReaderLocator,
        first: bool,
    ) -> Result<(), String> {
        let request_id = self.next_id();
        let artifact = self
            .session
            .request_artifact(ReaderArtifactRequest {
                session_id: SESSION,
                request_id,
                layout: layout.clone(),
                locator,
                text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
            })
            .map_err(|e| format!("{step} request: {e:?}"))?;
        self.session
            .adopt_foreground_candidate(ReaderForegroundHandoff {
                session_id: SESSION,
                expected_visible_artifact_id: (!first).then_some(self.visible),
                candidate_artifact_id: artifact.artifact_id,
            })
            .map_err(|e| format!("{step} adopt: {e:?}"))?;
        self.replace_visible(&artifact)?;
        self.rows
            .push(row(step, "chapter", artifact.local_spread_index, &artifact));
        Ok(())
    }

    /// Lays the whole book out behind the page shown, shows it, and
    /// digests every spread.
    fn show_book(&mut self, step: &str) -> Result<(), String> {
        let mut candidate = None;
        for _ in 0..100_000 {
            let advance = self
                .session
                .advance_background_once(ReaderBackgroundRequest {
                    session_id: SESSION,
                    expected_visible_artifact_id: self.visible,
                    max_pages_per_quantum: 512,
                })
                .map_err(|e| format!("{step} advance: {e:?}"))?;
            if let Some(artifact) = advance.artifact {
                candidate = Some(artifact);
                break;
            }
        }
        let candidate = candidate.ok_or_else(|| format!("{step}: the whole book never arrived"))?;
        self.session
            .adopt_background_candidate(ReaderBackgroundHandoff {
                session_id: SESSION,
                expected_visible_artifact_id: self.visible,
                candidate_artifact_id: candidate.artifact_id,
            })
            .map_err(|e| format!("{step} adopt book: {e:?}"))?;
        self.replace_visible(&candidate)?;
        for spread_index in 0.. {
            let request_id = self.next_id();
            let peeked = self.session.peek_spread(ReaderSpreadRequest {
                session_id: SESSION,
                request_id,
                from_artifact_id: self.visible,
                spread_index,
            });
            let peeked = match peeked {
                Ok(peeked) => peeked,
                Err(error) => {
                    // Past the last spread; any other refusal shows in the file.
                    let kind = format!("{:?}", error.kind);
                    self.rows
                        .push(format!("{step}\tbook-end\t{spread_index}\t{kind}"));
                    break;
                }
            };
            self.rows.push(row(step, "book", spread_index, &peeked));
            self.session
                .release_artifact(peeked.artifact_id)
                .map_err(|e| format!("{step} release peek: {e:?}"))?;
        }
        Ok(())
    }

    fn replace_visible(&mut self, artifact: &ReaderArtifact) -> Result<(), String> {
        let artifact_id = artifact.artifact_id;
        self.locator = artifact.locator.clone();
        let previous = std::mem::replace(&mut self.visible, artifact_id);
        if previous != 0 && previous != artifact_id {
            self.session
                .release_artifact(previous)
                .map_err(|e| format!("release replaced: {e:?}"))?;
        }
        Ok(())
    }
}

fn digest_book(path: &str, policy: RuntimePinnedFontPolicyInput) -> Result<Vec<String>, String> {
    let bytes = fs::read(path).map_err(|e| format!("read: {e}"))?;
    let session = ReaderSession::open_owned_with_pinned_font_policy(SESSION, bytes, policy)
        .map_err(|e| format!("open: {e:?}"))?;
    let middle = {
        let spine = &session.publication().spine;
        spine[spine.len() / 2].href.clone()
    };
    let start = |href: &str| ReaderLocator {
        href: href.to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    };
    let mut book = Book {
        session,
        request_id: 0,
        visible: 0,
        locator: start(""),
        rows: Vec::new(),
    };
    let opening = ReaderLayout {
        viewport_width: 1190.0,
        ..steps()[0].1.clone()
    };
    book.show_chapter("open", &opening, start(""), true)?;
    book.show_book("open")?;
    book.show_chapter("middle", &opening, start(&middle), false)?;
    book.show_book("middle")?;
    for (step, layout) in steps() {
        let locator = book.locator.clone();
        book.show_chapter(step, &layout, locator, false)?;
        book.show_book(step)?;
    }
    Ok(book.rows)
}

fn row(step: &str, scope: &str, spread_index: u32, artifact: &ReaderArtifact) -> String {
    let mut hasher = Sha256::new();
    hasher.update(&artifact.display_list.bytes);
    hasher.update(format!(
        "{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}",
        artifact.pages,
        artifact.resources,
        artifact.fonts,
        artifact.local_page_indexes,
        artifact.book_page_index,
        artifact.book_page_count,
        artifact.navigation,
    ));
    format!("{step}\t{scope}\t{spread_index}\t{:x}", hasher.finalize())
}
