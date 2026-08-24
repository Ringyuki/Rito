use rito_style_contract::{
    CssPx, LengthPercentage, NonNegativeCssPx, NonNegativeLengthPercentage, NonNegativeNumber,
    Percentage, UnitInterval,
};
use style::values::computed::{
    length_percentage::{LengthPercentage as StyloLengthPercentage, Unpacked},
    NonNegativeLengthPercentage as StyloNonNegativeLengthPercentage,
};

use super::{
    InlineStyleFieldV1, InlineStyleProjectionReasonV1, ProjectionFailure, ProjectionResult,
};

pub(super) fn css_px(value: f32, field: InlineStyleFieldV1) -> ProjectionResult<CssPx> {
    CssPx::new(value).map_err(|error| invalid_numeric(field, error))
}

pub(super) fn non_negative_css_px(
    value: f32,
    field: InlineStyleFieldV1,
) -> ProjectionResult<NonNegativeCssPx> {
    NonNegativeCssPx::new(value).map_err(|error| invalid_numeric(field, error))
}

pub(super) fn non_negative_number(
    value: f32,
    field: InlineStyleFieldV1,
) -> ProjectionResult<NonNegativeNumber> {
    NonNegativeNumber::new(value).map_err(|error| invalid_numeric(field, error))
}

pub(super) fn unit_interval(
    value: f32,
    field: InlineStyleFieldV1,
) -> ProjectionResult<UnitInterval> {
    UnitInterval::new(value).map_err(|error| invalid_numeric(field, error))
}

pub(super) fn length_percentage(
    value: &StyloLengthPercentage,
    field: InlineStyleFieldV1,
) -> ProjectionResult<LengthPercentage> {
    match value.unpack() {
        Unpacked::Length(length) => Ok(LengthPercentage::Length(css_px(length.px(), field)?)),
        Unpacked::Percentage(percentage) => Ok(LengthPercentage::Percentage(
            Percentage::from_ratio(percentage.0).map_err(|error| invalid_numeric(field, error))?,
        )),
        Unpacked::Calc(_) => Err(ProjectionFailure {
            field,
            reason: InlineStyleProjectionReasonV1::OpaqueCalc,
        }),
    }
}

pub(super) fn non_negative_length_percentage(
    value: &StyloNonNegativeLengthPercentage,
    field: InlineStyleFieldV1,
) -> ProjectionResult<NonNegativeLengthPercentage> {
    Ok(NonNegativeLengthPercentage::new(length_percentage(
        &value.0, field,
    )?))
}

pub(super) fn invalid_numeric(
    field: InlineStyleFieldV1,
    error: rito_style_contract::NumericError,
) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: InlineStyleProjectionReasonV1::InvalidNumeric(error),
    }
}

pub(super) const fn unsupported(field: InlineStyleFieldV1) -> ProjectionFailure {
    ProjectionFailure {
        field,
        reason: InlineStyleProjectionReasonV1::UnsupportedValue,
    }
}

pub(super) fn ensure_list_budget(
    item_count: usize,
    field: InlineStyleFieldV1,
) -> ProjectionResult<()> {
    if item_count > rito_style_contract::INLINE_STYLE_LIST_ITEM_LIMIT_V1 {
        return Err(ProjectionFailure {
            field,
            reason: InlineStyleProjectionReasonV1::ProjectionBudgetExceeded,
        });
    }
    Ok(())
}
