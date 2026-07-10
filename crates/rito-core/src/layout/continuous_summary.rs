use serde_json::{json, Map, Number, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun},
    summary_json::{hash_json, hash_text, number_value, rect_value},
};

type ContinuousBlock = RuntimeBlock<LineBox>;
type ContinuousChild = RuntimeChild<LineBox>;

#[derive(Debug)]
pub(crate) struct ContinuousAggregate {
    pub(crate) nested_block_count: usize,
    pub(crate) line_count: usize,
    pub(crate) text_run_count: usize,
    pub(crate) image_count: usize,
    pub(crate) hr_count: usize,
    pub(crate) text: String,
}

impl ContinuousAggregate {
    fn new() -> Self {
        Self {
            nested_block_count: 0,
            line_count: 0,
            text_run_count: 0,
            image_count: 0,
            hr_count: 0,
            text: String::new(),
        }
    }
}

pub(crate) fn summarize_continuous_block(block: &ContinuousBlock) -> Value {
    let aggregate = aggregate_continuous_blocks(std::slice::from_ref(block));
    let child_summaries = block
        .children
        .iter()
        .map(summarize_continuous_child)
        .collect::<Vec<_>>();
    let mut value = Map::new();
    value.insert(
        "bounds".to_owned(),
        rect_value(block.x, block.y, block.width, block.height),
    );
    insert_optional_string(&mut value, "semanticTag", block.semantic_tag.as_deref());
    insert_optional_string(&mut value, "anchorId", block.anchor_id.as_deref());
    value.insert(
        "childCount".to_owned(),
        Value::Number(Number::from(block.children.len())),
    );
    value.insert(
        "nestedBlockCount".to_owned(),
        Value::Number(Number::from(aggregate.nested_block_count)),
    );
    value.insert(
        "lineCount".to_owned(),
        Value::Number(Number::from(aggregate.line_count)),
    );
    value.insert(
        "textRunCount".to_owned(),
        Value::Number(Number::from(aggregate.text_run_count)),
    );
    value.insert(
        "imageCount".to_owned(),
        Value::Number(Number::from(aggregate.image_count)),
    );
    value.insert(
        "hrCount".to_owned(),
        Value::Number(Number::from(aggregate.hr_count)),
    );
    value.insert(
        "textHash".to_owned(),
        Value::String(hash_text(&aggregate.text)),
    );
    if block.page_break_before {
        value.insert("pageBreakBefore".to_owned(), Value::Bool(true));
    }
    if block.page_break_after {
        value.insert("pageBreakAfter".to_owned(), Value::Bool(true));
    }
    value.insert(
        "childDetailHash".to_owned(),
        Value::String(hash_json(&Value::Array(child_summaries.clone()))),
    );
    value.insert("children".to_owned(), Value::Array(child_summaries));
    Value::Object(value)
}

fn summarize_continuous_child(child: &ContinuousChild) -> Value {
    match child {
        ContinuousChild::Block(block) => {
            let mut summary = summarize_continuous_block(block);
            if let Value::Object(object) = &mut summary {
                object.remove("children");
            }
            summary
        }
        ContinuousChild::Line(line) => json!({
            "type": "line-box",
            "bounds": rect_value(line.x, line.y, line.width, line.height),
            "runCount": line.runs.len(),
            "textHash": hash_text(&line.text()),
            "usedWidth": number_value(line.used_width()),
        }),
        ContinuousChild::Image(image) => {
            let mut value = Map::new();
            value.insert("type".to_owned(), Value::String("image".to_owned()));
            value.insert(
                "bounds".to_owned(),
                rect_value(image.x, image.y, image.width, image.height),
            );
            value.insert("src".to_owned(), Value::String(image.src.clone()));
            insert_optional_string(&mut value, "alt", image.alt.as_deref());
            insert_optional_string(&mut value, "href", image.href.as_deref());
            Value::Object(value)
        }
        ContinuousChild::Hr(hr) => json!({
            "type": "hr",
            "bounds": rect_value(hr.x, hr.y, hr.width, hr.height),
            "paint": {
                "color": hr.color,
                "style": hr.style,
            },
        }),
    }
}

pub(crate) fn aggregate_continuous_blocks(blocks: &[ContinuousBlock]) -> ContinuousAggregate {
    let mut aggregate = ContinuousAggregate::new();
    for block in blocks {
        aggregate_continuous_block(block, &mut aggregate);
    }
    aggregate
}

fn aggregate_continuous_block(block: &ContinuousBlock, aggregate: &mut ContinuousAggregate) {
    aggregate.nested_block_count += 1;
    for child in &block.children {
        match child {
            ContinuousChild::Block(block) => aggregate_continuous_block(block, aggregate),
            ContinuousChild::Line(line) => {
                aggregate.line_count += 1;
                for run in &line.runs {
                    match run {
                        LineRun::Text(run) => {
                            aggregate.text_run_count += 1;
                            aggregate.text.push_str(&run.text);
                        }
                        LineRun::Atom(run) if run.image_src.is_some() => {
                            aggregate.image_count += 1;
                        }
                        LineRun::Atom(_) | LineRun::Ruby(_) => {}
                    }
                }
            }
            ContinuousChild::Image(_) => aggregate.image_count += 1,
            ContinuousChild::Hr(_) => aggregate.hr_count += 1,
        }
    }
}

pub(crate) fn continuous_block_bottom(block: &ContinuousBlock) -> f64 {
    block.y + block.height
}

fn insert_optional_string(output: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), Value::String(value.to_owned()));
    }
}
