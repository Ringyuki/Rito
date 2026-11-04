//! Measures what laying each chapter of a corpus out as one continuous
//! strip costs, beside what paginating it costs today: the numbers a
//! scrolled reading mode is designed against.
//!
//! Ignored; run in release with the corpus and the demo reader's fonts:
//!
//! ```text
//! RITO_STRIP_PROBE_BOOKS=~/rito-corpus RITO_STRIP_PROBE_FONTS=apps/reader/src/assets/fonts \
//! RITO_STRIP_PROBE_OUT=strip.tsv [RITO_STRIP_PROBE_ONLY=001,003] [RITO_STRIP_PROBE_CHAPTER=4] \
//! cargo test -p rito-core --release --lib strip_cost_probe::strip_cost_probe -- --ignored --nocapture
//! ```
//!
//! (`strip_cost_probe::session_open_cost_probe`,
//! `strip_cost_probe::background_step_probe` and
//! `strip_cost_probe::window_text_probe` take the same variables and
//! `RITO_STRIP_PROBE_ONLY`; they all write the same report, so run one at a
//! time. `window_text_probe` also takes `RITO_STRIP_PROBE_DUMP=<dir>`, where
//! it writes both record trees of a window that differs.)
//!
//! Every chapter is measured at a desktop and a phone viewport, each pass
//! on a document opened afresh so no chapter starts with another pass's
//! caches. One row per chapter and viewport:
//! - `open_ms`: today's cold open, through the chapter's first page;
//! - `strip_cold_ms`: the whole chapter laid out continuously right after,
//!   without text (what a cold scrolled open adds);
//! - `strip_text_ms`: the same with every line's text, its fragments and
//!   their estimated heap bytes;
//! - `paged_ms` / `page_max_ms`: paginating the rest of the chapter page by
//!   page, as the background does, in total and its slowest page;
//! - `seal_ms`: the continuous layout after that pagination;
//! - `window_ms` / `lower_ms`: a middle page's text and paint at the
//!   viewport's ratio, then its lowering and encoding (a window the size of
//!   the viewport does the same work).

use std::{
    collections::HashSet,
    env, fs,
    mem::size_of,
    path::{Path, PathBuf},
    rc::Rc,
    time::Instant,
};

use rito_fragment::{
    CancelFlag, ClusterPosition, ConstraintSpace, FormattingContext, FormattingTree, Fragment,
    LineText, TextSegment,
};

use super::pinned_font_policy_fixtures::{face, policy};
use crate::fragment_pagination::{chapter_is_vertical, ChapterPaginator};
use crate::layout::{
    create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
};
use crate::render::{encode_reader_primitive_list, lower};
use crate::runtime::source_locator::PaginationTarget;
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole, RuntimePinnedFontPolicyInput};

struct Viewport {
    name: &'static str,
    width: f64,
    height: f64,
    margin: f64,
    ratio: f64,
}

const VIEWPORTS: [Viewport; 2] = [
    Viewport {
        name: "desktop",
        width: 1500.0,
        height: 950.0,
        margin: 50.0,
        ratio: 1.0,
    },
    Viewport {
        name: "phone",
        width: 390.0,
        height: 844.0,
        margin: 20.0,
        ratio: 3.0,
    },
];

