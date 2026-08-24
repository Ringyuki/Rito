//! Page artifact backed by the fragment engine's laid-out page tree.
//!
//! This is the interaction surface of the fragment backend: text positions
//! and range geometry come straight from the engine's fragments (the same
//! geometry the paint commands carry), so selection overlays sit exactly on
//! the painted glyph runs instead of drifting against a parallel layout.
//! The text model mirrors the retained artifact: page text is every line's
//! runs concatenated with a newline between text-bearing lines, offsets are
//! UTF-16, and (block, line, run) indexes address the page's own structure.

use rito_fragment::{FormattingNodeContent, Fragment, InlineItem};
use sha2::{Digest, Sha256};

use crate::fragment_bridge::ChapterFormattingTree;

/// Page-text hash in the shared artifact format: the first eight bytes of
/// the SHA-256 digest, lowercase hex (the same shape the retained backend
/// produces, so cross-backend consistency checks compare like for like).
fn hash_page_text(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

use super::{
    PageArtifact, PageArtifactMetadata, PageArtifactRect, PageArtifactSemanticNode,
    PageArtifactSemanticRole, PageArtifactTarget, PageArtifactTargets, PageArtifactTextPosition,
    PageArtifactTextPositions, PageArtifactTextRangeGeometry, PageArtifactTextRangeRect,
    PageArtifactTextRunOffset,
};

use crate::fragment_bridge::FlowItemSource;

/// One text run's geometry and text, pre-resolved from the fragment tree.
#[derive(Debug, Clone)]
pub(in crate::runtime) struct FragmentRunRecord {
    pub(in crate::runtime) block_index: usize,
    pub(in crate::runtime) line_index: usize,
    pub(in crate::runtime) run_index: usize,
    /// UTF-16 offset range in the page text.
    pub(in crate::runtime) start: usize,
    pub(in crate::runtime) end: usize,
    /// Absolute page-content coordinates.
    pub(in crate::runtime) x: f64,
    pub(in crate::runtime) y: f64,
    pub(in crate::runtime) width: f64,
    pub(in crate::runtime) height: f64,
    /// Destination of the enclosing link, when the run sits inside one.
    pub(in crate::runtime) href: Option<String>,
    /// Source-locator mapping for the run, when its item has one.
    pub(in crate::runtime) source: Option<RunSourceMap>,
}

/// A run's piecewise-linear mapping back to its source node's text.
#[derive(Debug, Clone)]
pub(in crate::runtime) struct RunSourceMap {
    /// Source-tree node path, the durable locator coordinate.
    pub(in crate::runtime) path: Vec<usize>,
    /// `(run_start, source_start, len)`, all UTF-16 and run-local.
    pub(in crate::runtime) segments: Vec<(u32, u32, u32)>,
}

impl RunSourceMap {
    /// The source offset for a run-local caret offset. Offsets inside a
    /// collapsed gap snap to the nearest following stretch (or the end
    /// of the last one).
    pub(in crate::runtime) fn source_offset(&self, run_offset: u32) -> Option<u32> {
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

    /// The run-local offset for a source offset, when a stretch covers it.
    pub(in crate::runtime) fn run_offset(&self, source_offset: u32) -> Option<u32> {
        for (run_start, source_start, len) in &self.segments {
            if source_offset >= *source_start && source_offset <= source_start + len {
                return Some(run_start + (source_offset - source_start));
            }
        }
        None
    }

    /// The run-local offset when a stretch covers the source offset
    /// STRICTLY inside (an offset on a stretch's end seam is a collapsed
    /// gap or another run's start, not this run's character).
    pub(in crate::runtime) fn run_offset_strict(&self, source_offset: u32) -> Option<u32> {
        for (run_start, source_start, len) in &self.segments {
            if source_offset >= *source_start && source_offset < source_start + len {
                return Some(run_start + (source_offset - source_start));
            }
        }
        None
    }

    /// The first mapped run offset at or after the source offset, with
    /// its stretch's source start — the forward snap for a caret inside
    /// a collapsed gap (a space the flow kept but the map skipped).
    pub(in crate::runtime) fn run_offset_at_or_after(
        &self,
        source_offset: u32,
    ) -> Option<(u32, u32)> {
        self.segments
            .iter()
            .filter(|(_, source_start, _)| *source_start >= source_offset)
            .min_by_key(|(_, source_start, _)| *source_start)
            .map(|(run_start, source_start, _)| (*run_start, *source_start))
    }
}

/// Query-ready interaction data for one fragment-engine page.
#[derive(Debug, Clone)]
pub(in crate::runtime) struct FragmentPageArtifact {
    page_index: usize,
    width: f64,
    height: f64,
    text: String,
    text_length: usize,
    text_hash: String,
    runs: Vec<FragmentRunRecord>,
    images: Vec<FragmentImageRecord>,
    links: Vec<FragmentLinkRecord>,
    semantics: Vec<FragmentSemanticRecord>,
}

/// A block-level link's whole border box on this page: the browser makes
/// the entire `<a>`-wrapped block clickable, padding included, so the
/// hit area is the box rect — not just the text runs inside it.
#[derive(Debug, Clone)]
struct FragmentLinkRecord {
    block_index: usize,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    href: String,
}

/// One laid-out image on the page, with its interaction provenance.
#[derive(Debug, Clone)]
struct FragmentImageRecord {
    block_index: usize,
    line_index: usize,
    run_index: usize,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    src: String,
    alt: Option<String>,
    href: Option<String>,
}

/// One block-level box with a known source tag, in page coordinates.
#[derive(Debug, Clone)]
struct FragmentSemanticRecord {
    tag: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    text: String,
}

impl FragmentPageArtifact {
    /// A textless page for backend-storage tests that only need shape.
    #[cfg(test)]
    pub(in crate::runtime) fn empty_for_tests(page_index: usize, width: f64, height: f64) -> Self {
        Self {
            page_index,
            width,
            height,
            text: String::new(),
            text_length: 0,
            text_hash: hash_page_text(""),
            runs: Vec::new(),
            images: Vec::new(),
            links: Vec::new(),
            semantics: Vec::new(),
        }
    }

    /// The page's text runs, for interaction resolvers.
    pub(in crate::runtime) fn interaction_runs(&self) -> &[FragmentRunRecord] {
        &self.runs
    }

    /// The page's concatenated flow text (UTF-16 offsets index into it).
    pub(in crate::runtime) fn page_text(&self) -> &str {
        &self.text
    }

    /// Builds the artifact from one page's root fragment. `origin_x` and
    /// `origin_y` translate fragment coordinates into page coordinates
    /// (the page's content origin, exactly as the paint producer does).
    pub(in crate::runtime) fn build(
        page_index: usize,
        width: f64,
        height: f64,
        root: &Fragment,
        chapter: &ChapterFormattingTree,
        origin_x: f64,
        origin_y: f64,
    ) -> Self {
        let mut builder = ArtifactBuilder {
            chapter,
            text: String::new(),
            offset: 0,
            has_text: false,
            runs: Vec::new(),
            images: Vec::new(),
            links: Vec::new(),
            semantics: Vec::new(),
        };
        let Fragment::Box(page_root) = root else {
            return Self::empty(page_index, width, height);
        };
        for (block_index, child) in page_root.children.iter().enumerate() {
            let mut line_index = 0usize;
            builder.collect(
                child,
                block_index,
                &mut line_index,
                origin_x + page_root.rect.x,
                origin_y + page_root.rect.y,
            );
        }
        let text_length = builder.offset;
        let text_hash = hash_page_text(&builder.text);
        Self {
            page_index,
            width,
            height,
            text: builder.text,
            text_length,
            text_hash,
            runs: builder.runs,
            images: builder.images,
            links: builder.links,
            semantics: builder.semantics,
        }
    }

    fn empty(page_index: usize, width: f64, height: f64) -> Self {
        Self {
            page_index,
            width,
            height,
            text: String::new(),
            text_length: 0,
            text_hash: hash_page_text(""),
            runs: Vec::new(),
            images: Vec::new(),
            links: Vec::new(),
            semantics: Vec::new(),
        }
    }
}

struct ArtifactBuilder<'a> {
    chapter: &'a ChapterFormattingTree,
    text: String,
    /// UTF-16 running offset.
    offset: usize,
    has_text: bool,
    runs: Vec<FragmentRunRecord>,
    images: Vec<FragmentImageRecord>,
    links: Vec<FragmentLinkRecord>,
    semantics: Vec<FragmentSemanticRecord>,
}

impl ArtifactBuilder<'_> {
    fn collect(
        &mut self,
        fragment: &Fragment,
        block_index: usize,
        line_index: &mut usize,
        origin_x: f64,
        origin_y: f64,
    ) {
        match fragment {
            Fragment::Box(inner) => {
                if let Some(href) = self.chapter.node_links.get(&inner.source.0) {
                    self.links.push(FragmentLinkRecord {
                        block_index,
                        x: origin_x + inner.rect.x,
                        y: origin_y + inner.rect.y,
                        width: inner.rect.width,
                        height: inner.rect.height,
                        href: href.clone(),
                    });
                }
                if let Some(tag) = self.chapter.node_tags.get(&inner.source.0) {
                    self.semantics.push(FragmentSemanticRecord {
                        tag: tag.clone(),
                        x: origin_x + inner.rect.x,
                        y: origin_y + inner.rect.y,
                        width: inner.rect.width,
                        height: inner.rect.height,
                        text: fragment_subtree_text(&self.chapter.tree, fragment),
                    });
                }
                for child in &inner.children {
                    self.collect(
                        child,
                        block_index,
                        line_index,
                        origin_x + inner.rect.x,
                        origin_y + inner.rect.y,
                    );
                }
            }
            Fragment::Line(line) => {
                let FormattingNodeContent::InlineFlow { items } =
                    &self.chapter.tree.node(line.source).content
                else {
                    return;
                };
                // Text fragments address the flow's concatenated text-item
                // bytes; rebuild the ranges to attribute each run to the
                // item (and so to the link/source) that produced it.
                let mut flow_text = String::new();
                let mut item_ranges: Vec<(std::ops::Range<usize>, usize)> = Vec::new();
                for (item_index, item) in items.iter().enumerate() {
                    if let InlineItem::Text { text, .. } = item {
                        let start = flow_text.len();
                        flow_text.push_str(text);
                        item_ranges.push((start..flow_text.len(), item_index));
                    }
                }
                let sources = self.chapter.flow_item_sources.get(&line.source.0);
                let item_source = |item_index: usize| -> Option<&FlowItemSource> {
                    sources.and_then(|sources| sources.get(item_index))
                };
                let line_x = origin_x + line.rect.x;
                let line_y = origin_y + line.rect.y;
                let has_line_text = line
                    .children
                    .iter()
                    .any(|child| matches!(child, Fragment::Text(_)));
                if has_line_text && self.has_text {
                    self.text.push('\n');
                    self.offset += 1;
                }
                for (run_index, child) in line.children.iter().enumerate() {
                    match child {
                        Fragment::Text(run) => {
                            let Some(run_text) =
                                flow_text.get(run.text_start as usize..run.text_end as usize)
                            else {
                                continue;
                            };
                            let owner = item_ranges
                                .iter()
                                .find(|(range, _)| range.contains(&(run.text_start as usize)))
                                .map(|(_, item_index)| *item_index);
                            let owner_range = owner.and_then(|item_index| {
                                item_ranges
                                    .iter()
                                    .find(|(_, index)| *index == item_index)
                                    .map(|(range, _)| range.clone())
                            });
                            let href = owner
                                .and_then(item_source)
                                .and_then(|source| source.href.clone());
                            let source = owner.and_then(item_source).and_then(|item| {
                                let path = item.source_path.clone()?;
                                let range = owner_range.clone()?;
                                let prefix = flow_text
                                    .get(range.start..run.text_start as usize)?
                                    .encode_utf16()
                                    .count() as u32;
                                let run_len = run_text.encode_utf16().count() as u32;
                                let segments = item
                                    .segments
                                    .iter()
                                    .filter_map(|segment| {
                                        let lo = segment.item_start.max(prefix);
                                        let hi = (segment.item_start + segment.len)
                                            .min(prefix + run_len);
                                        (hi > lo).then(|| {
                                            (
                                                lo - prefix,
                                                segment.source_start + (lo - segment.item_start),
                                                hi - lo,
                                            )
                                        })
                                    })
                                    .collect::<Vec<_>>();
                                Some(RunSourceMap { path, segments })
                            });
                            let length = run_text.encode_utf16().count();
                            self.runs.push(FragmentRunRecord {
                                block_index,
                                line_index: *line_index,
                                run_index,
                                start: self.offset,
                                end: self.offset + length,
                                x: line_x + run.rect.x,
                                y: line_y,
                                width: run.rect.width,
                                height: line.rect.height,
                                href,
                                source,
                            });
                            self.text.push_str(run_text);
                            self.offset += length;
                            self.has_text = true;
                        }
                        Fragment::Image(image) => {
                            let InlineItem::Image { src, .. } = &items[image.item_index as usize]
                            else {
                                continue;
                            };
                            let source = item_source(image.item_index as usize);
                            self.images.push(FragmentImageRecord {
                                block_index,
                                line_index: *line_index,
                                run_index,
                                x: line_x + image.rect.x,
                                y: line_y + image.rect.y,
                                width: image.rect.width,
                                height: image.rect.height,
                                src: src.clone(),
                                alt: source.and_then(|source| source.image_alt.clone()),
                                href: source.and_then(|source| source.href.clone()),
                            });
                        }
                        Fragment::Box(_) => {
                            // An inline-block atom riding the line: its
                            // mini paragraph serializes like any nested
                            // box, in the line's coordinates.
                            self.collect(child, block_index, line_index, line_x, line_y);
                        }
                        _ => {}
                    }
                }
                *line_index += 1;
            }
            Fragment::Text(_) | Fragment::Image(_) => {}
        }
    }
}

