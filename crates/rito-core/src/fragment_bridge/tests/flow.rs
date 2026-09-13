//! Block flow tests: floats, clearing spacers and the margins around them,
//! negative-margin lines beside a float band, and fixed-height flow,
//! measured through the block engine.

use super::*;

/// A right-aligned line pulled UP by a negative margin into a right
/// float's band must still avoid the float: the browser aligns it to
/// the float's left edge whenever the line's top overlaps the band
/// (measured on the b126 title: the raised triangle sits at float
/// left 111.67 - advance, not at the container's right edge).
#[test]
fn a_negative_margin_raised_line_avoids_the_float_band() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="tbox2">
  <div class="fr tbox3">
    <p class="em04 pad-first">Youkoso</p>
    <p class="em04 pad">Jitsuryoku</p>
    <p class="em04 pad">Shijoushugi</p>
    <p class="em04 pad">Nokyoushitsue</p>
  </div>
  <p class="em12 up1">欢迎来到</p>
  <p class="em06 down">▼</p>
  <p class="em25">实力</p>
  <p class="em215 up2">至上主义</p>
  <p class="em16 right lift">中</p>
</div>
</body></html>"#,
        "body { margin: 0; padding: 0; font-size: 16px; } p { margin: 0; line-height: 1em; text-indent: 0; } .fr { float: right; margin: -4.8px 1.6px 0 0; } .tbox2 { width: 138.88px; border: 1.76px solid #000000; padding: 8.8px 11.2px; } .tbox3 { } .em04 { font-size: 6.4px; } .pad-first { margin: 8.32px 0 0 7.04px; } .pad { margin: 3.2px 0 0 7.04px; } .em06 { font-size: 9.6px; } .em12 { font-size: 19.2px; font-weight: bold; } .em16 { font-size: 25.6px; } .em25 { font-size: 40px; } .em215 { font-size: 34.4px; } .right { text-align: right; } .up1 { margin: -1.92px 0 0 0.96px; } .down { margin: 0 0 -5.76px 64px; } .up2 { margin: 1.72px 0 0 0; } .lift { margin: -60px 2.56px 0 0; }\n",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes(), source_han_test_bytes()])
            .expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(200.0),
            None,
            &cancel,
        )
        .expect("lays out");
    fn find_text_x(fragment: &Fragment, off_x: f64, off_y: f64, out: &mut Vec<(f64, f64)>) {
        match fragment {
            Fragment::Box(node) => {
                for child in &node.children {
                    find_text_x(child, off_x + node.rect.x, off_y + node.rect.y, out);
                }
            }
            Fragment::Line(line) => {
                for child in &line.children {
                    if let Fragment::Text(run) = child {
                        out.push((off_x + line.rect.x + run.rect.x, off_y + line.rect.y));
                    }
                }
            }
            _ => {}
        }
    }
    let mut xs = Vec::new();
    find_text_x(&outcome.fragments.root, 0.0, 0.0, &mut xs);
    // Mirror of the b126 title (pinned truth): the raised right-
    // aligned glyph aligns to the float's left edge, never the
    // container's right edge (truth x 86.06 vs the defect's 143.7).
    // The lifted paragraph is the LAST laid-out line (y ~47, inside
    // the float band): right-aligned to the float's left edge, its
    // glyph starts at content-left 12.96 + (91.83 - 25.6) = 78.4 —
    // the defect put it at the container's right edge (122.9).
    let (x, _) = xs.last().copied().expect("the lifted line lays out");
    assert!(
        (x - 78.4).abs() < 0.6,
        "the raised right-aligned glyph stops at the float's left edge: {x}"
    );
}

