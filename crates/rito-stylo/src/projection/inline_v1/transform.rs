use rito_style_contract::{FiniteF32, TransformListV1, TransformOperationV1};
use style::{
    properties::{longhands, ComputedValues},
    values::computed,
};

use super::{
    cache::PayloadCache, numeric, InlineStyleFieldV1, InlineStyleProjectionReasonV1,
    ProjectionFailure, ProjectionResult,
};

pub(super) fn project(
    styles: &ComputedValues,
    cache: &mut PayloadCache<TransformListV1>,
) -> ProjectionResult<TransformListV1> {
    let box_style = styles.get_box();
    require_initial(
        &box_style.rotate,
        &longhands::rotate::get_initial_value(),
        InlineStyleFieldV1::IndividualRotate,
    )?;
    require_initial(
        &box_style.scale,
        &longhands::scale::get_initial_value(),
        InlineStyleFieldV1::IndividualScale,
    )?;
    require_initial(
        &box_style.translate,
        &longhands::translate::get_initial_value(),
        InlineStyleFieldV1::IndividualTranslate,
    )?;
    require_initial(
        &box_style.transform_origin,
        &longhands::transform_origin::get_initial_value(),
        InlineStyleFieldV1::TransformOrigin,
    )?;

    let operations: &[computed::TransformOperation] = &box_style.transform.0;
    cache.get_or_project(operations, || project_operations(operations))
}

fn project_operations(
    values: &[computed::TransformOperation],
) -> ProjectionResult<TransformListV1> {
    numeric::ensure_list_budget(values.len(), InlineStyleFieldV1::Transform)?;
    let operations = values
        .iter()
        .map(project_operation)
        .collect::<ProjectionResult<Vec<_>>>()?;
    TransformListV1::new(operations).map_err(|_| ProjectionFailure {
        field: InlineStyleFieldV1::Transform,
        reason: InlineStyleProjectionReasonV1::ProjectionBudgetExceeded,
    })
}

fn project_operation(
    value: &computed::TransformOperation,
) -> ProjectionResult<TransformOperationV1> {
    let angle = match value {
        computed::TransformOperation::Rotate(angle)
        | computed::TransformOperation::RotateZ(angle) => angle,
        _ => return Err(numeric::unsupported(InlineStyleFieldV1::Transform)),
    };
    let radians = FiniteF32::new(angle.radians64() as f32)
        .map_err(|error| numeric::invalid_numeric(InlineStyleFieldV1::Transform, error))?;
    Ok(TransformOperationV1::Rotate { radians })
}

fn require_initial<T: PartialEq>(
    value: &T,
    initial: &T,
    field: InlineStyleFieldV1,
) -> ProjectionResult<()> {
    if value == initial {
        return Ok(());
    }
    Err(numeric::unsupported(field))
}
