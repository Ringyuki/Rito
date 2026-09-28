use std::{collections::HashMap, fmt};

use rito_source::NodeId;
use rito_style_contract::{
    AlignItems, CellVerticalAlign, Clear, CssPx, Float, JustifyContent, LayoutDisplay,
    LayoutDisplayInside, LayoutDisplayOutside, LayoutFormattingStyle, LayoutStyleId,
    LayoutStyleTable, LayoutStyleTableError, LengthPercentage, LengthPercentageOrAuto,
    ListMarkerStyle, MaximumHeight, MaximumSize, MinimumHeight, NonNegativeCssPx,
    NonNegativeLengthPercentage, NumericError, Overflow, PageBreak, Percentage, PhysicalSides,
    Position, PreferredSize,
};
use style::{
    counter_style::CounterStyle,
    properties::ComputedValues,
    values::{
        computed::{
            length_percentage::{LengthPercentage as StyloLengthPercentage, Unpacked},
            MaxSize as StyloMaxSize,
            NonNegativeLengthPercentage as StyloNonNegativeLengthPercentage, Size as StyloSize,
        },
        generics::length::{GenericMaxSize, GenericSize},
        specified::align::AlignFlags,
    },
};

use crate::{
    break_properties::{self, BreakEdge},
    dom::DomStorage,
};

#[cfg(test)]
mod sizing_tests;

/// Contract field that prevented an exact layout-style projection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutStyleField {
    ComputedStyle,
    Display,
    JustifyContent,
    AlignItems,
    FlexDirection,
    FlexWrap,
    BreakBefore,
    BreakAfter,
    Width,
    Height,
    MaxWidth,
    MinHeight,
    MaxHeight,
    Clear,
    Float,
    Overflow,
    Position,
    Inset,
    Margin,
    Padding,
    ListStyleType,
}

/// Stable reason a computed layout field could not be represented exactly.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutStyleProjectionReason {
    MissingPrimaryStyle,
    OpaqueCalc,
    AxisValuesDiffer,
    UnsupportedValue,
    InvalidNumeric(NumericError),
}

/// One source-element layout projection disposition in document order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutStyleDisposition {
    ContractProjected {
        node_id: NodeId,
        style_id: LayoutStyleId,
    },
    ContractRejected {
        node_id: NodeId,
        field: LayoutStyleField,
        reason: LayoutStyleProjectionReason,
    },
}

/// V1 layout contract table plus an audited disposition for every element.
pub struct LayoutStyleProjection {
    table: LayoutStyleTable,
    dispositions: Vec<LayoutStyleDisposition>,
}

impl fmt::Debug for LayoutStyleProjection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LayoutStyleProjection")
            .field("node_count", &self.table.node_count())
            .field("style_count", &self.table.style_count())
            .field("disposition_count", &self.dispositions.len())
            .field(
                "contract_projected_element_count",
                &self.contract_projected_element_count(),
            )
            .field(
                "contract_rejected_element_count",
                &self.contract_rejected_element_count(),
            )
            .finish()
    }
}

impl LayoutStyleProjection {
    pub fn table(&self) -> &LayoutStyleTable {
        &self.table
    }

    /// Consumes the projection, keeping only the interned table.
    ///
    /// Dispositions exist to explain rejection; a chapter that materialized
    /// successfully has none, so retention callers keep just the table.
    pub fn into_table(self) -> LayoutStyleTable {
        self.table
    }

    pub fn dispositions(&self) -> &[LayoutStyleDisposition] {
        &self.dispositions
    }

    pub fn contract_projected_element_count(&self) -> usize {
        self.dispositions
            .iter()
            .filter(|item| matches!(item, LayoutStyleDisposition::ContractProjected { .. }))
            .count()
    }

    pub fn contract_rejected_element_count(&self) -> usize {
        self.dispositions.len() - self.contract_projected_element_count()
    }

    pub fn is_contract_slice_complete(&self) -> bool {
        self.contract_projected_element_count() == self.dispositions.len()
    }
}

#[derive(Clone, Copy)]
struct ProjectionFailure {
    field: LayoutStyleField,
    reason: LayoutStyleProjectionReason,
}

type ProjectionResult<T> = Result<T, ProjectionFailure>;
type ProjectionCache = HashMap<usize, ProjectionResult<LayoutFormattingStyle>>;