/// Blink keeps a following sibling's margin BELOW a cleared empty
/// spacer (measured five-case oracle: follower top = the float's
/// margin-box bottom + the follower's collapsed margin, whether the
/// margin is its own or escaped from a child). The static fold must
/// not hoist that margin through the spacer onto the container.
#[test]
fn margins_after_a_cleared_spacer_stay_below_the_clear_line() {
    for (name, follow, expected) in [
        (
            "own margin",
            r#"<div style="margin-top: 16px"><p>x</p></div>"#,
            146.0,
        ),
        (
            "child-escaped margin",
            r#"<div><p style="margin-top: 3.2px">x</p></div>"#,
            133.2,
        ),
    ] {
        let chapter = resolved_chapter_with(
            &format!(
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="box">
    <div class="fl"></div>
    <div class="cb"></div>
    {follow}
  </div>
</body></html>"#
            ),
            "body { margin: 0; } p { margin: 0; } .box { width: 320px; }                  .fl { float: left; width: 120px; height: 50px; margin: 40px 0; }                  .cb { clear: both; }
",
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("tree builds");
        let engine = BlockFormattingContext::new(
            ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
        );
        let cancel = CancelFlag::new();
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &ConstraintSpace::continuous(640.0),
                None,
                &cancel,
            )
            .expect("lays out");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root box");
        };
        fn find_line_y(fragment: &Fragment, offset: f64) -> Option<f64> {
            match fragment {
                Fragment::Box(node) => node
                    .children
                    .iter()
                    .find_map(|child| find_line_y(child, offset + node.rect.y)),
                Fragment::Line(line) => Some(offset + line.rect.y),
                _ => None,
            }
        }
        let line_y = find_line_y(&outcome.fragments.root, -root.rect.y)
            .expect("the follower's line laid out");
        assert!(
            (line_y - expected).abs() < 0.1,
            "{name}: the follower's line starts below the cleared float: {line_y} vs {expected}"
        );
    }
}

/// illu3-t replica with the book's blanket margin rule: the spacer's
/// own margins cancel the follower's smaller one (follower top =
/// float margin-box bottom + max(0, join(spacer bottom, follower
/// top) - spacer top)), and none of that chain moves the container.
#[test]
fn cleared_spacer_margins_credit_the_follower_and_spare_the_container() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="illu">
  <div class="illu-box">
    <div class="HT font08 box-left" style="margin: 4em 0em"><div class="inner"><p class="c" style="margin-bottom: 0.5em">[a]</p><p class="z">text</p></div></div>
    <div class="HT font08 box-right" style="margin: 4em 0em"><div class="inner"><p class="c" style="margin-bottom: 0.5em">[b]</p><p class="z">text</p></div></div>
    <div class="cboth"></div>
    <div class="font08 tail"><p>one</p><p>two</p></div>
  </div>
</div>
</body></html>"#,
        "body { margin: 0; padding: 0; }              .illu p, .illu div { margin: 0.2em 0em; text-indent: 0; line-height: 1.2em; }              .illu .illu-box { width: 320px; max-width: 100%; margin: 0.8em auto; }              .illu .illu-box .box-left { width: 49%; float: left; }              .illu .illu-box .box-right { width: 49%; float: right; }              .inner { width: 95%; margin: 0 auto; }              .font08 { font-size: 0.8em; }              .cboth { clear: both; }
",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(640.0),
            None,
            &cancel,
        )
        .expect("lays out");
    fn walk_blocks(fragment: &Fragment, offset: f64, out: &mut Vec<(u32, f64, f64)>) {
        if let Fragment::Box(node) = fragment {
            out.push((node.source.0, offset + node.rect.y, node.rect.height));
            for child in &node.children {
                walk_blocks(child, offset + node.rect.y, out);
            }
        }
    }
    let mut blocks = Vec::new();
    walk_blocks(&outcome.fragments.root, 0.0, &mut blocks);
    let y_of = |source: u32| {
        blocks
            .iter()
            .find(|(s, ..)| *s == source)
            .map(|(_, y, _)| *y)
            .expect("block laid out")
    };
    assert!((y_of(12) - 12.8).abs() < 0.1, "container: {}", y_of(12));
    assert!((y_of(3) - 63.98).abs() < 0.1, "float: {}", y_of(3));
    assert!((y_of(8) - 157.38).abs() < 0.1, "spacer: {}", y_of(8));
    assert!((y_of(11) - 157.38).abs() < 0.1, "follower: {}", y_of(11));
}

