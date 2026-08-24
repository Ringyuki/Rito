use serde_json::{json, Value};

use super::{
    image_size::ImageSizeIndex,
    inline_content::{flatten_inline_content, normalize_inline_segment},
    inline_segment::{InlineSegment, SegmentContext},
    line::LineBox,
    line_break::utf16_len,
    line_break_input::build_line_break_input,
    line_mode::layout_lines_with_fonts,
    summary_json::{hash_json, hash_text, number_value},
    summary_types::{
        ContinuousBlockChapterSummary, InlineSegmentBlockSample, InlineSegmentBlockSummary,
        InlineSegmentChapterSummary, LineBoxBlockSample, LineBoxBlockSummary,
        LineBoxChapterSummary, LineBreakInputBlockSample, LineBreakInputBlockSummary,
        LineBreakInputChapterSummary,
    },
    text_measure::TextMeasurementFonts,
};
use crate::{
    layout::LineBreaking,
    style::{StyledNode, StyledNodeKind},
};

#[derive(Debug, Clone)]
pub(crate) struct InlineSegmentBlockDetail {
    pub(crate) segment_count: usize,
    pub(crate) atom_count: usize,
    pub(crate) line_break: LineBreakInputBlockDetail,
    pub(crate) line_boxes: LineBoxBlockDetail,
    pub(crate) text: String,
    path: Option<Vec<usize>>,
    tag: Option<String>,
    ruby_count: usize,
    text_length: usize,
    text_hash: String,
    detail_hash: String,
    segments: Vec<Value>,
}

impl InlineSegmentBlockDetail {
    pub(crate) fn summary(&self) -> InlineSegmentBlockSummary {
        InlineSegmentBlockSummary {
            path: self.path.clone(),
            tag: self.tag.clone(),
            segment_count: self.segment_count,
            atom_count: self.atom_count,
            ruby_count: self.ruby_count,
            text_length: self.text_length,
            text_hash: self.text_hash.clone(),
            detail_hash: self.detail_hash.clone(),
        }
    }

    pub(crate) fn sample(&self) -> InlineSegmentBlockSample {
        InlineSegmentBlockSample {
            path: self.path.clone(),
            tag: self.tag.clone(),
            segment_count: self.segment_count,
            atom_count: self.atom_count,
            ruby_count: self.ruby_count,
            text_length: self.text_length,
            text_hash: self.text_hash.clone(),
            detail_hash: self.detail_hash.clone(),
            segments: self.segments.clone(),
        }
    }
}