pub(crate) fn project_layout(
    dom: &DomStorage,
) -> Result<LayoutStyleProjection, LayoutStyleTableError> {
    let mut table = LayoutStyleTable::new(dom.source_node_count());
    let mut dispositions = Vec::new();
    let mut cache = ProjectionCache::new();
    for element in dom.element_handles() {
        let node_id = element.id();
        let Some(styles) = element.primary_styles() else {
            dispositions.push(rejected(
                node_id,
                LayoutStyleField::ComputedStyle,
                LayoutStyleProjectionReason::MissingPrimaryStyle,
            ));
            continue;
        };
        let cache_key = std::ptr::from_ref(styles.as_ref()).addr();
        let projected = cache
            .entry(cache_key)
            .or_insert_with(|| layout_style(&styles));
        match projected {
            Ok(style) => {
                let style_id = table.intern_for_node(node_id.index(), *style)?;
                dispositions.push(LayoutStyleDisposition::ContractProjected { node_id, style_id });
            }
            Err(failure) => dispositions.push(rejected(node_id, failure.field, failure.reason)),
        }
    }
    Ok(LayoutStyleProjection {
        table,
        dispositions,
    })
}

fn layout_style(styles: &ComputedValues) -> ProjectionResult<LayoutFormattingStyle> {
    let display = display(styles.clone_display());
    validate_flex_flow(styles, display)?;
    Ok(LayoutFormattingStyle {
        display,
        justify_content: justify_content(styles.clone_justify_content())?,
        align_items: align_items(styles.clone_align_items())?,
        break_before: page_break(styles, BreakEdge::Before, LayoutStyleField::BreakBefore)?,
        break_after: page_break(styles, BreakEdge::After, LayoutStyleField::BreakAfter)?,
        width: preferred_size(styles.clone_width(), LayoutStyleField::Width)?,
        height: preferred_size(styles.clone_height(), LayoutStyleField::Height)?,
        max_width: maximum_size(styles.clone_max_width())?,
        min_height: minimum_height(styles.clone_min_height())?,
        max_height: maximum_height(styles.clone_max_height())?,
        clear: clear(styles.clone_clear())?,
        float: float(styles.clone_float())?,
        overflow: overflow(styles.clone_overflow_x(), styles.clone_overflow_y())?,
        list_style_type: list_style_type(styles.clone_list_style_type())?,
        position: position(styles.get_box().clone_position())?,
        inset: inset(styles)?,
        vertical_align: cell_vertical_align(styles),
        border_spacing: {
            // Non-finite or negative separations cannot occur: the
            // registered custom property only accepts lengths, and the
            // parser floors them at zero.
            let (horizontal, vertical) = crate::break_properties::project_border_spacing(styles);
            (non_negative_px(horizontal), non_negative_px(vertical))
        },
        border_collapse: crate::break_properties::project_border_collapse(styles),
        margin: margin(styles)?,
        padding: padding(styles)?,
        box_sizing: box_sizing(styles),
        object_fit: object_fit(styles),
    })
}

fn page_break(
    styles: &ComputedValues,
    edge: BreakEdge,
    field: LayoutStyleField,
) -> ProjectionResult<PageBreak> {
    break_properties::project(styles, edge).ok_or_else(|| unsupported(field))
}

fn validate_flex_flow(styles: &ComputedValues, display: LayoutDisplay) -> ProjectionResult<()> {
    if display.inside != LayoutDisplayInside::Flex {
        return Ok(());
    }
    use style::properties::longhands::{flex_direction, flex_wrap};
    if styles.clone_flex_direction() != flex_direction::computed_value::T::Row {
        return Err(unsupported(LayoutStyleField::FlexDirection));
    }
    if styles.clone_flex_wrap() != flex_wrap::computed_value::T::Nowrap {
        return Err(unsupported(LayoutStyleField::FlexWrap));
    }
    Ok(())
}

fn justify_content(
    value: style::values::specified::align::ContentDistribution,
) -> ProjectionResult<JustifyContent> {
    if value.primary() == AlignFlags::NORMAL {
        Ok(JustifyContent::Normal)
    } else if value.primary() == AlignFlags::CENTER {
        Ok(JustifyContent::Center)
    } else {
        Err(unsupported(LayoutStyleField::JustifyContent))
    }
}

