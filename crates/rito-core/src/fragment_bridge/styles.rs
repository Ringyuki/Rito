//! Synthesized styles and marker text: the anonymous block style, the
//! inline style a node falls back to when the projection kept no entry for
//! it, and the outside list-marker text per `list-style-type`.

use rito_style_contract::{
    AlignItems, Clear, Float, JustifyContent, LayoutDisplay, LayoutDisplayInside,
    LayoutDisplayOutside, LayoutFormattingStyle, LengthPercentage, LengthPercentageOrAuto,
    ListMarkerStyle, MaximumHeight, MaximumSize, MinimumHeight, NonNegativeLengthPercentage,
    Overflow, PageBreak, PhysicalSides, Position, PreferredSize,
};

/// The marker text for one list item, or `None` when the list style
/// suppresses the marker. Ordinal styles follow the browser's counter
/// formatting; the symbol styles use the marker glyphs the browser
/// paints.
pub(super) fn list_marker_text(
    style: rito_style_contract::ListMarkerStyle,
    ordinal: u32,
) -> Option<String> {
    use rito_style_contract::ListMarkerStyle as M;
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
pub(super) fn fallback_inline_formatting_style() -> rito_style_contract::InlineFormattingStyle {
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

pub(super) fn anonymous_block_style() -> LayoutFormattingStyle {
    let zero = LengthPercentageOrAuto::Value(LengthPercentage::Length(
        rito_style_contract::CssPx::new(0.0).expect("zero length is finite"),
    ));
    let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        rito_style_contract::CssPx::new(0.0).expect("zero length is finite"),
    ));
    LayoutFormattingStyle {
        display: LayoutDisplay {
            outside: LayoutDisplayOutside::Block,
            inside: LayoutDisplayInside::Flow,
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
        box_sizing: rito_style_contract::BoxSizing::ContentBox,
        justify_content: JustifyContent::Normal,
        align_items: AlignItems::Normal,
        break_before: PageBreak::Auto,
        break_after: PageBreak::Auto,
        width: PreferredSize::Auto,
        height: PreferredSize::Auto,
        max_width: MaximumSize::None,
        min_height: MinimumHeight::Auto,
        max_height: MaximumHeight::None,
        clear: Clear::None,
        float: Float::None,
        overflow: Overflow::Visible,
        list_style_type: ListMarkerStyle::None,
        position: Position::Static,
        inset: PhysicalSides {
            top: LengthPercentageOrAuto::Auto,
            right: LengthPercentageOrAuto::Auto,
            bottom: LengthPercentageOrAuto::Auto,
            left: LengthPercentageOrAuto::Auto,
        },
        vertical_align: rito_style_contract::CellVerticalAlign::Baseline,
        border_spacing: (
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
        ),
        border_collapse: false,
        object_fit: rito_style_contract::ObjectFit::Fill,
    }
}
