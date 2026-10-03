//! The document-owned fragment engine and its shared frame helpers:
//! engine construction (pinned faces plus the publication's `@font-face`
//! bindings) and the frame-skeleton helpers the fragment session shares.

use std::rc::Rc;

use rito_block::BlockFormattingContext;
use rito_inline::ParleyInlineContext;

use crate::render::{
    contract::ReaderColor, contract::ReaderPagePaint, display_rect, DisplayCommand,
};

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

impl RuntimeDocument {
    /// Looks a revision up in whichever store holds it: publication
    /// revisions and chapter-local (preview) revisions share the frame
    /// path and both route through the bridge.
    pub(super) fn any_revision(&self, revision_id: &str) -> Option<&RuntimeRevision> {
        self.revisions
            .get(revision_id)
            .or_else(|| self.chapter_local_revisions.get(revision_id))
    }

    /// The document's fragment engine, built once from the pinned font
    /// policy and the publication's `@font-face` bindings. `None` when no
    /// fonts are available or a face fails to register — layout without
    /// explicit fonts would fall back to nothing, so the bridge stays off.
    pub(super) fn fragment_engine(&self) -> Option<&RuntimeFragmentEngine> {
        self.initialized_fragment_engine().as_deref()
    }

    /// The same engine as a shared handle: a page table keeps one so the
    /// chapters it rebuilds lay out on the engine they were paginated on.
    pub(super) fn fragment_engine_handle(&self) -> Option<Rc<RuntimeFragmentEngine>> {
        self.initialized_fragment_engine().clone()
    }

    fn initialized_fragment_engine(&self) -> &Option<Rc<RuntimeFragmentEngine>> {
        let engine = self.fragment_engine.get_or_init(|| {
            let host = self.pinned_font_policy.host_faces();
            if host.is_empty() {
                return None;
            }
            let mut context = ParleyInlineContext::with_faces(host).ok()?;
            for source in self.resolved_font_face_sources() {
                // A missing or codec-rejected face paints as its
                // fallback; it must not take the whole fragment engine
                // down with it (degrade, never block). Its family simply
                // never registers, so its text resolves past it.
                let Some(resource) = self.document.fonts.get(source.resource_index()) else {
                    continue;
                };
                // A face the host's font decoder rejected never paints;
                // shaping with it would measure runs the canvas then
                // draws with another face. The host reports it by the
                // alias it registered it under, or by its family.
                let alias = source.paint_alias(&resource.bytes).to_ascii_lowercase();
                let family = source.family().trim().to_ascii_lowercase();
                if self.unavailable_font_families.contains(&alias)
                    || self.unavailable_font_families.contains(&family)
                {
                    continue;
                }
                if context
                    .register_publication_face(source.engine_face(&resource.bytes))
                    .is_err()
                {
                    continue;
                }
            }
            Some(Rc::new(RuntimeFragmentEngine {
                engine: BlockFormattingContext::new(context),
            }))
        });
        engine
    }
}

/// A page wash: the rect filled with `color` as the page ground.
pub(super) fn paint_rect_command(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    color: ReaderColor,
) -> DisplayCommand {
    DisplayCommand::PaintPage {
        rect: display_rect(x, y, width, height),
        paint: ReaderPagePaint {
            background_color: Some(color),
        },
    }
}
