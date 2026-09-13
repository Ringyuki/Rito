//! Temporary diagnostic: peak and resident bytes after each stage of
//! opening and paginating one book.

use std::{env, fs, process};

use rito_core::layout::{create_layout_config, LayoutConfigInput, MarginInput, SpreadMode};
use rito_core::runtime::{
    RuntimeDocument, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontPolicyInput,
};
use sha2::{Digest, Sha256};
fn rss_mb() -> f64 {
    let out = process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .expect("ps runs");
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<f64>()
        .unwrap_or(0.0)
        / 1024.0
}

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let bytes = fs::read(&args[0]).expect("book reads");
    let serif = fs::read(&args[1]).expect("font reads");
    println!(
        "{:>8.1} MB  start (book bytes held by this process)",
        rss_mb()
    );
    let policy = RuntimePinnedFontPolicyInput {
        faces: vec![RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(&serif)),
            bytes: serif,
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
    });
    let mut document =
        RuntimeDocument::open_with_pinned_font_policy(&bytes, policy).expect("opens");
    drop(bytes);
    println!(
        "{:>8.1} MB  after open (archive resources decoded and held)",
        rss_mb()
    );
    let summary = document.create_revision(&layout).expect("paginates");
    println!(
        "{:>8.1} MB  after whole-book pagination ({} pages)",
        rss_mb(),
        summary.page_count
    );
    document.release_revision(&summary.revision_id);
    println!("{:>8.1} MB  after releasing the revision", rss_mb());
    let second = document.create_revision(&layout).expect("paginates again");
    println!(
        "{:>8.1} MB  after a SECOND whole-book pagination ({} pages)",
        rss_mb(),
        second.page_count
    );
    document.release_revision(&second.revision_id);
    println!("{:>8.1} MB  after releasing the second revision", rss_mb());
    drop(document);
    println!("{:>8.1} MB  after dropping the document", rss_mb());
}
