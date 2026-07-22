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
    PageArtifact, PageArtifactMetadata, PageArtifactSemanticNode, PageArtifactTargets,
    PageArtifactTextPosition, PageArtifactTextPositions, PageArtifactTextRangeGeometry,
    PageArtifactTextRangeRect, PageArtifactTextRunOffset,
};

/// One text run's geometry and text, pre-resolved from the fragment tree.
#[derive(Debug, Clone)]
struct FragmentRunRecord {
    block_index: usize,
    line_index: usize,
    run_index: usize,
    /// UTF-16 offset range in the page text.
    start: usize,
    end: usize,
    /// Absolute page-content coordinates.
    x: f64,
    y: f64,
    width: f64,
    height: f64,
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
}

impl FragmentPageArtifact {
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
                let flow_text: String = items
                    .iter()
                    .filter_map(|item| match item {
                        InlineItem::Text { text, .. } => Some(text.as_str()),
                        InlineItem::Image { .. } => None,
                    })
                    .collect();
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
                    let Fragment::Text(run) = child else {
                        continue;
                    };
                    let Some(run_text) =
                        flow_text.get(run.text_start as usize..run.text_end as usize)
                    else {
                        continue;
                    };
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
                    });
                    self.text.push_str(run_text);
                    self.offset += length;
                    self.has_text = true;
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
        // Semantic and target surfaces land with the backend wiring; the
        // artifact is not reachable from any session until they do.
        Vec::new()
    }

    fn targets(&self) -> PageArtifactTargets {
        PageArtifactTargets {
            entries: Vec::new(),
            text_hash: self.text_hash.clone(),
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
        FontFamilies, FontFamily, FontFamilyName, InlineStyleTableV1, LayoutStyleId,
        LayoutStyleTableV1,
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
            source_nodes: vec![None, None],
            node_paints: BTreeMap::new(),
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
