//! The pixel-walk truth harness must mirror the UA stylesheet's image
//! policy: the engine letterboxes rasters per `img { object-fit:
//! contain; }` (rito-stylo src/ua.rs), and the harness injects the same
//! declaration so both sides of the diff render under one policy. A
//! drift between them blinds the walk to exactly the image class the
//! policy governs.

const UA_STYLESHEET: &str = include_str!("../../rito-stylo/src/ua.rs");
const PIXEL_WALK: &str = include_str!("../../../tools/corpus-oracle/pixel-walk.mjs");

const MIRRORED_RULES: &[&str] = &["img { object-fit: contain; }"];

#[test]
fn the_pixel_walk_truth_mirrors_the_ua_image_policy() {
    let mut violations = Vec::new();
    for rule in MIRRORED_RULES {
        let normalized = without_whitespace(rule);
        if !without_whitespace(UA_STYLESHEET).contains(&normalized) {
            violations.push(format!("UA stylesheet lost `{rule}`"));
        }
        if !without_whitespace(PIXEL_WALK).contains(&normalized) {
            violations.push(format!("pixel-walk truth injection lost `{rule}`"));
        }
    }
    assert!(
        violations.is_empty(),
        "the truth harness and the UA stylesheet must carry the same image policy: {}",
        violations.join(", ")
    );
}

fn without_whitespace(source: &str) -> String {
    source.chars().filter(|c| !c.is_whitespace()).collect()
}
