//! Synthesized styles and marker text: the anonymous block style, the
//! inline style a node falls back to when the projection kept no entry for
//! it, and the outside list-marker text per `list-style-type`.

use rito_style_contract::{
    AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
    LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LengthPercentage,
    LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1, MinimumHeightV1,
    NonNegativeLengthPercentage, OverflowV1, PageBreakV1, PhysicalSides, PositionV1,
    PreferredSizeV1,
};

/// The marker text for one list item, or `None` when the list style
/// suppresses the marker. Ordinal styles follow the browser's counter
/// formatting; the symbol styles use the marker glyphs the browser
/// paints.
pub(super) fn list_marker_text(
    style: rito_style_contract::ListMarkerStyleV1,
    ordinal: u32,
) -> Option<String> {
    use rito_style_contract::ListMarkerStyleV1 as M;
    let text = match style {
        M::None => return None,
        M::Disc => "\u{2022}".to_owned(),
        M::Circle => "\u{25E6}".to_owned(),
        M::Square => "\u{25AA}".to_owned(),
        M::Decimal => format!("{ordinal}."),
        M::LowerAlpha => format!("{}.", alpha_ordinal(ordinal, false)),
        M::UpperAlpha => format!("{}.", alpha_ordinal(ordinal, true)),
        M::LowerRoman => format!("{}.", roman_ordinal(ordinal).to_lowercase()),
        M::UpperRoman => format!("{}.", roman_ordinal(ordinal)),
    };
    Some(text)
}

/// a., b., … z., aa., ab., … exactly as CSS `lower-alpha` counts.
fn alpha_ordinal(ordinal: u32, upper: bool) -> String {
    let mut n = ordinal;
    let mut out = Vec::new();
    while n > 0 {
        n -= 1;
        let letter = b'a' + (n % 26) as u8;
        out.push(if upper {
            letter.to_ascii_uppercase()
        } else {
            letter
        } as char);
        n /= 26;
    }
    out.into_iter().rev().collect()
}

/// I, II, III, IV, … CSS `upper-roman` counter formatting.
fn roman_ordinal(mut n: u32) -> String {
    const TABLE: [(u32, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (value, digits) in TABLE {
        while n >= value {
            out.push_str(digits);
            n -= value;
        }
    }
    out
}

/// The inline style a node degrades to when the projection retained no
/// entry for it: an undecorated 16px generic-serif paragraph. Inherited
/// context is lost, but the text renders.
pub(super) fn fallback_inline_formatting_style() -> rito_style_contract::InlineFormattingStyleV1 {
    let mut style = rito_inline::plain_paragraph_style(
        rito_style_contract::FontFamilies::new(vec![rito_style_contract::FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("one generic family is a valid stack"),
        16.0,
        0.0,
    );
    // The harness helper paints an opaque black background; a fallback
    // node must inherit the page instead of washing it out.
    style.paint.background = rito_style_contract::AbsoluteColor::new(
        rito_style_contract::AbsoluteColorSpace::Srgb,
        [0.0, 0.0, 0.0],
        0.0,
        rito_style_contract::ColorNoneFlags::new(false, false, false, false),
    )
    .expect("transparent is finite")
    .into();
    style
}

pub(super) fn anonymous_block_style() -> LayoutFormattingStyleV1 {
    let zero = LengthPercentageOrAuto::Value(LengthPercentage::Length(
        rito_style_contract::CssPx::new(0.0).expect("zero length is finite"),
    ));
    let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        rito_style_contract::CssPx::new(0.0).expect("zero length is finite"),
    ));
    LayoutFormattingStyleV1 {
        display: LayoutDisplayV1 {
            outside: LayoutDisplayOutsideV1::Block,
            inside: LayoutDisplayInsideV1::Flow,
            is_list_item: false,
        },
        margin: PhysicalSides {
            top: zero,
            right: zero,
            bottom: zero,
            left: zero,
        },
        padding: PhysicalSides {
            top: zero_padding,
            right: zero_padding,
            bottom: zero_padding,
            left: zero_padding,
        },
        box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
        justify_content: JustifyContentV1::Normal,
        align_items: AlignItemsV1::Normal,
        break_before: PageBreakV1::Auto,
        break_after: PageBreakV1::Auto,
        width: PreferredSizeV1::Auto,
        height: PreferredSizeV1::Auto,
        max_width: MaximumSizeV1::None,
        min_height: MinimumHeightV1::Auto,
        max_height: MaximumHeightV1::None,
        clear: ClearV1::None,
        float: FloatV1::None,
        overflow: OverflowV1::Visible,
        list_style_type: ListMarkerStyleV1::None,
        position: PositionV1::Static,
        inset: PhysicalSides {
            top: LengthPercentageOrAuto::Auto,
            right: LengthPercentageOrAuto::Auto,
            bottom: LengthPercentageOrAuto::Auto,
            left: LengthPercentageOrAuto::Auto,
        },
        vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
        border_spacing: (
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
        ),
        border_collapse: false,
        object_fit: rito_style_contract::ObjectFitV1::Fill,
    }
}
