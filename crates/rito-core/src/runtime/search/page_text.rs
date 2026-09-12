use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy)]
struct SearchQuerySpec<'a> {
    query: &'a str,
    case_sensitive: bool,
    whole_word: bool,
}

/// One page's searchable text with its run table, in page-text UTF-16
/// offsets, as the fragment backend serves it.
#[derive(Debug, Clone)]
pub(crate) struct SearchPageText {
    page_index: usize,
    text: String,
    offsets: Vec<SearchRunOffset>,
}

impl SearchPageText {
    pub(crate) fn from_parts(
        page_index: usize,
        text: String,
        runs: Vec<SearchPrebuiltRun>,
    ) -> Self {
        Self {
            page_index,
            text,
            offsets: runs
                .into_iter()
                .map(|run| SearchRunOffset {
                    start: run.start,
                    end: run.end,
                    block_index: run.block_index,
                    line_index: run.line_index,
                    run_index: run.run_index,
                    source: run.source,
                })
                .collect(),
        }
    }
}

/// One text run of a search page, in page-text UTF-16 offsets.
#[derive(Debug, Clone)]
pub(crate) struct SearchPrebuiltRun {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) block_index: usize,
    pub(crate) line_index: usize,
    pub(crate) run_index: usize,
    /// The run's source identity, when its builder retained one — a hit
    /// without it still finds text but cannot anchor a durable locator.
    pub(crate) source: Option<SearchPrebuiltRunSource>,
}

/// Source mapping of a run: the source node path and the run's
/// piecewise-linear text mapping, `(run_start, source_start, len)` in
/// run-local UTF-16 (the fragment artifact's own record).
#[derive(Debug, Clone)]
pub(crate) struct SearchPrebuiltRunSource {
    pub(crate) node_path: Vec<usize>,
    pub(crate) segments: Vec<(u32, u32, u32)>,
}

impl SearchPrebuiltRunSource {
    /// The source offset for a run-local caret offset. Offsets inside a
    /// collapsed gap snap to the nearest following stretch (or the end
    /// of the last one) — the same seam rule the artifact's own mapping
    /// uses.
    fn source_offset(&self, run_offset: u32) -> Option<u32> {
        for (run_start, source_start, len) in &self.segments {
            if run_offset < *run_start {
                return Some(*source_start);
            }
            if run_offset <= run_start + len {
                return Some(source_start + (run_offset - run_start));
            }
        }
        self.segments
            .last()
            .map(|(_, source_start, len)| source_start + len)
    }
}

#[derive(Debug, Clone)]
struct SearchRunOffset {
    start: usize,
    end: usize,
    block_index: usize,
    line_index: usize,
    run_index: usize,
    source: Option<SearchPrebuiltRunSource>,
}

#[derive(Debug, Clone)]
struct FoldedSearchText {
    text: String,
    source_spans: Vec<FoldedSourceSpan>,
}

