use rito_style_contract::{
    AlignmentBaseline, BaselineShift, BorderRadii, BorderStyle, CornerRadius, CssPx,
    LengthPercentage, PhysicalSides,
};
use serde_json::{Map, Value};

use super::{
    invalid_issue, policy, unavailable, value, LegacyBorderEdgeGeometryV1, LegacyBorderGeometryV1,
    LegacyInlineEvidenceV1 as Evidence, LegacyInlineFieldOutcomeV1 as Outcome,
    LegacyInlineFieldReasonV1 as Reason, LegacyInlineFieldV1 as Field,
};

pub(super) fn project<'a>(style: &'a Map<String, Value>, field: Field) -> Outcome<'a> {
    match field {
        Field::Margin => margins(style),
        Field::Padding => padding(style),
        Field::Border => border(style),
        Field::BorderRadii => border_radii(style),
        Field::AlignmentBaseline => alignment_baseline(style),
        Field::BaselineSource => unavailable(field, Reason::ContractFieldMissing, None),
        Field::BaselineShift => baseline_shift(style),
        _ => unreachable!("fragment projector received non-fragment field"),
    }
}

fn margins(style: &Map<String, Value>) -> Outcome<'_> {
    let result = (|| {
        Ok(PhysicalSides {
            top: value::margin(style, "marginTop", Some("marginTopPct"), None)?,
            right: value::margin(
                style,
                "marginRight",
                Some("marginRightPct"),
                Some("marginRightAuto"),
            )?,
            bottom: value::margin(style, "marginBottom", Some("marginBottomPct"), None)?,
            left: value::margin(
                style,
                "marginLeft",
                Some("marginLeftPct"),
                Some("marginLeftAuto"),
            )?,
        })
    })();
    match result {
        Ok(sides) => policy(
            Field::Margin,
            Reason::LegacyParserPolicy,
            Evidence::Margins(sides),
        ),
        Err(issue) => invalid_issue(Field::Margin, issue),
    }
}

fn padding(style: &Map<String, Value>) -> Outcome<'_> {
    let result = (|| {
        Ok(PhysicalSides {
            top: value::non_negative_length_percentage(style, "paddingTop", Some("paddingTopPct"))?
                .value,
            right: value::non_negative_length_percentage(
                style,
                "paddingRight",
                Some("paddingRightPct"),
            )?
            .value,
            bottom: value::non_negative_length_percentage(
                style,
                "paddingBottom",
                Some("paddingBottomPct"),
            )?
            .value,
            left: value::non_negative_length_percentage(
                style,
                "paddingLeft",
                Some("paddingLeftPct"),
            )?
            .value,
        })
    })();
    match result {
        Ok(sides) => policy(
            Field::Padding,
            Reason::LegacyParserPolicy,
            Evidence::Padding(sides),
        ),
        Err(issue) => invalid_issue(Field::Padding, issue),
    }
}

fn border(style: &Map<String, Value>) -> Outcome<'_> {
    let result = (|| {
        Ok(LegacyBorderGeometryV1 {
            top: border_edge(style, "borderTop")?,
            right: border_edge(style, "borderRight")?,
            bottom: border_edge(style, "borderBottom")?,
            left: border_edge(style, "borderLeft")?,
        })
    })();
    match result {
        Ok(geometry) => unavailable(
            Field::Border,
            Reason::ColorNotComputed,
            Some(Evidence::BorderGeometry(geometry)),
        ),
        Err(issue) => invalid_issue(Field::Border, issue),
    }
}

fn border_edge<'a>(
    style: &'a Map<String, Value>,
    key: &str,
) -> Result<LegacyBorderEdgeGeometryV1<'a>, value::ValueIssue> {
    let object = value::object(style.get(key).ok_or(value::ValueIssue::Missing)?)?;
    let resolved_width = value::non_negative_css_px(object, "width")?.value;
    let edge_style = match value::string(object, "style")? {
        "none" => BorderStyle::None,
        "solid" => BorderStyle::Solid,
        "dotted" => BorderStyle::Dotted,
        "dashed" => BorderStyle::Dashed,
        _ => return Err(value::ValueIssue::Keyword),
    };
    Ok(LegacyBorderEdgeGeometryV1 {
        resolved_width,
        style: edge_style,
        raw_color: value::string(object, "color")?,
    })
}

fn border_radii(style: &Map<String, Value>) -> Outcome<'_> {
    match value::non_negative_length_percentage(style, "borderRadius", Some("borderRadiusPct")) {
        Ok(radius) => {
            let corner = CornerRadius {
                horizontal: radius.value,
                vertical: radius.value,
            };
            policy(
                Field::BorderRadii,
                Reason::LegacyShorthandCollapsed,
                Evidence::BorderRadii(BorderRadii {
                    top_left: corner,
                    top_right: corner,
                    bottom_right: corner,
                    bottom_left: corner,
                }),
            )
        }
        Err(issue) => invalid_issue(Field::BorderRadii, issue),
    }
}

fn alignment_baseline(style: &Map<String, Value>) -> Outcome<'_> {
    match vertical_align(style) {
        Ok((alignment, _)) => policy(
            Field::AlignmentBaseline,
            Reason::LegacyShorthandCollapsed,
            Evidence::AlignmentBaseline(alignment),
        ),
        Err(issue) => invalid_issue(Field::AlignmentBaseline, issue),
    }
}

fn baseline_shift(style: &Map<String, Value>) -> Outcome<'_> {
    match vertical_align(style) {
        Ok((_, shift)) => policy(
            Field::BaselineShift,
            Reason::LegacyShorthandCollapsed,
            Evidence::BaselineShift(shift),
        ),
        Err(issue) => invalid_issue(Field::BaselineShift, issue),
    }
}

fn vertical_align(
    style: &Map<String, Value>,
) -> Result<(AlignmentBaseline, BaselineShift), value::ValueIssue> {
    let zero = BaselineShift::Offset(LengthPercentage::Length(
        CssPx::new(0.0).expect("zero is a finite CSS length"),
    ));
    let value = match value::string(style, "verticalAlign")? {
        "baseline" => (AlignmentBaseline::Baseline, zero),
        "text-top" => (AlignmentBaseline::TextTop, zero),
        "text-bottom" => (AlignmentBaseline::TextBottom, zero),
        "middle" => (AlignmentBaseline::Middle, zero),
        "top" => (AlignmentBaseline::Baseline, BaselineShift::Top),
        "bottom" => (AlignmentBaseline::Baseline, BaselineShift::Bottom),
        "super" => (AlignmentBaseline::Baseline, BaselineShift::Super),
        "sub" => (AlignmentBaseline::Baseline, BaselineShift::Sub),
        _ => return Err(value::ValueIssue::Keyword),
    };
    Ok(value)
}
