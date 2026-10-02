//! Opens each book twice, once from its archive and once from encrypted
//! shards, and compares every spine chapter's artifact between the two.
//!
//! Usage: `shard-equivalence-probe <serif-font-path> <epub>...`.
//! The sharded session starts with the skeleton only; whenever a request
//! fails as `ResourcePending` the probe supplies exactly the shards it
//! names and retries. Identity fields and footnote hits still waiting on
//! an unsupplied chapter are the only differences allowed; every other
//! field, the display list bytes included, must be equal. Prints one line
//! per book and exits non-zero when any book differs.

use std::{env, fs, process};

use rito_core::epub::shard::{pack_publication, PackOptions, PackedPublication};
use rito_core::runtime::{
    ReaderArtifact, ReaderArtifactRequest, ReaderErrorKind, ReaderLayout, ReaderLocator,
    ReaderSession, ReaderSpreadMode, ReaderTextRenderingProfile, RuntimePinnedFontFaceInput,
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
    let mut archive_request = 0u64;
    let mut shard_request = 0u64;
    let mut supplied = Vec::new();
    let mut rounds = 0usize;
    let mut chapters = 0usize;
    for href in &hrefs {
        archive_request += 1;
        let expected = archive.request_artifact(request(archive_request, href));
        let actual = loop {
            shard_request += 1;
            match sharded.request_artifact(request(shard_request, href)) {
                Err(error) if error.kind == ReaderErrorKind::ResourcePending => {
                    rounds += 1;
                    supply(&mut sharded, &packed, &error.pending_shards, &mut supplied)?;
                }
                other => break other,
            }
        };
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
    supplied.sort_unstable();
    supplied.dedup();
    Ok(format!(
        "OK {path}: chapters={chapters} shards={} supplied={} rounds={rounds} skeleton={}B",
        packed.shards.len(),
        supplied.len(),
        packed.skeleton.bytes.len()
    ))
}

fn supply(
    session: &mut ReaderSession,
    packed: &PackedPublication,
    shard_ids: &[u32],
    supplied: &mut Vec<u32>,
) -> Result<(), String> {
    if shard_ids.is_empty() {
        return Err("a pending failure named no shard".to_owned());
    }
    for shard_id in shard_ids {
        if supplied.contains(shard_id) {
            return Err(format!(
                "shard {shard_id} was asked for again after it arrived"
            ));
        }
        let shard = packed
            .shards
            .get(*shard_id as usize - 1)
            .ok_or_else(|| format!("unknown shard {shard_id}"))?;
        session
            .supply_shard(&shard.bytes, shard.key.as_ref())
            .map_err(|error| format!("supply {shard_id}: {}", error.message))?;
        supplied.push(*shard_id);
    }
    Ok(())
}

/// Everything but identity, and footnote pending flags, which may stay
/// set while the defining chapter's shard has not been supplied.
fn drawn(artifact: &ReaderArtifact) -> ReaderArtifact {
    let mut artifact = artifact.clone();
    artifact.request_id = 0;
    artifact.artifact_id = 0;
    artifact.revision_id = 0;
    for page in &mut artifact.pages {
        for hit in &mut page.hits {
            hit.footnote_pending = false;
        }
    }
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
