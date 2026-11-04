//! What a line with no glyph run lends the annotations over the next line.

use rito_fragment::{
    empty_line_half_leading, FormattingNodeId, Fragment, FragmentRect, ImageFragment, LineFonts,
    LineFragment,
};

fn line(height: f64, baseline: f64, children: Vec<Fragment>) -> LineFragment {
    LineFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height,
        },
        baseline,
        marker: None,
        trailing_whitespace: 0.0,
        annotation_growth: 0.0,
        annotation_overflow: 0.0,
        annotation_lent: 0.0,
        annotation_space_end: 0.0,
        fonts: LineFonts::None,
        text_runs: Vec::new(),
        children,
    }
}

fn image(top: f64, height: f64) -> Fragment {
    Fragment::Image(ImageFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 0.0,
            y: top,
            width: 200.0,
            height,
        },
        item_index: 0,
    })
}

/// An empty line lends its half-leading; a line holding an image on its
/// baseline lends only what lies under the image (measured: a ruby line
/// after a paragraph of one baseline-aligned illustration sits where the
/// image line's space under its baseline alone is reused).
#[test]
fn a_line_holding_an_image_lends_only_the_space_under_it() {
    let empty = line(28.0, 21.0, Vec::new());
    assert_eq!(
        empty.glyphless_end_space(16.0),
        empty_line_half_leading(28.0, 16.0)
    );
    assert_eq!(empty.glyphless_end_space(16.0), 6.0);
    // A 400px image standing on the baseline of a 414px line box.
    let illustrated = line(414.0, 400.0, vec![image(0.0, 400.0)]);
    assert_eq!(illustrated.glyphless_end_space(16.0), 14.0);
    // An image shorter than the font counts as empty content.
    let small = line(28.0, 21.0, vec![image(11.0, 10.0)]);
    assert_eq!(small.glyphless_end_space(16.0), 6.0);
}