impl PageArtifact for FragmentPageArtifact {
    fn metadata(&self) -> PageArtifactMetadata {
        PageArtifactMetadata {
            page_index: self.page_index,
            width: self.width,
            height: self.height,
        }
    }

    fn semantic_nodes(&self) -> Vec<PageArtifactSemanticNode> {
        self.semantics
            .iter()
            .map(|record| {
                let (role, level) = semantic_role(&record.tag);
                PageArtifactSemanticNode {
                    role,
                    level,
                    text: (!record.text.is_empty()).then(|| record.text.clone()),
                    alt: None,
                    href: None,
                    bounds: PageArtifactRect {
                        x: record.x,
                        y: record.y,
                        width: record.width,
                        height: record.height,
                    },
                    children: Vec::new(),
                }
            })
            .collect()
    }

    fn targets(&self) -> PageArtifactTargets {
        // Entry order and hashing mirror the retained backend: text runs
        // in flow order (their concatenation is the hash input), then
        // page images.
        let mut text = String::new();
        let mut entries = Vec::new();
        for run in &self.runs {
            let run_text = page_text_slice(&self.text, run.start, run.end);
            text.push_str(&run_text);
            entries.push(PageArtifactTarget {
                block_index: run.block_index,
                line_index: run.line_index,
                run_index: run.run_index,
                bounds: PageArtifactRect {
                    x: run.x,
                    y: run.y,
                    width: run.width,
                    height: run.height,
                },
                text_hash: hash_page_text(&run_text),
                text_length: run.end - run.start,
                text: run_text,
                href: run.href.clone(),
                source_path: None,
                source_text_offset: None,
                image_src: None,
                image_alt: None,
            });
        }
        for link in &self.links {
            entries.push(PageArtifactTarget {
                block_index: link.block_index,
                line_index: 0,
                run_index: 0,
                bounds: PageArtifactRect {
                    x: link.x,
                    y: link.y,
                    width: link.width,
                    height: link.height,
                },
                text: String::new(),
                text_hash: hash_page_text(""),
                text_length: 0,
                href: Some(link.href.clone()),
                source_path: None,
                source_text_offset: None,
                image_src: None,
                image_alt: None,
            });
        }
        for image in &self.images {
            entries.push(PageArtifactTarget {
                block_index: image.block_index,
                line_index: image.line_index,
                run_index: image.run_index,
                bounds: PageArtifactRect {
                    x: image.x,
                    y: image.y,
                    width: image.width,
                    height: image.height,
                },
                text: String::new(),
                text_hash: hash_page_text(""),
                text_length: 0,
                href: image.href.clone(),
                source_path: None,
                source_text_offset: None,
                image_src: Some(image.src.clone()),
                image_alt: image.alt.clone(),
            });
        }
        PageArtifactTargets {
            entries,
            text_hash: hash_page_text(&text),
        }
    }

