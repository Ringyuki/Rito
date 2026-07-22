//! Routes spread frames through the fragment engine where it can already
//! reproduce the retained pipeline's page model.
//!
//! This is the cutover bridge: revision structure — page count, chapter
//! ranges, spreads, interactions — stays owned by the retained engine, and
//! only a spread's paint commands are swapped when every page on it belongs
//! to a chapter the fragment pipeline can lay out end to end *and* that
//! chapter paginates into exactly the same number of pages. Chapters that
//! fail either condition keep their retained frames, so the swap can never
//! change what page a reader is on. Interaction geometry still comes from
//! the retained layout while the bridge is in place, so selection overlays
//! can drift by the small per-line differences between the engines until
//! the fragment page artifact lands.

use std::sync::Arc;

use serde_json::Value;

use rito_block::BlockFormattingContext;
use rito_fragment::CancelFlag;
use rito_inline::ParleyInlineContext;

use crate::fragment_pagination::paginate_chapter;
use crate::fragment_paint::{FragmentPaintContext, PaintFamilyPolicy};
use crate::layout::{
    build_spread_slots, LayoutRuntimePage, RuntimeBlock, RuntimeChild, SpreadMode,
};
use crate::render::DisplayCommand;

use super::page_artifact::PageArtifactFrame;
use super::{RuntimeDocument, RuntimeRevision};

/// The Parley-backed fragment engine a document lays chapters out with:
/// exactly the reader's pinned faces plus the publication's own
/// `@font-face` bindings, so layout is reproducible and independent of any
/// platform font database.
pub(super) struct RuntimeFragmentEngine {
    pub(super) engine: BlockFormattingContext<ParleyInlineContext>,
}

impl std::fmt::Debug for RuntimeFragmentEngine {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RuntimeFragmentEngine")
    }
}

/// Per-page paint commands for one chapter, aligned one to one with the
/// chapter's retained page range.
pub(super) type FragmentChapterFrames = Arc<Vec<Vec<DisplayCommand>>>;

impl RuntimeDocument {
    /// Looks a revision up in whichever store holds it: publication
    /// revisions and chapter-local (preview) revisions share the frame
    /// path and both route through the bridge.
    pub(super) fn any_revision(&self, revision_id: &str) -> Option<&RuntimeRevision> {
        self.revisions
            .get(revision_id)
            .or_else(|| self.chapter_local_revisions.get(revision_id))
    }

    fn any_revision_mut(&mut self, revision_id: &str) -> Option<&mut RuntimeRevision> {
        if self.revisions.contains_key(revision_id) {
            return self.revisions.get_mut(revision_id);
        }
        self.chapter_local_revisions.get_mut(revision_id)
    }

    /// The document's fragment engine, built once from the pinned font
    /// policy and the publication's `@font-face` bindings. `None` when no
    /// fonts are available or a face fails to register — layout without
    /// explicit fonts would fall back to nothing, so the bridge stays off.
    pub(super) fn fragment_engine(&self) -> Option<&RuntimeFragmentEngine> {
        self.fragment_engine
            .get_or_init(|| {
                let pinned: Vec<Vec<u8>> = self
                    .pinned_font_policy
                    .face_bytes()
                    .map(<[u8]>::to_vec)
                    .collect();
                if pinned.is_empty() {
                    return None;
                }
                let mut context = ParleyInlineContext::new(pinned).ok()?;
                for source in self.resolved_font_face_sources() {
                    let resource = self.document.fonts.get(source.resource_index())?;
                    context
                        .register_named_font(source.family(), resource.bytes.clone())
                        .ok()?;
                }
                Some(RuntimeFragmentEngine {
                    engine: BlockFormattingContext::new(context),
                })
            })
            .as_ref()
    }

