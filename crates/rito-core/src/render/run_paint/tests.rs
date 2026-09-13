use super::RunPaint;
use crate::render::contract::{
    ReaderColor, ReaderRunBorder, ReaderRunBorderEdge, ReaderRunDecoration,
    ReaderRunDecorationKind, ReaderRunPaint, ReaderSpacing,
};
use crate::render::test_support::css_color;

#[test]
fn clones_share_storage_until_layout_mutates_spacing() {
    let original = RunPaint::default();
    let mut clone = original.clone();
    assert!(original.shares_storage_with(&clone));

    clone.add_letter_spacing(2.0);

    assert!(!original.shares_storage_with(&clone));
    assert_eq!(original.letter_spacing_px, None);
    assert_eq!(clone.letter_spacing_px, Some(2.0));
}

#[test]
fn glyphs_only_drops_the_inline_box_and_the_decoration_line() {
    let decorated = RunPaint::new(ReaderRunPaint {
        background_color: Some(css_color("#112233")),
        background_radius: Some(3.0),
        decoration: Some(ReaderRunDecoration {
            kind: ReaderRunDecorationKind::Underline,
            y: 14.0,
            thickness: 1.0,
            color: css_color("#000000"),
        }),
        padding: Some(ReaderSpacing {
            top: 1.0,
            right: 2.0,
            bottom: 3.0,
            left: 4.0,
        }),
        border: Some(ReaderRunBorder {
            top: Some(ReaderRunBorderEdge {
                width_px: 1.0,
                paint: crate::render::contract::ReaderBorderEdgePaint {
                    color: css_color("#000000"),
                    style: crate::render::contract::ReaderBorderStyle::Solid,
                },
            }),
            ..ReaderRunBorder::default()
        }),
        box_offsets: Some((-2.0, 20.0)),
        ..ReaderRunPaint::default()
    });
    assert!(decorated.has_box_paint());

    let glyphs = decorated.glyphs_only();

    assert!(!glyphs.has_box_paint());
    assert_eq!(glyphs.decoration, None);
    assert_eq!(glyphs.background_radius, None);
    assert_eq!(glyphs.box_offsets, None);
    assert_eq!((glyphs.box_start, glyphs.box_end), (false, false));
    assert_eq!(glyphs.color, decorated.color);
    assert_eq!(glyphs.font, decorated.font);
    // An undecorated paint is shared, not copied.
    assert!(glyphs.glyphs_only().shares_storage_with(&glyphs));
}

#[test]
fn ruby_paint_keeps_the_base_font_and_colour_at_the_annotation_size() {
    let base = RunPaint::new(ReaderRunPaint {
        color: css_color("#ff0000"),
        letter_spacing_px: Some(2.0),
        background_color: Some(css_color("#112233")),
        ..ReaderRunPaint::default()
    });

    let ruby = base.for_ruby(8.0);

    assert_eq!(ruby.font.size_px, 8.0);
    assert_eq!(ruby.font.family, base.font.family);
    assert_eq!(ruby.color, css_color("#ff0000"));
    assert_eq!(ruby.letter_spacing_px, None);
    assert_eq!(ruby.background_color, None);
    assert_eq!((ruby.box_start, ruby.box_end), (true, true));
}

#[test]
fn shifting_the_decoration_moves_only_its_row() {
    let mut paint = RunPaint::new(ReaderRunPaint {
        decoration: Some(ReaderRunDecoration {
            kind: ReaderRunDecorationKind::LineThrough,
            y: 8.0,
            thickness: 1.0,
            color: ReaderColor::BLACK,
        }),
        ..ReaderRunPaint::default()
    });
    let shared = paint.clone();

    paint.shift_decoration(0.0);
    assert!(paint.shares_storage_with(&shared));

    paint.shift_decoration(0.5);
    assert!(!paint.shares_storage_with(&shared));
    assert_eq!(paint.decoration.map(|decoration| decoration.y), Some(8.5));
    assert_eq!(shared.decoration.map(|decoration| decoration.y), Some(8.0));
}