#[test]
#[ignore = "corpus measurement; see the module docs"]
fn strip_cost_probe() {
    let books = PathBuf::from(env::var("RITO_STRIP_PROBE_BOOKS").expect("RITO_STRIP_PROBE_BOOKS"));
    let fonts = PathBuf::from(env::var("RITO_STRIP_PROBE_FONTS").expect("RITO_STRIP_PROBE_FONTS"));
    let out = env::var("RITO_STRIP_PROBE_OUT").expect("RITO_STRIP_PROBE_OUT");
    let only = env::var("RITO_STRIP_PROBE_ONLY").ok();
    let mut paths = fs::read_dir(&books)
        .expect("corpus dir reads")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "epub"))
        .filter(|path| {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            only.as_deref()
                .is_none_or(|only| only.split(',').any(|prefix| name.starts_with(prefix)))
        })
        .collect::<Vec<_>>();
    paths.sort();
    let mut rows = String::from(
        "book\tchapter\tviewport\tvertical\tpages\tstrip_len\topen_ms\tstrip_cold_ms\t\
         strip_text_ms\ttext_fragments\ttext_bytes\tpaged_ms\tpage_max_ms\tseal_ms\t\
         window_ms\tlower_ms\twindow_size\terror\n",
    );
    for path in paths {
        let book = path.file_name().unwrap_or_default().to_string_lossy();
        let book = book.split(' ').next().unwrap_or_default().to_owned();
        let bytes = fs::read(&path).expect("book reads");
        let chapters = match open(&bytes, &fonts) {
            Ok(document) => document.chapter_count(),
            Err(error) => {
                eprintln!("{book}: does not open: {error}");
                continue;
            }
        };
        let only_chapter = env::var("RITO_STRIP_PROBE_CHAPTER")
            .ok()
            .and_then(|value| value.parse::<usize>().ok());
        for chapter in
            (0..chapters).filter(|chapter| only_chapter.is_none_or(|only| only == *chapter))
        {
            for viewport in &VIEWPORTS {
                let row = measure(&bytes, &fonts, chapter, viewport)
                    .unwrap_or_else(|error| format!("{}\t{error}", "\t".repeat(14)));
                let line = format!("{book}\t{chapter}\t{}\t{row}\n", viewport.name);
                eprint!("{line}");
                rows.push_str(&line);
            }
        }
        fs::write(&out, &rows).expect("report writes");
    }
}

fn measure(
    bytes: &[u8],
    fonts: &Path,
    chapter: usize,
    viewport: &Viewport,
) -> Result<String, String> {
    let config = layout_config(viewport);
    let content_width = config.page_width - config.margin_left - config.margin_right;
    let content_height = config.page_height - config.margin_top - config.margin_bottom;

    // Today's cold open, then the strip on what it left behind.
    let mut document = open(bytes, fonts)?;
    let started = Instant::now();
    let build =
        document.build_chapter_local_fragment_layout(&config, chapter, &PaginationTarget::Start)?;
    let open_ms = ms(started);
    let built = build.layout.materialized_tree(0).ok_or("no chapter tree")?;
    let engine = document
        .fragment_engine_handle()
        .ok_or("no fragment engine")?;
    let tree = &built.tree;
    let vertical = chapter_is_vertical(tree);
    let (strip_cold_ms, strip_len, _) = strip(
        &engine.engine,
        tree,
        content_width,
        content_height,
        LineText::Omitted,
    )?;
    let (strip_text_ms, _, root) = strip(
        &engine.engine,
        tree,
        content_width,
        content_height,
        LineText::All,
    )?;
    let mut heap = Heap::default();
    heap.add(&root);
    drop((root, build, engine, built, document));

    // The background's pagination, then the seal on what it left behind.
    let mut document = open(bytes, fonts)?;
    let mut build =
        document.build_chapter_local_fragment_layout(&config, chapter, &PaginationTarget::Start)?;
    let built = build.layout.materialized_tree(0).ok_or("no chapter tree")?;
    let engine = document
        .fragment_engine_handle()
        .ok_or("no fragment engine")?;
    let tree = &built.tree;
    let mut paginator = ChapterPaginator::new(tree, content_width, content_height, false);
    let (mut pages, mut paged_ms, mut page_max_ms) = (0_usize, 0.0_f64, 0.0_f64);
    loop {
        let started = Instant::now();
        let page = paginator
            .next_page(&engine.engine, tree, &CancelFlag::new())
            .map_err(|error| error.message().to_owned())?;
        let step = ms(started);
        if page.is_none() {
            break;
        }
        pages += 1;
        // The first page was laid out by the open: it is not background work.
        if pages > 1 {
            paged_ms += step;
            page_max_ms = page_max_ms.max(step);
        }
    }
    let (seal_ms, _, _) = strip(
        &engine.engine,
        tree,
        content_width,
        content_height,
        LineText::Omitted,
    )?;

    // A middle page shown at the viewport's ratio.
    build
        .layout
        .extend_chapter(None)
        .map_err(|error| error.message().to_owned())?;
    let page = build
        .layout
        .page(build.layout.page_count() / 2)
        .ok_or("no middle page")?;
    let started = Instant::now();
    let commands = page
        .commands_for(viewport.ratio)
        .map_err(|error| error.message().to_owned())?;
    let window_ms = ms(started);
    let started = Instant::now();
    let lowered = lower(commands.iter(), viewport.ratio, &|href| {
        document.image_size(href)
    })
    .map_err(|error| error.to_string())?;
    let encoded = encode_reader_primitive_list(&lowered).map_err(|error| format!("{error:?}"))?;
    let lower_ms = ms(started);
    let window_size = format!("{}/{}", lowered.commands.len(), encoded.bytes.len());

    Ok(format!(
        "{vertical}\t{pages}\t{strip_len:.0}\t{open_ms:.2}\t{strip_cold_ms:.2}\t{strip_text_ms:.2}\t\
         {}\t{}\t{paged_ms:.2}\t{page_max_ms:.2}\t{seal_ms:.2}\t{window_ms:.2}\t{lower_ms:.2}\t{window_size}\t",
        heap.fragments, heap.bytes
    ))
}

