//! Opens each book twice, once from its archive and once from encrypted
//! shards, and compares every spine chapter's artifact between the two.
//!
//! Usage: `shard-equivalence-probe <serif-font-path> <epub>...`.
//! The sharded session has the skeleton only and is never supplied a
//! shard: laying a chapter out must not need one, so any `ResourcePending`
//! fails the book. Identity fields are the only differences allowed; every
//! other field, the display list bytes included, must be equal. Prints one
//! line per book and exits non-zero when any book differs. Each line
//! reports what a reader downloads before a page shows whole: the skeleton
//! (before any page), the book's first page (the skeleton and the images
//! it draws) and the mean image bytes of a chapter's first page (a jump
//! into the book), each also as a share of the archive.

use std::{env, fs, process};

use rito_core::epub::shard::{pack_publication, PackOptions};
use rito_core::runtime::{
    ReaderArtifact, ReaderArtifactRequest, ReaderLayout, ReaderLocator, ReaderResourceKind,
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
    let shard_bytes = |shard_id: u32| {
        packed
            .shards
            .get(shard_id as usize - 1)
            .map_or(0, |shard| shard.bytes.len())
    };
    let mut chapters = 0usize;
    let mut page_image_bytes = Vec::new();
    for (index, href) in hrefs.iter().enumerate() {
        let request_id = index as u64 + 1;
        let expected = archive.request_artifact(request(request_id, href));
        let actual = sharded.request_artifact(request(request_id, href));
        match (expected, actual) {
            (Ok(expected), Ok(actual)) => {
                if drawn(&expected) != drawn(&actual) {
                    return Err(format!("{href}: artifacts differ"));
                }
                page_image_bytes.push(page_images(&mut sharded, &actual, &shard_bytes));
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
    let archive_bytes = fs::metadata(path).map_err(|error| error.to_string())?.len() as f64;
    let skeleton = packed.skeleton.bytes.len();
    let first_page = skeleton + page_image_bytes.first().copied().unwrap_or(0);
    let chapter_start =
        page_image_bytes.iter().sum::<usize>() as f64 / page_image_bytes.len().max(1) as f64;
    let share = |bytes: f64| bytes * 100.0 / archive_bytes;
    Ok(format!(
        "OK {path}: chapters={chapters} shards={} skeleton={skeleton}B ({:.1}%) \
         first-page={first_page}B ({:.1}%) chapter-start-images={chapter_start:.0}B ({:.1}%)",
        packed.shards.len(),
        share(skeleton as f64),
        share(first_page as f64),
        share(chapter_start),
    ))
}

/// The bytes of the shards holding the images `artifact` draws, read from
/// the shards each image read names; nothing is supplied.
fn page_images(
    session: &mut ReaderSession,
    artifact: &ReaderArtifact,
    shard_bytes: &dyn Fn(u32) -> usize,
) -> usize {
    let mut shards = std::collections::BTreeSet::new();
    for resource in &artifact.resources {
        if resource.kind != ReaderResourceKind::Image {
            continue;
        }
        if let Err(error) = session.read_resource(
            artifact.artifact_id,
            ReaderResourceKind::Image,
            &resource.href,
        ) {
            shards.extend(error.pending_shards);
        }
    }
    shards.into_iter().map(shard_bytes).sum()
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
            line_height_force: true,
            font_family_force: true,
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
