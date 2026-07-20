use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, BackgroundImagePaintV1, BackgroundImagePositionV1,
    BackgroundImageRepeatV1, BackgroundImageSizeV1, BoxShadow, ColorNoneFlags, ComputedColorV1,
    InlinePaintStyleV1, ResolvedUrlErrorV1, ResolvedUrlV1, TextDecoration, TextDecorationLines,
    TextDecorationStyle, TextShadow, TransformListV1, RESOLVED_URL_BYTE_LIMIT_V1,
};
use std::sync::Arc;
use style::{
    color::ColorSpace,
    properties::{longhands, style_structs::Background, ComputedValues},
    values::{
        computed::{self, url::ComputedUrl},
        specified::background::BackgroundRepeatKeyword,
    },
};

use super::{
    cache::{PayloadCache, UrlPayloadCache},
    numeric, transform, InlineStyleFieldV1, InlineStyleProjectionReasonV1, ProjectionFailure,
    ProjectionResult,
};

pub(super) fn project(
    styles: &ComputedValues,
    text_shadow_cache: &mut PayloadCache<Arc<[TextShadow]>>,
    box_shadow_cache: &mut PayloadCache<Arc<[BoxShadow]>>,
    background_image_url_cache: &mut UrlPayloadCache,
    transform_cache: &mut PayloadCache<TransformListV1>,
) -> ProjectionResult<InlinePaintStyleV1> {
    let foreground = absolute_color(
        &styles.get_inherited_text().color,
        InlineStyleFieldV1::Color,
    )?;
    let background = styles.get_background();
    Ok(InlinePaintStyleV1 {
        foreground,
        opacity: numeric::unit_interval(styles.clone_opacity(), InlineStyleFieldV1::Opacity)?,
        background: computed_color(&background.background_color, InlineStyleFieldV1::Color)?,
        background_image: background_image(background, background_image_url_cache)?,
        transform: transform::project(styles, transform_cache)?,
        text_decoration: own_decoration(styles)?,
        text_shadows: text_shadows(styles, text_shadow_cache)?,
        box_shadows: box_shadows(styles, box_shadow_cache)?,
    })
}

fn background_image(
    background: &Background,
    url_cache: &mut UrlPayloadCache,
) -> ProjectionResult<Option<BackgroundImagePaintV1>> {
    let image = single_layer(
        background.background_image.0.as_slice(),
        InlineStyleFieldV1::BackgroundImage,
    )?;
    let resolved = match image {
        computed::Image::None => return Ok(None),
        computed::Image::Url(ComputedUrl::Valid(value)) => {
            let serialized = value.as_str();
            if serialized.len() > RESOLVED_URL_BYTE_LIMIT_V1 {
                return Err(resolved_url_failure(
                    ResolvedUrlErrorV1::ByteLimitExceeded {
                        byte_len: serialized.len(),
                        limit: RESOLVED_URL_BYTE_LIMIT_V1,
                    },
                ));
            }
            url_cache.get_or_project(serialized, |serialized| {
                ResolvedUrlV1::new(serialized).map_err(resolved_url_failure)
            })?
        }
        _ => return Err(numeric::unsupported(InlineStyleFieldV1::BackgroundImage)),
    };

    let repeat = background_repeat(&background.background_repeat.0)?;
    let size = background_size(&background.background_size.0)?;
    let position = background_position(
        &background.background_position_x.0,
        &background.background_position_y.0,
    )?;
    require_initial_layer(
        &background.background_attachment.0,
        longhands::background_attachment::single_value::get_initial_value(),
        InlineStyleFieldV1::BackgroundAttachment,
    )?;
    require_initial_layer(
        &background.background_origin.0,
        longhands::background_origin::single_value::get_initial_value(),
        InlineStyleFieldV1::BackgroundOrigin,
    )?;
    require_initial_layer(
        &background.background_clip.0,
        longhands::background_clip::single_value::get_initial_value(),
        InlineStyleFieldV1::BackgroundClip,
    )?;
    require_initial_layer(
        &background.background_blend_mode.0,
        longhands::background_blend_mode::single_value::get_initial_value(),
        InlineStyleFieldV1::BackgroundBlendMode,
    )?;

    Ok(Some(BackgroundImagePaintV1 {
        url: resolved,
        size,
        repeat,
        position,
    }))
}

