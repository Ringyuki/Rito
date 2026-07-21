use std::{collections::HashMap, fmt};

use rito_source::NodeId;
use rito_style_contract::{
    AlignItemsV1, ClearV1, CssPx, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
    LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleId,
    LayoutStyleTableError, LayoutStyleTableV1, LengthPercentage, LengthPercentageOrAuto,
    ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1, MinimumHeightV1, NonNegativeCssPx,
    NonNegativeLengthPercentage, NumericError, OverflowV1, PageBreakV1, Percentage, PhysicalSides,
    PositionV1, PreferredSizeV1,
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

/// Contract field that prevented an exact layout-style projection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutStyleFieldV1 {
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
    ListStyleType,
}

/// Stable reason a computed layout field could not be represented exactly.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutStyleProjectionReasonV1 {
    MissingPrimaryStyle,
    OpaqueCalc,
    AxisValuesDiffer,
    UnsupportedValue,
    InvalidNumeric(NumericError),
}

/// One source-element layout projection disposition in document order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutStyleDispositionV1 {
    ContractProjected {
        node_id: NodeId,
        style_id: LayoutStyleId,
    },
    ContractRejected {
        node_id: NodeId,
        field: LayoutStyleFieldV1,
        reason: LayoutStyleProjectionReasonV1,
    },
}

/// V1 layout contract table plus an audited disposition for every element.
pub struct LayoutStyleProjectionV1 {
    table: LayoutStyleTableV1,
    dispositions: Vec<LayoutStyleDispositionV1>,
}

impl fmt::Debug for LayoutStyleProjectionV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LayoutStyleProjectionV1")
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

impl LayoutStyleProjectionV1 {
    pub fn table(&self) -> &LayoutStyleTableV1 {
        &self.table
    }

    pub fn dispositions(&self) -> &[LayoutStyleDispositionV1] {
        &self.dispositions
    }

