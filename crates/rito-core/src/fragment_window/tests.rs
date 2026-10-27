use rito_fragment::{
    BoxFragment, FormattingNode, FormattingNodeContent, FormattingNodeId, FormattingTree, Fragment,
    FragmentRect, LineFragment,
};
use rito_style_contract::LayoutStyleId;

use super::{window_paint_tree, window_record_tree, ScrollAxis, ScrollWindows};

const RATIOS: [f64; 6] = [1.0, 1.25, 1.5, 2.0, 2.625, 3.0];

#[test]
fn windows_tile_the_chapter_row_for_row_at_every_ratio() {
    for extent in [950.0, 1000.0, 2849.5, 31_337.25] {
        let windows = ScrollWindows::new(950.0, extent, ScrollAxis::Down);
        assert_eq!(windows.count(), (extent / 950.0_f64).ceil() as usize);
        assert_eq!(windows.range(windows.count() - 1).end, extent);
        for ratio in RATIOS {
            assert_eq!(windows.device_rows(0, ratio).start, 0.0);
            for window in 1..windows.count() {
                assert_eq!(
                    windows.device_rows(window - 1, ratio).end,
                    windows.device_rows(window, ratio).start,
                    "extent {extent} ratio {ratio} window {window}"
                );
                let rows = windows.device_rows(window - 1, ratio);
                assert!((rows.end - rows.start - 950.0 * ratio).abs() <= 1.0);
            }
            let last = windows.device_rows(windows.count() - 1, ratio);
            assert_eq!(last.end, (extent * ratio + 0.5).floor());
        }
    }
}

#[test]
fn leftward_windows_tile_the_chapter_column_for_column_from_its_right_edge() {
    for extent in [390.0, 411.5, 1_170.25, 31_337.25] {
        let windows = ScrollWindows::new(390.0, extent, ScrollAxis::Left);
        for ratio in RATIOS {
            let right = (390.0_f64 * ratio + 0.5).floor();
            let width = |window: usize| {
                let rows = windows.device_rows(window, ratio);
                rows.end - rows.start
            };
            // The first window ends at the chapter's right edge, where a
            // page's would.
            let (x, y) = windows.device_origin(0, ratio);
            assert_eq!(
                (x + width(0), y),
                (right, 0.0),
                "extent {extent} ratio {ratio}"
            );
            for window in 1..windows.count() {
                let (x, _) = windows.device_origin(window, ratio);
                assert_eq!(x.fract(), 0.0);
                assert_eq!(
                    x + width(window),
                    windows.device_origin(window - 1, ratio).0,
                    "extent {extent} ratio {ratio} window {window}"
                );
            }
            let last = windows.count() - 1;
            assert_eq!(
                windows.device_origin(last, ratio).0,
                right - (extent * ratio + 0.5).floor()
            );
        }
    }
}

#[test]
fn downward_windows_start_on_their_first_row() {
    let windows = ScrollWindows::new(950.0, 2849.5, ScrollAxis::Down);
    for ratio in RATIOS {
        for window in 0..windows.count() {
            assert_eq!(
                windows.device_origin(window, ratio),
                (0.0, windows.device_rows(window, ratio).start)
            );
        }
    }
}

#[test]
fn a_chapter_shorter_than_a_window_is_one_window() {
    let windows = ScrollWindows::new(950.0, 0.0, ScrollAxis::Down);
    assert_eq!(windows.count(), 1);
    assert_eq!(windows.range(0), 0.0..0.0);
}

