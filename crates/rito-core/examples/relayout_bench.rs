//! Times laying one chapter out again at a run of widths, as the reader
//! does for every size of a window being resized, and then the whole book.
//!
//! Usage: `relayout-bench <epub> <fonts-dir> [chapter-href] [frames]`.
//! The book opens with the demo reader's four pinned faces. Without a
//! chapter href the chapter with the most pages in the whole book is used. Each frame
//! creates the chapter-local revision the reader session creates on a
//! resize (900 high, double pages, from 1186 px wide and 4 px narrower
//! each frame, cycling over 30 widths, none of them the 1190 the book was
//! first laid out at) at the reading anchor of a page in the chapter, and
//! releases it; the time of each is reported, then that of one whole-book
//! layout.
//! With `RELAYOUT_BENCH_FRAMES` set, every frame's time is printed too;
//! with `RELAYOUT_BENCH_NO_BOOK` set, the closing whole-book layout is
//! skipped, so the work of the frames is the difference between two runs
//! with different frame counts.

use std::{env, fs, process, time::Instant};

use rito_core::layout::{create_layout_config, LayoutConfigInput, MarginInput, SpreadMode};
use rito_core::runtime::{
    RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalRevisionRequest, RuntimeDocument,
    RuntimePageReadingAnchor, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput, RuntimeSourceLocator,
    RuntimeSourceLocatorResolution,
};
use sha2::{Digest, Sha256};

fn main() {
    if let Err(error) = run() {
        eprintln!("relayout-bench: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 2 {
        return Err("usage: relayout-bench <epub> <fonts-dir> [chapter-href] [frames]".to_owned());
    }
    let bytes = fs::read(&args[0]).map_err(|e| format!("read {}: {e}", args[0]))?;
    let frames = args
        .get(3)
        .map_or(Ok(30), |value| value.parse::<usize>())
        .map_err(|e| format!("frames: {e}"))?;
    let mut document = RuntimeDocument::open_with_pinned_font_policy(&bytes, policy(&args[1])?)
        .map_err(|e| format!("open: {e:?}"))?;
    let config = |width: f64| {
        create_layout_config(LayoutConfigInput {
            width,
            height: 900.0,
            margin: MarginInput::All(50.0),
            spread: SpreadMode::Double,
            first_page_alone: true,
            spread_gap: 20.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            device_pixel_ratio: 1.0,
        })
    };

    // The position kept through the resizes: a page a little into the chapter.
    let started = Instant::now();
    let book = document
        .create_revision(&config(1190.0))
        .map_err(|e| format!("book: {e:?}"))?;
    let cold_book_ms = started.elapsed().as_secs_f64() * 1000.0;
    // Each chapter's first page in the book, in spine order.
    let hrefs = document
        .document()
        .chapters
        .iter()
        .map(|chapter| chapter.href.clone())
        .collect::<Vec<_>>();
    let mut starts = Vec::new();
    for (index, href) in hrefs.iter().enumerate() {
        if let Ok(RuntimeSourceLocatorResolution::Resolved { page_index, .. }) =
            document.resolve_source_locator(&book.revision_id, start_of(href))
        {
            starts.push((index, page_index));
        }
    }
    let pages_of = |position: usize| {
        let end = starts
            .get(position + 1)
            .map_or(book.page_count, |next| next.1);
        end - starts[position].1
    };
    let (chapter, page_index) = match args.get(2).filter(|href| !href.is_empty()) {
        Some(href) => starts
            .iter()
            .copied()
            .find(|(index, _)| hrefs[*index] == *href)
            .ok_or_else(|| format!("no chapter {href} in the book"))?,
        None => (0..starts.len())
            .max_by_key(|&position| pages_of(position))
            .map(|position| starts[position])
            .ok_or("the book has no chapters")?,
    };
    let href = hrefs[chapter].clone();
    let start = start_of(&href);
    let locator = match document
        .get_page_reading_anchor(&book.revision_id, (page_index + 4).min(book.page_count - 1))
        .map_err(|e| format!("anchor: {e:?}"))?
    {
        RuntimePageReadingAnchor::Resolved { locator, .. } => locator,
        _ => start,
    };
    document.release_revision(&book.revision_id);

    let mut lay = |width: f64| -> Result<(f64, usize), String> {
        let started = Instant::now();
        let created = document
            .create_chapter_local_revision(RuntimeChapterLocalRevisionRequest {
                layout_config: config(width),
                target_chapter_index: chapter,
                target_locator: locator.clone(),
            })
            .map_err(|e| format!("chapter at {width}: {e:?}"))?;
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        let revision = &created.revision;
        document
            .release_chapter_local_revision(&RuntimeChapterLocalRevisionHandle {
                revision_id: revision.revision_id.clone(),
                revision_version: revision.revision_version,
                coordinate: revision.coordinate.clone(),
            })
            .map_err(|e| format!("release: {e:?}"))?;
        Ok((ms, revision.local_page_count))
    };
    let (first_ms, pages) = lay(1194.0)?;
    let mut times = (0..frames)
        .map(|frame| lay(1186.0 - 4.0 * (frame % 30) as f64).map(|(ms, _)| ms))
        .collect::<Result<Vec<_>, _>>()?;
    if env::var_os("RELAYOUT_BENCH_FRAMES").is_some() {
        let each = times
            .iter()
            .map(|ms| format!("{ms:.1}"))
            .collect::<Vec<_>>();
        println!("each frame: {}", each.join(" "));
    }
    times.sort_by(f64::total_cmp);
    println!("chapter {href}: {pages} pages; first layout {first_ms:.2} ms");
    println!(
        "relayout over {frames} frames: median {:.2} ms, min {:.2}, max {:.2}",
        times[times.len() / 2],
        times[0],
        times[times.len() - 1]
    );

    if env::var_os("RELAYOUT_BENCH_NO_BOOK").is_some() {
        return Ok(());
    }
    let started = Instant::now();
    let book = document
        .create_revision(&config(1150.0))
        .map_err(|e| format!("book: {e:?}"))?;
    println!(
        "whole book: {} pages; cold {cold_book_ms:.1} ms, after the relayouts {:.1} ms",
        book.page_count,
        started.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

fn start_of(href: &str) -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: href.to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}

fn policy(dir: &str) -> Result<RuntimePinnedFontPolicyInput, String> {
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