/// b51 title replica: the badge's own margin must survive the fold
/// (it collapses into the container's EQUAL margin statically, then
/// the cleared line swallows it — the browser keeps it below).
#[test]
fn cleared_spacer_keeps_the_badge_margin_below_the_float() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="title">
  <div class="fr tall"></div>
  <div class="cboth"></div>
  <div class="ftitle"><p>m</p></div>
</div>
</body></html>"#,
        "body { padding: 0%; margin-top: 0%; margin-bottom: 0%; margin-left: 1%; margin-right: 1%; }              p { margin: 0; }              .title { width: 272px; margin: 0 auto; margin-top: 16px; }              .fr { float: right; }              .tall { width: 200px; height: 191.42px; }              .cboth { clear: both; }              .ftitle { width: 67.2px; height: 67.2px; overflow: hidden; margin: 16px auto; }
",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(640.0),
            None,
            &cancel,
        )
        .expect("lays out");
    fn walk_blocks(fragment: &Fragment, offset: f64, out: &mut Vec<(u32, f64, f64)>) {
        if let Fragment::Box(node) = fragment {
            out.push((node.source.0, offset + node.rect.y, node.rect.height));
            for child in &node.children {
                walk_blocks(child, offset + node.rect.y, out);
            }
        }
    }
    let mut blocks = Vec::new();
    walk_blocks(&outcome.fragments.root, 0.0, &mut blocks);
    let y_of = |source: u32| {
        blocks
            .iter()
            .find(|(s, ..)| *s == source)
            .map(|(_, y, _)| *y)
            .expect("block laid out")
    };
    assert!((y_of(0) - 16.0).abs() < 0.1, "float: {}", y_of(0));
    assert!((y_of(1) - 207.42).abs() < 0.1, "spacer: {}", y_of(1));
    assert!((y_of(3) - 223.42).abs() < 0.1, "badge: {}", y_of(3));
}

/// #85 full replica with PERCENTAGE margins (the b60 title exactly:
/// % margins are unfoldable, so the flow-root fold guard is not in
/// play — this observes where the +13.4 line drift enters the
/// bridge+layout pipeline).
#[test]
fn observe_percent_margin_float_lines() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="t1">
    <h1>X</h1>
  </div>

  <div class="t2">
    <h2>2</h2>
  </div>
</body></html>"#,
        "body { margin-left: 1%; margin-right: 1%; line-height: 130%; } .t1 { float: right; margin-top: 4%; margin-left: 10%; width: 48px; } .t2 { float: right; margin-top: 28%; margin-left: 10%; width: 48px; } h1 { font-size: 32px; line-height: 100%; } h2 { font-size: 30.4px; }",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(640.0),
            None,
            &cancel,
        )
        .expect("lays out");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root box");
    };
    let float_boxes: Vec<(f64, f64)> = root
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Box(float_box) => {
                let inner = float_box.children.iter().find_map(|inner| match inner {
                    Fragment::Box(heading) => Some(heading.rect.y),
                    _ => None,
                });
                Some((float_box.rect.y, inner.unwrap_or(f64::NAN)))
            }
            _ => None,
        })
        .collect();
    assert_eq!(float_boxes.len(), 2, "two floats");
    // The float sits at its own %-margin (basis = the containing
    // block, 4% / 28% of 627.2) and the heading's UA margin applies
    // ONCE inside — the previous inner layout re-resolved the float's
    // %-margin against the float's own 48px width and stacked it onto
    // the heading (h1 +1.9, h2 +13.4; truth line tops 46.518/200.841).
    assert!(
        (float_boxes[0].0 - 25.0781).abs() < 0.02,
        "t1 y {}",
        float_boxes[0].0
    );
    assert!(
        (float_boxes[0].1 - 21.4375).abs() < 0.02,
        "h1 inner y {}",
        float_boxes[0].1
    );
    assert!(
        (float_boxes[1].0 - 175.6094).abs() < 0.02,
        "t2 y {}",
        float_boxes[1].0
    );
    assert!(
        (float_boxes[1].1 - 25.2188).abs() < 0.05,
        "h2 inner y {}",
        float_boxes[1].1
    );
}