fn align_items(
    value: style::values::specified::align::ItemPlacement,
) -> ProjectionResult<AlignItems> {
    if value.0 == AlignFlags::NORMAL {
        Ok(AlignItems::Normal)
    } else if value.0 == AlignFlags::CENTER {
        Ok(AlignItems::Center)
    } else {
        Err(unsupported(LayoutStyleField::AlignItems))
    }
}

/// The row-box alignment a table cell asks for. Only the keywords a table
/// cell can act on are distinguished; every other `vertical-align` value
/// (sub/super/lengths, which belong to inline layout) aligns baselines.
fn cell_vertical_align(styles: &ComputedValues) -> CellVerticalAlign {
    use style::values::computed::box_::AlignmentBaseline;
    use style::values::generics::box_::{BaselineShiftKeyword, GenericBaselineShift};

    // `vertical-align` expands into three longhands, and its keywords land
    // in different ones: `middle` is an alignment baseline, while
    // `top`/`bottom` are baseline shifts.
    let box_style = styles.get_box();
    if matches!(box_style.alignment_baseline, AlignmentBaseline::Middle) {
        return CellVerticalAlign::Middle;
    }
    match box_style.baseline_shift {
        GenericBaselineShift::Keyword(BaselineShiftKeyword::Top) => CellVerticalAlign::Top,
        GenericBaselineShift::Keyword(BaselineShiftKeyword::Center) => CellVerticalAlign::Middle,
        GenericBaselineShift::Keyword(BaselineShiftKeyword::Bottom) => CellVerticalAlign::Bottom,
        _ => CellVerticalAlign::Baseline,
    }
}

/// A finite, non-negative CSS pixel length, defaulting to zero.
fn non_negative_px(value: f32) -> NonNegativeCssPx {
    NonNegativeCssPx::new(value.max(0.0))
        .unwrap_or_else(|_| NonNegativeCssPx::new(0.0).expect("zero is a valid length"))
}

fn display(value: style::values::computed::Display) -> LayoutDisplay {
    LayoutDisplay {
        outside: match value.outside() {
            style::values::specified::box_::DisplayOutside::None => LayoutDisplayOutside::None,
            style::values::specified::box_::DisplayOutside::Inline => LayoutDisplayOutside::Inline,
            style::values::specified::box_::DisplayOutside::Block => LayoutDisplayOutside::Block,
            style::values::specified::box_::DisplayOutside::TableCaption => {
                LayoutDisplayOutside::TableCaption
            }
            style::values::specified::box_::DisplayOutside::InternalTable => {
                LayoutDisplayOutside::InternalTable
            }
        },
        inside: display_inside(value.inside()),
        is_list_item: value.is_list_item(),
    }
}

fn display_inside(value: style::values::specified::box_::DisplayInside) -> LayoutDisplayInside {
    use style::values::specified::box_::DisplayInside;

    match value {
        DisplayInside::None => LayoutDisplayInside::None,
        DisplayInside::Contents => LayoutDisplayInside::Contents,
        DisplayInside::Flow => LayoutDisplayInside::Flow,
        DisplayInside::FlowRoot => LayoutDisplayInside::FlowRoot,
        DisplayInside::Flex => LayoutDisplayInside::Flex,
        DisplayInside::Grid => LayoutDisplayInside::Grid,
        DisplayInside::Table => LayoutDisplayInside::Table,
        DisplayInside::TableRowGroup => LayoutDisplayInside::TableRowGroup,
        DisplayInside::TableColumn => LayoutDisplayInside::TableColumn,
        DisplayInside::TableColumnGroup => LayoutDisplayInside::TableColumnGroup,
        DisplayInside::TableHeaderGroup => LayoutDisplayInside::TableHeaderGroup,
        DisplayInside::TableFooterGroup => LayoutDisplayInside::TableFooterGroup,
        DisplayInside::TableRow => LayoutDisplayInside::TableRow,
        DisplayInside::TableCell => LayoutDisplayInside::TableCell,
    }
}

