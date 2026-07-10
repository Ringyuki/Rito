use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::pagination_flow::PaginationFlowSummary;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSummary {
    pub inline_segments: InlineSegmentSummary,
    pub line_break_inputs: LineBreakInputSummary,
    pub line_boxes: LineBoxSummary,
    pub continuous_blocks: ContinuousBlockSummary,
    pub pagination_flow: PaginationFlowSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineSegmentSummary {
    pub chapter_count: usize,
    pub total_block_count: usize,
    pub total_segment_count: usize,
    pub total_atom_count: usize,
    pub chapters: Vec<InlineSegmentChapterSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineSegmentChapterSummary {
    pub idref: String,
    pub href: String,
    pub block_count: usize,
    pub segment_count: usize,
    pub atom_count: usize,
    pub text_hash: String,
    pub blocks: Vec<InlineSegmentBlockSummary>,
    pub samples: Vec<InlineSegmentBlockSample>,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineSegmentBlockSummary {
    pub path: Option<Vec<usize>>,
    pub tag: Option<String>,
    pub segment_count: usize,
    pub atom_count: usize,
    pub ruby_count: usize,
    pub text_length: usize,
    pub text_hash: String,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineSegmentBlockSample {
    pub path: Option<Vec<usize>>,
    pub tag: Option<String>,
    pub segment_count: usize,
    pub atom_count: usize,
    pub ruby_count: usize,
    pub text_length: usize,
    pub text_hash: String,
    pub detail_hash: String,
    pub segments: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineBreakInputSummary {
    pub chapter_count: usize,
    pub total_block_count: usize,
    pub total_range_count: usize,
    pub total_atom_count: usize,
    pub chapters: Vec<LineBreakInputChapterSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineBreakInputChapterSummary {
    pub idref: String,
    pub href: String,
    pub block_count: usize,
    pub range_count: usize,
    pub atom_count: usize,
    pub full_text_hash: String,
    pub blocks: Vec<LineBreakInputBlockSummary>,
    pub samples: Vec<LineBreakInputBlockSample>,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineBreakInputBlockSummary {
    pub path: Option<Vec<usize>>,
    pub tag: Option<String>,
    pub full_text_hash: String,
    pub full_text_length: usize,
    pub range_count: usize,
    pub atom_count: usize,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineBreakInputBlockSample {
    pub path: Option<Vec<usize>>,
    pub tag: Option<String>,
    pub full_text_hash: String,
    pub full_text_length: usize,
    pub range_count: usize,
    pub atom_count: usize,
    pub detail_hash: String,
    pub input: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineBoxSummary {
    pub chapter_count: usize,
    pub total_block_count: usize,
    pub total_line_count: usize,
    pub total_run_count: usize,
    pub total_atom_count: usize,
    pub total_ruby_count: usize,
    pub chapters: Vec<LineBoxChapterSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineBoxChapterSummary {
    pub idref: String,
    pub href: String,
    pub block_count: usize,
    pub line_count: usize,
    pub run_count: usize,
    pub atom_count: usize,
    pub ruby_count: usize,
    pub text_hash: String,
    pub blocks: Vec<LineBoxBlockSummary>,
    pub samples: Vec<LineBoxBlockSample>,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineBoxBlockSummary {
    pub path: Option<Vec<usize>>,
    pub tag: Option<String>,
    pub line_count: usize,
    pub run_count: usize,
    pub atom_count: usize,
    pub ruby_count: usize,
    pub text_hash: String,
    pub total_height: Value,
    pub max_used_width: Value,
    pub detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineBoxBlockSample {
    pub path: Option<Vec<usize>>,
    pub tag: Option<String>,
    pub line_count: usize,
    pub run_count: usize,
    pub atom_count: usize,
    pub ruby_count: usize,
    pub text_hash: String,
    pub total_height: Value,
    pub max_used_width: Value,
    pub detail_hash: String,
    pub lines: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousBlockSummary {
    pub chapter_count: usize,
    pub total_top_level_block_count: usize,
    pub total_line_count: usize,
    pub total_text_run_count: usize,
    pub total_image_count: usize,
    pub total_hr_count: usize,
    pub chapters: Vec<ContinuousBlockChapterSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuousBlockChapterSummary {
    pub idref: String,
    pub href: String,
    pub top_level_block_count: usize,
    pub line_count: usize,
    pub text_run_count: usize,
    pub image_count: usize,
    pub hr_count: usize,
    pub text_hash: String,
    pub max_block_bottom: Value,
    pub blocks: Vec<Value>,
    pub samples: Vec<Value>,
    pub detail_hash: String,
}
