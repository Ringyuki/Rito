//! CSS colour text as the fixtures spell it: `#rrggbb`, `rgba()`, named
//! keywords and `color()` functions, parsed to the typed colour and
//! written back.

use super::super::contract::{ReaderColor, ReaderColorNoneFlags, ReaderColorSpace};
use super::FixtureError;

/// A typed colour from fixture text; panics on text no fixture spells.
pub(crate) fn css_color(source: &str) -> ReaderColor {
    parse_color(source, "test colour").unwrap_or_else(|error| panic!("{source}: {error:?}"))
}

pub(crate) fn parse_color(
    source: &str,
    context: &'static str,
) -> Result<ReaderColor, FixtureError> {
    let source = source.trim();
    if source.eq_ignore_ascii_case("currentcolor") {
        return Err(FixtureError::UnsupportedValue("color.currentColor"));
    }
    if source.eq_ignore_ascii_case("transparent") {
        return absolute(ReaderColorSpace::Srgb, [0.0; 3], 0.0);
    }
    if let Some(color) = named_color(source) {
        return Ok(color);
    }
    if let Some(hex) = source.strip_prefix('#') {
        return parse_hex(hex).ok_or(FixtureError::InvalidColor(context));
    }
    if let Some(body) = function_body(source, "rgb").or_else(|| function_body(source, "rgba")) {
        return parse_rgb(body, context);
    }
    if let Some(body) = function_body(source, "color") {
        return parse_color_function(body, context);
    }
    Err(FixtureError::InvalidColor(context))
}

/// The fixture text for a typed colour: `#rrggbb` for an opaque sRGB
/// colour, `rgba()` for a translucent one, `color()` elsewhere.
pub(crate) fn color_css(color: ReaderColor) -> String {
    if let Some([red, green, blue]) = color.opaque_srgb8() {
        return format!("#{red:02x}{green:02x}{blue:02x}");
    }
    let none = color.none;
    if color.space == ReaderColorSpace::Srgb
        && !(none.component_0 || none.component_1 || none.component_2 || none.alpha)
    {
        let [red, green, blue] = color
            .components
            .map(|component| (component.clamp(0.0, 1.0) * 255.0).round() as u8);
        return format!("rgba({red}, {green}, {blue}, {})", color.alpha);
    }
    let component = |value: f32, is_none: bool| {
        if is_none {
            "none".to_owned()
        } else {
            value.to_string()
        }
    };
    format!(
        "color({} {} {} {} / {})",
        color.space.tag_name(),
        component(color.components[0], none.component_0),
        component(color.components[1], none.component_1),
        component(color.components[2], none.component_2),
        component(color.alpha, none.alpha),
    )
}

fn parse_hex(source: &str) -> Option<ReaderColor> {
    let (red, green, blue, alpha) = match source.len() {
        3 => (
            duplicate_nibble(source, 0)?,
            duplicate_nibble(source, 1)?,
            duplicate_nibble(source, 2)?,
            255,
        ),
        4 => (
            duplicate_nibble(source, 0)?,
            duplicate_nibble(source, 1)?,
            duplicate_nibble(source, 2)?,
            duplicate_nibble(source, 3)?,
        ),
        6 => (
            byte_pair(source, 0)?,
            byte_pair(source, 2)?,
            byte_pair(source, 4)?,
            255,
        ),
        8 => (
            byte_pair(source, 0)?,
            byte_pair(source, 2)?,
            byte_pair(source, 4)?,
            byte_pair(source, 6)?,
        ),
        _ => return None,
    };
    Some(ReaderColor::srgb8(red, green, blue, channel(alpha)))
}

fn parse_rgb(body: &str, context: &'static str) -> Result<ReaderColor, FixtureError> {
    let parts = components(body);
    if !(3..=4).contains(&parts.len()) {
        return Err(FixtureError::InvalidColor(context));
    }
    let components = [
        rgb_component(&parts[0], context)?,
        rgb_component(&parts[1], context)?,
        rgb_component(&parts[2], context)?,
    ];
    let alpha = parts
        .get(3)
        .map(|value| alpha_component(value, context))
        .transpose()?
        .unwrap_or(1.0);
    absolute(ReaderColorSpace::Srgb, components, alpha)
}

