//! Checks that a reader session whose chapter-local revisions paginate only
//! as far as their target needs publishes exactly the artifacts of one
//! whose revisions paginate their whole chapter.
//!
//! Usage: `lazy-pagination-check <fonts-dir> <epub>...`. For a few chapters
//! of each book, both sessions open a fraction of the way in, turn a page
//! (so the position is a source point, as a reader's is), resize through a
//! run of widths, then turn forward twice and back once. Every artifact the
//! two publish is compared but for its identities. Prints a line per book
//! and exits 1 on any difference.

use std::{env, fs, process};

use rito_core::runtime::{
    ReaderAdjacentDirection, ReaderAdjacentRequest, ReaderArtifact, ReaderArtifactRequest,
    ReaderForegroundHandoff, ReaderLayout, ReaderLocator, ReaderSession, ReaderSpreadMode,
    ReaderTextRenderingProfile, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
};
use sha2::{Digest, Sha256};

const SESSION: u64 = 1;
const CHAPTERS_PER_BOOK: usize = 4;
const PROGRESSIONS: [f64; 3] = [0.2, 0.5, 0.85];
const WIDTHS: [f64; 6] = [1190.0, 1186.0, 1101.0, 1013.5, 921.0, 640.0];

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 2 {
        eprintln!("usage: lazy-pagination-check <fonts-dir> <epub>...");
        process::exit(2);
    }
    let policy = match policy(&args[0]) {
        Ok(policy) => policy,
        Err(error) => {
            eprintln!("lazy-pagination-check: {error}");
            process::exit(2);
        }
    };
    let mut differing = 0;
    for path in &args[1..] {
        let name = path.rsplit('/').next().unwrap_or(path);
        match check_book(path, &policy) {
            Ok((compared, differences)) => {
                if !differences.is_empty() {
                    differing += 1;
                }
                println!("{name}: {compared} artifacts, {} differ", differences.len());
                for difference in differences.iter().take(3) {
                    println!("  {difference}");
                }
            }
            Err(error) => println!("{name}: skipped ({error})"),
        }
    }
    println!("books differing: {differing}");
    if differing > 0 {
        process::exit(1);
    }
}

