use std::sync::Arc;

use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, AlignmentBaseline, BackgroundImagePaintV1,
    BackgroundImagePositionV1, BackgroundImageRepeatV1, BackgroundImageSizeV1, BaselineShift,
    BaselineSource, BorderEdge, BorderEdges, BorderRadii, BorderStyle, ColorNoneFlags,
    CornerRadius, CssPx, Direction, FontFamilies, FontFamily, FontFamilyName, FontSlant,
    FontStyleV1, FontWeight, GenericFontFamily, InlineBidiV1, InlineFormattingStyleV1,
    InlineFragmentStyleV1, InlinePaintStyleV1, InlineStyleTableV1, InlineTextFlowV1, LanguageTag,
    LengthPercentage, LengthPercentageOrAuto, LineBreak, LineHeight, NonNegativeCssPx,
    NonNegativeLengthPercentage, NonNegativeNumber, OverflowWrap, Percentage, PhysicalSides,
    ResolvedUrlV1, StyleId, StyleTableError, TextAlign, TextDecoration, TextDecorationLines,
    TextDecorationStyle, TextIndent, TextJustify, TextShadow, TextTransform, TextTransformCase,
    TextWrapMode, TransformListV1, TransformOperationV1, UnicodeBidi, UnitInterval,
    WhiteSpaceCollapse, WordBreak, WritingMode,
};

fn px(value: f32) -> CssPx {
    CssPx::new(value).expect("fixture CSS length is finite")
}

fn non_negative_px(value: f32) -> NonNegativeCssPx {
    NonNegativeCssPx::new(value).expect("fixture CSS length is non-negative")
}

fn length(value: f32) -> LengthPercentage {
    LengthPercentage::Length(px(value))
}

fn non_negative_length(value: f32) -> NonNegativeLengthPercentage {
    NonNegativeLengthPercentage::new(length(value))
}

fn color(value: f32) -> AbsoluteColor {
    AbsoluteColor::new(
        AbsoluteColorSpace::DisplayP3,
        [value, 0.25, 0.75],
        1.0,
        ColorNoneFlags::new(false, false, false, false),
    )
    .expect("fixture color is finite")
}

fn border(value: f32) -> BorderEdge {
    BorderEdge {
        resolved_width: non_negative_px(value),
        style: BorderStyle::Solid,
        color: color(value / 10.0).into(),
    }
}

fn sides<T: Copy>(value: T) -> PhysicalSides<T> {
    PhysicalSides {
        top: value,
        right: value,
        bottom: value,
        left: value,
    }
}

fn style(seed: f32) -> InlineFormattingStyleV1 {
    let radius = CornerRadius {
        horizontal: non_negative_length(seed),
        vertical: non_negative_length(seed + 1.0),
    };
    InlineFormattingStyleV1 {
        font: font_style(seed),
        text_flow: text_flow(seed),
        bidi: InlineBidiV1 {
            direction: Direction::LeftToRight,
            unicode_bidi: UnicodeBidi::Normal,
            writing_mode: WritingMode::HorizontalTopToBottom,
        },
        fragment: InlineFragmentStyleV1 {
            margin: sides(LengthPercentageOrAuto::Value(length(seed))),
            padding: sides(non_negative_length(seed)),
            border: BorderEdges {
                top: border(seed),
                right: border(seed),
                bottom: border(seed),
                left: border(seed),
            },
            border_radii: BorderRadii {
                top_left: radius,
                top_right: radius,
                bottom_right: radius,
                bottom_left: radius,
            },
            alignment_baseline: AlignmentBaseline::Baseline,
            baseline_source: BaselineSource::Auto,
            baseline_shift: BaselineShift::Offset(length(0.0)),
        },
        paint: InlinePaintStyleV1 {
            foreground: color(seed / 10.0),
            opacity: UnitInterval::new(seed / 10.0).expect("fixture opacity is bounded"),
            background: color(seed / 20.0).into(),
            background_image: None,
            transform: TransformListV1::none(),
            text_decoration: TextDecoration {
                lines: TextDecorationLines::new(true, false, false, false),
                style: TextDecorationStyle::Solid,
                color: color(seed / 30.0).into(),
            },
            text_shadows: Arc::from(Vec::new()),
            box_shadows: Arc::from(Vec::new()),
        },
    }
}

