use rito_source::NodeId;

use crate::dom::DomStorage;

use super::{display_v1, line_height, ComputedDisplayV1, ComputedLineHeightV1, SrgbaV1};

mod text;

pub use text::{
    FontStyleV2, LineBreakV2, OverflowWrapV2, TextAlignV2, TextTransformCaseV2, TextTransformV2,
    TextWrapModeV2, UnicodeBidiV2, WhiteSpaceCollapseV2, WordBreakV2,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BoxSizingV2 {
    ContentBox,
    BorderBox,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DirectionV2 {
    LeftToRight,
    RightToLeft,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WritingModeV2 {
    HorizontalTopToBottom,
    VerticalRightToLeft,
    VerticalLeftToRight,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TextJustifyV2 {
    Auto,
    None,
    InterWord,
    InterCharacter,
}

/// Production-oriented typed projection increment.
///
/// V2 keeps V1's computed distinctions and adds no-basis text/box fields plus
/// writing direction and Unicode bidi control. In particular, it does not
/// flatten writing mode into physical geometry, collapse white-space longhands
/// back into a shorthand, or turn `line-height: normal` into a guessed
/// multiplier.
#[derive(Clone, Debug, PartialEq)]
pub struct ComputedElementStyleV2 {
    pub node_id: NodeId,
    pub id: Option<String>,
    pub local_name: String,
    pub font_size_px: f32,
    pub font_weight: f32,
    pub font_style: FontStyleV2,
    pub line_height: ComputedLineHeightV1,
    pub display: ComputedDisplayV1,
    /// V1 compatibility color in canonical legacy sRGB. A future wide-gamut
    /// paint schema must replace this field rather than extending its meaning.
    pub color: SrgbaV1,
    pub opacity: f32,
    pub box_sizing: BoxSizingV2,
    pub margin_left_auto: bool,
    pub margin_right_auto: bool,
    pub direction: DirectionV2,
    pub unicode_bidi: UnicodeBidiV2,
    pub writing_mode: WritingModeV2,
    pub text_align: TextAlignV2,
    pub text_justify: TextJustifyV2,
    pub text_transform: TextTransformV2,
    pub white_space_collapse: WhiteSpaceCollapseV2,
    pub text_wrap_mode: TextWrapModeV2,
    pub word_break: WordBreakV2,
    pub line_break: LineBreakV2,
    pub overflow_wrap: OverflowWrapV2,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResolvedStylesV2 {
    pub elements: Vec<ComputedElementStyleV2>,
}

impl ResolvedStylesV2 {
    pub fn element_by_id(&self, id: &str) -> Option<&ComputedElementStyleV2> {
        self.elements
            .iter()
            .find(|element| element.id.as_deref() == Some(id))
    }
}

pub(crate) fn project_v2(dom: &DomStorage) -> ResolvedStylesV2 {
    let elements = dom
        .element_handles()
        .filter_map(|element| {
            let styles = element.primary_styles()?;
            let foreground = styles.clone_color();
            let foreground_srgb = foreground.into_srgb_legacy();
            Some(ComputedElementStyleV2 {
                node_id: element.id(),
                id: element.id_attribute().map(ToOwned::to_owned),
                local_name: element.local_name_string().to_owned(),
                font_size_px: styles.get_font().font_size.computed_size().px(),
                font_weight: styles.clone_font_weight().value(),
                font_style: text::font_style(styles.clone_font_style()),
                line_height: line_height(styles.clone_line_height()),
                display: display_v1(styles.clone_display()),
                color: srgba(foreground_srgb),
                opacity: styles.clone_opacity(),
                box_sizing: box_sizing(styles.clone_box_sizing()),
                margin_left_auto: styles.clone_margin_left().is_auto(),
                margin_right_auto: styles.clone_margin_right().is_auto(),
                direction: direction(styles.clone_direction()),
                unicode_bidi: text::unicode_bidi(styles.clone_unicode_bidi()),
                writing_mode: writing_mode(styles.clone_writing_mode()),
                text_align: text::text_align(styles.clone_text_align()),
                text_justify: text_justify(styles.clone_text_justify()),
                text_transform: text::text_transform(styles.clone_text_transform()),
                white_space_collapse: text::white_space_collapse(
                    styles.clone_white_space_collapse(),
                ),
                text_wrap_mode: text::text_wrap_mode(styles.clone_text_wrap_mode()),
                word_break: text::word_break(styles.clone_word_break()),
                line_break: text::line_break(styles.clone_line_break()),
                overflow_wrap: text::overflow_wrap(styles.clone_overflow_wrap()),
            })
        })
        .collect();
    ResolvedStylesV2 { elements }
}

fn srgba(color: style::color::AbsoluteColor) -> SrgbaV1 {
    let [red, green, blue, alpha] = *color.raw_components();
    SrgbaV1 {
        red,
        green,
        blue,
        alpha,
    }
}

fn box_sizing(value: style::properties::longhands::box_sizing::computed_value::T) -> BoxSizingV2 {
    use style::properties::longhands::box_sizing::computed_value::T;

    match value {
        T::ContentBox => BoxSizingV2::ContentBox,
        T::BorderBox => BoxSizingV2::BorderBox,
    }
}

fn direction(value: style::properties::longhands::direction::computed_value::T) -> DirectionV2 {
    use style::properties::longhands::direction::computed_value::T;

    match value {
        T::Ltr => DirectionV2::LeftToRight,
        T::Rtl => DirectionV2::RightToLeft,
    }
}

fn writing_mode(value: style::logical_geometry::WritingModeProperty) -> WritingModeV2 {
    use style::logical_geometry::WritingModeProperty;

    match value {
        WritingModeProperty::HorizontalTb => WritingModeV2::HorizontalTopToBottom,
        WritingModeProperty::VerticalRl => WritingModeV2::VerticalRightToLeft,
        WritingModeProperty::VerticalLr => WritingModeV2::VerticalLeftToRight,
    }
}

fn text_justify(value: style::values::computed::TextJustify) -> TextJustifyV2 {
    use style::values::computed::TextJustify;

    match value {
        TextJustify::Auto => TextJustifyV2::Auto,
        TextJustify::None => TextJustifyV2::None,
        TextJustify::InterWord => TextJustifyV2::InterWord,
        TextJustify::InterCharacter => TextJustifyV2::InterCharacter,
    }
}
