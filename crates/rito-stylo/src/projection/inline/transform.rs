use rito_style_contract::{FiniteF32, TransformList, TransformOperation};
use style::{
    properties::{longhands, ComputedValues},
    values::computed,
};

use super::{
    cache::PayloadCache, numeric, InlineStyleField, InlineStyleProjectionReason, ProjectionFailure,
    ProjectionResult,
};

pub(super) fn project(
    styles: &ComputedValues,
    cache: &mut PayloadCache<TransformList>,
) -> ProjectionResult<TransformList> {
    let box_style = styles.get_box();
    require_initial(
        &box_style.rotate,
        &longhands::rotate::get_initial_value(),
        InlineStyleField::IndividualRotate,
    )?;
    require_initial(
        &box_style.scale,
        &longhands::scale::get_initial_value(),
        InlineStyleField::IndividualScale,
    )?;
    require_initial(
        &box_style.translate,
        &longhands::translate::get_initial_value(),
        InlineStyleField::IndividualTranslate,
    )?;
    require_initial(
        &box_style.transform_origin,
        &longhands::transform_origin::get_initial_value(),
        InlineStyleField::TransformOrigin,
    )?;

    let operations: &[computed::TransformOperation] = &box_style.transform.0;
    cache.get_or_project(operations, || project_operations(operations))
}

fn project_operations(values: &[computed::TransformOperation]) -> ProjectionResult<TransformList> {
    numeric::ensure_list_budget(values.len(), InlineStyleField::Transform)?;
    let operations = values
        .iter()
        .map(project_operation)
        .collect::<ProjectionResult<Vec<_>>>()?;
    TransformList::new(operations).map_err(|_| ProjectionFailure {
        field: InlineStyleField::Transform,
        reason: InlineStyleProjectionReason::ProjectionBudgetExceeded,
    })
}

fn project_operation(value: &computed::TransformOperation) -> ProjectionResult<TransformOperation> {
    let angle = match value {
        computed::TransformOperation::Rotate(angle)
        | computed::TransformOperation::RotateZ(angle) => angle,
        _ => return Err(numeric::unsupported(InlineStyleField::Transform)),
    };
    let radians = FiniteF32::new(angle.radians64() as f32)
        .map_err(|error| numeric::invalid_numeric(InlineStyleField::Transform, error))?;
    Ok(TransformOperation::Rotate { radians })
}

fn require_initial<T: PartialEq>(
    value: &T,
    initial: &T,
    field: InlineStyleField,
) -> ProjectionResult<()> {
    if value == initial {
        return Ok(());
    }
    Err(numeric::unsupported(field))
}