fn parse_color_function(body: &str, context: &'static str) -> Result<ReaderColor, FixtureError> {
    let parts = components(body);
    if !(4..=5).contains(&parts.len()) {
        return Err(FixtureError::InvalidColor(context));
    }
    let space = match parts[0].to_ascii_lowercase().as_str() {
        "srgb" => ReaderColorSpace::Srgb,
        "srgb-linear" => ReaderColorSpace::SrgbLinear,
        "display-p3" => ReaderColorSpace::DisplayP3,
        "display-p3-linear" => ReaderColorSpace::DisplayP3Linear,
        "a98-rgb" => ReaderColorSpace::A98Rgb,
        "prophoto-rgb" => ReaderColorSpace::ProphotoRgb,
        "rec2020" => ReaderColorSpace::Rec2020,
        "xyz-d50" => ReaderColorSpace::XyzD50,
        "xyz" | "xyz-d65" => ReaderColorSpace::XyzD65,
        _ => return Err(FixtureError::UnsupportedValue("color.space")),
    };
    let mut none = ReaderColorNoneFlags::default();
    let values = [
        color_component(&parts[1], &mut none.component_0, context)?,
        color_component(&parts[2], &mut none.component_1, context)?,
        color_component(&parts[3], &mut none.component_2, context)?,
    ];
    let alpha = match parts.get(4) {
        Some(value) if value.eq_ignore_ascii_case("none") => {
            none.alpha = true;
            0.0
        }
        Some(value) => alpha_component(value, context)?,
        None => 1.0,
    };
    typed_absolute(space, values, alpha, none, context)
}

fn typed_absolute(
    space: ReaderColorSpace,
    components: [f32; 3],
    alpha: f32,
    none: ReaderColorNoneFlags,
    context: &'static str,
) -> Result<ReaderColor, FixtureError> {
    if components.iter().all(|value| value.is_finite()) && alpha.is_finite() {
        Ok(ReaderColor {
            space,
            components,
            alpha: alpha.clamp(0.0, 1.0),
            none,
        })
    } else {
        Err(FixtureError::InvalidColor(context))
    }
}

fn absolute(
    space: ReaderColorSpace,
    components: [f32; 3],
    alpha: f32,
) -> Result<ReaderColor, FixtureError> {
    typed_absolute(
        space,
        components,
        alpha,
        ReaderColorNoneFlags::default(),
        "color",
    )
}

fn named_color(source: &str) -> Option<ReaderColor> {
    let rgba: u32 = match source.to_ascii_lowercase().as_str() {
        "black" => 0x000000ff,
        "silver" => 0xc0c0c0ff,
        "gray" | "grey" => 0x808080ff,
        "white" => 0xffffffff,
        "maroon" => 0x800000ff,
        "red" => 0xff0000ff,
        "purple" => 0x800080ff,
        "fuchsia" | "magenta" => 0xff00ffff,
        "green" => 0x008000ff,
        "lime" => 0x00ff00ff,
        "olive" => 0x808000ff,
        "yellow" => 0xffff00ff,
        "navy" => 0x000080ff,
        "blue" => 0x0000ffff,
        "teal" => 0x008080ff,
        "aqua" | "cyan" => 0x00ffffff,
        "orange" => 0xffa500ff,
        "rebeccapurple" => 0x663399ff,
        _ => return None,
    };
    Some(ReaderColor::srgb8(
        (rgba >> 24) as u8,
        (rgba >> 16) as u8,
        (rgba >> 8) as u8,
        channel(rgba as u8),
    ))
}

fn function_body<'a>(source: &'a str, name: &str) -> Option<&'a str> {
    let open = source.find('(')?;
    if !source[..open].trim().eq_ignore_ascii_case(name) || !source.ends_with(')') {
        return None;
    }
    Some(&source[open + 1..source.len() - 1])
}

fn components(body: &str) -> Vec<String> {
    body.replace([',', '/'], " ")
        .split_ascii_whitespace()
        .map(str::to_owned)
        .collect()
}

fn rgb_component(source: &str, context: &'static str) -> Result<f32, FixtureError> {
    if let Some(percent) = source.strip_suffix('%') {
        return scalar(percent, context).map(|value| (value / 100.0).clamp(0.0, 1.0));
    }
    scalar(source, context).map(|value| (value / 255.0).clamp(0.0, 1.0))
}

fn color_component(
    source: &str,
    none: &mut bool,
    context: &'static str,
) -> Result<f32, FixtureError> {
    if source.eq_ignore_ascii_case("none") {
        *none = true;
        return Ok(0.0);
    }
    if let Some(percent) = source.strip_suffix('%') {
        return scalar(percent, context).map(|value| value / 100.0);
    }
    scalar(source, context)
}

fn alpha_component(source: &str, context: &'static str) -> Result<f32, FixtureError> {
    if let Some(percent) = source.strip_suffix('%') {
        return scalar(percent, context).map(|value| (value / 100.0).clamp(0.0, 1.0));
    }
    scalar(source, context).map(|value| value.clamp(0.0, 1.0))
}

fn scalar(source: &str, context: &'static str) -> Result<f32, FixtureError> {
    source
        .parse::<f32>()
        .ok()
        .filter(|value| value.is_finite())
        .ok_or(FixtureError::InvalidColor(context))
}

fn duplicate_nibble(source: &str, index: usize) -> Option<u8> {
    let value = u8::from_str_radix(source.get(index..index + 1)?, 16).ok()?;
    Some(value * 17)
}

fn byte_pair(source: &str, index: usize) -> Option<u8> {
    u8::from_str_radix(source.get(index..index + 2)?, 16).ok()
}

const fn channel(value: u8) -> f32 {
    value as f32 / 255.0
}