    pub fn contract_projected_element_count(&self) -> usize {
        self.dispositions
            .iter()
            .filter(|item| matches!(item, LayoutStyleDispositionV1::ContractProjected { .. }))
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
    field: LayoutStyleFieldV1,
    reason: LayoutStyleProjectionReasonV1,
}

type ProjectionResult<T> = Result<T, ProjectionFailure>;
type ProjectionCache = HashMap<usize, ProjectionResult<LayoutFormattingStyleV1>>;

pub(crate) fn project_layout_v1(
    dom: &DomStorage,
) -> Result<LayoutStyleProjectionV1, LayoutStyleTableError> {
    let mut table = LayoutStyleTableV1::new(dom.source_node_count());
    let mut dispositions = Vec::new();
    let mut cache = ProjectionCache::new();
    for element in dom.element_handles() {
        let node_id = element.id();
        let Some(styles) = element.primary_styles() else {
            dispositions.push(rejected(
                node_id,
                LayoutStyleFieldV1::ComputedStyle,
                LayoutStyleProjectionReasonV1::MissingPrimaryStyle,
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
                dispositions
                    .push(LayoutStyleDispositionV1::ContractProjected { node_id, style_id });
            }
            Err(failure) => dispositions.push(rejected(node_id, failure.field, failure.reason)),
        }
    }
    Ok(LayoutStyleProjectionV1 {
        table,
        dispositions,
    })
}

fn layout_style(styles: &ComputedValues) -> ProjectionResult<LayoutFormattingStyleV1> {
    let display = display(styles.clone_display());
    validate_flex_flow(styles, display)?;
    Ok(LayoutFormattingStyleV1 {
        display,
        justify_content: justify_content(styles.clone_justify_content())?,
        align_items: align_items(styles.clone_align_items())?,
        break_before: page_break(styles, BreakEdge::Before, LayoutStyleFieldV1::BreakBefore)?,
        break_after: page_break(styles, BreakEdge::After, LayoutStyleFieldV1::BreakAfter)?,
        width: preferred_size(styles.clone_width(), LayoutStyleFieldV1::Width)?,
        height: preferred_size(styles.clone_height(), LayoutStyleFieldV1::Height)?,
        max_width: maximum_size(styles.clone_max_width())?,
        min_height: minimum_height(styles.clone_min_height())?,
        max_height: maximum_height(styles.clone_max_height())?,
        clear: clear(styles.clone_clear())?,
        float: float(styles.clone_float())?,
        overflow: overflow(styles.clone_overflow_x(), styles.clone_overflow_y())?,
        list_style_type: list_style_type(styles.clone_list_style_type())?,
        position: position(styles.get_box().clone_position())?,
        inset: inset(styles)?,
    })
}

fn page_break(
    styles: &ComputedValues,
    edge: BreakEdge,
    field: LayoutStyleFieldV1,
) -> ProjectionResult<PageBreakV1> {
    break_properties::project(styles, edge).ok_or_else(|| unsupported(field))
}

fn validate_flex_flow(styles: &ComputedValues, display: LayoutDisplayV1) -> ProjectionResult<()> {
    if display.inside != LayoutDisplayInsideV1::Flex {
        return Ok(());
    }
    use style::properties::longhands::{flex_direction, flex_wrap};
    if styles.clone_flex_direction() != flex_direction::computed_value::T::Row {
        return Err(unsupported(LayoutStyleFieldV1::FlexDirection));
    }
    if styles.clone_flex_wrap() != flex_wrap::computed_value::T::Nowrap {
        return Err(unsupported(LayoutStyleFieldV1::FlexWrap));
    }
    Ok(())
}

fn justify_content(
    value: style::values::specified::align::ContentDistribution,
) -> ProjectionResult<JustifyContentV1> {
    if value.primary() == AlignFlags::NORMAL {
        Ok(JustifyContentV1::Normal)
    } else if value.primary() == AlignFlags::CENTER {
        Ok(JustifyContentV1::Center)
    } else {
        Err(unsupported(LayoutStyleFieldV1::JustifyContent))
    }
}

fn align_items(
    value: style::values::specified::align::ItemPlacement,
) -> ProjectionResult<AlignItemsV1> {
    if value.0 == AlignFlags::NORMAL {
        Ok(AlignItemsV1::Normal)
    } else if value.0 == AlignFlags::CENTER {
        Ok(AlignItemsV1::Center)
    } else {
        Err(unsupported(LayoutStyleFieldV1::AlignItems))
    }
}

fn display(value: style::values::computed::Display) -> LayoutDisplayV1 {
    LayoutDisplayV1 {
        outside: match value.outside() {
            style::values::specified::box_::DisplayOutside::None => LayoutDisplayOutsideV1::None,
            style::values::specified::box_::DisplayOutside::Inline => {
                LayoutDisplayOutsideV1::Inline
            }
            style::values::specified::box_::DisplayOutside::Block => LayoutDisplayOutsideV1::Block,
            style::values::specified::box_::DisplayOutside::TableCaption => {
                LayoutDisplayOutsideV1::TableCaption
            }
            style::values::specified::box_::DisplayOutside::InternalTable => {
                LayoutDisplayOutsideV1::InternalTable
            }
        },
        inside: display_inside(value.inside()),
        is_list_item: value.is_list_item(),
    }
}

fn display_inside(value: style::values::specified::box_::DisplayInside) -> LayoutDisplayInsideV1 {
    use style::values::specified::box_::DisplayInside;

    match value {
        DisplayInside::None => LayoutDisplayInsideV1::None,
        DisplayInside::Contents => LayoutDisplayInsideV1::Contents,
        DisplayInside::Flow => LayoutDisplayInsideV1::Flow,
        DisplayInside::FlowRoot => LayoutDisplayInsideV1::FlowRoot,
        DisplayInside::Flex => LayoutDisplayInsideV1::Flex,
        DisplayInside::Grid => LayoutDisplayInsideV1::Grid,
        DisplayInside::Table => LayoutDisplayInsideV1::Table,
        DisplayInside::TableRowGroup => LayoutDisplayInsideV1::TableRowGroup,
        DisplayInside::TableColumn => LayoutDisplayInsideV1::TableColumn,
        DisplayInside::TableColumnGroup => LayoutDisplayInsideV1::TableColumnGroup,
        DisplayInside::TableHeaderGroup => LayoutDisplayInsideV1::TableHeaderGroup,
        DisplayInside::TableFooterGroup => LayoutDisplayInsideV1::TableFooterGroup,
        DisplayInside::TableRow => LayoutDisplayInsideV1::TableRow,
        DisplayInside::TableCell => LayoutDisplayInsideV1::TableCell,
    }
}

fn preferred_size(
    value: StyloSize,
    field: LayoutStyleFieldV1,
) -> ProjectionResult<PreferredSizeV1> {
    match value {
        GenericSize::LengthPercentage(value) => Ok(PreferredSizeV1::Value(
            non_negative_length_percentage(&value, field)?,
        )),
        GenericSize::Auto => Ok(PreferredSizeV1::Auto),
        GenericSize::MaxContent => Ok(PreferredSizeV1::MaxContent),
        GenericSize::MinContent => Ok(PreferredSizeV1::MinContent),
        GenericSize::FitContent => Ok(PreferredSizeV1::FitContent),
        GenericSize::WebkitFillAvailable => Ok(PreferredSizeV1::WebkitFillAvailable),
        GenericSize::Stretch => Ok(PreferredSizeV1::Stretch),
        GenericSize::FitContentFunction(value) => Ok(PreferredSizeV1::FitContentFunction(
            non_negative_length_percentage(&value, field)?,
        )),
        GenericSize::AnchorSizeFunction(_) => Err(unsupported(field)),
        GenericSize::AnchorContainingCalcFunction(_) => Err(opaque_calc(field)),
    }
}

fn maximum_size(value: StyloMaxSize) -> ProjectionResult<MaximumSizeV1> {
    let field = LayoutStyleFieldV1::MaxWidth;
    match value {
        GenericMaxSize::LengthPercentage(value) => Ok(MaximumSizeV1::Value(
            non_negative_length_percentage(&value, field)?,
        )),
        GenericMaxSize::None => Ok(MaximumSizeV1::None),
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

fn minimum_height(value: StyloSize) -> ProjectionResult<MinimumHeightV1> {
    let field = LayoutStyleFieldV1::MinHeight;
    match value {
        GenericSize::LengthPercentage(value) => match height_limit(&value, field)? {
            HeightLimit::Length(value) => Ok(MinimumHeightV1::Length(value)),
            HeightLimit::Percentage(value) => Ok(MinimumHeightV1::Percentage(value)),
        },
        GenericSize::Auto => Ok(MinimumHeightV1::Auto),
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

fn maximum_height(value: StyloMaxSize) -> ProjectionResult<MaximumHeightV1> {
    let field = LayoutStyleFieldV1::MaxHeight;
    match value {
        GenericMaxSize::LengthPercentage(value) => match height_limit(&value, field)? {
            HeightLimit::Length(value) => Ok(MaximumHeightV1::Length(value)),
            HeightLimit::Percentage(value) => Ok(MaximumHeightV1::Percentage(value)),
        },
        GenericMaxSize::None => Ok(MaximumHeightV1::None),
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

fn position(value: style::computed_values::position::T) -> ProjectionResult<PositionV1> {
    use style::computed_values::position::T as StyloPosition;

    Ok(match value {
        StyloPosition::Static => PositionV1::Static,
        StyloPosition::Relative => PositionV1::Relative,
        StyloPosition::Absolute => PositionV1::Absolute,
        // Fixed and sticky have no paginated meaning in this consumer.
        StyloPosition::Fixed | StyloPosition::Sticky => {
            return Err(unsupported(LayoutStyleFieldV1::Position));
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

fn inset_side(value: &style::values::computed::Inset) -> ProjectionResult<LengthPercentageOrAuto> {
    use style::values::generics::position::GenericInset as Inset;

    match value {
        Inset::Auto => Ok(LengthPercentageOrAuto::Auto),
        Inset::LengthPercentage(value) => Ok(LengthPercentageOrAuto::Value(length_percentage(
            value,
            LayoutStyleFieldV1::Inset,
        )?)),
        // Anchor positioning has no consumer here.
        Inset::AnchorFunction(_)
        | Inset::AnchorSizeFunction(_)
        | Inset::AnchorContainingCalcFunction(_) => Err(unsupported(LayoutStyleFieldV1::Inset)),
    }
}

fn clear(value: style::values::specified::box_::Clear) -> ProjectionResult<ClearV1> {
    use style::values::specified::box_::Clear as StyloClear;

    Ok(match value {
        StyloClear::None => ClearV1::None,
        StyloClear::Left => ClearV1::Left,
        StyloClear::Right => ClearV1::Right,
        StyloClear::Both => ClearV1::Both,
        StyloClear::InlineStart | StyloClear::InlineEnd => {
            return Err(unsupported(LayoutStyleFieldV1::Clear));
        }
    })
}

fn float(value: style::values::specified::box_::Float) -> ProjectionResult<FloatV1> {
    use style::values::specified::box_::Float as StyloFloat;

    Ok(match value {
        StyloFloat::None => FloatV1::None,
        StyloFloat::Left => FloatV1::Left,
        StyloFloat::Right => FloatV1::Right,
        StyloFloat::InlineStart | StyloFloat::InlineEnd => {
            return Err(unsupported(LayoutStyleFieldV1::Float));
        }
    })
}

fn overflow(
    x: style::values::specified::box_::Overflow,
    y: style::values::specified::box_::Overflow,
) -> ProjectionResult<OverflowV1> {
    use style::values::specified::box_::Overflow as StyloOverflow;

    let field = LayoutStyleFieldV1::Overflow;
    if x != y {
        return Err(axis_values_differ(field));
    }
    match x {
        StyloOverflow::Visible => Ok(OverflowV1::Visible),
        StyloOverflow::Hidden => Ok(OverflowV1::Hidden),
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
    field: LayoutStyleFieldV1,
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
    field: LayoutStyleFieldV1,
) -> ProjectionResult<NonNegativeLengthPercentage> {
    Ok(NonNegativeLengthPercentage::new(length_percentage(
        &value.0, field,
    )?))
}

fn length_percentage(
    value: &StyloLengthPercentage,
    field: LayoutStyleFieldV1,
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
) -> ProjectionResult<ListMarkerStyleV1> {
    let field = LayoutStyleFieldV1::ListStyleType;
    match value.0 {
        CounterStyle::None => Ok(ListMarkerStyleV1::None),
        CounterStyle::Name(name) => match &*name.0 {
            "disc" => Ok(ListMarkerStyleV1::Disc),
            "circle" => Ok(ListMarkerStyleV1::Circle),
            "square" => Ok(ListMarkerStyleV1::Square),
            "decimal" => Ok(ListMarkerStyleV1::Decimal),
            "lower-roman" => Ok(ListMarkerStyleV1::LowerRoman),
            "upper-roman" => Ok(ListMarkerStyleV1::UpperRoman),
            "lower-alpha" => Ok(ListMarkerStyleV1::LowerAlpha),
            "upper-alpha" => Ok(ListMarkerStyleV1::UpperAlpha),
            _ => Err(unsupported(field)),
        },
        CounterStyle::Symbols { .. } | CounterStyle::String(_) => Err(unsupported(field)),
    }
}

fn rejected(
    node_id: NodeId,
    field: LayoutStyleFieldV1,
    reason: LayoutStyleProjectionReasonV1,
) -> LayoutStyleDispositionV1 {
    LayoutStyleDispositionV1::ContractRejected {
        node_id,
        field,
        reason,
    }
}

fn opaque_calc(field: LayoutStyleFieldV1) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: LayoutStyleProjectionReasonV1::OpaqueCalc,
    }
}

fn axis_values_differ(field: LayoutStyleFieldV1) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: LayoutStyleProjectionReasonV1::AxisValuesDiffer,
    }
}

fn unsupported(field: LayoutStyleFieldV1) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: LayoutStyleProjectionReasonV1::UnsupportedValue,
    }
}

fn invalid_numeric(field: LayoutStyleFieldV1, error: NumericError) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: LayoutStyleProjectionReasonV1::InvalidNumeric(error),
    }
}
