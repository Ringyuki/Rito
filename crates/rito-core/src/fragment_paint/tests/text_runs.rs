//! Text runs: rect extents on the layout grid, per-item paint, baseline shift and the two-stage baseline snap.

use super::*;

/// A run's rect ends where the browser's item fragment ends: the
/// item's start plus its shaped width ceiled onto the 1/64 grid, so
/// the inline box band and the decoration line end on that edge,
/// while a run inside the item keeps its float advance.
#[test]
fn the_run_closing_an_item_ends_on_the_layout_grid() {
    let fixture = two_color_flow(|red, black| {
        vec![
            text_item("Hello world", red, 0.0),
            text_item("black.", black, 0.0),
        ]
    });
    // One item shaped as two runs (0..5, 5..11), then a second item.
    let root = boxed_line(vec![
        text_run(0.0, 30.31, 0, 5),
        text_run(30.31, 20.2, 5, 11),
        text_run(50.51, 20.2, 11, 17),
    ]);
    let commands = paint(&fixture.tree, &root);
    let widths: Vec<f64> = commands
        .iter()
        .filter_map(|command| match command {
            DisplayCommand::PaintText(input) => Some(input.rect.width),
            _ => None,
        })
        .collect();
    assert_eq!(widths.len(), 3);
    assert!((widths[0] - 30.31).abs() < 1e-9, "{widths:?}");
    // 50.51 ceils to 3233/64 = 50.515625; the closing run takes the rest.
    assert!((widths[1] - (50.515625 - 30.31)).abs() < 1e-9, "{widths:?}");
    assert!((widths[2] - 20.203125).abs() < 1e-9, "{widths:?}");
}

#[test]
fn adjacent_items_paint_with_their_own_styles() {
    let fixture = two_color_flow(|red, black| {
        vec![text_item("Red ", red, 0.0), text_item("black.", black, 0.0)]
    });
    let root = boxed_line(vec![text_run(0.0, 30.0, 0, 4), text_run(30.0, 40.0, 4, 10)]);
    let commands = paint(&fixture.tree, &root);
    assert_eq!(commands.len(), 2);
    let DisplayCommand::PaintText(first) = &commands[0] else {
        panic!("expected a text command, got {:?}", commands[0]);
    };
    assert_eq!(first.text, "Red ");
    assert_eq!(first.paint.color, css_color("#ff0000"));
    assert_eq!(first.paint.font.family, "Tinos");
    // Line top is 20 + 6 = 26; the paint rect starts one canvas-'top'
    // ascent (0.8 × 16px) above the 13px baseline.
    assert_eq!(first.rect, display_rect(14.0, 26.2, 30.0, 16.0));
    assert_eq!(first.line_height_px, Some(display_number(20.0)));
    let DisplayCommand::PaintText(second) = &commands[1] else {
        panic!("expected a text command, got {:?}", commands[1]);
    };
    assert_eq!(second.text, "black.");
    assert_eq!(second.paint.color, css_color("#000000"));
    assert_eq!(second.rect, display_rect(44.0, 26.2, 40.0, 16.0));
}

#[test]
fn baseline_shift_raises_the_paint_anchor() {
    let fixture = two_color_flow(|red, _| vec![text_item("2", red, 4.0)]);
    let root = boxed_line(vec![text_run(0.0, 8.0, 0, 1)]);
    let commands = paint(&fixture.tree, &root);
    let DisplayCommand::PaintText(command) = &commands[0] else {
        panic!("expected a text command, got {:?}", commands[0]);
    };
    assert_eq!(command.rect, display_rect(14.0, 22.2, 8.0, 16.0));
}

#[test]
fn a_baseline_rounds_the_line_top_on_css_pixels_and_the_sum_on_the_device_grid() {
    // A 64-phase sweep of the line top with a fractional within-line
    // baseline (a raised marker's line), painted at 2×: the line top
    // rounds to a whole CSS pixel, the baseline adds, and the sum
    // rounds once on the device grid. Rounding the line top on the
    // device grid instead lands half the phases one device row off.
    let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
    let within_line = 13.71875;
    let mut device_two_stage_disagreements = 0;
    for phase in 0..64 {
        let line_top = 26.0 + f64::from(phase) / 64.0;
        let root = Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 40.0,
            },
            children: vec![Fragment::Line(LineFragment {
                source: FormattingNodeId(0),
                marker: None,
                rect: FragmentRect {
                    x: 4.0,
                    y: line_top - 20.0,
                    width: 70.0,
                    height: 20.0,
                },
                baseline: within_line,
                trailing_whitespace: 0.0,
                ruby_growth: 0.0,
                children: vec![text_run(0.0, 8.0, 0, 1)],
            })],
        });
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                ratio: 2.0,
                ..FragmentPaintContext::default()
            },
        )
        .expect("fragments paint");
        let DisplayCommand::PaintText(command) = &commands[0] else {
            panic!("expected a text command, got {:?}", commands[0]);
        };
        let painted = command.rect.y + 0.8 * 16.0;
        let expected = ((line_top.round() + within_line) * 2.0).round() / 2.0;
        assert!(
            (painted - expected).abs() < 1e-9,
            "phase {phase}/64: painted {painted}, expected {expected}"
        );
        let device_two_stage = (line_top * 2.0).round() / 2.0 + (within_line * 2.0).round() / 2.0;
        if (device_two_stage - expected).abs() > 1e-9 {
            device_two_stage_disagreements += 1;
        }
    }
    assert_eq!(device_two_stage_disagreements, 32);
}