/// Lays the whole chapter out in one continuous block, as wide as a page's
/// content box and knowing how tall one is: its time, its block length and
/// its root.
fn strip(
    engine: &dyn FormattingContext,
    tree: &FormattingTree,
    content_width: f64,
    content_height: f64,
    line_text: LineText,
) -> Result<(f64, f64, Fragment), String> {
    let vertical = chapter_is_vertical(tree);
    let (inline, block) = if vertical {
        (content_height, content_width)
    } else {
        (content_width, content_height)
    };
    let space = ConstraintSpace {
        fragmentainer_size: Some(block),
        line_text,
        ..ConstraintSpace::continuous(inline)
    };
    let started = Instant::now();
    let outcome = engine
        .layout(tree, tree.root(), &space, None, &CancelFlag::new())
        .map_err(|error| format!("strip layout: {error:?}"))?;
    let elapsed = ms(started);
    if outcome.continuation.is_some() {
        return Err("a continuous layout broke".to_owned());
    }
    let root = outcome.fragments.root;
    let length = match &root {
        Fragment::Box(fragment) => fragment.rect.height,
        _ => 0.0,
    };
    Ok((elapsed, length, root))
}

/// Fragments a tree holds and the heap bytes they own, shared tables
/// counted once.
#[derive(Default)]
struct Heap {
    fragments: usize,
    bytes: usize,
    shared: HashSet<usize>,
}

impl Heap {
    fn add(&mut self, fragment: &Fragment) {
        self.fragments += 1;
        match fragment {
            Fragment::Box(fragment) => {
                self.bytes += fragment.children.capacity() * size_of::<Fragment>();
                fragment.children.iter().for_each(|child| self.add(child));
            }
            Fragment::Line(fragment) => {
                self.bytes += fragment.children.capacity() * size_of::<Fragment>()
                    + fragment.text_runs.capacity() * size_of::<(u32, u32)>();
                fragment.children.iter().for_each(|child| self.add(child));
            }
            Fragment::Text(fragment) => {
                self.slice::<ClusterPosition>(&fragment.clusters);
                if let Some(segments) = &fragment.segments {
                    self.slice::<TextSegment>(segments);
                }
            }
            Fragment::Image(_) => {}
        }
    }

    fn slice<T>(&mut self, slice: &Rc<[T]>) {
        if self.shared.insert(Rc::as_ptr(slice).cast::<u8>() as usize) {
            self.bytes += 2 * size_of::<usize>() + slice.len() * size_of::<T>();
        }
    }
}

fn open(bytes: &[u8], fonts: &Path) -> Result<RuntimeDocument, String> {
    RuntimeDocument::open_with_pinned_font_policy(bytes, demo_faces(fonts))
        .map_err(|error| error.message().to_owned())
}

fn demo_faces(fonts: &Path) -> RuntimePinnedFontPolicyInput {
    let read = |file: &str| fs::read(fonts.join(file)).expect("font reads");
    use RuntimePinnedFontGenericRole::{SansSerif, Serif};
    policy(vec![
        face(read("Tinos-Regular.ttf"), Serif, Some("und")),
        face(read("SourceHanSerifCN-Regular.otf"), Serif, Some("zh-Hans")),
        face(read("Arimo-Regular.ttf"), SansSerif, Some("und")),
        face(
            read("SourceHanSansCN-Regular.otf"),
            SansSerif,
            Some("zh-Hans"),
        ),
    ])
}

