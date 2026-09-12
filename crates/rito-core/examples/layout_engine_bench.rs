//! Times one whole-book pagination through the production runtime.
//!
//! Usage: `layout-engine-bench <epub> <serif-font-path>`. The book is
//! opened with the given face pinned as the serif fallback (the fragment
//! engine shapes with pinned faces only) and paginated once at a fixed
//! 420×640 single-page layout; the wall-clock time and page count are
//! printed.

use std::{env, fs, process, time::Instant};

use rito_core::layout::{create_layout_config, LayoutConfigInput, MarginInput, SpreadMode};
use rito_core::runtime::{
    RuntimeDocument, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontPolicyInput,
};
use sha2::{Digest, Sha256};

fn main() {
    if let Err(error) = run() {
        eprintln!("layout-engine-bench: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 2 {
        return Err("usage: layout-engine-bench <epub> <serif-font-path>".to_owned());
    }
    let bytes = fs::read(&args[0]).map_err(|error| format!("read {}: {error}", args[0]))?;
    let serif_bytes = fs::read(&args[1]).map_err(|error| format!("read {}: {error}", args[1]))?;
    let policy = RuntimePinnedFontPolicyInput {
        faces: vec![RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(&serif_bytes)),
            bytes: serif_bytes,
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: None,
        }],
    };
    let layout = create_layout_config(LayoutConfigInput {
        width: 420.0,
        height: 640.0,
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

    let mut document = RuntimeDocument::open_with_pinned_font_policy(&bytes, policy)
        .map_err(|e| format!("open: {e:?}"))?;
    let started = Instant::now();
    let revision = document
        .create_revision(&layout)
        .map_err(|e| format!("revision: {e:?}"))?;
    let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
    println!(
        "whole-book pagination: {elapsed_ms:.1} ms ({} pages)",
        revision.page_count
    );
    Ok(())
}
