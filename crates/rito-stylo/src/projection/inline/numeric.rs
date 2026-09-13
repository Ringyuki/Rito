use rito_style_contract::{
    CssPx, LengthPercentage, NonNegativeCssPx, NonNegativeLengthPercentage, NonNegativeNumber,
    Percentage, UnitInterval,
};
use style::values::computed::{
    length_percentage::{LengthPercentage as StyloLengthPercentage, Unpacked},
    NonNegativeLengthPercentage as StyloNonNegativeLengthPercentage,
};

use super::{InlineStyleField, InlineStyleProjectionReason, ProjectionFailure, ProjectionResult};

pub(super) fn css_px(value: f32, field: InlineStyleField) -> ProjectionResult<CssPx> {
    CssPx::new(value).map_err(|error| invalid_numeric(field, error))
}

pub(super) fn non_negative_css_px(
    value: f32,
    field: InlineStyleField,
) -> ProjectionResult<NonNegativeCssPx> {
    NonNegativeCssPx::new(value).map_err(|error| invalid_numeric(field, error))
}

pub(super) fn non_negative_number(
    value: f32,
    field: InlineStyleField,
) -> ProjectionResult<NonNegativeNumber> {
    NonNegativeNumber::new(value).map_err(|error| invalid_numeric(field, error))
}

pub(super) fn unit_interval(value: f32, field: InlineStyleField) -> ProjectionResult<UnitInterval> {
    UnitInterval::new(value).map_err(|error| invalid_numeric(field, error))
}

pub(super) fn length_percentage(
    value: &StyloLengthPercentage,
    field: InlineStyleField,
) -> ProjectionResult<LengthPercentage> {
    match value.unpack() {
        Unpacked::Length(length) => Ok(LengthPercentage::Length(css_px(length.px(), field)?)),
        Unpacked::Percentage(percentage) => Ok(LengthPercentage::Percentage(
            Percentage::from_ratio(percentage.0).map_err(|error| invalid_numeric(field, error))?,
        )),
        Unpacked::Calc(_) => Err(ProjectionFailure {
            field,
            reason: InlineStyleProjectionReason::OpaqueCalc,
        }),
    }
}

pub(super) fn non_negative_length_percentage(
    value: &StyloNonNegativeLengthPercentage,
    field: InlineStyleField,
) -> ProjectionResult<NonNegativeLengthPercentage> {
    Ok(NonNegativeLengthPercentage::new(length_percentage(
        &value.0, field,
    )?))
}

pub(super) fn invalid_numeric(
    field: InlineStyleField,
    error: rito_style_contract::NumericError,
) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: InlineStyleProjectionReason::InvalidNumeric(error),
    }
}

pub(super) const fn unsupported(field: InlineStyleField) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: InlineStyleProjectionReason::UnsupportedValue,
    }
}

pub(super) fn ensure_list_budget(
    item_count: usize,
    field: InlineStyleField,
) -> ProjectionResult<()> {
    if item_count > rito_style_contract::INLINE_STYLE_LIST_ITEM_LIMIT {
        return Err(ProjectionFailure {
            field,
            reason: InlineStyleProjectionReason::ProjectionBudgetExceeded,
        });
    }
    Ok(())
}
