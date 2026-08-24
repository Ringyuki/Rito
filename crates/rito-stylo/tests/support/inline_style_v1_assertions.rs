use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, AlignmentBaseline, BaselineShift, BaselineSource,
    BorderEdge, BorderStyle, ColorNoneFlags, ComputedColorV1, CssPx, Direction, FontFamily,
    FontFamilyNameSyntax, FontSlant, GenericFontFamily, InlineFormattingStyleV1, LengthPercentage,
    LengthPercentageOrAuto, LineBreak, LineHeight, NonNegativeLengthPercentage, OverflowWrap,
    Percentage, TextAlign, TextDecorationStyle, TextJustify, TextTransformCase, TextWrapMode,
    UnicodeBidi, WhiteSpaceCollapse, WordBreak, WritingMode,
};

pub(crate) fn assert_direct_style(style: &InlineFormattingStyleV1) {
    assert_font(style);
    assert_text_flow(style);
    assert_bidi(style);
    assert_fragment(style);
    assert_paint(style);
}

fn assert_text_flow(style: &InlineFormattingStyleV1) {
    let text = &style.text_flow;
    assert_eq!(text.text_align, TextAlign::Justify);
    assert_eq!(text.text_justify, TextJustify::InterCharacter);
    assert_eq!(text.text_transform.case, TextTransformCase::Uppercase);
    assert!(text.text_transform.full_width);
    assert!(text.text_transform.full_size_kana);
    assert_eq!(text.white_space_collapse, WhiteSpaceCollapse::BreakSpaces);
    assert_eq!(text.text_wrap_mode, TextWrapMode::NoWrap);
    assert_eq!(text.word_break, WordBreak::KeepAll);
    assert_eq!(text.line_break, LineBreak::Strict);
    assert_eq!(text.overflow_wrap, OverflowWrap::Anywhere);
    assert_eq!(text.letter_spacing, px(1.5));
    assert_eq!(text.word_spacing, percent(10.0));
    assert_eq!(text.text_indent.value, percent(12.0));
    assert!(!text.text_indent.hanging);
    assert!(!text.text_indent.each_line);
}

fn assert_font(style: &InlineFormattingStyleV1) {
    let families = style.font.families.as_slice();
    assert_eq!(families.len(), 2);
    assert!(matches!(
        &families[0],
        FontFamily::Named(name)
            if name.as_str() == "Book Face" && name.syntax() == FontFamilyNameSyntax::Quoted
    ));
    assert_eq!(
        families[1],
        FontFamily::Generic(GenericFontFamily::SansSerif)
    );
    assert!(!style.font.is_system_font);
    assert!(!style.font.is_initial);
    assert_eq!(style.font.size.get(), 20.0);
    assert_eq!(style.font.weight.get(), 650.0);
    assert!(matches!(
        style.font.slant,
        FontSlant::Oblique(angle) if angle.degrees() == 12.0
    ));
    assert!(matches!(
        style.font.line_height,
        LineHeight::Number(value) if value.get() == 1.4
    ));
}

fn assert_bidi(style: &InlineFormattingStyleV1) {
    assert_eq!(style.bidi.direction, Direction::RightToLeft);
    assert_eq!(style.bidi.unicode_bidi, UnicodeBidi::IsolateOverride);
    assert_eq!(style.bidi.writing_mode, WritingMode::VerticalRightToLeft);
}

fn assert_fragment(style: &InlineFormattingStyleV1) {
    let fragment = &style.fragment;
    assert_eq!(fragment.margin.top, auto_value(px(1.0)));
    assert_eq!(fragment.margin.right, auto_value(percent(2.0)));
    assert_eq!(fragment.margin.bottom, auto_value(px(3.0)));
    assert_eq!(fragment.margin.left, LengthPercentageOrAuto::Auto);
    assert_eq!(fragment.padding.top.value(), px(4.0));
    assert_eq!(fragment.padding.right.value(), percent(5.0));
    assert_eq!(fragment.padding.bottom.value(), px(6.0));
    assert_eq!(fragment.padding.left.value(), percent(7.0));

    assert_border(
        &fragment.border.top,
        2.0,
        BorderStyle::Dashed,
        p3(0.8, 0.2, 0.1),
    );
    assert_border(
        &fragment.border.right,
        3.0,
        BorderStyle::Dotted,
        ComputedColorV1::CurrentColor,
    );
    assert_border(
        &fragment.border.bottom,
        0.0,
        BorderStyle::None,
        srgb(1.0, 0.0, 0.0),
    );
    assert_border(
        &fragment.border.left,
        0.0,
        BorderStyle::Hidden,
        srgb(0.0, 0.0, 1.0),
    );

    assert_radius(fragment.border_radii.top_left.horizontal, px(1.0));
    assert_radius(fragment.border_radii.top_left.vertical, percent(5.0));
    assert_radius(fragment.border_radii.top_right.horizontal, px(2.0));
    assert_radius(fragment.border_radii.top_right.vertical, percent(6.0));
    assert_radius(fragment.border_radii.bottom_right.horizontal, px(3.0));
    assert_radius(fragment.border_radii.bottom_right.vertical, percent(7.0));
    assert_radius(fragment.border_radii.bottom_left.horizontal, px(4.0));
    assert_radius(fragment.border_radii.bottom_left.vertical, percent(8.0));
    assert_eq!(fragment.alignment_baseline, AlignmentBaseline::Middle);
    assert_eq!(fragment.baseline_source, BaselineSource::Last);
    assert_eq!(fragment.baseline_shift, BaselineShift::Center);
}

