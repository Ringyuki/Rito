use rito_source::NodeId;

use crate::dom::DomStorage;

mod inline_v1;
mod layout_v1;
mod v2;

pub(crate) use inline_v1::project_inline_v1;
pub use inline_v1::{
    InlineStyleDispositionV1, InlineStyleFieldV1, InlineStyleProjectionReasonV1,
    InlineStyleProjectionV1,
};
pub(crate) use layout_v1::project_layout_v1;
pub use layout_v1::{
    LayoutStyleDispositionV1, LayoutStyleFieldV1, LayoutStyleProjectionReasonV1,
    LayoutStyleProjectionV1,
};
pub(crate) use v2::project_v2;
pub use v2::{
    BoxSizingV2, ComputedElementStyleV2, DirectionV2, FontStyleV2, LineBreakV2, OverflowWrapV2,
    ResolvedStylesV2, TextAlignV2, TextJustifyV2, TextTransformCaseV2, TextTransformV2,
    TextWrapModeV2, UnicodeBidiV2, WhiteSpaceCollapseV2, WordBreakV2, WritingModeV2,
};

/// Inline and block/layout migration slices produced from one Stylo resolve.
#[derive(Debug)]
pub struct ProductionStyleProjectionV1 {
    inline: InlineStyleProjectionV1,
    layout: LayoutStyleProjectionV1,
}

impl ProductionStyleProjectionV1 {
    pub(crate) fn new(inline: InlineStyleProjectionV1, layout: LayoutStyleProjectionV1) -> Self {
        Self { inline, layout }
    }

    pub fn inline(&self) -> &InlineStyleProjectionV1 {
        &self.inline
    }

    pub fn layout(&self) -> &LayoutStyleProjectionV1 {
        &self.layout
    }

