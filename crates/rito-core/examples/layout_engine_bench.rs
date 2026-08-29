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
    let policy = || RuntimePinnedFontPolicyInput {
        faces: vec![RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(&serif_bytes)),
            bytes: serif_bytes.clone(),
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

    // Pass 1: continuous whole-book layout only.
    let mut document = RuntimeDocument::open_with_pinned_font_policy(&bytes, policy())
        .map_err(|e| format!("open: {e:?}"))?;
    let started = Instant::now();
    let revision = document
        .create_revision(&layout)
        .map_err(|e| format!("continuous revision: {e:?}"))?;
    let continuous_ms = started.elapsed().as_secs_f64() * 1_000.0;
    println!(
        "continuous whole-book: {continuous_ms:.1} ms ({} pages)",
        revision.page_count
    );

    // Pass 2: same, plus the fragment page-table build on top. The delta
    // is the fragment engine's own whole-book cost.
    let mut document = RuntimeDocument::open_with_pinned_font_policy(&bytes, policy())
        .map_err(|e| format!("open: {e:?}"))?;
    document.set_fragment_page_table_enabled(true);
    let started = Instant::now();
    let revision = document
        .create_revision(&layout)
        .map_err(|e| format!("fragment revision: {e:?}"))?;
    let with_fragment_ms = started.elapsed().as_secs_f64() * 1_000.0;
    println!(
        "continuous + fragment build: {with_fragment_ms:.1} ms ({} pages)",
        revision.page_count
    );
    println!(
        "fragment whole-book build alone: ~{:.1} ms",
        with_fragment_ms - continuous_ms
    );
    Ok(())
}