fn layout_config(viewport: &Viewport) -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: viewport.width,
        height: viewport.height,
        margin: MarginInput::All(viewport.margin),
        spread: SpreadMode::Single,
        first_page_alone: false,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        device_pixel_ratio: viewport.ratio,
    })
}

fn ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

/// What a reader session takes to open each chapter of `RITO_STRIP_PROBE_ONLY`
/// at its end, cold: the work the wasm build is timed on for the same
/// chapters (`RITO_STRIP_PROBE_OUT` lists them with their times).
#[test]
#[ignore = "corpus measurement; see the module docs"]
fn session_open_cost_probe() {
    use crate::runtime::{
        ReaderArtifactRequest, ReaderLayout, ReaderLocator, ReaderSession, ReaderSpreadMode,
        ReaderTextRenderingProfile,
    };
    let books = PathBuf::from(env::var("RITO_STRIP_PROBE_BOOKS").expect("RITO_STRIP_PROBE_BOOKS"));
    let fonts = PathBuf::from(env::var("RITO_STRIP_PROBE_FONTS").expect("RITO_STRIP_PROBE_FONTS"));
    let out = env::var("RITO_STRIP_PROBE_OUT").expect("RITO_STRIP_PROBE_OUT");
    let only = env::var("RITO_STRIP_PROBE_ONLY").expect("RITO_STRIP_PROBE_ONLY");
    let mut rows = String::from("book\thref\tms\n");
    for prefix in only.split(',') {
        let path = fs::read_dir(&books)
            .expect("corpus dir reads")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .find(|path| {
                path.extension().is_some_and(|ext| ext == "epub")
                    && path
                        .file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with(prefix))
            })
            .expect("book is in the corpus");
        let bytes = fs::read(&path).expect("book reads");
        let document = open(&bytes, &fonts).expect("book opens");
        let hrefs = document
            .document
            .chapters
            .iter()
            .map(|chapter| chapter.href.clone())
            .collect::<Vec<_>>();
        drop(document);
        for href in hrefs {
            let mut best = f64::INFINITY;
            for _ in 0..3 {
                let mut session = ReaderSession::open_owned_with_pinned_font_policy(
                    1,
                    bytes.clone(),
                    demo_faces(&fonts),
                )
                .expect("session opens");
                let started = Instant::now();
                let artifact = session.request_artifact(ReaderArtifactRequest {
                    session_id: 1,
                    request_id: 1,
                    layout: ReaderLayout {
                        render_ratio: 1.0,
                        viewport_width: 1500.0,
                        viewport_height: 950.0,
                        margin_top: 50.0,
                        margin_right: 50.0,
                        margin_bottom: 50.0,
                        margin_left: 50.0,
                        spread_mode: ReaderSpreadMode::Single,
                        first_page_alone: false,
                        spread_gap: 0.0,
                        root_font_size: 16.0,
                        line_height_override: None,
                        font_family_override: None,
                        line_height_force: false,
                        font_family_force: false,
                    },
                    locator: ReaderLocator {
                        href: href.clone(),
                        anchor_id: None,
                        source_point: None,
                        source_range: None,
                        progression: Some(0.999),
                    },
                    text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
                });
                best = best.min(ms(started));
                if artifact.is_err() {
                    best = f64::NAN;
                    break;
                }
            }
            let line = format!("{prefix}\t{href}\t{best:.2}\n");
            eprint!("{line}");
            rows.push_str(&line);
        }
    }
    fs::write(&out, rows).expect("report writes");
}