    fn text_positions(&self) -> PageArtifactTextPositions {
        PageArtifactTextPositions {
            text: self.text.clone(),
            text_length: self.text_length,
            text_hash: self.text_hash.clone(),
            offsets: self
                .runs
                .iter()
                .map(|run| PageArtifactTextRunOffset {
                    start: run.start,
                    end: run.end,
                    block_index: run.block_index,
                    line_index: run.line_index,
                    run_index: run.run_index,
                })
                .collect(),
        }
    }

    fn text_range_geometry(
        &self,
        start: PageArtifactTextPosition,
        end: PageArtifactTextPosition,
    ) -> PageArtifactTextRangeGeometry {
        let start_key = position_key(&start);
        let end_key = position_key(&end);
        if end_key < start_key {
            return PageArtifactTextRangeGeometry { rects: Vec::new() };
        }
        let mut rects: Vec<PageArtifactTextRangeRect> = Vec::new();
        for run in &self.runs {
            let run_key = (run.block_index, run.line_index, run.run_index);
            if run_key < (start.block_index, start.line_index, start.run_index)
                || run_key > (end.block_index, end.line_index, end.run_index)
            {
                continue;
            }
            let run_chars = run.end - run.start;
            let from_char = if run_key == (start.block_index, start.line_index, start.run_index) {
                start.char_index.min(run_chars)
            } else {
                0
            };
            let to_char = if run_key == (end.block_index, end.line_index, end.run_index) {
                end.char_index.min(run_chars)
            } else {
                run_chars
            };
            if to_char <= from_char {
                continue;
            }
            // Character-interior endpoints interpolate linearly across the
            // run's advance until per-cluster metrics are retained; exact
            // for the run-aligned endpoints selection snapping produces.
            let per_char = if run_chars > 0 {
                run.width / run_chars as f64
            } else {
                0.0
            };
            rects.push(PageArtifactTextRangeRect {
                x: run.x + per_char * from_char as f64,
                y: run.y,
                width: per_char * (to_char - from_char) as f64,
                height: run.height,
                block_index: run.block_index,
                line_index: run.line_index,
                run_index: run.run_index,
                start_char_index: from_char,
                end_char_index: to_char,
            });
        }
        PageArtifactTextRangeGeometry { rects }
    }
}

