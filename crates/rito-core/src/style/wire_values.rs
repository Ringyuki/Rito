//! Typed style values spelled the way the paint wire carries them: colours
//! as CSS hex or `rgba()` text, font stacks as one `font-family` string,
//! background image fields as publication hrefs and unit-tagged numbers.

use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, BackgroundImageRepeatV1, BackgroundImageSizeV1, FontFamily,
    FontFamilyNameSyntax, GenericFontFamily, LengthPercentage,
};
use serde_json::{json, Value};

const PUBLICATION_URL_PREFIX: &str = "https://rito.invalid/publication/";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WireValueError {
    NonSrgbColor,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BackgroundWireError {
    NonPublicationUrl,
    EmptyPublicationHref,
    LinearPosition,
}

/// The `font-family` list as CSS text; an empty stack spells the UA serif.
pub(crate) fn serialize_font_families(
    style: &rito_style_contract::FontStyleV1,
) -> Result<String, WireValueError> {
    if style.families.as_slice().is_empty() {
        return Ok("serif".to_owned());
    }
    Ok(style
        .families
        .iter()
        .map(|family| match family {
            FontFamily::Named(name) => match name.syntax() {
                FontFamilyNameSyntax::Quoted => quote_family(name.as_str()),
                FontFamilyNameSyntax::Identifiers => name.as_str().to_owned(),
            },
            FontFamily::Generic(generic) => generic_family(*generic).to_owned(),
        })
        .collect::<Vec<_>>()
        .join(", "))
}

fn quote_family(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn generic_family(value: GenericFontFamily) -> &'static str {
    match value {
        GenericFontFamily::Serif => "serif",
        GenericFontFamily::SansSerif => "sans-serif",
        GenericFontFamily::Monospace => "monospace",
        GenericFontFamily::Cursive => "cursive",
        GenericFontFamily::Fantasy => "fantasy",
        GenericFontFamily::SystemUi => "system-ui",
    }
}

/// An sRGB colour as `#rrggbb`, or `rgba(r, g, b, a)` when translucent.
/// `none` components count as zero and out-of-gamut channels clamp, the way
/// a browser serializes the same computed value.
pub(crate) fn absolute_color(value: AbsoluteColor) -> Result<String, WireValueError> {
    if value.space() != AbsoluteColorSpace::Srgb {
        return Err(WireValueError::NonSrgbColor);
    }
    let none = value.none();
    let mut components = value.components().map(|component| component.get());
    let none_flags = [none.component_0, none.component_1, none.component_2];
    for (component, is_none) in components.iter_mut().zip(none_flags) {
        if is_none {
            *component = 0.0;
        }
        if !(0.0..=1.0).contains(component) {
            *component = component.clamp(0.0, 1.0);
        }
    }
    let [red, green, blue] = components.map(|component| (component * 255.0).round() as u8);
    let alpha = if none.alpha { 0.0 } else { value.alpha().get() };
    if alpha == 1.0 {
        Ok(format!("#{red:02x}{green:02x}{blue:02x}"))
    } else {
        Ok(format!("rgba({red}, {green}, {blue}, {alpha})"))
    }
}

/// The publication-relative href behind a resolved stylesheet URL.
pub(crate) fn background_publication_href(url: &str) -> Result<&str, BackgroundWireError> {
    let href = url
        .strip_prefix(PUBLICATION_URL_PREFIX)
        .ok_or(BackgroundWireError::NonPublicationUrl)?;
    if href.is_empty() || href.starts_with('?') || href.starts_with('#') || href.starts_with('/') {
        return Err(BackgroundWireError::EmptyPublicationHref);
    }
    Ok(href)
}

pub(crate) fn background_repeat_wire(value: BackgroundImageRepeatV1) -> &'static str {
    match value {
        BackgroundImageRepeatV1::Repeat => "repeat",
        BackgroundImageRepeatV1::NoRepeat => "no-repeat",
    }
}

pub(crate) fn background_size_wire(value: BackgroundImageSizeV1) -> Value {
    match value {
        BackgroundImageSizeV1::Auto => json!("auto"),
        BackgroundImageSizeV1::Cover => json!("cover"),
        BackgroundImageSizeV1::Contain => json!("contain"),
        BackgroundImageSizeV1::Explicit { x, y } => json!({
            "x": size_axis(x),
            "y": size_axis(y),
        }),
    }
}

fn size_axis(axis: rito_style_contract::BackgroundSizeAxisV1) -> Value {
    use rito_style_contract::BackgroundSizeAxisV1 as Axis;
    match axis {
        Axis::Auto => json!("auto"),
        Axis::Value(LengthPercentage::Length(value)) => {
            json!({ "unit": "px", "value": value.get() })
        }
        Axis::Value(LengthPercentage::Percentage(value)) => {
            json!({ "unit": "percent", "value": value.percent() })
        }
        // calc() keeps its length component, the sizing policy used
        // throughout the bridge.
        Axis::Value(LengthPercentage::Linear { length, .. }) => {
            json!({ "unit": "px", "value": length.get() })
        }
    }
}

pub(crate) fn background_position_axis_wire(
    value: LengthPercentage,
) -> Result<Value, BackgroundWireError> {
    match value {
        LengthPercentage::Length(value) => Ok(json!({ "unit": "px", "value": value.get() })),
        LengthPercentage::Percentage(value) => {
            Ok(json!({ "unit": "percent", "value": value.percent() }))
        }
        LengthPercentage::Linear { .. } => Err(BackgroundWireError::LinearPosition),
    }
}

#[cfg(test)]
mod tests {
    use rito_style_contract::{CssPx, Percentage};

    use super::*;

    #[test]
    fn publication_hrefs_keep_their_query_and_fragment() {
        assert_eq!(
            background_publication_href(
                "https://rito.invalid/publication/Images/cover%20art.jpg?edition=1#cover",
            ),
            Ok("Images/cover%20art.jpg?edition=1#cover")
        );
        assert_eq!(
            background_publication_href("https://example.test/Images/cover.jpg"),
            Err(BackgroundWireError::NonPublicationUrl)
        );
        assert_eq!(
            background_publication_href("https://rito.invalid/publication/#cover"),
            Err(BackgroundWireError::EmptyPublicationHref)
        );
    }

    #[test]
    fn background_fields_spell_their_css_keywords_and_units() {
        assert_eq!(
            background_repeat_wire(BackgroundImageRepeatV1::Repeat),
            "repeat"
        );
        assert_eq!(
            background_repeat_wire(BackgroundImageRepeatV1::NoRepeat),
            "no-repeat"
        );
        assert_eq!(
            background_size_wire(BackgroundImageSizeV1::Cover),
            json!("cover")
        );
        assert_eq!(
            background_position_axis_wire(LengthPercentage::Percentage(
                Percentage::from_percent(50.0).unwrap()
            ))
            .unwrap(),
            json!({ "unit": "percent", "value": 50.0 })
        );
        assert_eq!(
            background_position_axis_wire(LengthPercentage::Length(CssPx::new(12.0).unwrap()))
                .unwrap(),
            json!({ "unit": "px", "value": 12.0 })
        );
    }
}