/// What each step of a whole-book layout costs on the thread a host draws
/// on: every book at both viewports, paginated and scrolled, stepped by the
/// frame quantum the hosts ask for, each step timed. One row per book,
/// viewport and mode: the steps, their total, their slowest, their 99th
/// percentile, and how many took longer than a 60 Hz frame. Takes the same
/// variables as [`strip_cost_probe`].
#[test]
#[ignore = "corpus measurement; see the module docs"]
fn background_step_probe() {
    use crate::layout::SpreadMode;
    use crate::runtime::reader_session::READER_FRAME_QUANTUM_PAGES;
    use crate::runtime::revision::RevisionProgress;

    let books = PathBuf::from(env::var("RITO_STRIP_PROBE_BOOKS").expect("RITO_STRIP_PROBE_BOOKS"));
    let fonts = PathBuf::from(env::var("RITO_STRIP_PROBE_FONTS").expect("RITO_STRIP_PROBE_FONTS"));
    let out = env::var("RITO_STRIP_PROBE_OUT").expect("RITO_STRIP_PROBE_OUT");
    let only = env::var("RITO_STRIP_PROBE_ONLY").ok();
    let mut paths = fs::read_dir(&books)
        .expect("corpus dir reads")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "epub"))
        .filter(|path| {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            only.as_deref()
                .is_none_or(|only| only.split(',').any(|prefix| name.starts_with(prefix)))
        })
        .collect::<Vec<_>>();
    paths.sort();
    let mut rows =
        String::from("book\tviewport\tmode\tsteps\ttotal_ms\tmax_ms\tp99_ms\tover_16\terror\n");
    for path in paths {
        let book = path.file_name().unwrap_or_default().to_string_lossy();
        let book = book.split(' ').next().unwrap_or_default().to_owned();
        let bytes = fs::read(&path).expect("book reads");
        for viewport in &VIEWPORTS {
            for (mode, spread) in [
                ("paged", SpreadMode::Single),
                ("scrolled", SpreadMode::Scrolled),
            ] {
                let mut config = layout_config(viewport);
                config.spread_mode = spread;
                let row = (|| -> Result<String, String> {
                    let mut document = open(&bytes, &fonts)?;
                    let mut build = document
                        .begin_revision(&config)
                        .map_err(|error| error.message().to_owned())?;
                    let mut times = Vec::new();
                    loop {
                        let started = Instant::now();
                        let progress = document
                            .advance_revision(build, READER_FRAME_QUANTUM_PAGES as usize)
                            .map_err(|error| error.message().to_owned())?;
                        times.push(ms(started));
                        match progress {
                            RevisionProgress::Pending(next) => build = *next,
                            RevisionProgress::Done(_) => break,
                        }
                    }
                    let total: f64 = times.iter().sum();
                    let over = times.iter().filter(|time| **time > 16.0).count();
                    times.sort_by(f64::total_cmp);
                    let max = times.last().copied().unwrap_or_default();
                    let p99 = times[(times.len() * 99 / 100).min(times.len() - 1)];
                    Ok(format!(
                        "{}\t{total:.1}\t{max:.2}\t{p99:.2}\t{over}\t",
                        times.len()
                    ))
                })()
                .unwrap_or_else(|error| format!("\t\t\t\t\t{error}"));
                let line = format!("{book}\t{}\t{mode}\t{row}\n", viewport.name);
                eprint!("{line}");
                rows.push_str(&line);
            }
        }
    }
    fs::write(&out, rows).expect("report writes");
}

/// Whether laying a window's text out around it reads as the whole strip
/// laid out with its text does, and what it costs: every horizontal chapter
/// of every book at both viewports, each window's text laid out on the
/// strip laid out without it, its frame (at the viewport's ratio) and its
/// records compared with the whole text strip's. One row per chapter and
/// viewport: its windows, how many frames and records differ, the slowest
/// and 99th-percentile window, and the most text fragments a window holds
/// beside the whole strip's. Takes the same variables as
/// [`strip_cost_probe`].
#[test]
#[ignore = "corpus measurement; see the module docs"]
fn window_text_probe() {
    let books = PathBuf::from(env::var("RITO_STRIP_PROBE_BOOKS").expect("RITO_STRIP_PROBE_BOOKS"));
    let fonts = PathBuf::from(env::var("RITO_STRIP_PROBE_FONTS").expect("RITO_STRIP_PROBE_FONTS"));
    let out = env::var("RITO_STRIP_PROBE_OUT").expect("RITO_STRIP_PROBE_OUT");
    let only = env::var("RITO_STRIP_PROBE_ONLY").ok();
    let mut paths = fs::read_dir(&books)
        .expect("corpus dir reads")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "epub"))
        .filter(|path| {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            only.as_deref()
                .is_none_or(|only| only.split(',').any(|prefix| name.starts_with(prefix)))
        })
        .collect::<Vec<_>>();
    paths.sort();
    let mut rows = String::from(
        "book\tchapter\tviewport\twindows\tframes_differ\trecords_differ\tmax_ms\tp99_ms\t\
         window_text_max\twhole_text\terror\n",
    );
    for path in paths {
        let book = path.file_name().unwrap_or_default().to_string_lossy();
        let book = book.split(' ').next().unwrap_or_default().to_owned();
        let bytes = fs::read(&path).expect("book reads");
        for viewport in &VIEWPORTS {
            let mut config = layout_config(viewport);
            config.spread_mode = SpreadMode::Scrolled;
            let lines = window_text_rows(&bytes, &fonts, &config, viewport.ratio)
                .unwrap_or_else(|error| vec![format!("\t\t\t\t\t\t\t\t{error}")]);
            for line in lines {
                let (chapter, rest) = line.split_once('\t').unwrap_or((&line, ""));
                let line = format!("{book}\t{chapter}\t{}\t{rest}\n", viewport.name);
                eprint!("{line}");
                rows.push_str(&line);
            }
        }
        fs::write(&out, &rows).expect("report writes");
    }
}