#[derive(Debug, Clone, Copy)]
struct FoldedSourceSpan {
    folded_start: usize,
    folded_end: usize,
    original_start: usize,
    original_end: usize,
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
    selected_text: String,
    context: String,
    source_range: Option<SearchSourceRange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRuntimeResult {
    pub page_index: usize,
    pub start: SearchTextPosition,
    pub end: SearchTextPosition,
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SearchRuntimeMatch {
    pub(crate) result: SearchRuntimeResult,
    pub(crate) selected_text: String,
    pub(crate) source_range: Option<SearchSourceRange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SearchSourceRange {
    pub(crate) start: SearchSourcePoint,
    pub(crate) end: SearchSourcePoint,
    /// The slice of the match this range actually anchors, as page-text
    /// offsets. It equals the whole match unless generated content
    /// (list markers, `::before`, a `text-transform` rewrite) sits
    /// inside it and has no source to point at; then it is the longest
    /// stretch that does, so a hit straddling generated and real text
    /// still lands somewhere durable instead of losing its anchor.
    pub(crate) covered_start: usize,
    pub(crate) covered_end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SearchSourcePoint {
    pub(crate) node_path: Vec<usize>,
    pub(crate) text_offset: usize,
}

pub(crate) fn search_prebuilt_runtime_pages(
    index: &[SearchPageText],
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    limit: Option<usize>,
) -> Vec<SearchRuntimeMatch> {
    let spec = SearchQuerySpec {
        query,
        case_sensitive,
        whole_word,
    };
    let results = search_index(index, &spec)
        .into_iter()
        .map(SearchRuntimeMatch::from_detail);
    match limit {
        Some(limit) => results.take(limit).collect(),
        None => results.collect(),
    }
}

fn search_index(index: &[SearchPageText], spec: &SearchQuerySpec<'_>) -> Vec<SearchResultDetail> {
    if spec.query.is_empty() {
        return Vec::new();
    }
    index
        .iter()
        .flat_map(|page| search_page(page, spec))
        .collect()
}

impl SearchRuntimeMatch {
    fn from_detail(detail: SearchResultDetail) -> Self {
        Self {
            result: SearchRuntimeResult {
                page_index: detail.page_index,
                start: detail.start,
                end: detail.end,
                context: detail.context,
            },
            selected_text: detail.selected_text,
            source_range: detail.source_range,
        }
    }
}

fn search_page(page: &SearchPageText, spec: &SearchQuerySpec<'_>) -> Vec<SearchResultDetail> {
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

        let start_offset = folded_byte_to_original_utf16(&haystack, byte_index, SearchBias::Start);
        let end_offset = folded_byte_to_original_utf16(&haystack, end_byte, SearchBias::End);
        if let (Some(start), Some(end)) = (
            search_offset_to_position(&page.offsets, start_offset, SearchBias::Start),
            search_offset_to_position(&page.offsets, end_offset, SearchBias::End),
        ) {
            let source_range = search_source_range(&page.offsets, start_offset, end_offset);
            // The source range is verified against the text it claims
            // to cover, which is the whole match unless generated
            // content forced it to shrink. Verifying a shrunken range
            // against the full match would fail and throw the anchor
            // away, which is exactly the outcome the shrinking exists
            // to avoid.
            let (covered_start, covered_end) = source_range
                .as_ref()
                .map_or((start_offset, end_offset), |range| {
                    (range.covered_start, range.covered_end)
                });
            results.push(SearchResultDetail {
                page_index: page.page_index,
                start,
                end,
                selected_text: utf16_slice(&page.text, covered_start, covered_end),
                context: extract_search_context(&page.text, start_offset, end_offset),
                source_range,
            });
        }
        pos = end_byte;
    }

    results
}

fn fold_search_text(text: &str, case_sensitive: bool) -> FoldedSearchText {
    let mut folded = String::new();
    let mut source_spans = Vec::new();
    let mut original_offset = 0usize;

    for character in text.chars() {
        let folded_start = folded.len();
        let original_start = original_offset;
        let chars = if case_sensitive {
            character.to_string()
        } else {
            character.to_lowercase().collect::<String>()
        };
        folded.push_str(&chars);
        original_offset += character.len_utf16();
        source_spans.push(FoldedSourceSpan {
            folded_start,
            folded_end: folded.len(),
            original_start,
            original_end: original_offset,
        });
    }

    FoldedSearchText {
        text: folded,
        source_spans,
    }
}

fn fold_query_text(text: &str, case_sensitive: bool) -> String {
    if case_sensitive {
        text.to_owned()
    } else {
        text.to_lowercase()
    }
}

fn folded_byte_to_original_utf16(
    haystack: &FoldedSearchText,
    byte_index: usize,
    bias: SearchBias,
) -> usize {
    for span in &haystack.source_spans {
        if byte_index <= span.folded_start {
            return span.original_start;
        }
        if byte_index < span.folded_end {
            return match bias {
                SearchBias::Start => span.original_start,
                SearchBias::End => span.original_end,
            };
        }
        if byte_index == span.folded_end {
            return span.original_end;
        }
    }
    haystack
        .source_spans
        .last()
        .map(|span| span.original_end)
        .unwrap_or(0)
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
            let char_index = offset - entry.start;
            return Some(SearchTextPosition {
                block_index: entry.block_index,
                line_index: entry.line_index,
                run_index: entry.run_index,
                char_index,
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

fn search_source_range(
    offsets: &[SearchRunOffset],
    start: usize,
    end: usize,
) -> Option<SearchSourceRange> {
    // Walk the match, collecting the runs that carry source identity
    // into contiguous segments. A run without a source or a gap ends
    // the current segment rather than discarding the match: the longest
    // surviving segment is a weaker anchor than the whole range, but it
    // beats none at all.
    let mut segments: Vec<SearchSourceRange> = Vec::new();
    let mut current: Option<SearchSourceRange> = None;
    let mut cursor = start;

    let close = |current: &mut Option<SearchSourceRange>, segments: &mut Vec<SearchSourceRange>| {
        if let Some(segment) = current.take() {
            segments.push(segment);
        }
    };

    for entry in offsets
        .iter()
        .filter(|entry| entry.end > start && entry.start < end)
    {
        let part_start = start.max(entry.start);
        let part_end = end.min(entry.end);
        if part_start != cursor {
            close(&mut current, &mut segments);
        }
        cursor = part_end;
        let Some(source) = entry.source.as_ref() else {
            close(&mut current, &mut segments);
            continue;
        };
        // A run maps its own text to source offsets directly. Consecutive
        // runs of the same source node with contiguous offsets extend one
        // segment — a match that font fallback split across two runs must
        // keep its full anchor, not shrink to the longest run's slice.
        let head = u32::try_from(part_start - entry.start)
            .ok()
            .and_then(|offset| source.source_offset(offset));
        let tail = u32::try_from(part_end - entry.start)
            .ok()
            .and_then(|offset| source.source_offset(offset));
        let (Some(head), Some(tail)) = (head, tail) else {
            close(&mut current, &mut segments);
            continue;
        };
        let continues = current.as_ref().is_some_and(|segment| {
            segment.end.node_path == source.node_path
                && segment.end.text_offset == head as usize
                && segment.covered_end == part_start
        });
        let tail_point = SearchSourcePoint {
            node_path: source.node_path.clone(),
            text_offset: tail as usize,
        };
        if continues {
            let segment = current.as_mut().expect("continuity checked");
            segment.end = tail_point;
            segment.covered_end = part_end;
        } else {
            close(&mut current, &mut segments);
            current = Some(SearchSourceRange {
                start: SearchSourcePoint {
                    node_path: source.node_path.clone(),
                    text_offset: head as usize,
                },
                end: tail_point,
                covered_start: part_start,
                covered_end: part_end,
            });
        }
    }
    close(&mut current, &mut segments);

    segments
        .into_iter()
        .max_by_key(|segment| segment.covered_end - segment.covered_start)
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

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests;