fn font_style(seed: f32) -> FontStyleV1 {
    FontStyleV1 {
        families: FontFamilies::new(vec![
            FontFamily::Named(FontFamilyName::new(format!("Fixture {seed}"))),
            FontFamily::Generic(GenericFontFamily::Serif),
        ])
        .expect("fixture family list is non-empty"),
        is_system_font: false,
        is_initial: false,
        size: non_negative_px(16.0 + seed),
        weight: FontWeight::new(400.0).expect("fixture font weight is valid"),
        slant: FontSlant::Normal,
        line_height: LineHeight::Number(
            NonNegativeNumber::new(1.2).expect("fixture line height is non-negative"),
        ),
        line_height_is_declared: false,
    }
}

fn text_flow(seed: f32) -> InlineTextFlowV1 {
    InlineTextFlowV1 {
        text_align: TextAlign::Start,
        text_justify: TextJustify::Auto,
        text_transform: TextTransform {
            case: TextTransformCase::None,
            full_width: false,
            full_size_kana: false,
        },
        white_space_collapse: WhiteSpaceCollapse::Collapse,
        text_wrap_mode: TextWrapMode::Wrap,
        word_break: WordBreak::Normal,
        line_break: LineBreak::Auto,
        overflow_wrap: OverflowWrap::Normal,
        letter_spacing: length(seed),
        word_spacing: LengthPercentage::Percentage(
            Percentage::from_percent(seed).expect("fixture percentage is finite"),
        ),
        text_indent: TextIndent {
            value: length(seed),
            hanging: false,
            each_line: false,
        },
        language: None,
    }
}

#[test]
fn interning_is_value_deduplicated_and_first_seen_deterministic() {
    let first = style(1.0);
    let second = style(2.0);
    let mut table = InlineStyleTableV1::new(0);

    assert_eq!(table.intern(first.clone()), Ok(StyleId::from_raw(0)));
    assert_eq!(table.intern(second.clone()), Ok(StyleId::from_raw(1)));
    assert_eq!(table.intern(first.clone()), Ok(StyleId::from_raw(0)));
    assert_eq!(table.styles(), &[first, second]);

    let mut replay = InlineStyleTableV1::new(0);
    assert_eq!(replay.intern(style(1.0)), Ok(StyleId::from_raw(0)));
    assert_eq!(replay.intern(style(2.0)), Ok(StyleId::from_raw(1)));
}

#[test]
fn opacity_participates_in_style_interning() {
    let mut opaque = style(1.0);
    opaque.paint.opacity = UnitInterval::new(1.0).unwrap();
    let mut quarter = opaque.clone();
    quarter.paint.opacity = UnitInterval::new(0.25).unwrap();
    let mut table = InlineStyleTableV1::new(3);

    assert_eq!(table.intern(opaque), Ok(StyleId::from_raw(0)));
    assert_eq!(table.intern(quarter.clone()), Ok(StyleId::from_raw(1)));
    assert_eq!(table.intern(quarter), Ok(StyleId::from_raw(1)));
}

