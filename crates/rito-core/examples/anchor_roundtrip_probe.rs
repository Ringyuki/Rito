use std::{env, fs, process};

use rito_core::layout::{create_layout_config, LayoutConfigInput, MarginInput, SpreadMode};
use rito_core::runtime::{
    RuntimeDocument, RuntimePageReadingAnchor, RuntimeRevisionHandle,
    RuntimeSourceLocatorResolution,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("anchor-roundtrip-probe: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() {
        return Err("usage: anchor-roundtrip-probe <epub> [width] [height]".to_owned());
    }
    let bytes = fs::read(&args[0]).map_err(|error| format!("read {}: {error}", args[0]))?;
    let width: f64 = args
        .get(1)
        .map_or(Ok(420.0), |v| v.parse().map_err(|e| format!("width: {e}")))?;
    let height: f64 = args
        .get(2)
        .map_or(Ok(640.0), |v| v.parse().map_err(|e| format!("height: {e}")))?;

    let mut document = RuntimeDocument::open(&bytes).map_err(|e| format!("open: {e:?}"))?;
    let layout = create_layout_config(LayoutConfigInput {
        width,
        height,
        margin: MarginInput::All(24.0),
        spread: SpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    });
    let revision = document
        .create_revision(&layout)
        .map_err(|e| format!("create_revision: {e:?}"))?;
    let handle = RuntimeRevisionHandle::from(&revision);
    println!(
        "book={} viewport={}x{} pages={}",
        args[0], width, height, revision.page_count
    );

    let mut mismatches = 0usize;
    let mut unavailable = 0usize;
    let mut pending = 0usize;
    for page_index in 0..revision.page_count {
        let response = document
            .get_page_reading_anchor_at(&handle, page_index)
            .map_err(|e| format!("anchor page {page_index}: {e:?}"))?;
        let RuntimePageReadingAnchor::Resolved {
            locator,
            spread_index: captured_spread,
            ..
        } = response.value
        else {
            unavailable += 1;
            println!("page {page_index}: anchor UNAVAILABLE");
            continue;
        };
        let resolution = document
            .resolve_source_locator_at(&handle, locator.clone())
            .map_err(|e| format!("resolve page {page_index}: {e:?}"))?;
        match resolution.value {
            RuntimeSourceLocatorResolution::Resolved {
                page_index: resolved_page,
                spread_index: resolved_spread,
                matched_by,
                ..
            } => {
                if resolved_page != page_index {
                    mismatches += 1;
                    println!(
                        "MISMATCH page {page_index} (spread {captured_spread}) -> resolved page {resolved_page} (spread {resolved_spread}) matched_by={matched_by:?} point={:?} progression={:?}",
                        locator.source_point, locator.progression
                    );
                }
            }
            RuntimeSourceLocatorResolution::Pending { reason, .. } => {
                pending += 1;
                println!("page {page_index}: resolution PENDING ({reason:?})");
            }
        }
    }
    println!(
        "swept {} pages: {mismatches} mismatches, {unavailable} unavailable, {pending} pending",
        revision.page_count
    );
    Ok(())
}
