use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun},
    page::RuntimePage,
    summary_json::{hash_json, hash_text},
};

type SearchPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFlowSummary {
    pub query_count: usize,
    pub result_count: usize,
    pub queries: Vec<SearchFlowQuerySummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFlowQuerySummary {
    pub id: String,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub result_count: usize,
    pub page_indexes: Vec<usize>,
    pub context_hash: String,
    pub range_hash: String,
    pub samples: Vec<Value>,
    pub detail_hash: String,
}

#[derive(Debug, Clone, Copy)]
struct SearchFlowQuerySpec<'a> {
    id: &'a str,
    query: &'a str,
    case_sensitive: bool,
    whole_word: bool,
}

#[derive(Debug, Clone)]
struct SearchPageText {
    page_index: usize,
    text: String,
    offsets: Vec<SearchRunOffset>,
}

#[derive(Debug, Clone, Copy)]
struct SearchRunOffset {
    start: usize,
    end: usize,
    block_index: usize,
    line_index: usize,
    run_index: usize,
}

#[derive(Debug, Clone, Copy)]
struct SearchOffsetState {
    offset: usize,
    has_text: bool,
}

#[derive(Debug, Clone)]
struct FoldedSearchText {
    text: String,
    byte_to_original_utf16: Vec<(usize, usize)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTextPosition {
    pub block_index: usize,
    pub line_index: usize,
    pub run_index: usize,
    pub char_index: usize,
}

#[derive(Debug, Clone)]
struct SearchResultDetail {
    page_index: usize,
    start: SearchTextPosition,
    end: SearchTextPosition,
    context: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRuntimeResult {
    pub page_index: usize,
    pub start: SearchTextPosition,
    pub end: SearchTextPosition,
    pub context: String,
}

const SEARCH_FLOW_QUERY_SPECS: &[SearchFlowQuerySpec<'static>] = &[
    SearchFlowQuerySpec {
        id: "heroine-name",
        query: "八奈见",
        case_sensitive: false,
        whole_word: false,
    },
    SearchFlowQuerySpec {
        id: "protagonist-name",
        query: "温水",
        case_sensitive: false,
        whole_word: false,
    },
    SearchFlowQuerySpec {
        id: "reader-name",
        query: "EbookReader",
        case_sensitive: true,
        whole_word: false,
    },
    SearchFlowQuerySpec {
        id: "missing-ascii",
        query: "RITO_NATIVE_NO_MATCH",
        case_sensitive: false,
        whole_word: false,
    },
];

pub(crate) fn summarize_search_flow(pages: &[SearchPage]) -> SearchFlowSummary {
    let index = pages.iter().map(search_page_text).collect::<Vec<_>>();
    let queries = SEARCH_FLOW_QUERY_SPECS
        .iter()
        .map(|spec| summarize_search_query(&index, spec))
        .collect::<Vec<_>>();
    SearchFlowSummary {
        query_count: queries.len(),
        result_count: queries.iter().map(|query| query.result_count).sum(),
        full_detail_hash: hash_json(
            &serde_json::to_value(&queries).expect("search flow summaries serialize"),
        ),
        queries,
    }
}

pub(crate) fn search_runtime_pages(
    pages: &[SearchPage],
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    limit: Option<usize>,
) -> Vec<SearchRuntimeResult> {
    let spec = SearchFlowQuerySpec {
        id: "runtime",
        query,
        case_sensitive,
        whole_word,
    };
    let index = pages.iter().map(search_page_text).collect::<Vec<_>>();
    let results = search_index(&index, &spec)
        .into_iter()
        .map(SearchRuntimeResult::from_detail);
    match limit {
        Some(limit) => results.take(limit).collect(),
        None => results.collect(),
    }
}

fn summarize_search_query(
    index: &[SearchPageText],
    spec: &SearchFlowQuerySpec<'_>,
) -> SearchFlowQuerySummary {
    let results = search_index(index, spec)
        .iter()
        .map(search_result_value)
        .collect::<Vec<_>>();
    let page_indexes = results
        .iter()
        .filter_map(|result| result.get("pageIndex").and_then(Value::as_u64))
        .map(|index| (index as usize, ()))
        .collect::<BTreeMap<_, _>>()
        .into_keys()
        .collect::<Vec<_>>();
    let contexts = results
        .iter()
        .filter_map(|result| result.get("context").cloned())
        .collect::<Vec<_>>();
    let ranges = results
        .iter()
        .map(search_result_range_value)
        .collect::<Vec<_>>();

    SearchFlowQuerySummary {
        id: spec.id.to_owned(),
        query: spec.query.to_owned(),
        case_sensitive: spec.case_sensitive,
        whole_word: spec.whole_word,
        result_count: results.len(),
        page_indexes,
        context_hash: hash_json(&Value::Array(contexts)),
        range_hash: hash_json(&Value::Array(ranges)),
        samples: results.iter().take(6).cloned().collect(),
        detail_hash: hash_json(&Value::Array(results)),
    }
}

fn search_index(
    index: &[SearchPageText],
    spec: &SearchFlowQuerySpec<'_>,
) -> Vec<SearchResultDetail> {
    if spec.query.is_empty() {
        return Vec::new();
    }
    index
        .iter()
        .flat_map(|page| search_page(page, spec))
        .collect()
}

impl SearchRuntimeResult {
    fn from_detail(detail: SearchResultDetail) -> Self {
        Self {
            page_index: detail.page_index,
            start: detail.start,
            end: detail.end,
            context: detail.context,
        }
    }
}

fn search_page(page: &SearchPageText, spec: &SearchFlowQuerySpec<'_>) -> Vec<SearchResultDetail> {
    let haystack = fold_search_text(&page.text, spec.case_sensitive);
    let needle = fold_query_text(spec.query, spec.case_sensitive);
    let mut results = Vec::new();
    let mut pos = 0usize;

    while pos <= haystack.text.len().saturating_sub(needle.len()) {
        let Some(relative_index) = haystack.text[pos..].find(&needle) else {
            break;
        };
        let byte_index = pos + relative_index;
        let end_byte = byte_index + needle.len();
        if spec.whole_word && !is_search_word_boundary(&haystack.text, byte_index, end_byte) {
            pos = next_search_byte(&haystack.text, byte_index);
            continue;
        }

        let start_offset = folded_byte_to_original_utf16(&haystack, byte_index);
        let end_offset = folded_byte_to_original_utf16(&haystack, end_byte);
        if let (Some(start), Some(end)) = (
            search_offset_to_position(&page.offsets, start_offset, SearchBias::Start),
            search_offset_to_position(&page.offsets, end_offset, SearchBias::End),
        ) {
            results.push(SearchResultDetail {
                page_index: page.page_index,
                start,
                end,
                context: extract_search_context(&page.text, start_offset, end_offset),
            });
        }
        pos = end_byte;
    }

    results
}

fn fold_search_text(text: &str, case_sensitive: bool) -> FoldedSearchText {
    let mut folded = String::new();
    let mut byte_to_original_utf16 = Vec::new();
    let mut original_offset = 0usize;

    for character in text.chars() {
        let chars = if case_sensitive {
            character.to_string()
        } else {
            character.to_lowercase().collect::<String>()
        };
        for folded_character in chars.chars() {
            byte_to_original_utf16.push((folded.len(), original_offset));
            folded.push(folded_character);
        }
        original_offset += character.len_utf16();
    }
    byte_to_original_utf16.push((folded.len(), original_offset));

    FoldedSearchText {
        text: folded,
        byte_to_original_utf16,
    }
}

fn fold_query_text(text: &str, case_sensitive: bool) -> String {
    if case_sensitive {
        text.to_owned()
    } else {
        text.to_lowercase()
    }
}

fn folded_byte_to_original_utf16(haystack: &FoldedSearchText, byte_index: usize) -> usize {
    haystack
        .byte_to_original_utf16
        .iter()
        .rev()
        .find(|(entry_byte, _)| *entry_byte <= byte_index)
        .map(|(_, offset)| *offset)
        .unwrap_or(0)
}

fn search_page_text(page: &SearchPage) -> SearchPageText {
    let mut text = String::new();
    let mut offsets = Vec::new();
    let mut state = SearchOffsetState {
        offset: 0,
        has_text: false,
    };
    for (block_index, block) in page.content.iter().enumerate() {
        let mut line_index = 0usize;
        collect_search_text_offsets(
            block,
            block_index,
            &mut line_index,
            &mut state,
            &mut offsets,
            &mut text,
        );
    }
    SearchPageText {
        page_index: page.index,
        text,
        offsets,
    }
}

fn collect_search_text_offsets(
    block: &RuntimeBlock<LineBox>,
    block_index: usize,
    line_index: &mut usize,
    state: &mut SearchOffsetState,
    offsets: &mut Vec<SearchRunOffset>,
    text: &mut String,
) {
    for child in &block.children {
        match child {
            RuntimeChild::Line(line) => {
                collect_search_line_offsets(line, block_index, *line_index, state, offsets, text);
                *line_index += 1;
            }
            RuntimeChild::Block(block) => {
                collect_search_text_offsets(block, block_index, line_index, state, offsets, text);
            }
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_search_line_offsets(
    line: &LineBox,
    block_index: usize,
    line_index: usize,
    state: &mut SearchOffsetState,
    offsets: &mut Vec<SearchRunOffset>,
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
            offsets.push(SearchRunOffset {
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

#[derive(Debug, Clone, Copy)]
enum SearchBias {
    Start,
    End,
}

fn search_offset_to_position(
    offsets: &[SearchRunOffset],
    offset: usize,
    bias: SearchBias,
) -> Option<SearchTextPosition> {
    for entry in offsets {
        let in_entry = match bias {
            SearchBias::Start => offset >= entry.start && offset < entry.end,
            SearchBias::End => offset > entry.start && offset <= entry.end,
        };
        if in_entry {
            return Some(SearchTextPosition {
                block_index: entry.block_index,
                line_index: entry.line_index,
                run_index: entry.run_index,
                char_index: offset - entry.start,
            });
        }
    }
    if matches!(bias, SearchBias::End) && offset == 0 {
        return offsets.first().map(|first| SearchTextPosition {
            block_index: first.block_index,
            line_index: first.line_index,
            run_index: first.run_index,
            char_index: 0,
        });
    }
    None
}

fn is_search_word_boundary(text: &str, start: usize, end: usize) -> bool {
    let before = previous_char(text, start).unwrap_or(' ');
    let after = text[end..].chars().next().unwrap_or(' ');
    !is_search_word_char(before) && !is_search_word_char(after)
}

fn previous_char(text: &str, byte_index: usize) -> Option<char> {
    text[..byte_index].chars().next_back()
}

fn is_search_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn next_search_byte(text: &str, byte_index: usize) -> usize {
    text[byte_index..]
        .chars()
        .next()
        .map(|ch| byte_index + ch.len_utf8())
        .unwrap_or(text.len())
}

const SEARCH_CONTEXT_CHARS: usize = 30;

fn extract_search_context(text: &str, match_start: usize, match_end: usize) -> String {
    let text_len = utf16_len(text);
    let start = match_start.saturating_sub(SEARCH_CONTEXT_CHARS);
    let end = (match_end + SEARCH_CONTEXT_CHARS).min(text_len);
    let mut context = String::new();
    if start > 0 {
        context.push_str("...");
    }
    context.push_str(&utf16_slice(text, start, end));
    if end < text_len {
        context.push_str("...");
    }
    context
}

fn utf16_slice(text: &str, start: usize, end: usize) -> String {
    let start_byte = byte_index_for_utf16_offset(text, start);
    let end_byte = byte_index_for_utf16_offset(text, end);
    text[start_byte..end_byte].to_owned()
}

fn byte_index_for_utf16_offset(text: &str, target: usize) -> usize {
    if target == 0 {
        return 0;
    }
    let mut offset = 0usize;
    for (byte_index, ch) in text.char_indices() {
        if offset >= target {
            return byte_index;
        }
        offset += ch.len_utf16();
    }
    text.len()
}

fn search_result_value(result: &SearchResultDetail) -> Value {
    json!({
        "pageIndex": result.page_index,
        "range": {
            "start": search_text_position_value(result.start),
            "end": search_text_position_value(result.end),
        },
        "context": {
            "length": utf16_len(&result.context),
            "hash": hash_text(&result.context),
        },
    })
}

fn search_result_range_value(result: &Value) -> Value {
    json!({
        "pageIndex": result.get("pageIndex").cloned().unwrap_or(Value::Null),
        "range": result.get("range").cloned().unwrap_or(Value::Null),
    })
}

fn search_text_position_value(position: SearchTextPosition) -> Value {
    json!({
        "blockIndex": position.block_index,
        "lineIndex": position.line_index,
        "runIndex": position.run_index,
        "charIndex": position.char_index,
    })
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        search_page, summarize_search_flow, SearchFlowQuerySpec, SearchPageText, SearchRunOffset,
        SearchTextPosition,
    };
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild},
        line::{LineBox, LineRun, TextRunBox},
        page::RuntimePage,
    };

    #[test]
    fn fixed_flow_queries_search_typed_page_text() {
        let page = page_with_text("温水 and EbookReader");

        let summary = summarize_search_flow(&[page]);

        assert_eq!(summary.query_count, 4);
        assert_eq!(
            summary
                .queries
                .iter()
                .find(|query| query.id == "protagonist-name")
                .map(|query| query.result_count),
            Some(1)
        );
        assert_eq!(
            summary
                .queries
                .iter()
                .find(|query| query.id == "reader-name")
                .map(|query| query.result_count),
            Some(1)
        );
    }

    #[test]
    fn case_insensitive_search_maps_folded_offsets_to_original_text() {
        let page = SearchPageText {
            page_index: 0,
            text: "\u{130}xY".to_owned(),
            offsets: vec![SearchRunOffset {
                start: 0,
                end: 4,
                block_index: 2,
                line_index: 3,
                run_index: 4,
            }],
        };
        let spec = SearchFlowQuerySpec {
            id: "folding",
            query: "xy",
            case_sensitive: false,
            whole_word: false,
        };

        let results = search_page(&page, &spec);

        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].start,
            SearchTextPosition {
                block_index: 2,
                line_index: 3,
                run_index: 4,
                char_index: 1,
            }
        );
        assert_eq!(
            results[0].end,
            SearchTextPosition {
                block_index: 2,
                line_index: 3,
                run_index: 4,
                char_index: 3,
            }
        );
    }

    fn page_with_text(text: &str) -> RuntimePage<RuntimeBlock<LineBox>> {
        RuntimePage {
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
                    runs: vec![LineRun::Text(TextRunBox {
                        text: text.to_owned(),
                        x: 0.0,
                        y: 0.0,
                        width: 160.0,
                        height: 12.0,
                        font_size: 12.0,
                        paint: json!({}),
                        line_height_px: None,
                        href: None,
                        source_path: None,
                        source_text: None,
                        source_text_offset: None,
                        inline_margin_right: None,
                        ruby_annotation: None,
                        shape: crate::layout::text_shape::fixture_run_shape(160.0),
                    })],
                })],
            }],
        }
    }
}
