use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild, RuntimeImage},
    line::{AtomRunBox, LineBox, LineRun, TextRunBox},
    page::RuntimePage,
    summary_json::{hash_json, hash_text, rect_value},
    visual_geometry::{VisualGeometry, VisualRect},
};

type HitMapPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitMapFlowSummary {
    pub page_count: usize,
    pub totals: HitMapFlowCounts,
    pub page_digests: Vec<HitMapFlowPageDigest>,
    pub samples: Vec<Value>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitMapFlowPageDigest {
    pub index: usize,
    pub counts: HitMapFlowCounts,
    pub text_hash: String,
    pub detail_hash: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitMapFlowCounts {
    pub entries: usize,
    pub text_entries: usize,
    pub image_entries: usize,
    pub link_entries: usize,
    pub source_refs: usize,
}

#[derive(Debug, Clone)]
struct HitMapFlowPageDetail {
    index: usize,
    counts: HitMapFlowCounts,
    text_hash: String,
    value: Value,
}

pub(crate) fn summarize_hit_map_flow(
    pages: &[HitMapPage],
    sample_indices: Vec<usize>,
) -> HitMapFlowSummary {
    let details = pages
        .iter()
        .map(summarize_hit_map_flow_page)
        .collect::<Vec<_>>();
    let values = details
        .iter()
        .map(|detail| detail.value.clone())
        .collect::<Vec<_>>();
    let page_digests = details
        .iter()
        .map(|detail| HitMapFlowPageDigest {
            index: detail.index,
            counts: detail.counts.clone(),
            text_hash: detail.text_hash.clone(),
            detail_hash: hash_json(&detail.value),
        })
        .collect::<Vec<_>>();
    let samples = sample_indices
        .into_iter()
        .map(|index| values[index].clone())
        .collect::<Vec<_>>();

    HitMapFlowSummary {
        page_count: details.len(),
        totals: total_hit_map_counts(&details),
        page_digests,
        samples,
        full_detail_hash: hash_json(&Value::Array(values)),
    }
}

fn summarize_hit_map_flow_page(page: &HitMapPage) -> HitMapFlowPageDetail {
    let (entries, text_hash) = build_hit_map(page);
    let counts = count_hit_map_entries(&entries);
    let value = json!({
        "index": page.index,
        "counts": counts,
        "textHash": text_hash,
        "entries": entries,
    });

    HitMapFlowPageDetail {
        index: page.index,
        counts,
        text_hash,
        value,
    }
}

pub(crate) fn build_hit_map(page: &HitMapPage) -> (Vec<Value>, String) {
    let mut text = String::new();
    let entries = build_hit_map_flow_entries(page, Some(&mut text));
    (entries, hash_text(&text))
}

fn build_hit_map_flow_entries(page: &HitMapPage, mut text: Option<&mut String>) -> Vec<Value> {
    let mut entries = Vec::new();
    let page_visual = VisualGeometry::page();
    for (block_index, block) in page.content.iter().enumerate() {
        let mut line_index = 0usize;
        collect_hit_map_line_entries(
            block,
            block_index,
            (0.0, 0.0),
            &mut line_index,
            &mut entries,
            &mut text,
            page_visual,
        );
    }
    for (block_index, block) in page.content.iter().enumerate() {
        collect_hit_map_block_image_entries(
            block,
            0.0,
            0.0,
            block_index,
            &mut entries,
            page_visual,
        );
    }
    entries
}

fn collect_hit_map_line_entries(
    block: &RuntimeBlock<LineBox>,
    block_index: usize,
    offset: (f64, f64),
    line_index: &mut usize,
    entries: &mut Vec<Value>,
    text: &mut Option<&mut String>,
    parent_visual: VisualGeometry,
) {
    let block_x = offset.0 + block.x;
    let block_y = offset.1 + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Line(line) => {
                collect_hit_map_line(
                    line,
                    (block_x, block_y),
                    block_index,
                    *line_index,
                    entries,
                    text,
                    visual,
                );
                *line_index += 1;
            }
            RuntimeChild::Block(block) => collect_hit_map_line_entries(
                block,
                block_index,
                (block_x, block_y),
                line_index,
                entries,
                text,
                visual,
            ),
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_hit_map_line(
    line: &LineBox,
    offset: (f64, f64),
    block_index: usize,
    line_index: usize,
    entries: &mut Vec<Value>,
    text: &mut Option<&mut String>,
    visual: VisualGeometry,
) {
    let line_x = offset.0 + line.x;
    let line_y = offset.1 + line.y;
    for (run_index, run) in line.runs.iter().enumerate() {
        match run {
            LineRun::Text(run) => {
                if let Some(entry) = hit_map_text_entry(
                    run,
                    line_x,
                    line_y,
                    block_index,
                    line_index,
                    run_index,
                    visual,
                ) {
                    if let Some(text) = text.as_deref_mut() {
                        text.push_str(&run.text);
                    }
                    entries.push(entry);
                }
            }
            LineRun::Atom(run) => {
                if let Some(entry) = hit_map_atom_entry(
                    run,
                    line_x,
                    line_y,
                    block_index,
                    line_index,
                    run_index,
                    visual,
                ) {
                    entries.push(entry);
                }
            }
            LineRun::Ruby(_) => {}
        }
    }
}

fn collect_hit_map_block_image_entries(
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    block_index: usize,
    entries: &mut Vec<Value>,
    parent_visual: VisualGeometry,
) {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Image(image) => {
                if let Some(entry) =
                    hit_map_image_entry(image, block_x, block_y, block_index, visual)
                {
                    entries.push(entry);
                }
            }
            RuntimeChild::Block(block) => collect_hit_map_block_image_entries(
                block,
                block_x,
                block_y,
                block_index,
                entries,
                visual,
            ),
            RuntimeChild::Line(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn hit_map_text_entry(
    run: &TextRunBox,
    offset_x: f64,
    offset_y: f64,
    block_index: usize,
    line_index: usize,
    run_index: usize,
    visual: VisualGeometry,
) -> Option<Value> {
    let bounds = visual.resolve_rect(absolute_rect(
        run.x, run.y, run.width, run.height, offset_x, offset_y,
    ))?;
    let mut value = base_hit_map_entry(block_index, line_index, run_index, bounds, &run.text);
    insert_optional_string(&mut value, "href", run.href.as_deref());
    insert_optional_path(&mut value, "sourcePath", run.source_path.as_ref());
    if let Some(offset) = run.source_text_offset {
        value.insert(
            "sourceTextOffset".to_owned(),
            Value::Number(Number::from(offset)),
        );
    }
    Some(Value::Object(value))
}

fn hit_map_atom_entry(
    run: &AtomRunBox,
    offset_x: f64,
    offset_y: f64,
    block_index: usize,
    line_index: usize,
    run_index: usize,
    visual: VisualGeometry,
) -> Option<Value> {
    let bounds = visual.resolve_rect(absolute_rect(
        run.x, run.y, run.width, run.height, offset_x, offset_y,
    ))?;
    let mut value = base_hit_map_entry(block_index, line_index, run_index, bounds, "");
    insert_optional_string(&mut value, "href", run.href.as_deref());
    insert_optional_string(&mut value, "imageSrc", run.image_src.as_deref());
    insert_optional_string(&mut value, "imageAlt", run.alt.as_deref());
    Some(Value::Object(value))
}

fn hit_map_image_entry(
    image: &RuntimeImage,
    offset_x: f64,
    offset_y: f64,
    block_index: usize,
    visual: VisualGeometry,
) -> Option<Value> {
    let bounds = visual.resolve_rect(absolute_rect(
        image.x,
        image.y,
        image.width,
        image.height,
        offset_x,
        offset_y,
    ))?;
    let mut value = base_hit_map_entry(block_index, 0, 0, bounds, "");
    insert_optional_string(&mut value, "href", image.href.as_deref());
    insert_optional_string(&mut value, "imageSrc", Some(&image.src));
    insert_optional_string(&mut value, "imageAlt", image.alt.as_deref());
    Some(Value::Object(value))
}

fn base_hit_map_entry(
    block_index: usize,
    line_index: usize,
    run_index: usize,
    bounds: VisualRect,
    text: &str,
) -> Map<String, Value> {
    let mut value = Map::new();
    value.insert(
        "blockIndex".to_owned(),
        Value::Number(Number::from(block_index)),
    );
    value.insert(
        "bounds".to_owned(),
        rect_value(bounds.x, bounds.y, bounds.width, bounds.height),
    );
    value.insert(
        "lineIndex".to_owned(),
        Value::Number(Number::from(line_index)),
    );
    value.insert(
        "runIndex".to_owned(),
        Value::Number(Number::from(run_index)),
    );
    value.insert(
        "text".to_owned(),
        json!({
            "hash": hash_text(text),
            "length": utf16_len(text),
        }),
    );
    value
}

fn total_hit_map_counts(details: &[HitMapFlowPageDetail]) -> HitMapFlowCounts {
    let mut totals = HitMapFlowCounts::default();
    for detail in details {
        totals.entries += detail.counts.entries;
        totals.text_entries += detail.counts.text_entries;
        totals.image_entries += detail.counts.image_entries;
        totals.link_entries += detail.counts.link_entries;
        totals.source_refs += detail.counts.source_refs;
    }
    totals
}

fn count_hit_map_entries(entries: &[Value]) -> HitMapFlowCounts {
    let mut counts = HitMapFlowCounts::default();
    for entry in entries {
        counts.entries += 1;
        if hit_map_entry_text_len(entry) > 0 {
            counts.text_entries += 1;
        }
        if entry.get("imageSrc").is_some() {
            counts.image_entries += 1;
        }
        if entry.get("href").is_some() {
            counts.link_entries += 1;
        }
        if entry.get("sourcePath").is_some() {
            counts.source_refs += 1;
        }
    }
    counts
}

fn hit_map_entry_text_len(entry: &Value) -> usize {
    entry
        .get("text")
        .and_then(|text| text.get("length"))
        .and_then(Value::as_u64)
        .map(|length| length as usize)
        .unwrap_or(0)
}

fn absolute_rect(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    offset_x: f64,
    offset_y: f64,
) -> VisualRect {
    VisualRect::new(offset_x + x, offset_y + y, width, height)
}

fn insert_optional_string(output: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), Value::String(value.to_owned()));
    }
}

fn insert_optional_path(output: &mut Map<String, Value>, key: &str, value: Option<&Vec<usize>>) {
    if let Some(value) = value {
        output.insert(
            key.to_owned(),
            Value::Array(
                value
                    .iter()
                    .map(|part| Value::Number(Number::from(*part)))
                    .collect(),
            ),
        );
    }
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::summarize_hit_map_flow;
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild, RuntimeImage},
        hit_map::HitMapFlowCounts,
        line::{LineBox, LineRun, TextRunBox},
        page::RuntimePage,
    };

    #[test]
    fn summarizes_text_link_source_and_image_entries() {
        let page = RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 10.0,
                y: 20.0,
                width: 300.0,
                height: 100.0,
                semantic_tag: None,
                anchor_id: None,
                paint: Some(json!({ "visualOffset": { "dx": 5, "dy": -2 } })),
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![
                    RuntimeChild::Line(LineBox {
                        x: 1.0,
                        y: 2.0,
                        width: 200.0,
                        height: 20.0,
                        runs: vec![LineRun::Text(TextRunBox {
                            text: "Hello".to_owned(),
                            x: 3.0,
                            y: 4.0,
                            width: 40.0,
                            height: 12.0,
                            font_size: 12.0,
                            paint: json!({}),
                            line_height_px: None,
                            href: Some("#target".to_owned()),
                            source_path: Some(vec![0, 1]),
                            source_text: Some("Hello".to_owned()),
                            source_text_offset: Some(0),
                            inline_margin_right: None,
                            ruby_annotation: None,
                        })],
                    }),
                    RuntimeChild::Image(RuntimeImage {
                        x: 5.0,
                        y: 40.0,
                        width: 80.0,
                        height: 60.0,
                        src: "Images/a.png".to_owned(),
                        alt: Some("a".to_owned()),
                        href: None,
                    }),
                ],
            }],
        };

        let summary = summarize_hit_map_flow(&[page], vec![0]);

        assert_eq!(
            summary.totals,
            HitMapFlowCounts {
                entries: 2,
                text_entries: 1,
                image_entries: 1,
                link_entries: 1,
                source_refs: 1,
            }
        );
        assert_eq!(summary.samples.len(), 1);
        assert_eq!(summary.samples[0]["entries"][0]["bounds"]["x"], json!(19));
        assert_eq!(summary.samples[0]["entries"][0]["bounds"]["y"], json!(24));
        assert_eq!(summary.samples[0]["entries"][1]["bounds"]["x"], json!(20));
        assert_eq!(summary.samples[0]["entries"][1]["bounds"]["y"], json!(58));
    }
}