/// #85 phantom-fy probe at BRIDGE level: the b60 title skeleton
/// (two right floats with whitespace text between the divs, each
/// holding a margined heading). CSS: the second float's border top =
/// its own margin-top (flow position 0). The runtime probe measured
/// the real page drifting +13.4 here — this test decides whether the
/// phantom lives in the bridge+layout pipeline or upstream.
#[test]
fn observe_title_float_ys() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="t1">
    <h1>X</h1>
  </div>

  <div class="t2">
    <h2>2</h2>
  </div>
</body></html>"#,
        ".t1 { float: right; width: 48px; } .t2 { float: right; margin-top: 100px; width: 48px; } h1 { margin: 21px 0; font-size: 32px; } h2 { margin: 25px 0; font-size: 30px; }",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(600.0),
            None,
            &cancel,
        )
        .expect("lays out");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root box");
    };
    let mut float_ys: Vec<f64> = Vec::new();
    for child in &root.children {
        if let Fragment::Box(inner) = child {
            eprintln!(
                "[t85] box source={} y={:.4} h={:.4}",
                inner.source.0, inner.rect.y, inner.rect.height
            );
            float_ys.push(inner.rect.y);
        }
        if let Fragment::Line(line) = child {
            eprintln!("[t85] stray line y={:.4}", line.rect.y);
        }
    }
    assert!(float_ys.len() >= 2, "two float boxes present");
    assert!(
        float_ys[0].abs() < 1e-6,
        "first float at flow 0, got {}",
        float_ys[0]
    );
    assert!(
        (float_ys[1] - 100.0).abs() < 1e-6,
        "second float at its own margin-top 100, got {}",
        float_ys[1]
    );
}

/// Observation (a real book's title page): a text-carrying div
/// with a fixed `height` must flow at padding + height (Blink: the
/// `.book-rank` pill is 24 + 30 = 54 tall, its line overflowing
/// visibly), not at its natural line height. The pixel walk measured
/// the three blocks below the rank sitting 9.2px high — exactly
/// 30 − 20.8 (the fixed height replaced by one 130% line).
#[test]
fn observe_fixed_height_text_div_flow() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="a">x</div>
  <div class="rank">I</div>
  <div class="b">y</div>
</body></html>"#,
        "body { line-height: 130%; } .rank { height: 30px; padding-top: 24px; font-size: 24px; }",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let cancel = CancelFlag::new();
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(600.0),
            None,
            &cancel,
        )
        .expect("lays out");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root box");
    };
    let mut tops: Vec<f64> = Vec::new();
    for child in &root.children {
        match child {
            Fragment::Box(inner) => {
                eprintln!(
                    "[t-rank] box source={} y={:.4} h={:.4}",
                    inner.source.0, inner.rect.y, inner.rect.height
                );
                tops.push(inner.rect.y);
            }
            Fragment::Line(line) => {
                eprintln!(
                    "[t-rank] line y={:.4} h={:.4}",
                    line.rect.y, line.rect.height
                );
                tops.push(line.rect.y);
            }
            _ => {}
        }
    }
    assert!(tops.len() >= 3, "three blocks present");
    let last = *tops.last().expect("last block top");
    // Blink: .a line 20.8, .rank flows 24 + 30 = 54 → .b at 74.8.
    assert!(
        (last - 74.8).abs() < 0.05,
        "the block after the fixed-height div flows at 74.8, got {last}"
    );
}
