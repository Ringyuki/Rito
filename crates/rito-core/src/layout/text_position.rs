use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun},
    page::RuntimePage,
    summary_json::{hash_json, hash_text},
};

type TextPositionPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPositionFlowSummary {
    pub page_count: usize,
    pub totals: TextPositionFlowTotals,
    pub page_digests: Vec<TextPositionFlowPageDigest>,
    pub samples: Vec<Value>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPositionFlowTotals {
    pub text_length: usize,
    pub run_offsets: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPositionFlowPageDigest {
    pub index: usize,
    pub text_length: usize,
    pub text_hash: String,
    pub offset_count: usize,
    pub offset_hash: String,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTextPositionPage {
    pub page_index: usize,
    pub text: String,
    pub text_length: usize,
    pub text_hash: String,
    pub offsets: Vec<TextRunOffset>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRunOffset {
    pub start: usize,
    pub end: usize,
    pub block_index: usize,
    pub line_index: usize,
    pub run_index: usize,
}

pub(crate) fn summarize_text_position_flow(
    pages: &[TextPositionPage],
    sample_indices: Vec<usize>,
) -> TextPositionFlowSummary {
    let details = pages
        .iter()
        .map(build_text_position_page)
        .collect::<Vec<_>>();
    let values = details
        .iter()
        .map(text_position_page_value)
        .collect::<Vec<_>>();
    let page_digests = details
        .iter()
        .zip(values.iter())
        .map(|(detail, value)| TextPositionFlowPageDigest {
            index: detail.page_index,
            text_length: detail.text_length,
            text_hash: detail.text_hash.clone(),
            offset_count: detail.offsets.len(),
            offset_hash: hash_json(&Value::Array(
                detail.offsets.iter().map(text_run_offset_value).collect(),
            )),
            detail_hash: hash_json(value),
        })
        .collect::<Vec<_>>();
    let samples = sample_indices
        .into_iter()
        .map(|index| values[index].clone())
        .collect::<Vec<_>>();

    TextPositionFlowSummary {
        page_count: details.len(),
        totals: total_text_position_counts(&details),
        page_digests,
        samples,
        full_detail_hash: hash_json(&Value::Array(values)),
    }
}

pub(crate) fn build_text_position_page(page: &TextPositionPage) -> RuntimeTextPositionPage {
    let mut text = String::new();
    let mut offsets = Vec::new();
    let mut state = TextPositionOffsetState {
        offset: 0,
        has_text: false,
    };
    for (block_index, block) in page.content.iter().enumerate() {
        let mut line_index = 0usize;
        collect_text_position_offsets(
            block,
            block_index,
            &mut line_index,
            &mut state,
            &mut offsets,
            &mut text,
        );
    }
    let text_length = utf16_len(&text);
    let text_hash = hash_text(&text);

    RuntimeTextPositionPage {
        page_index: page.index,
        text,
        text_length,
        text_hash,
        offsets,
    }
}

#[derive(Debug, Clone, Copy)]
struct TextPositionOffsetState {
    offset: usize,
    has_text: bool,
}

fn collect_text_position_offsets(
    block: &RuntimeBlock<LineBox>,
    block_index: usize,
    line_index: &mut usize,
    state: &mut TextPositionOffsetState,
    offsets: &mut Vec<TextRunOffset>,
    text: &mut String,
) {
    for child in &block.children {
        match child {
            RuntimeChild::Line(line) => {
                collect_text_position_line_offsets(
                    line,
                    block_index,
                    *line_index,
                    state,
                    offsets,
                    text,
                );
                *line_index += 1;
            }
            RuntimeChild::Block(block) => {
                collect_text_position_offsets(block, block_index, line_index, state, offsets, text);
            }
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_text_position_line_offsets(
    line: &LineBox,
    block_index: usize,
    line_index: usize,
    state: &mut TextPositionOffsetState,
    offsets: &mut Vec<TextRunOffset>,
    text: &mut String,
) {
    let has_line_text = line.runs.iter().any(|run| matches!(run, LineRun::Text(_)));
    if has_line_text && state.has_text {
        text.push('\n');
        state.offset += 1;
    }
    for (run_index, run) in line.runs.iter().enumerate() {
        if let LineRun::Text(run) = run {
            let length = utf16_len(&run.text);
            offsets.push(TextRunOffset {
                start: state.offset,
                end: state.offset + length,
                block_index,
                line_index,
                run_index,
            });
            text.push_str(&run.text);
            state.offset += length;
            state.has_text = true;
        }
    }
}

fn text_position_page_value(page: &RuntimeTextPositionPage) -> Value {
    json!({
        "index": page.page_index,
        "text": {
            "length": page.text_length,
            "hash": page.text_hash,
        },
        "offsets": page.offsets.iter().map(text_run_offset_value).collect::<Vec<_>>(),
    })
}

fn text_run_offset_value(offset: &TextRunOffset) -> Value {
    json!({
        "start": offset.start,
        "end": offset.end,
        "blockIndex": offset.block_index,
        "lineIndex": offset.line_index,
        "runIndex": offset.run_index,
    })
}

fn total_text_position_counts(details: &[RuntimeTextPositionPage]) -> TextPositionFlowTotals {
    let mut totals = TextPositionFlowTotals::default();
    for detail in details {
        totals.text_length += detail.text_length;
        totals.run_offsets += detail.offsets.len();
    }
    totals
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{summarize_text_position_flow, TextPositionFlowTotals};
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild},
        line::{LineBox, LineRun, TextRunBox},
        page::RuntimePage,
    };

    #[test]
    fn summarizes_utf16_text_offsets_from_typed_page_content() {
        let page = RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 20.0,
                semantic_tag: None,
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![RuntimeChild::Line(LineBox {
                    x: 0.0,
                    y: 0.0,
                    width: 300.0,
                    height: 20.0,
                    runs: vec![
                        LineRun::Text(text_run("A")),
                        LineRun::Text(text_run("\u{1f600}B")),
                    ],
                })],
            }],
        };

        let summary = summarize_text_position_flow(&[page], vec![0]);

        assert_eq!(
            summary.totals,
            TextPositionFlowTotals {
                text_length: 4,
                run_offsets: 2,
            }
        );
        assert_eq!(summary.samples[0]["offsets"][1]["start"], json!(1));
        assert_eq!(summary.samples[0]["offsets"][1]["end"], json!(4));
    }

    fn text_run(text: &str) -> TextRunBox {
        TextRunBox {
            text: text.to_owned(),
            text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 12.0,
            font_size: 12.0,
            interaction_geometry: None,
            paint: json!({}),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
            shape: crate::layout::text_shape::fixture_run_shape(10.0),
        }
    }
}