fn position_key(position: &PageArtifactTextPosition) -> (usize, usize, usize, usize) {
    (
        position.block_index,
        position.line_index,
        position.run_index,
        position.char_index,
    )
}

/// UTF-16 offset range back to a string slice of the page text.
fn page_text_slice(text: &str, start: usize, end: usize) -> String {
    text.encode_utf16()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect::<Vec<u16>>()
        .pipe(|units| String::from_utf16_lossy(&units))
}

trait Pipe: Sized {
    fn pipe<T>(self, apply: impl FnOnce(Self) -> T) -> T {
        apply(self)
    }
}
impl<T: Sized> Pipe for T {}

/// Text content of one fragment subtree, lines joined by spaces — the
/// heading/paragraph text a semantic outline shows.
fn fragment_subtree_text(tree: &rito_fragment::FormattingTree, fragment: &Fragment) -> String {
    fn walk(tree: &rito_fragment::FormattingTree, fragment: &Fragment, out: &mut String) {
        match fragment {
            Fragment::Box(inner) => {
                for child in &inner.children {
                    walk(tree, child, out);
                }
            }
            Fragment::Line(line) => {
                let FormattingNodeContent::InlineFlow { items } = &tree.node(line.source).content
                else {
                    return;
                };
                let flow_text: String = items
                    .iter()
                    .filter_map(|item| match item {
                        InlineItem::Text { text, .. } => Some(text.as_str()),
                        InlineItem::Image { .. }
                        | InlineItem::InlineBlock { .. }
                        | InlineItem::EmptyBox { .. } => None,
                    })
                    .collect();
                for child in &line.children {
                    if let Fragment::Text(run) = child {
                        if let Some(run_text) =
                            flow_text.get(run.text_start as usize..run.text_end as usize)
                        {
                            if !out.is_empty() && !out.ends_with(' ') {
                                out.push(' ');
                            }
                            out.push_str(run_text);
                        }
                    }
                }
            }
            Fragment::Text(_) | Fragment::Image(_) => {}
        }
    }
    let mut out = String::new();
    walk(tree, fragment, &mut out);
    out.trim().to_owned()
}

