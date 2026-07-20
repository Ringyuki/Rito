use rito_style_contract::{TransformListV1, TransformOperationV1};
use serde_json::{json, Map, Value};

/// Translates the bounded typed transform list into the current layout paint
/// contract. Projection has already rejected every operation except exact 2D
/// rotations, so this layer never parses or approximates CSS text.
pub(super) fn materialize_transform(output: &mut Map<String, Value>, transform: &TransformListV1) {
    let operations = transform
        .as_slice()
        .iter()
        .map(|operation| match operation {
            TransformOperationV1::Rotate { radians } => json!({
                "kind": "rotate",
                "rad": radians.get(),
            }),
        })
        .collect();
    output.insert("transform".to_owned(), Value::Array(operations));
}