    /// Decides and caches fragment frames for every chapter the given
    /// spread touches. Completed chapters are decided exactly once: either
    /// their pages swap in, or they stay retained for this revision's
    /// lifetime. Chapters still paginating are left undecided so they are
    /// reconsidered once complete.
    pub(super) fn prepare_fragment_spread_frames(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) {
        let Some(revision) = self.any_revision(revision_id) else {
            return;
        };
        let mut pending = Vec::new();
        for page_index in spread_page_indexes(revision, spread_index) {
            let Some((idref, _)) = chapter_of_page(revision, page_index) else {
                continue;
            };
            if revision.fragment_chapter_frames.contains_key(idref) {
                continue;
            }
            if !revision
                .interactions
                .completed_chapter_idrefs
                .contains(idref)
            {
                continue;
            }
            let idref = idref.to_owned();
            if !pending.contains(&idref) {
                pending.push(idref);
            }
        }
        for idref in pending {
            let frames = self.build_fragment_chapter_frames(revision_id, &idref);
            if let Some(revision) = self.any_revision_mut(revision_id) {
                revision.fragment_chapter_frames.insert(idref, frames);
            }
        }
    }

    /// Builds one completed chapter's per-page fragment commands, or `None`
    /// when the chapter must stay on the retained engine.
    fn build_fragment_chapter_frames(
        &self,
        revision_id: &str,
        idref: &str,
    ) -> Option<FragmentChapterFrames> {
        let revision = self.any_revision(revision_id)?;
        let range = revision
            .layout
            .summary
            .pagination_flow
            .chapter_map
            .get(idref)?;
        let legacy_pages = revision
            .layout
            .pages
            .get(range.start_page..=range.end_page)?;
        // The retained pages must not carry paint the fragment painter
        // cannot reproduce yet (block backgrounds, borders, rules).
        if !legacy_pages.iter().all(page_supports_swap) {
            return None;
        }
        // The retained pipeline resolves pinned-font alias collisions in
        // the pinned face's favor; the fragment pipeline registers fonts
        // by declared name and would let the publication face win, so a
        // book that names a face into the pinned alias namespace stays
        // retained.
        if self.resolved_font_face_sources().iter().any(|source| {
            source
                .family()
                .to_ascii_lowercase()
                .starts_with("__ritopinned")
        }) {
            return None;
        }
        let engine = self.fragment_engine()?;
        // Painted family stacks must resolve to the same faces layout
        // measured with: only engine-registered families survive, and the
        // pinned faces ride along under the alias names the host
        // registered for them.
        let family_policy = PaintFamilyPolicy {
            available: engine
                .engine
                .inline()
                .registered_families()
                .iter()
                .map(|family| family.to_ascii_lowercase())
                .collect(),
            aliases: self
                .pinned_font_policy
                .summary()
                .faces
                .into_iter()
                .map(|face| face.family_alias)
                .collect(),
        };
        let built = self.chapter_formatting_tree(revision_id, idref).ok()?;
        let config = &revision.layout_config;
        let pages = paginate_chapter(
            &engine.engine,
            &built.tree,
            config.page_width - config.margin_left - config.margin_right,
            config.page_height - config.margin_top - config.margin_bottom,
            config.margin_left,
            config.margin_top,
            FragmentPaintContext {
                family_policy: Some(&family_policy),
                node_paints: Some(&built.node_paints),
            },
            &CancelFlag::new(),
        )
        .ok()?;
        // Page-count parity is the bridge's safety condition: navigation,
        // locators, and chapter ranges all live in retained page numbers,
        // so the fragment engine may only repaint pages, never renumber
        // them.
        if pages.len() != legacy_pages.len() {
            return None;
        }
        Some(Arc::new(
            pages.into_iter().map(|page| page.commands).collect(),
        ))
    }
}