fn preferred_size(value: StyloSize, field: LayoutStyleField) -> ProjectionResult<PreferredSize> {
    match value {
        GenericSize::LengthPercentage(value) => Ok(PreferredSize::Value(
            non_negative_length_percentage(&value, field)?,
        )),
        GenericSize::Auto => Ok(PreferredSize::Auto),
        GenericSize::MaxContent => Ok(PreferredSize::MaxContent),
        GenericSize::MinContent => Ok(PreferredSize::MinContent),
        GenericSize::FitContent => Ok(PreferredSize::FitContent),
        GenericSize::WebkitFillAvailable => Ok(PreferredSize::WebkitFillAvailable),
        GenericSize::Stretch => Ok(PreferredSize::Stretch),
        GenericSize::FitContentFunction(value) => Ok(PreferredSize::FitContentFunction(
            non_negative_length_percentage(&value, field)?,
        )),
        GenericSize::AnchorSizeFunction(_) => Err(unsupported(field)),
        GenericSize::AnchorContainingCalcFunction(_) => Err(opaque_calc(field)),
    }
}

fn maximum_size(value: StyloMaxSize) -> ProjectionResult<MaximumSize> {
    let field = LayoutStyleField::MaxWidth;
    match value {
        GenericMaxSize::LengthPercentage(value) => Ok(MaximumSize::Value(
            non_negative_length_percentage(&value, field)?,
        )),
        GenericMaxSize::None => Ok(MaximumSize::None),
        GenericMaxSize::MaxContent => Ok(MaximumSize::MaxContent),
        GenericMaxSize::MinContent => Ok(MaximumSize::MinContent),
        GenericMaxSize::FitContent => Ok(MaximumSize::FitContent),
        GenericMaxSize::WebkitFillAvailable => Ok(MaximumSize::WebkitFillAvailable),
        GenericMaxSize::Stretch => Ok(MaximumSize::Stretch),
        GenericMaxSize::FitContentFunction(value) => Ok(MaximumSize::FitContentFunction(
            non_negative_length_percentage(&value, field)?,
        )),
        GenericMaxSize::AnchorSizeFunction(_) => Err(unsupported(field)),
        GenericMaxSize::AnchorContainingCalcFunction(_) => Err(opaque_calc(field)),
    }
}

fn minimum_height(value: StyloSize) -> ProjectionResult<MinimumHeight> {
    let field = LayoutStyleField::MinHeight;
    match value {
        GenericSize::LengthPercentage(value) => match height_limit(&value, field)? {
            HeightLimit::Length(value) => Ok(MinimumHeight::Length(value)),
            HeightLimit::Percentage(value) => Ok(MinimumHeight::Percentage(value)),
        },
        GenericSize::Auto => Ok(MinimumHeight::Auto),
        GenericSize::MaxContent
        | GenericSize::MinContent
        | GenericSize::FitContent
        | GenericSize::WebkitFillAvailable
        | GenericSize::Stretch
        | GenericSize::FitContentFunction(_)
        | GenericSize::AnchorSizeFunction(_) => Err(unsupported(field)),
        GenericSize::AnchorContainingCalcFunction(_) => Err(opaque_calc(field)),
    }
}

fn maximum_height(value: StyloMaxSize) -> ProjectionResult<MaximumHeight> {
    let field = LayoutStyleField::MaxHeight;
    match value {
        GenericMaxSize::LengthPercentage(value) => match height_limit(&value, field)? {
            HeightLimit::Length(value) => Ok(MaximumHeight::Length(value)),
            HeightLimit::Percentage(value) => Ok(MaximumHeight::Percentage(value)),
        },
        GenericMaxSize::None => Ok(MaximumHeight::None),
        GenericMaxSize::MaxContent
        | GenericMaxSize::MinContent
        | GenericMaxSize::FitContent
        | GenericMaxSize::WebkitFillAvailable
        | GenericMaxSize::Stretch
        | GenericMaxSize::FitContentFunction(_)
        | GenericMaxSize::AnchorSizeFunction(_) => Err(unsupported(field)),
        GenericMaxSize::AnchorContainingCalcFunction(_) => Err(opaque_calc(field)),
    }
}

fn position(value: style::computed_values::position::T) -> ProjectionResult<Position> {
    use style::computed_values::position::T as StyloPosition;

    Ok(match value {
        StyloPosition::Static => Position::Static,
        StyloPosition::Relative => Position::Relative,
        StyloPosition::Absolute => Position::Absolute,
        // Fixed and sticky have no paginated meaning in this consumer.
        StyloPosition::Fixed | StyloPosition::Sticky => {
            return Err(unsupported(LayoutStyleField::Position));
        }
    })
}