pub(crate) fn collect_block_details(
    nodes: &[StyledNode],
    image_sizes: &ImageSizeIndex,
    max_width: f64,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> Vec<InlineSegmentBlockDetail> {
    let mut output = Vec::new();
    collect_node_block_details(
        nodes,
        &mut output,
        image_sizes,
        max_width,
        line_breaking,
        fonts,
    );
    output
}

fn collect_node_block_details(
    nodes: &[StyledNode],
    output: &mut Vec<InlineSegmentBlockDetail>,
    image_sizes: &ImageSizeIndex,
    max_width: f64,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) {
    for node in nodes {
        if node.node_type == StyledNodeKind::Block {
            let segments = flatten_inline_content(
                &node.children,
                SegmentContext {
                    image_sizes: Some(image_sizes),
                    href: node.href.clone(),
                    ..SegmentContext::default()
                },
            );
            if !segments.is_empty() {
                output.push(block_detail(
                    node,
                    &segments,
                    max_width,
                    line_breaking,
                    fonts,
                ));
            }
        }
        collect_node_block_details(
            &node.children,
            output,
            image_sizes,
            max_width,
            line_breaking,
            fonts,
        );
    }
}

fn block_detail(
    node: &StyledNode,
    segments: &[InlineSegment],
    max_width: f64,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> InlineSegmentBlockDetail {
    let normalized = segments
        .iter()
        .map(normalize_inline_segment)
        .collect::<Vec<_>>();
    let text = segments
        .iter()
        .filter_map(InlineSegment::text_content)
        .collect::<String>();
    let detail_hash = hash_json(&Value::Array(normalized.clone()));

    InlineSegmentBlockDetail {
        path: node
            .source_ref
            .as_ref()
            .map(|source| source.node_path.clone()),
        tag: node.tag.clone(),
        segment_count: segments.len(),
        atom_count: segments.iter().filter(|segment| segment.is_atom()).count(),
        ruby_count: segments
            .iter()
            .filter(|segment| segment.ruby_annotation().is_some())
            .count(),
        text_length: utf16_len(&text),
        text_hash: hash_text(&text),
        detail_hash,
        segments: normalized,
        line_break: line_break_input_block_detail(node, segments),
        line_boxes: line_box_block_detail(node, segments, max_width, line_breaking, fonts),
        text,
    }
}

#[derive(Debug, Clone)]
pub(crate) struct LineBreakInputBlockDetail {
    pub(crate) range_count: usize,
    pub(crate) atom_count: usize,
    pub(crate) full_text: String,
    path: Option<Vec<usize>>,
    tag: Option<String>,
    full_text_hash: String,
    full_text_length: usize,
    detail_hash: String,
    input: Value,
}

impl LineBreakInputBlockDetail {
    pub(crate) fn summary(&self) -> LineBreakInputBlockSummary {
        LineBreakInputBlockSummary {
            path: self.path.clone(),
            tag: self.tag.clone(),
            full_text_hash: self.full_text_hash.clone(),
            full_text_length: self.full_text_length,
            range_count: self.range_count,
            atom_count: self.atom_count,
            detail_hash: self.detail_hash.clone(),
        }
    }

    pub(crate) fn sample(&self) -> LineBreakInputBlockSample {
        LineBreakInputBlockSample {
            path: self.path.clone(),
            tag: self.tag.clone(),
            full_text_hash: self.full_text_hash.clone(),
            full_text_length: self.full_text_length,
            range_count: self.range_count,
            atom_count: self.atom_count,
            detail_hash: self.detail_hash.clone(),
            input: self.input.clone(),
        }
    }
}

fn line_break_input_block_detail(
    node: &StyledNode,
    segments: &[InlineSegment],
) -> LineBreakInputBlockDetail {
    let input = build_line_break_input(segments);
    let full_text_hash = hash_text(&input.full_text);
    let full_text_length = utf16_len(&input.full_text);
    let range_count = input.ranges.len();
    let atom_count = input.atoms.len();
    let full_text_value = json!({
        "hash": full_text_hash.clone(),
        "length": full_text_length,
    });
    let detail = json!({
        "atoms": input.atoms,
        "fullText": full_text_value,
        "ranges": input.ranges,
    });

    LineBreakInputBlockDetail {
        path: node
            .source_ref
            .as_ref()
            .map(|source| source.node_path.clone()),
        tag: node.tag.clone(),
        full_text_hash,
        full_text_length,
        range_count,
        atom_count,
        detail_hash: hash_json(&detail),
        input: detail,
        full_text: input.full_text,
    }
}

#[derive(Debug, Clone)]
pub(crate) struct LineBoxBlockDetail {
    pub(crate) line_count: usize,
    pub(crate) run_count: usize,
    pub(crate) atom_count: usize,
    pub(crate) ruby_count: usize,
    pub(crate) text: String,
    path: Option<Vec<usize>>,
    tag: Option<String>,
    text_hash: String,
    total_height: Value,
    max_used_width: Value,
    detail_hash: String,
    lines: Vec<Value>,
}

impl LineBoxBlockDetail {
    pub(crate) fn summary(&self) -> LineBoxBlockSummary {
        LineBoxBlockSummary {
            path: self.path.clone(),
            tag: self.tag.clone(),
            line_count: self.line_count,
            run_count: self.run_count,
            atom_count: self.atom_count,
            ruby_count: self.ruby_count,
            text_hash: self.text_hash.clone(),
            total_height: self.total_height.clone(),
            max_used_width: self.max_used_width.clone(),
            detail_hash: self.detail_hash.clone(),
        }
    }

    pub(crate) fn sample(&self) -> LineBoxBlockSample {
        LineBoxBlockSample {
            path: self.path.clone(),
            tag: self.tag.clone(),
            line_count: self.line_count,
            run_count: self.run_count,
            atom_count: self.atom_count,
            ruby_count: self.ruby_count,
            text_hash: self.text_hash.clone(),
            total_height: self.total_height.clone(),
            max_used_width: self.max_used_width.clone(),
            detail_hash: self.detail_hash.clone(),
            lines: self.lines.clone(),
        }
    }
}

fn line_box_block_detail(
    node: &StyledNode,
    segments: &[InlineSegment],
    max_width: f64,
    line_breaking: LineBreaking,
    fonts: &TextMeasurementFonts<'_>,
) -> LineBoxBlockDetail {
    let lines = layout_lines_with_fonts(segments, max_width, line_breaking, fonts);
    let normalized = lines
        .iter()
        .map(|line| line.normalized())
        .collect::<Vec<_>>();
    let text = lines.iter().map(LineBox::text).collect::<String>();
    let run_count = lines.iter().map(LineBox::text_run_count).sum();
    let atom_count = lines.iter().map(LineBox::atom_count).sum();
    let ruby_count = lines.iter().map(LineBox::ruby_count).sum();
    let total_height = lines.iter().map(|line| line.height).sum::<f64>();
    let max_used_width = lines
        .iter()
        .map(LineBox::used_width)
        .fold(0.0_f64, f64::max);

    let detail = LineBoxBlockDetail {
        path: node
            .source_ref
            .as_ref()
            .map(|source| source.node_path.clone()),
        tag: node.tag.clone(),
        line_count: lines.len(),
        run_count,
        atom_count,
        ruby_count,
        text_hash: hash_text(&text),
        total_height: number_value(total_height),
        max_used_width: number_value(max_used_width),
        detail_hash: hash_json(&Value::Array(normalized.clone())),
        lines: normalized,
        text,
    };
    detail
}

pub(crate) fn inline_segments_full_detail_hash(chapters: &[InlineSegmentChapterSummary]) -> String {
    chapter_detail_hash(chapters.iter().map(|chapter| {
        (
            chapter.idref.as_str(),
            chapter.href.as_str(),
            chapter.detail_hash.as_str(),
        )
    }))
}

pub(crate) fn line_break_inputs_full_detail_hash(
    chapters: &[LineBreakInputChapterSummary],
) -> String {
    chapter_detail_hash(chapters.iter().map(|chapter| {
        (
            chapter.idref.as_str(),
            chapter.href.as_str(),
            chapter.detail_hash.as_str(),
        )
    }))
}

pub(crate) fn line_boxes_full_detail_hash(chapters: &[LineBoxChapterSummary]) -> String {
    chapter_detail_hash(chapters.iter().map(|chapter| {
        (
            chapter.idref.as_str(),
            chapter.href.as_str(),
            chapter.detail_hash.as_str(),
        )
    }))
}

pub(crate) fn continuous_blocks_full_detail_hash(
    chapters: &[ContinuousBlockChapterSummary],
) -> String {
    chapter_detail_hash(chapters.iter().map(|chapter| {
        (
            chapter.idref.as_str(),
            chapter.href.as_str(),
            chapter.detail_hash.as_str(),
        )
    }))
}

fn chapter_detail_hash<'a>(
    chapters: impl IntoIterator<Item = (&'a str, &'a str, &'a str)>,
) -> String {
    hash_json(&Value::Array(
        chapters
            .into_iter()
            .map(|(idref, href, detail_hash)| {
                json!({
                    "detailHash": detail_hash,
                    "href": href,
                    "idref": idref,
                })
            })
            .collect(),
    ))
}