    pub fn into_parts(self) -> (InlineStyleProjectionV1, LayoutStyleProjectionV1) {
        (self.inline, self.layout)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisplayCategory {
    None,
    Contents,
    Block,
    Inline,
    Other,
}

/// Initial typed projection used to validate the direct adapter plumbing.
/// V0 is intentionally small and must not be treated as the production
/// 76-field Rito style projection.
#[derive(Clone, Debug, PartialEq)]
pub struct ComputedElementStyleV0 {
    pub node_id: NodeId,
    pub id: Option<String>,
    pub local_name: String,
    pub font_size_px: f32,
    pub display: DisplayCategory,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResolvedStylesV0 {
    pub elements: Vec<ComputedElementStyleV0>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisplayOutsideV1 {
    None,
    Inline,
    Block,
    TableCaption,
    InternalTable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisplayInsideV1 {
    None,
    Contents,
    Flow,
    FlowRoot,
    Flex,
    Grid,
    Table,
    TableRowGroup,
    TableColumn,
    TableColumnGroup,
    TableHeaderGroup,
    TableFooterGroup,
    TableRow,
    TableCell,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ComputedDisplayV1 {
    pub outside: DisplayOutsideV1,
    pub inside: DisplayInsideV1,
    pub is_list_item: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ComputedLineHeightV1 {
    Normal,
    Number(f32),
    LengthPx(f32),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SrgbaV1 {
    pub red: f32,
    pub green: f32,
    pub blue: f32,
    pub alpha: f32,
}

/// First same-node, same-field projection. Unlike V0, these values preserve
/// the computed CSS distinctions needed by a differential correctness gate.
#[derive(Clone, Debug, PartialEq)]
pub struct ComputedElementStyleV1 {
    pub node_id: NodeId,
    pub id: Option<String>,
    pub local_name: String,
    pub font_size_px: f32,
    pub font_weight: f32,
    pub line_height: ComputedLineHeightV1,
    pub display: ComputedDisplayV1,
    pub color: SrgbaV1,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ResolvedStylesV1 {
    pub elements: Vec<ComputedElementStyleV1>,
}

impl ResolvedStylesV0 {
    pub fn element_by_id(&self, id: &str) -> Option<&ComputedElementStyleV0> {
        self.elements
            .iter()
            .find(|element| element.id.as_deref() == Some(id))
    }
}

impl ResolvedStylesV1 {
    pub fn element_by_id(&self, id: &str) -> Option<&ComputedElementStyleV1> {
        self.elements
            .iter()
            .find(|element| element.id.as_deref() == Some(id))
    }
}

pub(crate) fn project(dom: &DomStorage) -> ResolvedStylesV0 {
    let elements = dom
        .element_handles()
        .filter_map(|element| {
            let styles = element.primary_styles()?;
            Some(ComputedElementStyleV0 {
                node_id: element.id(),
                id: element.id_attribute().map(ToOwned::to_owned),
                local_name: element.local_name_string().to_owned(),
                font_size_px: styles.get_font().font_size.computed_size().px(),
                display: display_category(styles.clone_display()),
            })
        })
        .collect();
    ResolvedStylesV0 { elements }
}

pub(crate) fn project_v1(dom: &DomStorage) -> ResolvedStylesV1 {
    let elements = dom
        .element_handles()
        .filter_map(|element| {
            let styles = element.primary_styles()?;
            let color = styles.clone_color().into_srgb_legacy();
            let [red, green, blue, alpha] = *color.raw_components();
            Some(ComputedElementStyleV1 {
                node_id: element.id(),
                id: element.id_attribute().map(ToOwned::to_owned),
                local_name: element.local_name_string().to_owned(),
                font_size_px: styles.get_font().font_size.computed_size().px(),
                font_weight: styles.clone_font_weight().value(),
                line_height: line_height(styles.clone_line_height()),
                display: display_v1(styles.clone_display()),
                color: SrgbaV1 {
                    red,
                    green,
                    blue,
                    alpha,
                },
            })
        })
        .collect();
    ResolvedStylesV1 { elements }
}

fn line_height(value: style::values::computed::LineHeight) -> ComputedLineHeightV1 {
    use style::values::generics::font::GenericLineHeight;

    match value {
        GenericLineHeight::Normal => ComputedLineHeightV1::Normal,
        GenericLineHeight::Number(number) => ComputedLineHeightV1::Number(number.0),
        GenericLineHeight::Length(length) => ComputedLineHeightV1::LengthPx(length.0.px()),
    }
}

fn display_v1(display: style::values::computed::Display) -> ComputedDisplayV1 {
    ComputedDisplayV1 {
        outside: display_outside_v1(display.outside()),
        inside: display_inside_v1(display.inside()),
        is_list_item: display.is_list_item(),
    }
}

fn display_outside_v1(outside: style::values::specified::box_::DisplayOutside) -> DisplayOutsideV1 {
    use style::values::specified::box_::DisplayOutside;

    match outside {
        DisplayOutside::None => DisplayOutsideV1::None,
        DisplayOutside::Inline => DisplayOutsideV1::Inline,
        DisplayOutside::Block => DisplayOutsideV1::Block,
        DisplayOutside::TableCaption => DisplayOutsideV1::TableCaption,
        DisplayOutside::InternalTable => DisplayOutsideV1::InternalTable,
    }
}

fn display_inside_v1(inside: style::values::specified::box_::DisplayInside) -> DisplayInsideV1 {
    use style::values::specified::box_::DisplayInside;

    match inside {
        DisplayInside::None => DisplayInsideV1::None,
        DisplayInside::Contents => DisplayInsideV1::Contents,
        DisplayInside::Flow => DisplayInsideV1::Flow,
        DisplayInside::FlowRoot => DisplayInsideV1::FlowRoot,
        DisplayInside::Flex => DisplayInsideV1::Flex,
        DisplayInside::Grid => DisplayInsideV1::Grid,
        DisplayInside::Table => DisplayInsideV1::Table,
        DisplayInside::TableRowGroup => DisplayInsideV1::TableRowGroup,
        DisplayInside::TableColumn => DisplayInsideV1::TableColumn,
        DisplayInside::TableColumnGroup => DisplayInsideV1::TableColumnGroup,
        DisplayInside::TableHeaderGroup => DisplayInsideV1::TableHeaderGroup,
        DisplayInside::TableFooterGroup => DisplayInsideV1::TableFooterGroup,
        DisplayInside::TableRow => DisplayInsideV1::TableRow,
        DisplayInside::TableCell => DisplayInsideV1::TableCell,
    }
}

fn display_category(display: style::values::computed::Display) -> DisplayCategory {
    use style::values::specified::box_::{DisplayInside, DisplayOutside};

    if display.is_none() {
        return DisplayCategory::None;
    }
    if display.is_contents() {
        return DisplayCategory::Contents;
    }
    match (display.outside(), display.inside()) {
        (DisplayOutside::Block, _) => DisplayCategory::Block,
        (DisplayOutside::Inline, DisplayInside::Flow) => DisplayCategory::Inline,
        _ => DisplayCategory::Other,
    }
}