fn background_repeat(
    values: &[computed::BackgroundRepeat],
) -> ProjectionResult<BackgroundImageRepeatV1> {
    let value = single_layer(values, InlineStyleFieldV1::BackgroundRepeat)?;
    if value.0 == BackgroundRepeatKeyword::Repeat && value.1 == BackgroundRepeatKeyword::Repeat {
        return Ok(BackgroundImageRepeatV1::Repeat);
    }
    if value.0 == BackgroundRepeatKeyword::NoRepeat && value.1 == BackgroundRepeatKeyword::NoRepeat
    {
        return Ok(BackgroundImageRepeatV1::NoRepeat);
    }
    Err(numeric::unsupported(InlineStyleFieldV1::BackgroundRepeat))
}

fn background_size(values: &[computed::BackgroundSize]) -> ProjectionResult<BackgroundImageSizeV1> {
    let value = single_layer(values, InlineStyleFieldV1::BackgroundSize)?;
    if *value == computed::BackgroundSize::auto() {
        return Ok(BackgroundImageSizeV1::Auto);
    }
    match value {
        computed::BackgroundSize::Cover => Ok(BackgroundImageSizeV1::Cover),
        computed::BackgroundSize::Contain => Ok(BackgroundImageSizeV1::Contain),
        _ => Err(numeric::unsupported(InlineStyleFieldV1::BackgroundSize)),
    }
}

fn background_position(
    x_values: &[computed::LengthPercentage],
    y_values: &[computed::LengthPercentage],
) -> ProjectionResult<BackgroundImagePositionV1> {
    let x = single_layer(x_values, InlineStyleFieldV1::BackgroundPosition)?;
    let y = single_layer(y_values, InlineStyleFieldV1::BackgroundPosition)?;
    Ok(BackgroundImagePositionV1 {
        x: numeric::length_percentage(x, InlineStyleFieldV1::BackgroundPosition)?,
        y: numeric::length_percentage(y, InlineStyleFieldV1::BackgroundPosition)?,
    })
}

fn require_initial_layer<T: PartialEq>(
    values: &[T],
    initial: T,
    field: InlineStyleFieldV1,
) -> ProjectionResult<()> {
    if single_layer(values, field)? == &initial {
        return Ok(());
    }
    Err(numeric::unsupported(field))
}

fn single_layer<T>(values: &[T], field: InlineStyleFieldV1) -> ProjectionResult<&T> {
    let [value] = values else {
        return Err(numeric::unsupported(field));
    };
    Ok(value)
}

fn resolved_url_failure(error: ResolvedUrlErrorV1) -> ProjectionFailure {
    let reason = match error {
        ResolvedUrlErrorV1::ByteLimitExceeded { .. } => {
            InlineStyleProjectionReasonV1::ProjectionBudgetExceeded
        }
        ResolvedUrlErrorV1::Empty | ResolvedUrlErrorV1::NotAbsolute => {
            InlineStyleProjectionReasonV1::UnsupportedValue
        }
    };
    ProjectionFailure {
        field: InlineStyleFieldV1::BackgroundImage,
        reason,
    }
}

pub(super) fn absolute_color(
    value: &style::color::AbsoluteColor,
    field: InlineStyleFieldV1,
) -> ProjectionResult<AbsoluteColor> {
    let [component_0, component_1, component_2, alpha] = *value.raw_components();
    AbsoluteColor::new(
        color_space(value.color_space),
        [component_0, component_1, component_2],
        alpha,
        ColorNoneFlags::new(
            value.c0().is_none(),
            value.c1().is_none(),
            value.c2().is_none(),
            value.alpha().is_none(),
        ),
    )
    .map_err(|error| numeric::invalid_numeric(field, error))
}

pub(super) fn computed_color(
    value: &computed::Color,
    field: InlineStyleFieldV1,
) -> ProjectionResult<ComputedColorV1> {
    match value {
        computed::Color::Absolute(color) => {
            Ok(ComputedColorV1::Absolute(absolute_color(color, field)?))
        }
        computed::Color::CurrentColor => Ok(ComputedColorV1::CurrentColor),
        computed::Color::ColorFunction(_)
        | computed::Color::ColorMix(_)
        | computed::Color::ContrastColor(_) => Err(numeric::unsupported(field)),
    }
}

fn color_space(value: ColorSpace) -> AbsoluteColorSpace {
    match value {
        ColorSpace::Srgb => AbsoluteColorSpace::Srgb,
        ColorSpace::Hsl => AbsoluteColorSpace::Hsl,
        ColorSpace::Hwb => AbsoluteColorSpace::Hwb,
        ColorSpace::Lab => AbsoluteColorSpace::Lab,
        ColorSpace::Lch => AbsoluteColorSpace::Lch,
        ColorSpace::Oklab => AbsoluteColorSpace::Oklab,
        ColorSpace::Oklch => AbsoluteColorSpace::Oklch,
        ColorSpace::SrgbLinear => AbsoluteColorSpace::SrgbLinear,
        ColorSpace::DisplayP3 => AbsoluteColorSpace::DisplayP3,
        ColorSpace::DisplayP3Linear => AbsoluteColorSpace::DisplayP3Linear,
        ColorSpace::A98Rgb => AbsoluteColorSpace::A98Rgb,
        ColorSpace::ProphotoRgb => AbsoluteColorSpace::ProphotoRgb,
        ColorSpace::Rec2020 => AbsoluteColorSpace::Rec2020,
        ColorSpace::XyzD50 => AbsoluteColorSpace::XyzD50,
        ColorSpace::XyzD65 => AbsoluteColorSpace::XyzD65,
    }
}

