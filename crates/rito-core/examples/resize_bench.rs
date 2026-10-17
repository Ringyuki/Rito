//! Times what a reader session does for each size of a window being
//! resized: lay the chapter shown out again at the new width, publish the
//! spread that keeps the reading position (its display list and hits),
//! adopt it over the one shown and release that one, as the browser
//! reader's worker does per size.
//!
//! Usage: `resize-bench <epub> <fonts-dir> <chapter-href> [frames]`. The
//! session opens a tenth of the way into the chapter at 1190×900, double
//! pages; each frame then asks for a width 4 px narrower, cycling over 30
//! widths. Prints the median, minimum and maximum frame time; with
//! `RESIZE_BENCH_FRAMES` set, every frame's time too. Its work over the
//! frames alone is the difference between two runs with different frame
//! counts.

use std::{env, fs, process, time::Instant};

use rito_core::runtime::{
    ReaderArtifactRequest, ReaderForegroundHandoff, ReaderLayout, ReaderLocator, ReaderSession,
    ReaderSpreadMode, ReaderTextRenderingProfile, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole, RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
};
use sha2::{Digest, Sha256};

const SESSION: u64 = 1;

fn main() {
    if let Err(error) = run() {
        eprintln!("resize-bench: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 3 {
        return Err("usage: resize-bench <epub> <fonts-dir> <chapter-href> [frames]".to_owned());
    }
    let bytes = fs::read(&args[0]).map_err(|e| format!("read {}: {e}", args[0]))?;
    let frames = args
        .get(3)
        .map_or(Ok(30), |value| value.parse::<usize>())
        .map_err(|e| format!("frames: {e}"))?;
    let mut session =
        ReaderSession::open_owned_with_pinned_font_policy(SESSION, bytes, policy(&args[1])?)
            .map_err(|e| format!("open: {e:?}"))?;
    let mut request_id = 0;
    let mut show = |session: &mut ReaderSession,
                    width: f64,
                    locator: ReaderLocator,
                    visible: Option<u64>|
     -> Result<(u64, ReaderLocator), String> {
        request_id += 1;
        let artifact = session
            .request_artifact(ReaderArtifactRequest {
                session_id: SESSION,
                request_id,
                layout: layout(width),
                locator,
                text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
            })
            .map_err(|e| format!("request at {width}: {e:?}"))?;
        session
            .adopt_foreground_candidate(ReaderForegroundHandoff {
                session_id: SESSION,
                expected_visible_artifact_id: visible,
                candidate_artifact_id: artifact.artifact_id,
            })
            .map_err(|e| format!("adopt at {width}: {e:?}"))?;
        if let Some(previous) = visible {
            session
                .release_artifact(previous)
                .map_err(|e| format!("release at {width}: {e:?}"))?;
        }
        Ok((artifact.artifact_id, artifact.locator))
    };
    let opening = ReaderLocator {
        href: args[2].clone(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: Some(0.1),
    };
    let (mut visible, mut locator) = show(&mut session, 1190.0, opening, None)?;
    let mut times = Vec::with_capacity(frames);
    for frame in 0..frames {
        let width = 1186.0 - 4.0 * (frame % 30) as f64;
        let started = Instant::now();
        (visible, locator) = show(&mut session, width, locator, Some(visible))?;
        times.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    if env::var_os("RESIZE_BENCH_FRAMES").is_some() {
        let each = times
            .iter()
            .map(|ms| format!("{ms:.1}"))
            .collect::<Vec<_>>();
        println!("each frame: {}", each.join(" "));
    }
    if !times.is_empty() {
        times.sort_by(f64::total_cmp);
        println!(
            "resize over {frames} frames: median {:.2} ms, min {:.2}, max {:.2}",
            times[times.len() / 2],
            times[0],
            times[times.len() - 1]
        );
    }
    Ok(())
}

fn layout(width: f64) -> ReaderLayout {
    ReaderLayout {
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