/// The artifacts both sessions published for a book, and where they
/// differed.
fn check_book(
    path: &str,
    policy: &RuntimePinnedFontPolicyInput,
) -> Result<(usize, Vec<String>), String> {
    let bytes = fs::read(path).map_err(|e| format!("read: {e}"))?;
    let open = |whole: bool| {
        let mut session = ReaderSession::open_owned_with_pinned_font_policy(
            SESSION,
            bytes.clone(),
            policy.clone(),
        )
        .map_err(|e| format!("open: {e:?}"))?;
        session.paginate_whole_chapters(whole);
        Ok::<_, String>(Reader {
            session,
            request_id: 0,
            visible: None,
        })
    };
    let mut whole = open(true)?;
    let mut settled = open(false)?;
    let spine = whole.session.publication().spine.clone();
    let linear: Vec<String> = spine
        .iter()
        .filter(|item| item.linear_index.is_some())
        .map(|item| item.href.clone())
        .collect();
    let step = (linear.len() / CHAPTERS_PER_BOOK).max(1);
    let mut compared = 0;
    let mut differences = Vec::new();
    for href in linear.iter().step_by(step).take(CHAPTERS_PER_BOOK) {
        for progression in PROGRESSIONS {
            let opening = ReaderLocator {
                href: href.clone(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: Some(progression),
            };
            let mut steps: Vec<Step> = vec![Step::Open(opening), Step::Turn(true)];
            steps.extend(WIDTHS.iter().map(|width| Step::Resize(*width)));
            steps.extend([Step::Turn(true), Step::Turn(true), Step::Turn(false)]);
            for step in steps {
                let label = format!("{href} at {progression}: {step:?}");
                let (a, b) = (whole.step(&step), settled.step(&step));
                compared += 1;
                match (a, b) {
                    (Ok(a), Ok(b)) => {
                        if let Some(field) = first_difference(&a, &b) {
                            differences.push(format!("{label}: {field}"));
                            break;
                        }
                    }
                    (Err(a), Err(b)) if a == b => break,
                    (a, b) => {
                        differences.push(format!(
                            "{label}: {:?} vs {:?}",
                            a.map(|a| a.local_page_index),
                            b.map(|b| b.local_page_index)
                        ));
                        break;
                    }
                }
            }
        }
    }
    Ok((compared, differences))
}

#[derive(Debug, Clone)]
enum Step {
    Open(ReaderLocator),
    Resize(f64),
    /// Forward when true.
    Turn(bool),
}

struct Reader {
    session: ReaderSession,
    request_id: u64,
    /// The artifact shown, the width it was laid out at, and its position.
    visible: Option<(u64, f64, ReaderLocator)>,
}

impl Reader {
    fn step(&mut self, step: &Step) -> Result<ReaderArtifact, String> {
        self.request_id += 1;
        let request_id = self.request_id;
        let artifact = match step {
            Step::Open(locator) => self.request(1190.0, locator.clone(), request_id)?,
            Step::Resize(width) => {
                let (_, _, locator) = self.visible.clone().ok_or("nothing shown")?;
                self.request(*width, locator, request_id)?
            }
            Step::Turn(forward) => {
                let (visible, _, _) = self.visible.clone().ok_or("nothing shown")?;
                self.session
                    .request_adjacent(ReaderAdjacentRequest {
                        session_id: SESSION,
                        request_id,
                        from_artifact_id: visible,
                        direction: if *forward {
                            ReaderAdjacentDirection::Next
                        } else {
                            ReaderAdjacentDirection::Previous
                        },
                    })
                    .map_err(|e| format!("{:?}", e.kind))?
            }
        };
        let width = match step {
            Step::Resize(width) => *width,
            _ => self.visible.as_ref().map_or(1190.0, |(_, width, _)| *width),
        };
        self.session
            .adopt_foreground_candidate(ReaderForegroundHandoff {
                session_id: SESSION,
                expected_visible_artifact_id: self.visible.as_ref().map(|(id, _, _)| *id),
                candidate_artifact_id: artifact.artifact_id,
            })
            .map_err(|e| format!("adopt: {:?}", e.kind))?;
        if let Some((previous, _, _)) = self.visible.take() {
            self.session
                .release_artifact(previous)
                .map_err(|e| format!("release: {:?}", e.kind))?;
        }
        self.visible = Some((artifact.artifact_id, width, artifact.locator.clone()));
        Ok(artifact)
    }

    fn request(
        &mut self,
        width: f64,
        locator: ReaderLocator,
        request_id: u64,
    ) -> Result<ReaderArtifact, String> {
        self.session
            .request_artifact(ReaderArtifactRequest {
                session_id: SESSION,
                request_id,
                layout: layout(width),
                locator,
                text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
            })
            .map_err(|e| format!("{:?}", e.kind))
    }
}

/// The first field two artifacts differ in, their identities aside.
fn first_difference(a: &ReaderArtifact, b: &ReaderArtifact) -> Option<String> {
    let checks: [(&str, bool); 11] = [
        ("locator", a.locator == b.locator),
        ("matched_by", a.matched_by == b.matched_by),
        ("local_page_index", a.local_page_index == b.local_page_index),
        (
            "local_spread_index",
            a.local_spread_index == b.local_spread_index,
        ),
        (
            "local_page_indexes",
            a.local_page_indexes == b.local_page_indexes,
        ),
        ("size", a.width == b.width && a.height == b.height),
        ("navigation", a.navigation == b.navigation),
        ("display_list", a.display_list == b.display_list),
        ("resources", a.resources == b.resources),
        ("fonts", a.fonts == b.fonts),
        ("pages", a.pages == b.pages),
    ];
    checks.iter().find(|(_, same)| !same).map(|(field, _)| {
        format!(
            "{field} differs (pages {:?} vs {:?})",
            a.local_page_indexes, b.local_page_indexes
        )
    })
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