pub(super) fn own_decoration(styles: &ComputedValues) -> ProjectionResult<TextDecoration> {
    let text = styles.get_text();
    let lines = text.text_decoration_line;
    Ok(TextDecoration {
        lines: TextDecorationLines::new(
            lines.contains(computed::TextDecorationLine::UNDERLINE),
            lines.contains(computed::TextDecorationLine::OVERLINE),
            lines.contains(computed::TextDecorationLine::LINE_THROUGH),
            lines.contains(computed::TextDecorationLine::BLINK),
        ),
        style: decoration_style(text.text_decoration_style),
        color: computed_color(
            &text.text_decoration_color,
            InlineStyleFieldV1::TextDecoration,
        )?,
    })
}

fn decoration_style(
    value: style::properties::longhands::text_decoration_style::computed_value::T,
) -> TextDecorationStyle {
    use style::properties::longhands::text_decoration_style::computed_value::T;

    match value {
        T::Solid => TextDecorationStyle::Solid,
        T::Double => TextDecorationStyle::Double,
        T::Dotted => TextDecorationStyle::Dotted,
        T::Dashed => TextDecorationStyle::Dashed,
        T::Wavy => TextDecorationStyle::Wavy,
        T::MozNone => TextDecorationStyle::MozNone,
    }
}

fn text_shadows(
    styles: &ComputedValues,
    cache: &mut PayloadCache<Arc<[TextShadow]>>,
) -> ProjectionResult<Arc<[TextShadow]>> {
    let shadows = &styles.get_inherited_text().text_shadow.0;
    cache.get_or_project(shadows, || project_text_shadows(shadows))
}

fn project_text_shadows(shadows: &[computed::SimpleShadow]) -> ProjectionResult<Arc<[TextShadow]>> {
    numeric::ensure_list_budget(shadows.len(), InlineStyleFieldV1::TextShadow)?;
    shadows
        .iter()
        .map(|shadow| {
            Ok(TextShadow {
                offset_x: numeric::css_px(shadow.horizontal.px(), InlineStyleFieldV1::TextShadow)?,
                offset_y: numeric::css_px(shadow.vertical.px(), InlineStyleFieldV1::TextShadow)?,
                blur_radius: numeric::non_negative_css_px(
                    shadow.blur.0.px(),
                    InlineStyleFieldV1::TextShadow,
                )?,
                color: computed_color(&shadow.color, InlineStyleFieldV1::TextShadow)?,
            })
        })
        .collect::<ProjectionResult<Vec<_>>>()
        .map(Arc::from)
}

fn box_shadows(
    styles: &ComputedValues,
    cache: &mut PayloadCache<Arc<[BoxShadow]>>,
) -> ProjectionResult<Arc<[BoxShadow]>> {
    let shadows = &styles.get_effects().box_shadow.0;
    cache.get_or_project(shadows, || project_box_shadows(shadows))
}

fn project_box_shadows(shadows: &[computed::BoxShadow]) -> ProjectionResult<Arc<[BoxShadow]>> {
    numeric::ensure_list_budget(shadows.len(), InlineStyleFieldV1::BoxShadow)?;
    shadows
        .iter()
        .map(|shadow| {
            Ok(BoxShadow {
                offset_x: numeric::css_px(
                    shadow.base.horizontal.px(),
                    InlineStyleFieldV1::BoxShadow,
                )?,
                offset_y: numeric::css_px(
                    shadow.base.vertical.px(),
                    InlineStyleFieldV1::BoxShadow,
                )?,
                blur_radius: numeric::non_negative_css_px(
                    shadow.base.blur.0.px(),
                    InlineStyleFieldV1::BoxShadow,
                )?,
                spread_radius: numeric::css_px(shadow.spread.px(), InlineStyleFieldV1::BoxShadow)?,
                color: computed_color(&shadow.base.color, InlineStyleFieldV1::BoxShadow)?,
                inset: shadow.inset,
            })
        })
        .collect::<ProjectionResult<Vec<_>>>()
        .map(Arc::from)
}