#[test]
fn node_mapping_reports_missing_and_out_of_bounds_states() {
    let mut table = InlineStyleTableV1::new(2);
    assert_eq!(
        table.node_style_id(0),
        Err(StyleTableError::MissingNodeStyle { node_index: 0 })
    );
    assert_eq!(
        table.node_style_id(2),
        Err(StyleTableError::NodeIndexOutOfBounds {
            node_index: 2,
            node_count: 2,
        })
    );
    assert_eq!(
        table.set_node_style(0, StyleId::from_raw(9)),
        Err(StyleTableError::StyleIdOutOfBounds {
            style_id: StyleId::from_raw(9),
            style_count: 0,
        })
    );

    let expected = style(3.0);
    let id = table
        .intern_for_node(1, expected.clone())
        .expect("in-bounds node can receive an interned style");
    assert_eq!(id, StyleId::from_raw(0));
    assert_eq!(table.node_style_id(1), Ok(id));
    assert_eq!(table.style_for_node(1), Ok(&expected));
}

#[test]
fn invalid_node_assignment_does_not_mutate_the_intern_table() {
    let mut table = InlineStyleTableV1::new(1);
    assert_eq!(
        table.intern_for_node(4, style(4.0)),
        Err(StyleTableError::NodeIndexOutOfBounds {
            node_index: 4,
            node_count: 1,
        })
    );
    assert_eq!(table.style_count(), 0);
}

#[test]
fn duplicate_node_assignment_is_rejected_without_interning_another_style() {
    let mut table = InlineStyleTableV1::new(1);
    let original_id = table
        .intern_for_node(0, style(1.0))
        .expect("first node assignment succeeds");

    assert_eq!(
        table.intern_for_node(0, style(2.0)),
        Err(StyleTableError::NodeStyleAlreadyAssigned {
            node_index: 0,
            style_id: original_id,
        })
    );
    assert_eq!(table.style_count(), 1);
    assert_eq!(table.node_style_ids(), &[Some(original_id)]);
}

#[test]
fn debug_output_is_bounded_to_counts() {
    let table = InlineStyleTableV1::new(3);
    assert_eq!(
        format!("{table:?}"),
        "InlineStyleTableV1 { style_count: 0, node_count: 3, assigned_node_count: 0 }"
    );
}

#[test]
fn nested_payloads_are_shared_across_many_unique_outer_styles() {
    let mut table = InlineStyleTableV1::new(2_048);
    let shadow = TextShadow {
        offset_x: px(1.0),
        offset_y: px(2.0),
        blur_radius: non_negative_px(3.0),
        color: color(0.5).into(),
    };
    for index in 0..2_048 {
        let mut value = style(1.0);
        value.text_flow.language = Some(LanguageTag::new(format!("x-{index}")));
        value.paint.text_shadows = Arc::from(vec![shadow]);
        value.paint.background_image = Some(BackgroundImagePaintV1 {
            url: ResolvedUrlV1::new("https://example.test/Images/background.jpg")
                .expect("fixture URL is absolute and bounded"),
            size: BackgroundImageSizeV1::Cover,
            repeat: BackgroundImageRepeatV1::NoRepeat,
            position: BackgroundImagePositionV1 {
                x: length(0.0),
                y: length(0.0),
            },
        });
        value.paint.transform = TransformListV1::new(vec![TransformOperationV1::Rotate {
            radians: rito_style_contract::FiniteF32::new(0.25).unwrap(),
        }])
        .unwrap();
        table
            .intern_for_node(index, value)
            .expect("stress fixture has bounded unique styles");
    }

    let first = &table.styles()[0];
    for value in &table.styles()[1..] {
        assert_eq!(
            first.font.families.as_slice().as_ptr(),
            value.font.families.as_slice().as_ptr()
        );
        assert!(Arc::ptr_eq(
            &first.paint.text_shadows,
            &value.paint.text_shadows
        ));
        assert_eq!(
            first
                .paint
                .background_image
                .as_ref()
                .unwrap()
                .url
                .as_str()
                .as_ptr(),
            value
                .paint
                .background_image
                .as_ref()
                .unwrap()
                .url
                .as_str()
                .as_ptr()
        );
        assert_eq!(
            first.paint.transform.as_slice().as_ptr(),
            value.paint.transform.as_slice().as_ptr()
        );
    }
}