fn assert_paint(style: &InlineFormattingStyleV1) {
    let paint = &style.paint;
    assert_eq!(
        paint.foreground,
        absolute(AbsoluteColorSpace::DisplayP3, 0.7, 0.3, 0.2)
    );
    assert_eq!(paint.background, ComputedColorV1::CurrentColor);
    assert_eq!(paint.opacity.get(), 0.25);
    assert!(paint.transform.is_none());
    assert!(paint.text_decoration.lines.underline);
    assert_eq!(paint.text_decoration.style, TextDecorationStyle::Wavy);
    assert_eq!(paint.text_decoration.color, ComputedColorV1::CurrentColor);

    assert_eq!(paint.text_shadows.len(), 2);
    let first_text = paint.text_shadows[0];
    assert_eq!(
        (first_text.offset_x.get(), first_text.offset_y.get()),
        (1.0, 2.0)
    );
    assert_eq!(first_text.blur_radius.get(), 3.0);
    assert_eq!(first_text.color, ComputedColorV1::CurrentColor);
    let second_text = paint.text_shadows[1];
    assert_eq!(
        (second_text.offset_x.get(), second_text.offset_y.get()),
        (4.0, 5.0)
    );
    assert_eq!(second_text.blur_radius.get(), 6.0);
    assert_eq!(second_text.color, p3(0.1, 0.2, 0.3));

    assert_eq!(paint.box_shadows.len(), 2);
    let first_box = paint.box_shadows[0];
    assert_eq!(
        (first_box.offset_x.get(), first_box.offset_y.get()),
        (2.0, 3.0)
    );
    assert_eq!(
        (first_box.blur_radius.get(), first_box.spread_radius.get()),
        (4.0, 5.0)
    );
    assert_eq!(first_box.color, ComputedColorV1::CurrentColor);
    assert!(first_box.inset);
    let second_box = paint.box_shadows[1];
    assert_eq!(
        (second_box.offset_x.get(), second_box.offset_y.get()),
        (6.0, 7.0)
    );
    assert_eq!(
        (second_box.blur_radius.get(), second_box.spread_radius.get()),
        (8.0, 9.0)
    );
    assert_eq!(second_box.color, p3(0.2, 0.3, 0.4));
    assert!(!second_box.inset);
}

fn assert_border(edge: &BorderEdge, width: f32, style: BorderStyle, color: ComputedColorV1) {
    assert_eq!(edge.resolved_width.get(), width);
    assert_eq!(edge.style, style);
    assert_eq!(edge.color, color);
}

fn assert_radius(value: NonNegativeLengthPercentage, expected: LengthPercentage) {
    assert_eq!(value.value(), expected);
}

fn auto_value(value: LengthPercentage) -> LengthPercentageOrAuto {
    LengthPercentageOrAuto::Value(value)
}

fn px(value: f32) -> LengthPercentage {
    LengthPercentage::Length(CssPx::new(value).unwrap())
}

fn percent(value: f32) -> LengthPercentage {
    LengthPercentage::Percentage(Percentage::from_percent(value).unwrap())
}

fn p3(red: f32, green: f32, blue: f32) -> ComputedColorV1 {
    ComputedColorV1::Absolute(absolute(AbsoluteColorSpace::DisplayP3, red, green, blue))
}

fn srgb(red: f32, green: f32, blue: f32) -> ComputedColorV1 {
    ComputedColorV1::Absolute(absolute(AbsoluteColorSpace::Srgb, red, green, blue))
}

fn absolute(space: AbsoluteColorSpace, c0: f32, c1: f32, c2: f32) -> AbsoluteColor {
    AbsoluteColor::new(
        space,
        [c0, c1, c2],
        1.0,
        ColorNoneFlags::new(false, false, false, false),
    )
    .unwrap()
}
