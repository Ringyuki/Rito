//! The document-owned fragment engine and its shared frame helpers:
//! engine construction (pinned faces plus the publication's `@font-face`
//! bindings), the paint family policy, and the frame-skeleton helpers the
//! fragment session shares.

use std::rc::Rc;

use rito_block::BlockFormattingContext;
use rito_inline::ParleyInlineContext;

use crate::fragment_paint::PaintFamilyPolicy;
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
                // A face the host's font decoder rejected never paints;
                // shaping with it would measure runs the canvas then
                // draws with a fallback font.
                if self
                    .unavailable_font_families
                    .contains(&source.family().trim().to_ascii_lowercase())
                {
                    continue;
                }
                // A missing or codec-rejected face paints as its
                // fallback stack; it must not take the whole fragment
                // engine down with it (degrade, never block). Its
                // family simply never registers, so paint resolves
                // past it exactly like layout does.
                let Some(resource) = self.document.fonts.get(source.resource_index()) else {
                    continue;
                };
                if context
                    .register_named_font(source.family(), resource.bytes.clone())
                    .is_err()
                {
                    continue;
                }
            }
            Some(Rc::new(RuntimeFragmentEngine {
                engine: BlockFormattingContext::new(context),
            }))
        });
        if engine.is_some() {
            // Metrics injected before the engine existed apply now.
            self.apply_pending_host_line_metrics();
        }
        engine
    }

    /// Decides and caches fragment frames for every chapter the given
    /// spread touches. Completed chapters are decided exactly once: either
    /// their pages swap in, or they stay retained for this revision's
    /// lifetime. Chapters still paginating are left undecided so they are
    /// reconsidered once complete.
    /// The family policy fragment paint runs under, or `None` when the
    /// publication names a face into the pinned alias namespace: the
    /// engine registers fonts by declared name, so such a face would shadow
    /// the pinned face it aliases and paint could not resolve what layout
    /// measured with; the chapter build reports the collision instead.
    /// Painted family stacks must resolve to the same faces layout
    /// measured with: only engine-registered families survive, and the
    /// pinned faces ride along under the alias names the host registered
    /// for them.
    pub(super) fn fragment_paint_family_policy(&self) -> Option<PaintFamilyPolicy> {
        if self.resolved_font_face_sources().iter().any(|source| {
            source
                .family()
                .to_ascii_lowercase()
                .starts_with("__ritopinned")
        }) {
            return None;
        }
        let engine = self.fragment_engine()?;
        Some(PaintFamilyPolicy {
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
        })
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
