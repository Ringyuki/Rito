use serde_json::{Map, Number, Value};

use super::{DisplayCommand, DisplayTextCommandInput};

pub(super) fn command_value(command: &DisplayCommand) -> Value {
    let mut object = command_fields(command);
    object.insert("kind".to_owned(), Value::String(command.kind().to_owned()));
    Value::Object(object)
}

fn command_fields(command: &DisplayCommand) -> Map<String, Value> {
    let mut fields = Map::new();
    match command {
        DisplayCommand::PushState | DisplayCommand::PopState => {}
        DisplayCommand::Translate { dx, dy } => {
            insert_field(&mut fields, "dx", dx.clone());
            insert_field(&mut fields, "dy", dy.clone());
        }
        DisplayCommand::Opacity { value } => {
            insert_field(&mut fields, "value", number_value(*value))
        }
        DisplayCommand::Transform {
            origin,
            box_value,
            transforms,
        } => {
            insert_field(&mut fields, "origin", origin.clone());
            insert_field(&mut fields, "box", box_value.clone());
            insert_field(&mut fields, "transforms", transforms.clone());
        }
        DisplayCommand::ClipRect { rect, radius } => {
            insert_field(&mut fields, "rect", rect.clone());
            insert_optional_field(&mut fields, "radius", radius.clone());
        }
        DisplayCommand::PaintPage { rect, paint }
        | DisplayCommand::PaintHorizontalRule { rect, paint } => {
            insert_field(&mut fields, "paint", paint.clone());
            insert_field(&mut fields, "rect", rect.clone());
        }
        DisplayCommand::PaintBlock {
            rect,
            paint,
            border_box,
        } => {
            insert_field(&mut fields, "rect", rect.clone());
            insert_field(&mut fields, "paint", paint.clone());
            insert_optional_field(&mut fields, "borderBox", border_box.clone());
        }
        DisplayCommand::PaintText(input) | DisplayCommand::PaintRuby(input) => {
            insert_text_fields(&mut fields, input)
        }
        DisplayCommand::PaintImage {
            src,
            rect,
            alt,
            href,
        } => {
            insert_field(&mut fields, "src", Value::String(src.clone()));
            insert_field(&mut fields, "rect", rect.clone());
            insert_optional_string(&mut fields, "alt", alt.clone());
            insert_optional_string(&mut fields, "href", href.clone());
        }
    }
    fields
}

fn insert_text_fields(fields: &mut Map<String, Value>, input: &DisplayTextCommandInput) {
    insert_field(fields, "paint", input.paint.clone());
    insert_field(fields, "rect", input.rect.clone());
    insert_field(fields, "text", input.text.clone());
    insert_optional_field(fields, "lineHeightPx", input.line_height_px.clone());
    insert_optional_string(fields, "href", input.href.clone());
    insert_optional_field(fields, "sourceText", input.source_text.clone());
    insert_optional_field(
        fields,
        "sourceTextOffset",
        input
            .source_text_offset
            .map(|offset| Value::Number(offset.into())),
    );
}

fn insert_field(fields: &mut Map<String, Value>, key: &str, value: Value) {
    fields.insert(key.to_owned(), value);
}

fn insert_optional_field(fields: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        insert_field(fields, key, value);
    }
}

fn insert_optional_string(fields: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        insert_field(fields, key, Value::String(value));
    }
}

fn number_value(value: f64) -> Value {
    Value::Number(Number::from_f64(value).unwrap_or_else(|| Number::from(0)))
}
