use rito_style_contract::{
    AlignmentBaseline, BaselineShift, BaselineSource, BorderEdge, BorderEdges, BorderRadii,
    BorderStyle, CornerRadius, InlineFragmentStyleV1, LengthPercentageOrAuto, PhysicalSides,
};
use style::{
    properties::ComputedValues,
    values::{
        computed::{self, Margin},
        generics::{box_::GenericBaselineShift, length::GenericMargin},
    },
};

use super::{numeric, paint, InlineStyleFieldV1, ProjectionResult};

pub(super) fn project(styles: &ComputedValues) -> ProjectionResult<InlineFragmentStyleV1> {
    let box_style = styles.get_box();
    Ok(InlineFragmentStyleV1 {
        margin: margins(styles)?,
        padding: paddings(styles)?,
        border: borders(styles)?,
        border_radii: border_radii(styles)?,
        alignment_baseline: alignment_baseline(box_style.alignment_baseline),
        baseline_source: baseline_source(box_style.baseline_source),
        baseline_shift: baseline_shift(&box_style.baseline_shift)?,
    })
}

fn margins(styles: &ComputedValues) -> ProjectionResult<PhysicalSides<LengthPercentageOrAuto>> {
    let margin_style = styles.get_margin();
    Ok(PhysicalSides {
        top: margin(&margin_style.margin_top)?,
        right: margin(&margin_style.margin_right)?,
        bottom: margin(&margin_style.margin_bottom)?,
        left: margin(&margin_style.margin_left)?,
    })
}

fn margin(value: &Margin) -> ProjectionResult<LengthPercentageOrAuto> {
    match value {
        GenericMargin::Auto => Ok(LengthPercentageOrAuto::Auto),
        GenericMargin::LengthPercentage(value) => Ok(LengthPercentageOrAuto::Value(
            numeric::length_percentage(value, InlineStyleFieldV1::Margin)?,
        )),
        GenericMargin::AnchorSizeFunction(_) | GenericMargin::AnchorContainingCalcFunction(_) => {
            Err(numeric::unsupported(InlineStyleFieldV1::Margin))
        }
    }
}

fn paddings(
    styles: &ComputedValues,
) -> ProjectionResult<PhysicalSides<rito_style_contract::NonNegativeLengthPercentage>> {
    let padding = styles.get_padding();
    Ok(PhysicalSides {
        top: numeric::non_negative_length_percentage(
            &padding.padding_top,
            InlineStyleFieldV1::Padding,
        )?,
        right: numeric::non_negative_length_percentage(
            &padding.padding_right,
            InlineStyleFieldV1::Padding,
        )?,
        bottom: numeric::non_negative_length_percentage(
            &padding.padding_bottom,
            InlineStyleFieldV1::Padding,
        )?,
        left: numeric::non_negative_length_percentage(
            &padding.padding_left,
            InlineStyleFieldV1::Padding,
        )?,
    })
}

fn borders(styles: &ComputedValues) -> ProjectionResult<BorderEdges> {
    let border = styles.get_border();
    Ok(BorderEdges {
        top: border_edge(
            &border.border_top_width,
            border.border_top_style,
            &border.border_top_color,
        )?,
        right: border_edge(
            &border.border_right_width,
            border.border_right_style,
            &border.border_right_color,
        )?,
        bottom: border_edge(
            &border.border_bottom_width,
            border.border_bottom_style,
            &border.border_bottom_color,
        )?,
        left: border_edge(
            &border.border_left_width,
            border.border_left_style,
            &border.border_left_color,
        )?,
    })
}

fn border_edge(
    width: &computed::BorderSideWidth,
    style: computed::BorderStyle,
    color: &computed::Color,
) -> ProjectionResult<BorderEdge> {
    let width = if style.none_or_hidden() {
        0.0
    } else {
        width.0.to_f32_px()
    };
    Ok(BorderEdge {
        resolved_width: numeric::non_negative_css_px(width, InlineStyleFieldV1::Border)?,
        style: border_style(style),
        color: paint::computed_color(color, InlineStyleFieldV1::Border)?,
    })
}

fn border_style(value: computed::BorderStyle) -> BorderStyle {
    use style::values::specified::BorderStyle as StyloBorderStyle;

    match value {
        StyloBorderStyle::None => BorderStyle::None,
        StyloBorderStyle::Hidden => BorderStyle::Hidden,
        StyloBorderStyle::Dotted => BorderStyle::Dotted,
        StyloBorderStyle::Dashed => BorderStyle::Dashed,
        StyloBorderStyle::Solid => BorderStyle::Solid,
        StyloBorderStyle::Double => BorderStyle::Double,
        StyloBorderStyle::Groove => BorderStyle::Groove,
        StyloBorderStyle::Ridge => BorderStyle::Ridge,
        StyloBorderStyle::Inset => BorderStyle::Inset,
        StyloBorderStyle::Outset => BorderStyle::Outset,
    }
}

fn border_radii(styles: &ComputedValues) -> ProjectionResult<BorderRadii> {
    let border = styles.get_border();
    Ok(BorderRadii {
        top_left: corner_radius(&border.border_top_left_radius)?,
        top_right: corner_radius(&border.border_top_right_radius)?,
        bottom_right: corner_radius(&border.border_bottom_right_radius)?,
        bottom_left: corner_radius(&border.border_bottom_left_radius)?,
    })
}

fn corner_radius(value: &computed::BorderCornerRadius) -> ProjectionResult<CornerRadius> {
    Ok(CornerRadius {
        horizontal: numeric::non_negative_length_percentage(
            &value.0.width,
            InlineStyleFieldV1::BorderRadii,
        )?,
        vertical: numeric::non_negative_length_percentage(
            &value.0.height,
            InlineStyleFieldV1::BorderRadii,
        )?,
    })
}

fn alignment_baseline(value: computed::AlignmentBaseline) -> AlignmentBaseline {
    match value {
        computed::AlignmentBaseline::Baseline => AlignmentBaseline::Baseline,
        computed::AlignmentBaseline::TextBottom => AlignmentBaseline::TextBottom,
        computed::AlignmentBaseline::Middle => AlignmentBaseline::Middle,
        computed::AlignmentBaseline::TextTop => AlignmentBaseline::TextTop,
    }
}

fn baseline_source(value: computed::BaselineSource) -> BaselineSource {
    match value {
        computed::BaselineSource::Auto => BaselineSource::Auto,
        computed::BaselineSource::First => BaselineSource::First,
        computed::BaselineSource::Last => BaselineSource::Last,
    }
}

fn baseline_shift(value: &computed::BaselineShift) -> ProjectionResult<BaselineShift> {
    use style::values::generics::box_::BaselineShiftKeyword;

    match value {
        GenericBaselineShift::Keyword(BaselineShiftKeyword::Sub) => Ok(BaselineShift::Sub),
        GenericBaselineShift::Keyword(BaselineShiftKeyword::Super) => Ok(BaselineShift::Super),
        GenericBaselineShift::Keyword(BaselineShiftKeyword::Top) => Ok(BaselineShift::Top),
        GenericBaselineShift::Keyword(BaselineShiftKeyword::Center) => Ok(BaselineShift::Center),
        GenericBaselineShift::Keyword(BaselineShiftKeyword::Bottom) => Ok(BaselineShift::Bottom),
        GenericBaselineShift::Length(value) => Ok(BaselineShift::Offset(
            numeric::length_percentage(value, InlineStyleFieldV1::VerticalAlign)?,
        )),
    }
}
