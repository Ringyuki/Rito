//! Opens each book twice, once from its archive and once from encrypted
//! shards, and compares every spine chapter's artifact between the two.
//!
//! Usage: `shard-equivalence-probe <serif-font-path> <epub>...`.
//! The sharded session has the skeleton only and is never supplied a
//! shard: laying a chapter out must not need one, so any `ResourcePending`
//! fails the book. Identity fields are the only differences allowed; every
//! other field, the display list bytes included, must be equal. Prints one
//! line per book, with the skeleton's share of the archive (what a reader
//! downloads before its first page), and exits non-zero when any book
//! differs.

use std::{env, fs, process};

use rito_core::epub::shard::{pack_publication, PackOptions};
use rito_core::runtime::{
    ReaderArtifact, ReaderArtifactRequest, ReaderLayout, ReaderLocator, ReaderSession,
    ReaderSpreadMode, ReaderTextRenderingProfile, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole, RuntimePinnedFontPolicyInput,
};
use sha2::{Digest, Sha256};

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 2 {
        eprintln!("usage: shard-equivalence-probe <serif-font-path> <epub>...");
        process::exit(2);
    }
    let font = fs::read(&args[0]).unwrap_or_else(|error| {
        eprintln!("read {}: {error}", args[0]);
        process::exit(2);
    });
    let mut failed = false;
    for path in &args[1..] {
        match probe_book(path, &font) {
            Ok(line) => println!("{line}"),
            Err(error) => {
                failed = true;
                println!("FAIL {path}: {error}");
            }
        }
    }
    process::exit(i32::from(failed));
}

fn policy(font: &[u8]) -> RuntimePinnedFontPolicyInput {
    RuntimePinnedFontPolicyInput {
        faces: vec![RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(font)),
            bytes: font.to_vec(),
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: None,
        }],
    }
}

fn probe_book(path: &str, font: &[u8]) -> Result<String, String> {
    let epub = fs::read(path).map_err(|error| format!("read: {error}"))?;
    let mut random = os_random();
    let packed = pack_publication(&epub, PackOptions { encrypt: true }, &mut random)
        .map_err(|error| format!("pack: {}", error.message()))?;
    let mut archive = ReaderSession::open_owned_with_pinned_font_policy(1, epub, policy(font))
        .map_err(|error| format!("archive open: {}", error.message))?;
    let mut sharded = ReaderSession::open_shards_with_pinned_font_policy(
        1,
        &packed.skeleton.bytes,
        packed.skeleton.key.as_ref(),
        policy(font),
    )
    .map_err(|error| format!("shard open: {}", error.message))?;
    if archive.publication() != sharded.publication() {
        return Err("publication snapshots differ".to_owned());
    }
    let hrefs = archive
        .publication()
        .spine
        .iter()
        .map(|item| item.href.clone())
        .collect::<Vec<_>>();
    let mut chapters = 0usize;
    for (index, href) in hrefs.iter().enumerate() {
        let request_id = index as u64 + 1;
        let expected = archive.request_artifact(request(request_id, href));
        let actual = sharded.request_artifact(request(request_id, href));
        match (expected, actual) {
            (Ok(expected), Ok(actual)) => {
                if drawn(&expected) != drawn(&actual) {
                    return Err(format!("{href}: artifacts differ"));
                }
                archive
                    .release_artifact(expected.artifact_id)
                    .map_err(|error| error.message)?;
                sharded
                    .release_artifact(actual.artifact_id)
                    .map_err(|error| error.message)?;
                chapters += 1;
            }
            (Err(expected), Err(actual)) if expected.kind == actual.kind => {}
            (expected, actual) => {
                return Err(format!(
                    "{href}: archive {:?} but shards {:?}",
                    expected.map(|_| ()).map_err(|error| error.kind),
                    actual.map(|_| ()).map_err(|error| error.kind)
                ));
            }
        }
    }
    let archive_bytes = fs::metadata(path).map_err(|error| error.to_string())?.len();
    Ok(format!(
        "OK {path}: chapters={chapters} shards={} skeleton={}B ({:.1}% of the archive)",
        packed.shards.len(),
        packed.skeleton.bytes.len(),
        packed.skeleton.bytes.len() as f64 * 100.0 / archive_bytes as f64
    ))
}

/// Everything but identity.
fn drawn(artifact: &ReaderArtifact) -> ReaderArtifact {
    let mut artifact = artifact.clone();
    artifact.request_id = 0;
    artifact.artifact_id = 0;
    artifact.revision_id = 0;
    artifact
}

fn request(request_id: u64, href: &str) -> ReaderArtifactRequest {
    ReaderArtifactRequest {
        session_id: 1,
        request_id,
        layout: ReaderLayout {
            render_ratio: 1.0,
            viewport_width: 420.0,
            viewport_height: 640.0,
            margin_top: 24.0,
            margin_right: 24.0,
            margin_bottom: 24.0,
            margin_left: 24.0,
            spread_mode: ReaderSpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            font_family_override: None,
        },
        locator: ReaderLocator {
            href: href.to_owned(),
            anchor_id: None,
            source_point: None,
            source_range: None,
            progression: None,
        },
        text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
    }
}

fn os_random() -> impl FnMut(&mut [u8]) {
    let mut urandom = fs::File::open("/dev/urandom").expect("/dev/urandom opens");
    move |buffer: &mut [u8]| {
        use std::io::Read;
        urandom.read_exact(buffer).expect("/dev/urandom reads");
    }
}