/// A strip of three blocks: a block of three lines ending on a window
/// boundary (its last line straddles it), a tall block whose only line
/// lies two windows down, and a table below both.
fn strip() -> (FormattingTree, Fragment) {
    let node = |content, children: Vec<u32>| FormattingNode {
        style: LayoutStyleId::from_raw(0),
        content,
        children: children.into_iter().map(FormattingNodeId).collect(),
    };
    let tree = FormattingTree::new(
        vec![
            node(FormattingNodeContent::BlockContainer, vec![1, 2, 3]),
            node(FormattingNodeContent::BlockContainer, vec![]),
            node(FormattingNodeContent::BlockContainer, vec![]),
            node(FormattingNodeContent::Table, vec![]),
        ],
        FormattingNodeId(0),
    )
    .expect("tree builds");
    let rect = |y, height| FragmentRect {
        x: 0.0,
        y,
        width: 600.0,
        height,
    };
    let line = |y, height| {
        Fragment::Line(LineFragment {
            source: FormattingNodeId(1),
            rect: rect(y, height),
            baseline: 0.0,
            marker: None,
            trailing_whitespace: 0.0,
            ruby_growth: 0.0,
            ruby_overflow: 0.0,
            fonts: rito_fragment::LineFonts::None,
            text_runs: Vec::new(),
            children: Vec::new(),
        })
    };
    let block = |source, y, height, children| {
        Fragment::Box(BoxFragment {
            source: FormattingNodeId(source),
            rect: rect(y, height),
            children,
        })
    };
    let root = block(
        0,
        0.0,
        2900.0,
        vec![
            block(
                1,
                0.0,
                1000.0,
                vec![line(0.0, 20.0), line(500.0, 20.0), line(980.0, 40.0)],
            ),
            block(2, 1000.0, 1500.0, vec![line(1400.0, 20.0)]),
            block(
                3,
                2500.0,
                400.0,
                vec![block(2, 0.0, 400.0, vec![line(10.0, 20.0)])],
            ),
        ],
    );
    (tree, root)
}

fn children(fragment: &Fragment) -> &[Fragment] {
    match fragment {
        Fragment::Box(fragment) => &fragment.children,
        Fragment::Line(line) => &line.children,
        _ => &[],
    }
}

fn line_tops(fragment: &Fragment, parent_y: f64, out: &mut Vec<f64>) {
    let top = parent_y + fragment.rect().y;
    if let Fragment::Line(_) = fragment {
        out.push(top);
    }
    for child in children(fragment) {
        line_tops(child, top, out);
    }
}

#[test]
fn a_window_paints_the_lines_that_reach_it_and_a_box_it_lies_in() {
    let (tree, root) = strip();
    let painted = window_paint_tree(&tree, None, &root, 0.0, 1000.0..2000.0, 0.0);
    let blocks = children(&painted);
    assert_eq!(
        blocks.iter().map(Fragment::source).collect::<Vec<_>>(),
        [FormattingNodeId(1), FormattingNodeId(2)],
        "the straddling line's block and the tall block the window lies in, not the table"
    );
    let mut tops = Vec::new();
    line_tops(&painted, 0.0, &mut tops);
    assert_eq!(tops, [980.0], "only the line that reaches into the window");
    assert!(children(&blocks[1]).is_empty());

    // A table is painted whole once it reaches the window.
    let painted = window_paint_tree(&tree, None, &root, 0.0, 2600.0..2700.0, 0.0);
    let mut tops = Vec::new();
    line_tops(&painted, 0.0, &mut tops);
    assert_eq!(tops, [2510.0]);
}

#[test]
fn each_line_is_recorded_by_the_one_window_it_starts_in() {
    let (_, root) = strip();
    let windows = ScrollWindows::new(1000.0, 2900.0, ScrollAxis::Down);
    let mut recorded = Vec::new();
    for window in 0..windows.count() {
        let records = window_record_tree(&root, 0.0, windows.range(window));
        let mut tops = Vec::new();
        line_tops(&records, 0.0, &mut tops);
        assert!(tops.iter().all(|top| windows.range(window).contains(top)));
        recorded.extend(tops);
    }
    let mut all = Vec::new();
    line_tops(&root, 0.0, &mut all);
    assert_eq!(recorded, all);
}
