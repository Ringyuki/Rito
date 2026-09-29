//! Unsupported sizing must degrade locally and keep chapter pagination usable.

use super::*;

fn sizing_pages(declaration: &str, floated: bool) -> (Vec<Fragment>, Vec<String>) {
    let paragraphs =
        "<p>Every paragraph must remain readable across page boundaries.</p>".repeat(12);
    let xhtml = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="card" style="{declaration}">{paragraphs}</div>
<div class="hidden" style="max-width:fit-content">Hidden text must stay hidden.</div>
<p class="tail">End of chapter.</p></body></html>"#
    );
    let css = format!(
        "body {{ margin:0; padding:0; font-family:Tinos; font-size:16px; }}
         p {{ margin:0; line-height:20px; }}
         .card {{ padding:6px 10px; margin:0 12px; border:2px solid black; float:{}; }}
         .hidden {{ display:none; }} .tail {{ clear:both; }}",
        if floated { "left" } else { "none" },
    );
    let chapter = resolved_chapter_with(&xhtml, &css);
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("sizing fixture builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let space = ConstraintSpace::fragmented(200.0, 100.0);
    let mut pages = Vec::new();
    let mut token = None;
    loop {
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &space,
                token.as_ref(),
                &cancel,
            )
            .expect("modern sizing must not abort chapter pagination");
        token = outcome.continuation;
        pages.push(outcome.fragments.root);
        if token.is_none() {
            break;
        }
        assert!(
            pages.len() < 64,
            "sizing fallback pagination must terminate"
        );
    }
    assert!(
        pages.len() > 1,
        "fixture exercises continuation across pages"
    );
    (pages, built.degradations)
}

#[test]
fn modern_sizing_paginates_like_auto_without_losing_box_geometry_or_text() {
    // Compare every fragment, including text ranges, glyph positions and box
    // geometry, against the explicit fallback. Each property is tested alone
    // so a rejected max-width cannot accidentally mask a width/height failure.
    for (property, fallback) in [("width", "auto"), ("height", "auto"), ("max-width", "none")] {
        let (expected, _) = sizing_pages(&format!("{property}:{fallback}"), false);
        for value in [
            "fit-content",
            "min-content",
            "max-content",
            "-webkit-fill-available",
            "stretch",
            "fit-content(120px)",
        ] {
            let declaration = format!("{property}:{value}");
            let (pages, degradations) = sizing_pages(&declaration, false);
            assert_eq!(
                pages, expected,
                "fallback changes content or geometry: {declaration}"
            );
            assert!(
                degradations.iter().any(|reason| reason.contains(property)),
                "fallback must remain visible in diagnostics: {declaration}: {degradations:?}",
            );
        }
    }
}

#[test]
fn modern_sizing_on_floats_preserves_auto_shrink_to_fit() {
    let (expected, _) = sizing_pages("width:auto;max-width:none", true);
    for value in [
        "fit-content",
        "min-content",
        "max-content",
        "-webkit-fill-available",
        "stretch",
        "fit-content(120px)",
    ] {
        let (pages, _) = sizing_pages(&format!("width:{value};max-width:{value}"), true);
        assert_eq!(pages, expected, "float fallback changes geometry: {value}");
    }
}

#[test]
fn modern_sizing_keeps_numeric_constraints_and_authored_styles() {
    for (actual, fallback) in [
        (
            "width:fit-content;max-width:120px",
            "width:auto;max-width:120px",
        ),
        (
            "width:120px;max-width:fit-content",
            "width:120px;max-width:none",
        ),
        (
            "width:fit-content;height:fit-content;max-width:fit-content",
            "width:auto;height:auto;max-width:none",
        ),
        ("width:9.8em;width:fit-content", "width:auto"),
    ] {
        let (expected, _) = sizing_pages(fallback, false);
        let (pages, _) = sizing_pages(actual, false);
        assert_eq!(
            pages, expected,
            "fallback loses another CSS declaration: {actual}"
        );
    }
}