/// Builds the swapped display-command frame for a spread, or `None` when
/// any of its pages has no fragment commands.
pub(super) fn fragment_spread_frame(
    revision: &RuntimeRevision,
    spread_index: usize,
) -> Option<PageArtifactFrame> {
    let config = &revision.layout_config;
    let spreads = build_spread_slots(
        revision.layout.pages.len(),
        &revision.layout.chapter_start_pages,
        config,
    );
    let spread = spreads.get(spread_index)?;
    let mut page_indexes = vec![spread.left_page_index];
    if config.spread_mode == SpreadMode::Double {
        if let Some(right) = spread.right_page_index {
            page_indexes.push(right);
        }
    }
    let mut commands = Vec::new();
    // The frame skeleton mirrors the retained producer: a viewport wash,
    // then each page translated into place, washed, and clipped around its
    // content commands.
    commands.push(paint_rect_command(
        0.0,
        0.0,
        config.viewport_width,
        config.viewport_height,
        "#ffffff",
    ));
    for (slot, page_index) in page_indexes.iter().enumerate() {
        let page_commands = fragment_page_commands(revision, *page_index)?;
        let page = revision.layout.pages.get(*page_index)?;
        let offset_x = slot as f64 * (config.page_width + config.spread_gap);
        commands.push(DisplayCommand::push_state());
        commands.push(DisplayCommand::translate(
            number_value(offset_x),
            number_value(0.0),
        ));
        commands.push(paint_rect_command(
            0.0,
            0.0,
            page.width,
            page.height,
            page_background_color(page).unwrap_or("#ffffff"),
        ));
        commands.push(DisplayCommand::push_state());
        commands.push(DisplayCommand::clip_rect(
            rect_value(0.0, 0.0, page.width, page.height),
            None,
        ));
        commands.extend(page_commands.iter().cloned());
        commands.push(DisplayCommand::pop_state());
        commands.push(DisplayCommand::pop_state());
    }
    Some(PageArtifactFrame {
        spread_index: spread.index,
        page_indexes,
        commands,
    })
}

/// One page's cached fragment commands, when its chapter swapped in.
fn fragment_page_commands(
    revision: &RuntimeRevision,
    page_index: usize,
) -> Option<&[DisplayCommand]> {
    let (idref, range) = chapter_of_page(revision, page_index)?;
    let frames = revision.fragment_chapter_frames.get(idref)?.as_ref()?;
    frames.get(page_index - range.start_page).map(Vec::as_slice)
}

fn spread_page_indexes(revision: &RuntimeRevision, spread_index: usize) -> Vec<usize> {
    let config = &revision.layout_config;
    let spreads = build_spread_slots(
        revision.layout.pages.len(),
        &revision.layout.chapter_start_pages,
        config,
    );
    let Some(spread) = spreads.get(spread_index) else {
        return Vec::new();
    };
    let mut indexes = vec![spread.left_page_index];
    if config.spread_mode == SpreadMode::Double {
        if let Some(right) = spread.right_page_index {
            indexes.push(right);
        }
    }
    indexes
}

/// The chapter a retained page belongs to, with its page range.
fn chapter_of_page(
    revision: &RuntimeRevision,
    page_index: usize,
) -> Option<(&str, &crate::layout::PaginationFlowChapterRange)> {
    revision
        .layout
        .summary
        .pagination_flow
        .chapter_map
        .iter()
        .find(|(_, range)| range.start_page <= page_index && page_index <= range.end_page)
        .map(|(idref, range)| (idref.as_str(), range))
}

/// Whether a retained page paints nothing the fragment painter cannot
/// reproduce: a plain background color at most, and no block-level paint,
/// borders, or rules anywhere in its content.
fn page_supports_swap(page: &LayoutRuntimePage) -> bool {
    paint_is_plain_background(&page.paint) && page.content.iter().all(block_supports_swap)
}

fn block_supports_swap(block: &RuntimeBlock<crate::layout::LineBox>) -> bool {
    if block.paint.is_some() || block.border_box.is_some() {
        return false;
    }
    block.children.iter().all(|child| match child {
        RuntimeChild::Block(inner) => block_supports_swap(inner),
        RuntimeChild::Line(_) | RuntimeChild::Image(_) | RuntimeChild::Hr(_) => true,
    })
}

fn paint_is_plain_background(paint: &Option<Value>) -> bool {
    match paint {
        None => true,
        Some(Value::Object(map)) => map.keys().all(|key| key == "backgroundColor"),
        Some(_) => false,
    }
}

fn page_background_color(page: &LayoutRuntimePage) -> Option<&str> {
    page.paint
        .as_ref()?
        .get("backgroundColor")?
        .as_str()
        .filter(|color| !color.is_empty())
}

fn paint_rect_command(x: f64, y: f64, width: f64, height: f64, color: &str) -> DisplayCommand {
    DisplayCommand::paint_page(
        rect_value(x, y, width, height),
        serde_json::json!({ "backgroundColor": color }),
    )
}

fn number_value(value: f64) -> Value {
    crate::fragment_paint::number_value(value)
}

fn rect_value(x: f64, y: f64, width: f64, height: f64) -> Value {
    crate::fragment_paint::rect_value(x, y, width, height)
}