/// One row per chapter (from its index on) for [`window_text_probe`].
fn window_text_rows(
    bytes: &[u8],
    fonts: &Path,
    config: &LayoutConfig,
    ratio: f64,
) -> Result<Vec<String>, String> {
    let mut document = open(bytes, fonts)?;
    let revision_id = document
        .create_revision(config)
        .map_err(|error| error.message)?
        .revision_id;
    let layout = &document.revisions[&revision_id].fragment_layout;
    let engine = layout.strip_engine().ok_or("no build inputs")?;
    let mut rows = Vec::new();
    for chapter in 0..layout.chapters().count() {
        let strips = layout
            .chapter_strip_laid_out(chapter, false)
            .and_then(|plain| Ok((plain, layout.chapter_strip_laid_out(chapter, true)?)));
        let (plain, whole) = match strips {
            Ok(strips) => strips,
            Err(error) => {
                rows.push(format!("{chapter}\t\t\t\t\t\t\t\t{}", error.message()));
                continue;
            }
        };
        let (mut frames, mut records, mut most) = (0, 0, 0);
        let mut times = Vec::new();
        for window in 0..plain.windows().count() {
            let started = Instant::now();
            let text = plain
                .window_text(engine, window)
                .map_err(|error| error.message().to_owned())?;
            times.push(ms(started));
            most = most.max(text_fragments(&text));
            let frame = |strip: &crate::runtime::scroll_strip::ChapterStrip, text: &Fragment| {
                strip
                    .window_frame(text, window..window + 1, ratio)
                    .map(|(commands, _)| commands)
                    .map_err(|error| error.message().to_owned())
            };
            if frame(&plain, &text)? != frame(&whole, whole.whole())? {
                frames += 1;
            }
            if plain.window_text_page_root(&text, window) != whole.window_page_root(window) {
                records += 1;
                if let Ok(dir) = env::var("RITO_STRIP_PROBE_DUMP") {
                    let _ = fs::write(
                        format!("{dir}/c{chapter}w{window}-plain.txt"),
                        format!("{:#?}", plain.window_text_page_root(&text, window)),
                    );
                    let _ = fs::write(
                        format!("{dir}/c{chapter}w{window}-whole.txt"),
                        format!("{:#?}", whole.window_page_root(window)),
                    );
                }
            }
        }
        times.sort_by(f64::total_cmp);
        let max = times.last().copied().unwrap_or_default();
        let p99 = times
            .get((times.len() * 99 / 100).min(times.len().saturating_sub(1)))
            .copied()
            .unwrap_or_default();
        rows.push(format!(
            "{chapter}\t{}\t{frames}\t{records}\t{max:.2}\t{p99:.2}\t{most}\t{}\t",
            times.len(),
            text_fragments(whole.whole())
        ));
    }
    Ok(rows)
}

fn text_fragments(fragment: &Fragment) -> usize {
    match fragment {
        Fragment::Text(_) => 1,
        Fragment::Box(inner) => inner.children.iter().map(text_fragments).sum(),
        Fragment::Line(line) => line.children.iter().map(text_fragments).sum(),
        Fragment::Image(_) => 0,
    }
}
