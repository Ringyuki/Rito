use rito_style_contract::{
    CssPx, FontFamilies, FontFamily, FontFamilyName, FontWeight, GenericFontFamily,
    LengthPercentage, LengthPercentageOrAuto, NonNegativeCssPx, NonNegativeLengthPercentage,
    NonNegativeNumber, NumericError, Percentage, UnitInterval,
};
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ValueIssue {
    Missing,
    Shape,
    Keyword,
    Numeric(NumericError),
}

#[derive(Clone, Copy)]
pub(super) struct ProjectedNumber<T> {
    pub(super) value: T,
    pub(super) exact_f32: bool,
}

pub(super) fn string<'a>(style: &'a Map<String, Value>, key: &str) -> Result<&'a str, ValueIssue> {
    style
        .get(key)
        .ok_or(ValueIssue::Missing)?
        .as_str()
        .ok_or(ValueIssue::Shape)
}

pub(super) fn boolean(style: &Map<String, Value>, key: &str) -> Result<bool, ValueIssue> {
    style
        .get(key)
        .ok_or(ValueIssue::Missing)?
        .as_bool()
        .ok_or(ValueIssue::Shape)
}

pub(super) fn array<'a>(
    style: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a [Value], ValueIssue> {
    style
        .get(key)
        .ok_or(ValueIssue::Missing)?
        .as_array()
        .map(Vec::as_slice)
        .ok_or(ValueIssue::Shape)
}

pub(super) fn object(value: &Value) -> Result<&Map<String, Value>, ValueIssue> {
    value.as_object().ok_or(ValueIssue::Shape)
}

pub(super) fn css_px(
    style: &Map<String, Value>,
    key: &str,
) -> Result<ProjectedNumber<CssPx>, ValueIssue> {
    let number = f32_number(style, key)?;
    Ok(ProjectedNumber {
        value: CssPx::new(number.value).map_err(ValueIssue::Numeric)?,
        exact_f32: number.exact_f32,
    })
}

pub(super) fn non_negative_css_px(
    style: &Map<String, Value>,
    key: &str,
) -> Result<ProjectedNumber<NonNegativeCssPx>, ValueIssue> {
    let number = f32_number(style, key)?;
    Ok(ProjectedNumber {
        value: NonNegativeCssPx::new(number.value).map_err(ValueIssue::Numeric)?,
        exact_f32: number.exact_f32,
    })
}

pub(super) fn font_weight(
    style: &Map<String, Value>,
    key: &str,
) -> Result<ProjectedNumber<FontWeight>, ValueIssue> {
    let number = f32_number(style, key)?;
    Ok(ProjectedNumber {
        value: FontWeight::new(number.value).map_err(ValueIssue::Numeric)?,
        exact_f32: number.exact_f32,
    })
}

pub(super) fn non_negative_number(
    style: &Map<String, Value>,
    key: &str,
) -> Result<ProjectedNumber<NonNegativeNumber>, ValueIssue> {
    let number = f32_number(style, key)?;
    Ok(ProjectedNumber {
        value: NonNegativeNumber::new(number.value).map_err(ValueIssue::Numeric)?,
        exact_f32: number.exact_f32,
    })
}

pub(super) fn unit_interval(
    style: &Map<String, Value>,
    key: &str,
) -> Result<ProjectedNumber<UnitInterval>, ValueIssue> {
    let number = f32_number(style, key)?;
    Ok(ProjectedNumber {
        value: UnitInterval::new(number.value).map_err(ValueIssue::Numeric)?,
        exact_f32: number.exact_f32,
    })
}

pub(super) fn length_percentage(
    style: &Map<String, Value>,
    px_key: &str,
    pct_key: Option<&str>,
) -> Result<ProjectedNumber<LengthPercentage>, ValueIssue> {
    if let Some(pct_key) = pct_key {
        if style.contains_key(pct_key) {
            let number = f32_number(style, pct_key)?;
            let percentage = Percentage::from_percent(number.value).map_err(ValueIssue::Numeric)?;
            return Ok(ProjectedNumber {
                value: LengthPercentage::Percentage(percentage),
                exact_f32: number.exact_f32,
            });
        }
    }
    let length = css_px(style, px_key)?;
    Ok(ProjectedNumber {
        value: LengthPercentage::Length(length.value),
        exact_f32: length.exact_f32,
    })
}

