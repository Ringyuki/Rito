//! Lists the pages a book lays out with nothing on them: no text and no
//! image.
//!
//! Usage: `blank-page-probe <serif-font> <width> <height> <margin> <epub>...`.
//! Walks every page of every linear chapter through the reader session, one
//! page a spread, and prints each page that carries neither text nor an
//! image, with what the page before it carried. Prints one summary line per
//! book.

use std::{env, fs, process};

use rito_core::runtime::{
    ReaderAdjacentAvailability, ReaderAdjacentDirection, ReaderAdjacentRequest, ReaderArtifact,
    ReaderArtifactRequest, ReaderLayout, ReaderLocator, ReaderResourceKind, ReaderSession,
    ReaderSpreadMode, ReaderTextRenderingProfile, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole, RuntimePinnedFontPolicyInput,
};
use sha2::{Digest, Sha256};

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 5 {
        eprintln!("usage: blank-page-probe <serif-font> <width> <height> <margin> <epub>...");
        process::exit(2);
    }
    let font = fs::read(&args[0]).expect("font reads");
    let number = |index: usize| args[index].parse::<f64>().expect("a number");
    let (width, height, margin) = (number(1), number(2), number(3));
    for path in &args[4..] {
        match probe_book(path, &font, width, height, margin) {
            Ok(line) => println!("{line}"),
            Err(error) => println!("FAIL {path}: {error}"),
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Content {
    Blank,
    Text,
    Image,
    TextAndImage,
}

fn content(artifact: &ReaderArtifact) -> Content {
    let text = artifact
        .pages
        .iter()
        .any(|page| !page.text.trim().is_empty());
    let image = artifact
        .resources
        .iter()
        .any(|resource| resource.kind == ReaderResourceKind::Image);
    match (text, image) {
        (false, false) => Content::Blank,
        (true, false) => Content::Text,
        (false, true) => Content::Image,
        (true, true) => Content::TextAndImage,
    }
}

fn label(content: Content) -> &'static str {
    match content {
        Content::Blank => "blank",
        Content::Text => "text",
        Content::Image => "image",
        Content::TextAndImage => "text+image",
    }
}

fn probe_book(
    path: &str,
    font: &[u8],
    width: f64,
    height: f64,
    margin: f64,
) -> Result<String, String> {
    let epub = fs::read(path).map_err(|error| format!("read: {error}"))?;
    let policy = RuntimePinnedFontPolicyInput {
        faces: vec![RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(font)),
            bytes: font.to_vec(),
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: None,
        }],
    };
    let mut session = ReaderSession::open_owned_with_pinned_font_policy(1, epub, policy)
        .map_err(|error| format!("open: {}", error.message))?;
    let hrefs = session
        .publication()
        .spine
        .iter()
        .filter(|item| item.linear_index.is_some())
        .map(|item| item.href.clone())
        .collect::<Vec<_>>();
    let mut request_id = 0u64;
    let mut pages = 0usize;
    let mut blanks = Vec::new();
    let mut before = Content::Text;
    // A blank page waiting for what the page after it carries.
    let mut open: Option<String> = None;
    for href in &hrefs {
        request_id += 1;
        let mut artifact = match session.request_artifact(ReaderArtifactRequest {
            session_id: 1,
            request_id,
            layout: layout(width, height, margin),
            locator: ReaderLocator {
                href: href.clone(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
            text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
        }) {
            Ok(artifact) => artifact,
            Err(error) => {
                blanks.push(format!("  {href}: request failed: {}", error.message));
                continue;
            }
        };
        loop {
            pages += 1;
            let here = content(&artifact);
            if let Some(line) = open.take() {
                blanks.push(format!("{line}, before {})", label(here)));
            }
            if here == Content::Blank {
                open = Some(format!(
                    "  {href} page {} last={} (commands {}, after {}",
                    artifact.local_page_index,
                    artifact.navigation.next != ReaderAdjacentAvailability::Available,
                    artifact.display_list.command_count,
                    label(before)
                ));
            }
            before = here;
            if artifact.navigation.next != ReaderAdjacentAvailability::Available {
                session
                    .release_artifact(artifact.artifact_id)
                    .map_err(|error| error.message)?;
                break;
            }
            request_id += 1;
            let next = session
                .request_adjacent(ReaderAdjacentRequest {
                    session_id: 1,
                    request_id,
                    from_artifact_id: artifact.artifact_id,
                    direction: ReaderAdjacentDirection::Next,
                })
                .map_err(|error| format!("{href}: next: {}", error.message))?;
            session
                .release_artifact(artifact.artifact_id)
                .map_err(|error| error.message)?;
            artifact = next;
        }
    }
    if let Some(line) = open.take() {
        blanks.push(format!("{line}, before end)"));
    }
    let mut line = format!(
        "{} {path}: pages={pages} blank={}",
        if blanks.is_empty() { "OK" } else { "BLANK" },
        blanks.len()
    );
    for blank in blanks {
        line.push('\n');
        line.push_str(&blank);
    }
    Ok(line)
}

fn layout(width: f64, height: f64, margin: f64) -> ReaderLayout {
    ReaderLayout {
        render_ratio: 1.0,
        viewport_width: width,
        viewport_height: height,
        margin_top: margin,
        margin_right: margin,
        margin_bottom: margin,
        margin_left: margin,
        spread_mode: ReaderSpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        font_family_override: None,
        line_height_force: true,
        font_family_force: true,
    }
}