fn inset(styles: &ComputedValues) -> ProjectionResult<PhysicalSides<LengthPercentageOrAuto>> {
    let position = styles.get_position();
    Ok(PhysicalSides {
        top: inset_side(&position.top)?,
        right: inset_side(&position.right)?,
        bottom: inset_side(&position.bottom)?,
        left: inset_side(&position.left)?,
    })
}

fn box_sizing(styles: &ComputedValues) -> rito_style_contract::BoxSizing {
    use style::properties::longhands::box_sizing::computed_value::T;

    match styles.clone_box_sizing() {
        T::ContentBox => rito_style_contract::BoxSizing::ContentBox,
        T::BorderBox => rito_style_contract::BoxSizing::BorderBox,
    }
}

fn object_fit(styles: &ComputedValues) -> rito_style_contract::ObjectFit {
    use style::properties::longhands::object_fit::computed_value::T;

    match styles.clone_object_fit() {
        T::Fill => rito_style_contract::ObjectFit::Fill,
        T::Contain => rito_style_contract::ObjectFit::Contain,
        T::Cover => rito_style_contract::ObjectFit::Cover,
        T::None => rito_style_contract::ObjectFit::None,
        T::ScaleDown => rito_style_contract::ObjectFit::ScaleDown,
    }
}

fn margin(styles: &ComputedValues) -> ProjectionResult<PhysicalSides<LengthPercentageOrAuto>> {
    let margin = styles.get_margin();
    Ok(PhysicalSides {
        top: margin_side(&margin.margin_top)?,
        right: margin_side(&margin.margin_right)?,
        bottom: margin_side(&margin.margin_bottom)?,
        left: margin_side(&margin.margin_left)?,
    })
}

fn margin_side(
    value: &style::values::computed::Margin,
) -> ProjectionResult<LengthPercentageOrAuto> {
    use style::values::generics::length::GenericMargin as Margin;

    match value {
        Margin::Auto => Ok(LengthPercentageOrAuto::Auto),
        Margin::LengthPercentage(value) => Ok(LengthPercentageOrAuto::Value(length_percentage(
            value,
            LayoutStyleField::Margin,
        )?)),
        // Anchor positioning has no consumer here.
        Margin::AnchorSizeFunction(_) | Margin::AnchorContainingCalcFunction(_) => {
            Err(unsupported(LayoutStyleField::Margin))
        }
    }
}

fn padding(
    styles: &ComputedValues,
) -> ProjectionResult<PhysicalSides<NonNegativeLengthPercentage>> {
    let padding = styles.get_padding();
    Ok(PhysicalSides {
        top: non_negative_length_percentage(&padding.padding_top, LayoutStyleField::Padding)?,
        right: non_negative_length_percentage(&padding.padding_right, LayoutStyleField::Padding)?,
        bottom: non_negative_length_percentage(&padding.padding_bottom, LayoutStyleField::Padding)?,
        left: non_negative_length_percentage(&padding.padding_left, LayoutStyleField::Padding)?,
    })
}

fn inset_side(value: &style::values::computed::Inset) -> ProjectionResult<LengthPercentageOrAuto> {
    use style::values::generics::position::GenericInset as Inset;

    match value {
        Inset::Auto => Ok(LengthPercentageOrAuto::Auto),
        Inset::LengthPercentage(value) => Ok(LengthPercentageOrAuto::Value(length_percentage(
            value,
            LayoutStyleField::Inset,
        )?)),
        // Anchor positioning has no consumer here.
        Inset::AnchorFunction(_)
        | Inset::AnchorSizeFunction(_)
        | Inset::AnchorContainingCalcFunction(_) => Err(unsupported(LayoutStyleField::Inset)),
    }
}

fn clear(value: style::values::specified::box_::Clear) -> ProjectionResult<Clear> {
    use style::values::specified::box_::Clear as StyloClear;

    Ok(match value {
        StyloClear::None => Clear::None,
        StyloClear::Left => Clear::Left,
        StyloClear::Right => Clear::Right,
        StyloClear::Both => Clear::Both,
        StyloClear::InlineStart | StyloClear::InlineEnd => {
            return Err(unsupported(LayoutStyleField::Clear));
        }
    })
}

fn float(value: style::values::specified::box_::Float) -> ProjectionResult<Float> {
    use style::values::specified::box_::Float as StyloFloat;

    Ok(match value {
        StyloFloat::None => Float::None,
        StyloFloat::Left => Float::Left,
        StyloFloat::Right => Float::Right,
        StyloFloat::InlineStart | StyloFloat::InlineEnd => {
            return Err(unsupported(LayoutStyleField::Float));
        }
    })
}

