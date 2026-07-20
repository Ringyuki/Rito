use super::super::{
    contract::{ReaderColorNoneFlagsV1, ReaderColorSpaceV1, ReaderColorV1},
    ReaderDisplayListWireError,
};

pub(super) fn adapt_color(
    source: &str,
    context: &'static str,
) -> Result<ReaderColorV1, ReaderDisplayListWireError> {
    let source = source.trim();
    if source.eq_ignore_ascii_case("currentcolor") {
        return Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
            "color.currentColor",
        ));
    }
    if source.eq_ignore_ascii_case("transparent") {
        return absolute(ReaderColorSpaceV1::Srgb, [0.0; 3], 0.0);
    }
    if let Some(color) = named_color(source) {
        return Ok(color);
    }
    if let Some(hex) = source.strip_prefix('#') {
        return parse_hex(hex).ok_or(ReaderDisplayListWireError::InvalidLegacyColor(context));
    }
    if let Some(body) = function_body(source, "rgb").or_else(|| function_body(source, "rgba")) {
        return parse_rgb(body, context);
    }
    if let Some(body) = function_body(source, "color") {
        return parse_color_function(body, context);
    }
    Err(ReaderDisplayListWireError::InvalidLegacyColor(context))
}

fn parse_hex(source: &str) -> Option<ReaderColorV1> {
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
    absolute(
        ReaderColorSpaceV1::Srgb,
        [channel(red), channel(green), channel(blue)],
        channel(alpha),
    )
    .ok()
}

fn parse_rgb(
    body: &str,
    context: &'static str,
) -> Result<ReaderColorV1, ReaderDisplayListWireError> {
    let parts = components(body);
    if !(3..=4).contains(&parts.len()) {
        return Err(ReaderDisplayListWireError::InvalidLegacyColor(context));
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
    absolute(ReaderColorSpaceV1::Srgb, components, alpha)
}

fn parse_color_function(
    body: &str,
    context: &'static str,
) -> Result<ReaderColorV1, ReaderDisplayListWireError> {
    let parts = components(body);
    if !(4..=5).contains(&parts.len()) {
        return Err(ReaderDisplayListWireError::InvalidLegacyColor(context));
    }
    let space = match parts[0].to_ascii_lowercase().as_str() {
        "srgb" => ReaderColorSpaceV1::Srgb,
        "srgb-linear" => ReaderColorSpaceV1::SrgbLinear,
        "display-p3" => ReaderColorSpaceV1::DisplayP3,
        "display-p3-linear" => ReaderColorSpaceV1::DisplayP3Linear,
        "a98-rgb" => ReaderColorSpaceV1::A98Rgb,
        "prophoto-rgb" => ReaderColorSpaceV1::ProphotoRgb,
        "rec2020" => ReaderColorSpaceV1::Rec2020,
        "xyz-d50" => ReaderColorSpaceV1::XyzD50,
        "xyz" | "xyz-d65" => ReaderColorSpaceV1::XyzD65,
        _ => {
            return Err(ReaderDisplayListWireError::UnsupportedLegacyValue(
                "color.space",
            ))
        }
    };
    let mut none = ReaderColorNoneFlagsV1::default();
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
    space: ReaderColorSpaceV1,
    components: [f32; 3],
    alpha: f32,
    none: ReaderColorNoneFlagsV1,
    context: &'static str,
) -> Result<ReaderColorV1, ReaderDisplayListWireError> {
    if components.iter().all(|value| value.is_finite()) && alpha.is_finite() {
        Ok(ReaderColorV1 {
            space,
            components,
            alpha: alpha.clamp(0.0, 1.0),
            none,
        })
    } else {
        Err(ReaderDisplayListWireError::InvalidLegacyColor(context))
    }
}

fn absolute(
    space: ReaderColorSpaceV1,
    components: [f32; 3],
    alpha: f32,
) -> Result<ReaderColorV1, ReaderDisplayListWireError> {
    typed_absolute(
        space,
        components,
        alpha,
        ReaderColorNoneFlagsV1::default(),
        "color",
    )
}

fn named_color(source: &str) -> Option<ReaderColorV1> {
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
    absolute(
        ReaderColorSpaceV1::Srgb,
        [
            channel((rgba >> 24) as u8),
            channel((rgba >> 16) as u8),
            channel((rgba >> 8) as u8),
        ],
        channel(rgba as u8),
    )
    .ok()
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

fn rgb_component(source: &str, context: &'static str) -> Result<f32, ReaderDisplayListWireError> {
    if let Some(percent) = source.strip_suffix('%') {
        return scalar(percent, context).map(|value| (value / 100.0).clamp(0.0, 1.0));
    }
    scalar(source, context).map(|value| (value / 255.0).clamp(0.0, 1.0))
}

fn color_component(
    source: &str,
    none: &mut bool,
    context: &'static str,
) -> Result<f32, ReaderDisplayListWireError> {
    if source.eq_ignore_ascii_case("none") {
        *none = true;
        return Ok(0.0);
    }
    if let Some(percent) = source.strip_suffix('%') {
        return scalar(percent, context).map(|value| value / 100.0);
    }
    scalar(source, context)
}

fn alpha_component(source: &str, context: &'static str) -> Result<f32, ReaderDisplayListWireError> {
    if let Some(percent) = source.strip_suffix('%') {
        return scalar(percent, context).map(|value| (value / 100.0).clamp(0.0, 1.0));
    }
    scalar(source, context).map(|value| value.clamp(0.0, 1.0))
}

fn scalar(source: &str, context: &'static str) -> Result<f32, ReaderDisplayListWireError> {
    source
        .parse::<f32>()
        .ok()
        .filter(|value| value.is_finite())
        .ok_or(ReaderDisplayListWireError::InvalidLegacyColor(context))
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
