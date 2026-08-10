//! The document-owned fragment engine and its shared frame helpers.
//!
//! The per-spread paint bridge that once lived here is gone: the fragment
//! page table owns pagination outright and the retained engine no longer
//! paints. What remains is the engine construction (pinned faces plus the
//! publication's `@font-face` bindings), the paint family policy, and the
//! frame-skeleton helpers the fragment session shares.

use serde_json::Value;

use rito_block::BlockFormattingContext;
use rito_inline::ParleyInlineContext;

use crate::fragment_paint::PaintFamilyPolicy;
use crate::render::DisplayCommand;

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

    pub(super) fn any_revision_mut(&mut self, revision_id: &str) -> Option<&mut RuntimeRevision> {
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
                // Painted runs reference the face SHAPING resolved by the
                // name the host DOM registered — for the pinned faces
                // that is the policy alias, not the name-table name.
                for (index, face) in self.pinned_font_policy.summary().faces.iter().enumerate() {
                    context.alias_font_blob(index, &face.family_alias);
                }
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
            .inspect(|_| {
                // Metrics injected before the engine existed apply now.
                self.apply_pending_host_line_metrics();
            })
    }

    /// Decides and caches fragment frames for every chapter the given
    /// spread touches. Completed chapters are decided exactly once: either
    /// their pages swap in, or they stay retained for this revision's
    /// lifetime. Chapters still paginating are left undecided so they are
    /// reconsidered once complete.
    /// The family policy fragment paint runs under, or `None` when the
    /// publication names a face into the pinned alias namespace. The
    /// retained pipeline resolves such collisions in the pinned face's
    /// favor; the fragment pipeline registers fonts by declared name and
    /// would let the publication face win, so those books stay retained.
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

pub(super) fn paint_rect_command(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    color: &str,
) -> DisplayCommand {
    DisplayCommand::paint_page(
        rect_value(x, y, width, height),
        serde_json::json!({ "backgroundColor": color }),
    )
}

pub(super) fn number_value(value: f64) -> Value {
    crate::fragment_paint::number_value(value)
}

pub(super) fn rect_value(x: f64, y: f64, width: f64, height: f64) -> Value {
    crate::fragment_paint::rect_value(x, y, width, height)
}