fn overflow(
    x: style::values::specified::box_::Overflow,
    y: style::values::specified::box_::Overflow,
) -> ProjectionResult<Overflow> {
    use style::values::specified::box_::Overflow as StyloOverflow;

    let field = LayoutStyleField::Overflow;
    if x != y {
        return Err(axis_values_differ(field));
    }
    match x {
        StyloOverflow::Visible => Ok(Overflow::Visible),
        StyloOverflow::Hidden => Ok(Overflow::Hidden),
        StyloOverflow::Scroll | StyloOverflow::Auto | StyloOverflow::Clip => {
            Err(unsupported(field))
        }
    }
}

enum HeightLimit {
    Length(NonNegativeCssPx),
    Percentage(Percentage),
}

fn height_limit(
    value: &StyloNonNegativeLengthPercentage,
    field: LayoutStyleField,
) -> ProjectionResult<HeightLimit> {
    match value.0.unpack() {
        Unpacked::Length(length) => Ok(HeightLimit::Length(
            NonNegativeCssPx::new(length.px()).map_err(|error| invalid_numeric(field, error))?,
        )),
        Unpacked::Percentage(value) => Ok(HeightLimit::Percentage(
            Percentage::from_ratio(value.0).map_err(|error| invalid_numeric(field, error))?,
        )),
        Unpacked::Calc(_) => Err(opaque_calc(field)),
    }
}

fn non_negative_length_percentage(
    value: &StyloNonNegativeLengthPercentage,
    field: LayoutStyleField,
) -> ProjectionResult<NonNegativeLengthPercentage> {
    Ok(NonNegativeLengthPercentage::new(length_percentage(
        &value.0, field,
    )?))
}

fn length_percentage(
    value: &StyloLengthPercentage,
    field: LayoutStyleField,
) -> ProjectionResult<LengthPercentage> {
    match value.unpack() {
        Unpacked::Length(length) => Ok(LengthPercentage::Length(
            CssPx::new(length.px()).map_err(|error| invalid_numeric(field, error))?,
        )),
        Unpacked::Percentage(value) => Ok(LengthPercentage::Percentage(
            Percentage::from_ratio(value.0).map_err(|error| invalid_numeric(field, error))?,
        )),
        Unpacked::Calc(_) => Err(opaque_calc(field)),
    }
}

fn list_style_type(
    value: style::values::computed::ListStyleType,
) -> ProjectionResult<ListMarkerStyle> {
    let field = LayoutStyleField::ListStyleType;
    match value.0 {
        CounterStyle::None => Ok(ListMarkerStyle::None),
        CounterStyle::Name(name) => match &*name.0 {
            "disc" => Ok(ListMarkerStyle::Disc),
            "circle" => Ok(ListMarkerStyle::Circle),
            "square" => Ok(ListMarkerStyle::Square),
            "decimal" => Ok(ListMarkerStyle::Decimal),
            "lower-roman" => Ok(ListMarkerStyle::LowerRoman),
            "upper-roman" => Ok(ListMarkerStyle::UpperRoman),
            "lower-alpha" => Ok(ListMarkerStyle::LowerAlpha),
            "upper-alpha" => Ok(ListMarkerStyle::UpperAlpha),
            _ => Err(unsupported(field)),
        },
        CounterStyle::Symbols { .. } | CounterStyle::String(_) => Err(unsupported(field)),
    }
}

fn rejected(
    node_id: NodeId,
    field: LayoutStyleField,
    reason: LayoutStyleProjectionReason,
) -> LayoutStyleDisposition {
    LayoutStyleDisposition::ContractRejected {
        node_id,
        field,
        reason,
    }
}

fn opaque_calc(field: LayoutStyleField) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: LayoutStyleProjectionReason::OpaqueCalc,
    }
}

fn axis_values_differ(field: LayoutStyleField) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: LayoutStyleProjectionReason::AxisValuesDiffer,
    }
}

fn unsupported(field: LayoutStyleField) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: LayoutStyleProjectionReason::UnsupportedValue,
    }
}

fn invalid_numeric(field: LayoutStyleField, error: NumericError) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: LayoutStyleProjectionReason::InvalidNumeric(error),
    }
}
