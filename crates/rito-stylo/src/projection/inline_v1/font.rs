use rito_style_contract::{
    FontFamilies, FontFamily, FontFamilyName, FontFamilyNameSyntax as ContractFontFamilyNameSyntax,
    FontObliqueAngle, FontSlant, FontStyleV1, FontWeight,
    GenericFontFamily as ContractGenericFamily, LineHeight,
};
use style::{
    properties::ComputedValues,
    values::{
        computed::font::{FontFamilyNameSyntax, GenericFontFamily, SingleFontFamily},
        generics::font::GenericLineHeight,
    },
};

use super::{cache::PayloadCache, numeric, InlineStyleFieldV1, ProjectionResult};

pub(super) fn project(
    styles: &ComputedValues,
    family_cache: &mut PayloadCache<FontFamilies>,
) -> ProjectionResult<FontStyleV1> {
    let font = styles.get_font();
    let family = &font.font_family;
    Ok(FontStyleV1 {
        families: font_families(family, family_cache)?,
        is_system_font: family.is_system_font,
        is_initial: family.is_initial,
        size: numeric::non_negative_css_px(
            font.font_size.computed_size().px(),
            InlineStyleFieldV1::FontSize,
        )?,
        weight: font_weight(font.font_weight.value())?,
        slant: font_slant(font.font_style)?,
        line_height: line_height(&font.line_height)?,
    })
}

fn font_families(
    value: &style::values::computed::FontFamily,
    cache: &mut PayloadCache<FontFamilies>,
) -> ProjectionResult<FontFamilies> {
    cache.get_or_project(&value.families.list, || project_font_families(value))
}

fn project_font_families(
    value: &style::values::computed::FontFamily,
) -> ProjectionResult<FontFamilies> {
    numeric::ensure_list_budget(value.families.list.len(), InlineStyleFieldV1::FontFamilies)?;
    let families = value
        .families
        .iter()
        .map(font_family)
        .collect::<ProjectionResult<Vec<_>>>()?;
    FontFamilies::new(families).map_err(|_| numeric::unsupported(InlineStyleFieldV1::FontFamilies))
}

fn font_family(value: &SingleFontFamily) -> ProjectionResult<FontFamily> {
    match value {
        SingleFontFamily::FamilyName(family) => Ok(FontFamily::Named(FontFamilyName::with_syntax(
            family.name.to_string(),
            match family.syntax {
                FontFamilyNameSyntax::Quoted => ContractFontFamilyNameSyntax::Quoted,
                FontFamilyNameSyntax::Identifiers => ContractFontFamilyNameSyntax::Identifiers,
            },
        ))),
        SingleFontFamily::Generic(generic) => Ok(FontFamily::Generic(generic_family(*generic)?)),
    }
}

fn generic_family(value: GenericFontFamily) -> ProjectionResult<ContractGenericFamily> {
    let family = match value {
        GenericFontFamily::Serif => ContractGenericFamily::Serif,
        GenericFontFamily::SansSerif => ContractGenericFamily::SansSerif,
        GenericFontFamily::Monospace => ContractGenericFamily::Monospace,
        GenericFontFamily::Cursive => ContractGenericFamily::Cursive,
        GenericFontFamily::Fantasy => ContractGenericFamily::Fantasy,
        GenericFontFamily::SystemUi => ContractGenericFamily::SystemUi,
        GenericFontFamily::None => {
            return Err(numeric::unsupported(InlineStyleFieldV1::FontFamilies));
        }
    };
    Ok(family)
}

fn font_weight(value: f32) -> ProjectionResult<FontWeight> {
    FontWeight::new(value)
        .map_err(|error| numeric::invalid_numeric(InlineStyleFieldV1::FontWeight, error))
}

fn font_slant(value: style::values::computed::FontStyle) -> ProjectionResult<FontSlant> {
    use style::values::computed::FontStyle;

    if value == FontStyle::NORMAL {
        Ok(FontSlant::Normal)
    } else if value == FontStyle::ITALIC {
        Ok(FontSlant::Italic)
    } else {
        Ok(FontSlant::Oblique(
            FontObliqueAngle::new(value.oblique_degrees())
                .map_err(|error| numeric::invalid_numeric(InlineStyleFieldV1::FontSlant, error))?,
        ))
    }
}

fn line_height(value: &style::values::computed::LineHeight) -> ProjectionResult<LineHeight> {
    match value {
        GenericLineHeight::Normal => Ok(LineHeight::Normal),
        GenericLineHeight::Number(number) => Ok(LineHeight::Number(numeric::non_negative_number(
            number.0,
            InlineStyleFieldV1::LineHeight,
        )?)),
        GenericLineHeight::Length(length) => Ok(LineHeight::Length(numeric::non_negative_css_px(
            length.0.px(),
            InlineStyleFieldV1::LineHeight,
        )?)),
    }
}
