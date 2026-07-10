use serde_json::{Map, Number, Value};

use super::{
    line::{LineRun, RubyRunBox, TextRunBox},
    summary_json::number_value,
};

pub(crate) fn extract_ruby_annotations(runs: Vec<LineRun>, line_y: f64) -> Vec<LineRun> {
    let mut out = Vec::new();
    let mut index = 0usize;
    while index < runs.len() {
        let Some(group) = collect_ruby_group(&runs, index) else {
            out.push(runs[index].clone());
            index += 1;
            continue;
        };
        for run in runs.iter().take(group.next_index).skip(index) {
            out.push(run.clone());
        }
        out.push(LineRun::Ruby(create_ruby_annotation(&group, line_y)));
        index = group.next_index;
    }
    out
}

#[derive(Debug)]
struct RubyGroup {
    tag: String,
    start: TextRunBox,
    end: TextRunBox,
    next_index: usize,
}

fn collect_ruby_group(runs: &[LineRun], index: usize) -> Option<RubyGroup> {
    let LineRun::Text(run) = runs.get(index)? else {
        return None;
    };
    let tag = run.ruby_annotation.clone()?;
    let mut group_end = run.clone();
    let mut next_index = index + 1;
    while next_index < runs.len() {
        let LineRun::Text(next) = &runs[next_index] else {
            break;
        };
        if next.ruby_annotation.as_deref() != Some(&tag) {
            break;
        }
        group_end = next.clone();
        next_index += 1;
    }
    Some(RubyGroup {
        tag,
        start: run.clone(),
        end: group_end,
        next_index,
    })
}

fn create_ruby_annotation(group: &RubyGroup, line_y: f64) -> RubyRunBox {
    let ruby_font_size = group.start.font_size * 0.5;
    RubyRunBox {
        text: group.tag.clone(),
        x: group.start.x,
        y: line_y + group.start.y - ruby_font_size - 1.0,
        width: group.end.x + group.end.width - group.start.x,
        height: ruby_font_size,
        paint: ruby_paint_value(&group.start.paint, ruby_font_size),
    }
}

fn ruby_paint_value(base_paint: &Value, ruby_font_size: f64) -> Value {
    let mut paint = Map::new();
    paint.insert(
        "color".to_owned(),
        base_paint
            .get("color")
            .cloned()
            .unwrap_or_else(|| Value::String("#000000".to_owned())),
    );

    let base_font = base_paint.get("font").and_then(Value::as_object);
    let mut font = Map::new();
    font.insert(
        "family".to_owned(),
        base_font
            .and_then(|font| font.get("family"))
            .cloned()
            .unwrap_or_else(|| Value::String("serif".to_owned())),
    );
    font.insert("sizePx".to_owned(), number_value(ruby_font_size));
    font.insert(
        "style".to_owned(),
        base_font
            .and_then(|font| font.get("style"))
            .cloned()
            .unwrap_or_else(|| Value::String("normal".to_owned())),
    );
    font.insert(
        "weight".to_owned(),
        base_font
            .and_then(|font| font.get("weight"))
            .cloned()
            .unwrap_or_else(|| Value::Number(Number::from(400))),
    );
    paint.insert("font".to_owned(), Value::Object(font));
    Value::Object(paint)
}