pub(super) fn non_negative_length_percentage(
    style: &Map<String, Value>,
    px_key: &str,
    pct_key: Option<&str>,
) -> Result<ProjectedNumber<NonNegativeLengthPercentage>, ValueIssue> {
    let value = length_percentage(style, px_key, pct_key)?;
    match value.value {
        LengthPercentage::Length(length) if length.get() < 0.0 => {
            return Err(ValueIssue::Numeric(NumericError::Negative));
        }
        LengthPercentage::Percentage(percentage) if percentage.ratio() < 0.0 => {
            return Err(ValueIssue::Numeric(NumericError::Negative));
        }
        LengthPercentage::Linear { .. }
        | LengthPercentage::Length(_)
        | LengthPercentage::Percentage(_) => {}
    }
    Ok(ProjectedNumber {
        value: NonNegativeLengthPercentage::new(value.value),
        exact_f32: value.exact_f32,
    })
}

pub(super) fn margin(
    style: &Map<String, Value>,
    px_key: &str,
    pct_key: Option<&str>,
    auto_key: Option<&str>,
) -> Result<LengthPercentageOrAuto, ValueIssue> {
    if let Some(auto_key) = auto_key {
        if boolean(style, auto_key)? {
            return Ok(LengthPercentageOrAuto::Auto);
        }
    }
    Ok(LengthPercentageOrAuto::Value(
        length_percentage(style, px_key, pct_key)?.value,
    ))
}

pub(super) fn parsed_font_families(raw: &str) -> Option<FontFamilies> {
    let parts = split_family_list(raw)?;
    let families = parts
        .into_iter()
        .map(font_family)
        .collect::<Option<Vec<_>>>()?;
    FontFamilies::new(families).ok()
}

pub(super) fn font_family_item_count(raw: &str) -> Option<usize> {
    if raw.contains('\\') || raw.contains('(') || raw.contains(')') {
        return None;
    }
    let mut quote = None;
    let mut start = 0;
    let mut count = 1;
    for (index, character) in raw.char_indices() {
        match (quote, character) {
            (None, '\'' | '"') => quote = Some(character),
            (Some(open), close) if open == close => quote = None,
            (None, ',') => {
                if raw[start..index].trim().is_empty() {
                    return None;
                }
                start = index + 1;
                count += 1;
            }
            _ => {}
        }
    }
    (quote.is_none() && !raw[start..].trim().is_empty()).then_some(count)
}

fn f32_number(style: &Map<String, Value>, key: &str) -> Result<ProjectedNumber<f32>, ValueIssue> {
    let value = style
        .get(key)
        .ok_or(ValueIssue::Missing)?
        .as_f64()
        .ok_or(ValueIssue::Shape)?;
    if !value.is_finite() {
        return Err(ValueIssue::Numeric(NumericError::NonFinite));
    }
    let narrowed = value as f32;
    if !narrowed.is_finite() {
        return Err(ValueIssue::Numeric(NumericError::NonFinite));
    }
    Ok(ProjectedNumber {
        value: narrowed,
        exact_f32: f64::from(narrowed) == value,
    })
}

fn split_family_list(raw: &str) -> Option<Vec<&str>> {
    if raw.contains('\\') || raw.contains('(') || raw.contains(')') {
        return None;
    }
    let mut quote = None;
    let mut start = 0;
    let mut output = Vec::new();
    for (index, character) in raw.char_indices() {
        match (quote, character) {
            (None, '\'' | '"') => quote = Some(character),
            (Some(open), close) if open == close => quote = None,
            (None, ',') => {
                output.push(raw[start..index].trim());
                start = index + 1;
            }
            _ => {}
        }
    }
    if quote.is_some() {
        return None;
    }
    output.push(raw[start..].trim());
    (!output.iter().any(|part| part.is_empty())).then_some(output)
}

fn font_family(raw: &str) -> Option<FontFamily> {
    let unquoted = if (raw.starts_with('"') && raw.ends_with('"'))
        || (raw.starts_with('\'') && raw.ends_with('\''))
    {
        raw.get(1..raw.len().checked_sub(1)?)?
    } else if raw.contains('"') || raw.contains('\'') {
        return None;
    } else {
        raw
    };
    if unquoted.is_empty() {
        return None;
    }
    let generic = match unquoted.to_ascii_lowercase().as_str() {
        "serif" => Some(GenericFontFamily::Serif),
        "sans-serif" => Some(GenericFontFamily::SansSerif),
        "monospace" => Some(GenericFontFamily::Monospace),
        "cursive" => Some(GenericFontFamily::Cursive),
        "fantasy" => Some(GenericFontFamily::Fantasy),
        "system-ui" => Some(GenericFontFamily::SystemUi),
        _ => None,
    };
    Some(match generic {
        Some(value) => FontFamily::Generic(value),
        None => FontFamily::Named(FontFamilyName::new(unquoted)),
    })
}
