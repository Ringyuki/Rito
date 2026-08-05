//! Diagnostic probe: page-by-page ink-less lines for one chapter, laid
//! out exactly the way the fragment page table paginates it (same tree,
//! same engine, same content box). Mirrors the native
//! `chapter-fragment-probe` example's paginated output so the wasm and
//! native pipelines can be diffed line by line to locate an input
//! divergence.

use rito_fragment::{
    CancelFlag, ConstraintSpace, FormattingContext, FormattingNodeContent, Fragment, InlineItem,
};
use serde::Serialize;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::ChapterFormattingTree;
use crate::runtime::RuntimeDocument;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeReport {
    content_width: f64,
    content_height: f64,
    tree_fingerprint: String,
    lines: Vec<ProbeLine>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeLine {
    text: String,
    page: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    source: u32,
}

impl RuntimeDocument {
    /// Lays one chapter out page by page through the revision's own
    /// fragment engine and content box, reporting every line's ink
    /// geometry. Purely diagnostic; the page table is not touched.
    pub fn chapter_fragment_probe_json(
        &self,
        revision_id: &str,
        idref: &str,
    ) -> EpubResult<String> {
        let revision = self
            .any_revision(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        let config = &revision.layout_config;
        let content_width = config.page_width - config.margin_left - config.margin_right;
        let content_height = config.page_height - config.margin_top - config.margin_bottom;
        let engine = self
            .fragment_engine()
            .ok_or_else(|| EpubError::new("no fragment engine (no pinned faces)".to_owned()))?;
        let built = self.chapter_formatting_tree(revision_id, idref)?;
        let space = ConstraintSpace::fragmented(content_width, content_height);
        let cancel = CancelFlag::new();
        let mut token = None;
        let mut lines = Vec::new();
        let mut page = 0u32;
        loop {
            let outcome = engine
                .engine
                .layout(&built.tree, built.tree.root(), &space, token.as_ref(), &cancel)
                .map_err(|error| {
                    EpubError::new(format!("probe pagination failed on page {page}: {error:?}"))
                })?;
            let start = lines.len();
            collect_probe_lines(&outcome.fragments.root, &built, 0.0, 0.0, &mut lines);
            for line in &mut lines[start..] {
                line.page = page;
            }
            page += 1;
            if page > 2000 {
                return Err(EpubError::new("probe pagination did not converge".to_owned()));
            }
            match outcome.continuation {
                Some(next) => token = Some(next),
                None => break,
            }
        }
        let report = ProbeReport {
            content_width,
            content_height,
            tree_fingerprint: format!("{:016x}", built.tree.fingerprint()),
            lines,
        };
        serde_json::to_string(&report)
            .map_err(|error| EpubError::new(format!("probe report encodes: {error}")))
    }
}

/// Flattens line fragments in document order, reassembling each line's
/// text from its source flow and measuring its ink extent (trailing
/// whitespace excluded). Same shape as the native probe example.
fn collect_probe_lines(
    fragment: &Fragment,
    built: &ChapterFormattingTree,
    x_offset: f64,
    y_offset: f64,
    lines: &mut Vec<ProbeLine>,
) {
    match fragment {
        Fragment::Box(inner) => {
            for child in &inner.children {
                collect_probe_lines(
                    child,
                    built,
                    x_offset + inner.rect.x,
                    y_offset + inner.rect.y,
                    lines,
                );
            }
        }
        Fragment::Line(line) => {
            let FormattingNodeContent::InlineFlow { items } = &built.tree.node(line.source).content
            else {
                return;
            };
            let full_text: String = items
                .iter()
                .filter_map(|item| match item {
                    InlineItem::Text { text, .. } => Some(text.as_str()),
                    InlineItem::Image { .. } => None,
                })
                .collect();
            let mut start = u32::MAX;
            let mut end = 0_u32;
            let mut first_x = f64::INFINITY;
            let mut last_edge = f64::NEG_INFINITY;
            for child in &line.children {
                match child {
                    Fragment::Text(run) => {
                        start = start.min(run.text_start);
                        end = end.max(run.text_end);
                        first_x = first_x.min(run.rect.x);
                        last_edge = last_edge.max(run.rect.x + run.rect.width);
                    }
                    Fragment::Image(image) => {
                        first_x = first_x.min(image.rect.x);
                        last_edge = last_edge.max(image.rect.x + image.rect.width);
                    }
                    _ => {}
                }
            }
            let (x, width) = if last_edge == f64::NEG_INFINITY {
                (x_offset + line.rect.x, 0.0)
            } else {
                (
                    x_offset + line.rect.x + first_x,
                    (last_edge - line.trailing_whitespace - first_x).max(0.0),
                )
            };
            let text = if start <= end && start != u32::MAX {
                full_text[start as usize..end as usize].to_owned()
            } else {
                String::new()
            };
            lines.push(ProbeLine {
                text,
                page: 0,
                x,
                y: y_offset + line.rect.y,
                width,
                height: line.rect.height,
                source: line.source.0,
            });
        }
        Fragment::Text(_) | Fragment::Image(_) => {}
    }
}
