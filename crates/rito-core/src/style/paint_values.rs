//! Typed style values as the paint model carries them: sRGB colours as
//! 8-bit device colours, font stacks as one `font-family` string,
//! background image fields as publication hrefs and typed lengths.

use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, BackgroundImageRepeat, BackgroundImageSize,
    BackgroundSizeAxis, FontFamily, FontFamilyNameSyntax, GenericFontFamily, LengthPercentage,
};

use crate::render::contract::{
    ReaderBackgroundRepeat, ReaderBackgroundSize, ReaderColor, ReaderLength,
};

const PUBLICATION_URL_PREFIX: &str = "https://rito.invalid/publication/";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PaintValueError {
    NonSrgbColor,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BackgroundPaintError {
    NonPublicationUrl,
    EmptyPublicationHref,
    LinearPosition,
}

/// The `font-family` list as CSS text; an empty stack spells the UA serif.
pub(crate) fn serialize_font_families(
    style: &rito_style_contract::FontStyle,
) -> Result<String, PaintValueError> {
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

/// An sRGB colour as the paint model carries it: channels quantized to
/// 8 bits the way a browser stores a legacy colour, `none` components
/// counting as zero and out-of-gamut channels clamped.
pub(crate) fn paint_color(value: AbsoluteColor) -> Result<ReaderColor, PaintValueError> {
    if value.space() != AbsoluteColorSpace::Srgb {
        return Err(PaintValueError::NonSrgbColor);
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
    let alpha = if none.alpha {
        0.0
    } else {
        value.alpha().get().clamp(0.0, 1.0)
    };
    Ok(ReaderColor::srgb8(red, green, blue, alpha))
}

/// The publication-relative href behind a resolved stylesheet URL.
pub(crate) fn background_publication_href(url: &str) -> Result<&str, BackgroundPaintError> {
    let href = url
        .strip_prefix(PUBLICATION_URL_PREFIX)
        .ok_or(BackgroundPaintError::NonPublicationUrl)?;
    if href.is_empty() || href.starts_with('?') || href.starts_with('#') || href.starts_with('/') {
        return Err(BackgroundPaintError::EmptyPublicationHref);
    }
    Ok(href)
}

pub(crate) fn background_repeat(value: BackgroundImageRepeat) -> ReaderBackgroundRepeat {
    match value {
        BackgroundImageRepeat::Repeat => ReaderBackgroundRepeat::Repeat,
        BackgroundImageRepeat::NoRepeat => ReaderBackgroundRepeat::NoRepeat,
    }
}

pub(crate) fn background_size(value: BackgroundImageSize) -> ReaderBackgroundSize {
    match value {
        BackgroundImageSize::Auto => ReaderBackgroundSize::Auto,
        BackgroundImageSize::Cover => ReaderBackgroundSize::Cover,
        BackgroundImageSize::Contain => ReaderBackgroundSize::Contain,
        BackgroundImageSize::Explicit { x, y } => ReaderBackgroundSize::Explicit {
            x: size_axis(x),
            y: size_axis(y),
        },
    }
}

fn size_axis(axis: BackgroundSizeAxis) -> Option<ReaderLength> {
    match axis {
        BackgroundSizeAxis::Auto => None,
        BackgroundSizeAxis::Value(LengthPercentage::Length(value)) => {
            Some(ReaderLength::Px(f64::from(value.get())))
        }
        BackgroundSizeAxis::Value(LengthPercentage::Percentage(value)) => {
            Some(ReaderLength::Percent(f64::from(value.percent())))
        }
        // calc() keeps its length component, the sizing policy used
        // throughout the bridge.
        BackgroundSizeAxis::Value(LengthPercentage::Linear { length, .. }) => {
            Some(ReaderLength::Px(f64::from(length.get())))
        }
    }
}

pub(crate) fn background_position_axis(
    value: LengthPercentage,
) -> Result<ReaderLength, BackgroundPaintError> {
    match value {
        LengthPercentage::Length(value) => Ok(ReaderLength::Px(f64::from(value.get()))),
        LengthPercentage::Percentage(value) => {
            Ok(ReaderLength::Percent(f64::from(value.percent())))
        }
        LengthPercentage::Linear { .. } => Err(BackgroundPaintError::LinearPosition),
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
            Err(BackgroundPaintError::NonPublicationUrl)
        );
        assert_eq!(
            background_publication_href("https://rito.invalid/publication/#cover"),
            Err(BackgroundPaintError::EmptyPublicationHref)
        );
    }

    #[test]
    fn background_fields_map_to_their_typed_paint_values() {
        assert_eq!(
            background_repeat(BackgroundImageRepeat::Repeat),
            ReaderBackgroundRepeat::Repeat
        );
        assert_eq!(
            background_repeat(BackgroundImageRepeat::NoRepeat),
            ReaderBackgroundRepeat::NoRepeat
        );
        assert_eq!(
            background_size(BackgroundImageSize::Cover),
            ReaderBackgroundSize::Cover
        );
        assert_eq!(
            background_position_axis(LengthPercentage::Percentage(
                Percentage::from_percent(50.0).unwrap()
            )),
            Ok(ReaderLength::Percent(50.0))
        );
        assert_eq!(
            background_position_axis(LengthPercentage::Length(CssPx::new(12.0).unwrap())),
            Ok(ReaderLength::Px(12.0))
        );
    }
}
