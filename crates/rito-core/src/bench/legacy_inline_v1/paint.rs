use rito_style_contract::{
    TextDecorationLines, TextDecorationStyle, INLINE_STYLE_LIST_ITEM_LIMIT_V1,
};
use serde_json::{Map, Value};

use super::{
    exact, invalid_issue, policy, unavailable, value, LegacyBoxShadowGeometryV1,
    LegacyInlineEvidenceV1 as Evidence, LegacyInlineFieldOutcomeV1 as Outcome,
    LegacyInlineFieldReasonV1 as Reason, LegacyInlineFieldV1 as Field,
    LegacyTextDecorationGeometryV1, LegacyTextShadowGeometryV1,
};

pub(super) fn project<'a>(style: &'a Map<String, Value>, field: Field) -> Outcome<'a> {
    match field {
        Field::Foreground => raw_color(style, field, "color"),
        Field::Opacity => opacity(style),
        Field::Background => raw_color(style, field, "backgroundColor"),
        Field::TextDecoration => text_decoration(style),
        Field::TextShadows => text_shadows(style),
        Field::BoxShadows => box_shadows(style),
        _ => unreachable!("paint projector received non-paint field"),
    }
}

fn opacity(style: &Map<String, Value>) -> Outcome<'_> {
    match value::unit_interval(style, "opacity") {
        Ok(number) if number.exact_f32 => {
            exact(Field::Opacity, Evidence::UnitInterval(number.value))
        }
        Ok(number) => policy(
            Field::Opacity,
            Reason::NumericNarrowing,
            Evidence::UnitInterval(number.value),
        ),
        Err(issue) => invalid_issue(Field::Opacity, issue),
    }
}

fn raw_color<'a>(style: &'a Map<String, Value>, field: Field, key: &str) -> Outcome<'a> {
    match value::string(style, key) {
        Ok(raw) => unavailable(
            field,
            Reason::ColorNotComputed,
            Some(Evidence::RawString(raw)),
        ),
        Err(issue) => invalid_issue(field, issue),
    }
}

fn text_decoration(style: &Map<String, Value>) -> Outcome<'_> {
    let lines = match value::string(style, "textDecoration") {
        Ok("none") => TextDecorationLines::new(false, false, false, false),
        Ok("underline") => TextDecorationLines::new(true, false, false, false),
        Ok("line-through") => TextDecorationLines::new(false, false, true, false),
        Ok(_) => return invalid_issue(Field::TextDecoration, value::ValueIssue::Keyword),
        Err(issue) => return invalid_issue(Field::TextDecoration, issue),
    };
    let raw_color = match value::string(style, "color") {
        Ok(value) => value,
        Err(issue) => return invalid_issue(Field::TextDecoration, issue),
    };
    unavailable(
        Field::TextDecoration,
        Reason::ColorNotComputed,
        Some(Evidence::TextDecorationGeometry(
            LegacyTextDecorationGeometryV1 {
                lines,
                style: TextDecorationStyle::Solid,
                raw_color,
            },
        )),
    )
}

fn text_shadows(style: &Map<String, Value>) -> Outcome<'_> {
    let values = match value::array(style, "textShadow") {
        Ok(values) => values,
        Err(value::ValueIssue::Missing) => {
            return policy(
                Field::TextShadows,
                Reason::LegacyParserPolicy,
                Evidence::TextShadowGeometry(Box::new([])),
            );
        }
        Err(issue) => return invalid_issue(Field::TextShadows, issue),
    };
    if values.len() > INLINE_STYLE_LIST_ITEM_LIMIT_V1 {
        return unavailable(Field::TextShadows, Reason::ProjectionBudgetExceeded, None);
    }
    let geometry = match values
        .iter()
        .map(text_shadow)
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(values) => values.into_boxed_slice(),
        Err(issue) => return invalid_issue(Field::TextShadows, issue),
    };
    if geometry.is_empty() {
        policy(
            Field::TextShadows,
            Reason::LegacyParserPolicy,
            Evidence::TextShadowGeometry(geometry),
        )
    } else {
        unavailable(
            Field::TextShadows,
            Reason::ColorNotComputed,
            Some(Evidence::TextShadowGeometry(geometry)),
        )
    }
}

fn text_shadow(value: &Value) -> Result<LegacyTextShadowGeometryV1<'_>, value::ValueIssue> {
    let object = value::object(value)?;
    Ok(LegacyTextShadowGeometryV1 {
        offset_x: value::css_px(object, "offsetX")?.value,
        offset_y: value::css_px(object, "offsetY")?.value,
        blur_radius: value::non_negative_css_px(object, "blur")?.value,
        raw_color: value::string(object, "color")?,
    })
}

fn box_shadows(style: &Map<String, Value>) -> Outcome<'_> {
    let values = match value::array(style, "boxShadow") {
        Ok(values) => values,
        Err(issue) => return invalid_issue(Field::BoxShadows, issue),
    };
    if values.len() > INLINE_STYLE_LIST_ITEM_LIMIT_V1 {
        return unavailable(Field::BoxShadows, Reason::ProjectionBudgetExceeded, None);
    }
    let geometry = match values.iter().map(box_shadow).collect::<Result<Vec<_>, _>>() {
        Ok(values) => values.into_boxed_slice(),
        Err(issue) => return invalid_issue(Field::BoxShadows, issue),
    };
    if geometry.is_empty() {
        policy(
            Field::BoxShadows,
            Reason::LegacyParserPolicy,
            Evidence::BoxShadowGeometry(geometry),
        )
    } else {
        unavailable(
            Field::BoxShadows,
            Reason::ColorNotComputed,
            Some(Evidence::BoxShadowGeometry(geometry)),
        )
    }
}

fn box_shadow(value: &Value) -> Result<LegacyBoxShadowGeometryV1<'_>, value::ValueIssue> {
    let object = value::object(value)?;
    Ok(LegacyBoxShadowGeometryV1 {
        offset_x: value::css_px(object, "offsetX")?.value,
        offset_y: value::css_px(object, "offsetY")?.value,
        blur_radius: value::non_negative_css_px(object, "blur")?.value,
        spread_radius: value::css_px(object, "spread")?.value,
        raw_color: value::string(object, "color")?,
        inset: value::boolean(object, "inset")?,
    })
}