/// Source tag to the artifact's semantic role.
fn semantic_role(tag: &str) -> (PageArtifactSemanticRole, Option<u8>) {
    match tag {
        "h1" => (PageArtifactSemanticRole::Heading, Some(1)),
        "h2" => (PageArtifactSemanticRole::Heading, Some(2)),
        "h3" => (PageArtifactSemanticRole::Heading, Some(3)),
        "h4" => (PageArtifactSemanticRole::Heading, Some(4)),
        "h5" => (PageArtifactSemanticRole::Heading, Some(5)),
        "h6" => (PageArtifactSemanticRole::Heading, Some(6)),
        "p" => (PageArtifactSemanticRole::Paragraph, None),
        "ul" | "ol" => (PageArtifactSemanticRole::List, None),
        "li" => (PageArtifactSemanticRole::ListItem, None),
        "blockquote" => (PageArtifactSemanticRole::Blockquote, None),
        "table" => (PageArtifactSemanticRole::Table, None),
        _ => (PageArtifactSemanticRole::Generic, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use rito_block::BlockFormattingContext;
    use rito_fragment::{
        CancelFlag, ConstraintSpace, FormattingContext, FormattingNode, FormattingNodeId,
        FormattingTree, FormattingTreeStyles,
    };
    use rito_inline::{plain_paragraph_style, ParleyInlineContext};
    use rito_style_contract::{
        FontFamilies, FontFamily, FontFamilyName, InlineStyleTableV1, LayoutStyleTableV1,
    };
    use std::collections::BTreeMap;

    fn tinos_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
        );
        std::fs::read(path).expect("pinned Tinos test font reads")
    }

    fn chapter(text: &str) -> ChapterFormattingTree {
        let mut inline = InlineStyleTableV1::new(1);
        let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
            .expect("family list");
        let style = inline
            .intern_for_node(0, plain_paragraph_style(families, 16.0, 0.0))
            .expect("style interns");
        let mut layout = LayoutStyleTableV1::new(1);
        let block = layout
            .intern_for_node(0, crate::fragment_bridge::tests_block_style())
            .expect("layout style interns");
        let nodes = vec![
            FormattingNode {
                style: block,
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(1)],
            },
            FormattingNode {
                style: block,
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            },
        ];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        ChapterFormattingTree {
            tree,
            image_border_paints: BTreeMap::new(),
            source_nodes: vec![None, None],
            node_paints: BTreeMap::new(),
            page_background: None,
            page_background_image: None,
            flow_item_sources: BTreeMap::new(),
            node_anchors: BTreeMap::new(),
            node_links: BTreeMap::new(),
            source_anchors: BTreeMap::new(),
            node_tags: BTreeMap::new(),
            list_markers: BTreeMap::new(),
            degradations: Vec::new(),
        }
    }

    #[test]
    fn page_text_and_range_geometry_come_from_the_fragments() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let engine = BlockFormattingContext::new(context);
        let built = chapter("The quick brown fox jumps over the lazy dog again and again.");
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &ConstraintSpace::continuous(160.0),
                None,
                &CancelFlag::new(),
            )
            .expect("chapter lays out");
        let artifact = FragmentPageArtifact::build(
            3,
            200.0,
            300.0,
            &outcome.fragments.root,
            &built,
            24.0,
            32.0,
        );

        assert_eq!(artifact.metadata().page_index, 3);
        let positions = artifact.text_positions();
        // Line splits insert newlines (trailing spaces hang on their
        // line); the words themselves survive intact.
        assert_eq!(
            positions
                .text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" "),
            "The quick brown fox jumps over the lazy dog again and again."
        );
        assert!(positions.offsets.len() >= 2, "narrow layout wraps lines");
        for pair in positions.offsets.windows(2) {
            assert!(pair[0].end <= pair[1].start, "offsets are monotonic");
        }
        assert_eq!(positions.text_length, positions.text.encode_utf16().count());

        // Full-page selection covers every run, one rect per run, inside
        // the page content box.
        let last = positions.offsets.last().expect("runs exist");
        let geometry = artifact.text_range_geometry(
            PageArtifactTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: 0,
                char_index: 0,
            },
            PageArtifactTextPosition {
                block_index: last.block_index,
                line_index: last.line_index,
                run_index: last.run_index,
                char_index: last.end - last.start,
            },
        );
        assert_eq!(geometry.rects.len(), positions.offsets.len());
        for rect in &geometry.rects {
            assert!(rect.x >= 24.0 - 1e-6, "rects sit at the page origin");
            assert!(rect.y >= 32.0 - 1e-6);
            assert!(rect.width > 0.0);
            assert!(rect.height > 0.0);
        }
        // A mid-run selection interpolates inside the run's advance.
        let first = &positions.offsets[0];
        let chars = first.end - first.start;
        let partial = artifact.text_range_geometry(
            PageArtifactTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: first.run_index,
                char_index: 1,
            },
            PageArtifactTextPosition {
                block_index: 0,
                line_index: 0,
                run_index: first.run_index,
                char_index: chars - 1,
            },
        );
        assert_eq!(partial.rects.len(), 1);
        assert!(partial.rects[0].x > geometry.rects[0].x);
        assert!(partial.rects[0].width < geometry.rects[0].width);
    }
}
