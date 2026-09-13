use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, BackgroundImagePaint, BackgroundImagePosition,
    BackgroundImageRepeat, BackgroundImageSize, BoxShadow, ColorNoneFlags, ComputedColor,
    InlinePaintStyle, ResolvedUrl, ResolvedUrlError, TextDecoration, TextDecorationLines,
    TextDecorationStyle, TextShadow, TransformList, RESOLVED_URL_BYTE_LIMIT,
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
    numeric, transform, InlineStyleField, InlineStyleProjectionReason, ProjectionFailure,
    ProjectionResult,
};

pub(super) fn project(
    styles: &ComputedValues,
    text_shadow_cache: &mut PayloadCache<Arc<[TextShadow]>>,
    box_shadow_cache: &mut PayloadCache<Arc<[BoxShadow]>>,
    background_image_url_cache: &mut UrlPayloadCache,
    transform_cache: &mut PayloadCache<TransformList>,
) -> ProjectionResult<InlinePaintStyle> {
    let foreground = absolute_color(&styles.get_inherited_text().color, InlineStyleField::Color)?;
    let background = styles.get_background();
    Ok(InlinePaintStyle {
        foreground,
        opacity: numeric::unit_interval(styles.clone_opacity(), InlineStyleField::Opacity)?,
        background: computed_color(&background.background_color, InlineStyleField::Color)?,
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
) -> ProjectionResult<Option<BackgroundImagePaint>> {
    let image = single_layer(
        background.background_image.0.as_slice(),
        InlineStyleField::BackgroundImage,
    )?;
    let resolved = match image {
        computed::Image::None => return Ok(None),
        computed::Image::Url(ComputedUrl::Valid(value)) => {
            let serialized = value.as_str();
            if serialized.len() > RESOLVED_URL_BYTE_LIMIT {
                return Err(resolved_url_failure(ResolvedUrlError::ByteLimitExceeded {
                    byte_len: serialized.len(),
                    limit: RESOLVED_URL_BYTE_LIMIT,
                }));
            }
            url_cache.get_or_project(serialized, |serialized| {
                ResolvedUrl::new(serialized).map_err(resolved_url_failure)
            })?
        }
        _ => return Err(numeric::unsupported(InlineStyleField::BackgroundImage)),
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
        InlineStyleField::BackgroundAttachment,
    )?;
    require_initial_layer(
        &background.background_origin.0,
        longhands::background_origin::single_value::get_initial_value(),
        InlineStyleField::BackgroundOrigin,
    )?;
    require_initial_layer(
        &background.background_clip.0,
        longhands::background_clip::single_value::get_initial_value(),
        InlineStyleField::BackgroundClip,
    )?;
    require_initial_layer(
        &background.background_blend_mode.0,
        longhands::background_blend_mode::single_value::get_initial_value(),
        InlineStyleField::BackgroundBlendMode,
    )?;

    Ok(Some(BackgroundImagePaint {
        url: resolved,
        size,
        repeat,
        position,
    }))
}

fn background_repeat(
    values: &[computed::BackgroundRepeat],
) -> ProjectionResult<BackgroundImageRepeat> {
    let value = single_layer(values, InlineStyleField::BackgroundRepeat)?;
    if value.0 == BackgroundRepeatKeyword::Repeat && value.1 == BackgroundRepeatKeyword::Repeat {
        return Ok(BackgroundImageRepeat::Repeat);
    }
    if value.0 == BackgroundRepeatKeyword::NoRepeat && value.1 == BackgroundRepeatKeyword::NoRepeat
    {
        return Ok(BackgroundImageRepeat::NoRepeat);
    }
    Err(numeric::unsupported(InlineStyleField::BackgroundRepeat))
}

fn background_size(values: &[computed::BackgroundSize]) -> ProjectionResult<BackgroundImageSize> {
    let value = single_layer(values, InlineStyleField::BackgroundSize)?;
    if *value == computed::BackgroundSize::auto() {
        return Ok(BackgroundImageSize::Auto);
    }
    match value {
        computed::BackgroundSize::Cover => Ok(BackgroundImageSize::Cover),
        computed::BackgroundSize::Contain => Ok(BackgroundImageSize::Contain),
        computed::BackgroundSize::ExplicitSize { width, height } => {
            Ok(BackgroundImageSize::Explicit {
                x: background_size_axis(width)?,
                y: background_size_axis(height)?,
            })
        }
    }
}

fn background_size_axis(
    value: &style::values::computed::NonNegativeLengthPercentageOrAuto,
) -> ProjectionResult<rito_style_contract::BackgroundSizeAxis> {
    use style::values::generics::length::GenericLengthPercentageOrAuto;
    match value {
        GenericLengthPercentageOrAuto::Auto => Ok(rito_style_contract::BackgroundSizeAxis::Auto),
        GenericLengthPercentageOrAuto::LengthPercentage(length) => {
            Ok(rito_style_contract::BackgroundSizeAxis::Value(
                numeric::length_percentage(&length.0, InlineStyleField::BackgroundSize)?,
            ))
        }
    }
}

fn background_position(
    x_values: &[computed::LengthPercentage],
    y_values: &[computed::LengthPercentage],
) -> ProjectionResult<BackgroundImagePosition> {
    let x = single_layer(x_values, InlineStyleField::BackgroundPosition)?;
    let y = single_layer(y_values, InlineStyleField::BackgroundPosition)?;
    Ok(BackgroundImagePosition {
        x: numeric::length_percentage(x, InlineStyleField::BackgroundPosition)?,
        y: numeric::length_percentage(y, InlineStyleField::BackgroundPosition)?,
    })
}

fn require_initial_layer<T: PartialEq>(
    values: &[T],
    initial: T,
    field: InlineStyleField,
) -> ProjectionResult<()> {
    if single_layer(values, field)? == &initial {
        return Ok(());
    }
    Err(numeric::unsupported(field))
}

fn single_layer<T>(values: &[T], field: InlineStyleField) -> ProjectionResult<&T> {
    let [value] = values else {
        return Err(numeric::unsupported(field));
    };
    Ok(value)
}

fn resolved_url_failure(error: ResolvedUrlError) -> ProjectionFailure {
    let reason = match error {
        ResolvedUrlError::ByteLimitExceeded { .. } => {
            InlineStyleProjectionReason::ProjectionBudgetExceeded
        }
        ResolvedUrlError::Empty | ResolvedUrlError::NotAbsolute => {
            InlineStyleProjectionReason::UnsupportedValue
        }
    };
    ProjectionFailure {
        field: InlineStyleField::BackgroundImage,
        reason,
    }
}

pub(super) fn absolute_color(
    value: &style::color::AbsoluteColor,
    field: InlineStyleField,
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
    field: InlineStyleField,
) -> ProjectionResult<ComputedColor> {
    match value {
        computed::Color::Absolute(color) => {
            Ok(ComputedColor::Absolute(absolute_color(color, field)?))
        }
        computed::Color::CurrentColor => Ok(ComputedColor::CurrentColor),
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
            InlineStyleField::TextDecoration,
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
    numeric::ensure_list_budget(shadows.len(), InlineStyleField::TextShadow)?;
    shadows
        .iter()
        .map(|shadow| {
            Ok(TextShadow {
                offset_x: numeric::css_px(shadow.horizontal.px(), InlineStyleField::TextShadow)?,
                offset_y: numeric::css_px(shadow.vertical.px(), InlineStyleField::TextShadow)?,
                blur_radius: numeric::non_negative_css_px(
                    shadow.blur.0.px(),
                    InlineStyleField::TextShadow,
                )?,
                color: computed_color(&shadow.color, InlineStyleField::TextShadow)?,
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
    numeric::ensure_list_budget(shadows.len(), InlineStyleField::BoxShadow)?;
    shadows
        .iter()
        .map(|shadow| {
            Ok(BoxShadow {
                offset_x: numeric::css_px(
                    shadow.base.horizontal.px(),
                    InlineStyleField::BoxShadow,
                )?,
                offset_y: numeric::css_px(shadow.base.vertical.px(), InlineStyleField::BoxShadow)?,
                blur_radius: numeric::non_negative_css_px(
                    shadow.base.blur.0.px(),
                    InlineStyleField::BoxShadow,
                )?,
                spread_radius: numeric::css_px(shadow.spread.px(), InlineStyleField::BoxShadow)?,
                color: computed_color(&shadow.base.color, InlineStyleField::BoxShadow)?,
                inset: shadow.inset,
            })
        })
        .collect::<ProjectionResult<Vec<_>>>()
        .map(Arc::from)
}
