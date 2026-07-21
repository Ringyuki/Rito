//! Shadow-runs the fragment layout contract against a revision's published
//! pages, without touching production output.
//!
//! The production engine stays the sole layout authority. This read-only
//! diagnostic derives a `FormattingTree` per published page — one opaque
//! sized leaf per top-level block, in document order, from geometry the
//! production engine already committed — and lays it out through the
//! input-keyed fragment cache with an explicitly selected engine provider.
//! It exists so replacement formatting engines can be exercised against
//! real published content (with reader semantics such as out-of-flow
//! footnote asides already applied) long before any of them is allowed to
//! change what readers see. An unrecognized provider fails closed.

use serde::{Deserialize, Serialize};

use rito_fragment::{
    block::StubBlockContext, encode_layout_outcome, CancelFlag, ConstraintSpace, FormattingNode,
    FormattingNodeContent, FormattingNodeId, FormattingTree, FragmentCache,
};
use rito_style_contract::LayoutStyleId;

use crate::{
    epub::{EpubError, EpubResult},
    layout::LayoutRuntimePage,
};

use super::{RuntimeDocument, RuntimeRevisionStatus};

pub const RUNTIME_FRAGMENT_SHADOW_SCHEMA_VERSION: u32 = 1;

/// The only engine provider currently wired for shadow runs: bounded
/// vertical block stacking with fragmentainer splits.
pub const RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK: &str = "stub-block";

const OVERFLOWING_PAGE_INDEX_CAP: usize = 16;

/// Replay is verified per page immediately after its first layout, so the
/// cache never needs to hold more than a handful of outcomes at once and
/// shadow memory stays bounded regardless of book size.
const SHADOW_CACHE_BUDGET_BYTES: usize = 256 * 1024;

/// Evidence from one shadow run over a revision's published pages.
///
/// `is_complete == false` means the counts describe only the revision's
/// published prefix. Nothing here feeds back into production layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFragmentShadowReport {
    pub schema_version: u32,
    /// The provider that produced the shadow fragments, echoed back.
    pub engine_provider: String,
    pub is_complete: bool,
    pub known_page_count: usize,
    pub shadowed_page_count: usize,
    /// Top-level production blocks that became shadow leaves.
    pub shadowed_block_count: usize,
    /// Pages whose shadow layout fit one fragmentainer, matching how the
    /// production engine placed the same blocks on one page.
    pub fitting_page_count: usize,
    /// Pages whose shadow layout produced a continuation, i.e. the fragment
    /// model would have broken content the production engine kept on one
    /// page. Capped; see the omitted count.
    pub overflowing_page_indexes: Vec<usize>,
    pub overflowing_page_omitted_count: usize,
    /// Whether every page's second, cache-served layout replayed the first
    /// outcome exactly.
    pub replay_verified: bool,
    /// Total canonical serialized size of every page's shadow outcome.
    pub serialized_artifact_bytes: usize,
    /// FNV-1a 64 over the canonical serialized outcomes in page order.
    /// Equal inputs must reproduce this digest exactly, on every platform.
    pub artifact_digest: String,
}

impl RuntimeDocument {
    pub(super) fn fragment_shadow_report(
        &self,
        revision_id: &str,
        engine_provider: &str,
    ) -> EpubResult<RuntimeFragmentShadowReport> {
        if engine_provider != RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK {
            return Err(EpubError::new(format!(
                "unknown fragment engine provider: {engine_provider}"
            )));
        }
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;

        let provider = StubBlockContext;
        let cancel = CancelFlag::new();
        let mut cache = FragmentCache::new(SHADOW_CACHE_BUDGET_BYTES);
        let mut digest = Fnv64::new();
        let mut report = RuntimeFragmentShadowReport {
            schema_version: RUNTIME_FRAGMENT_SHADOW_SCHEMA_VERSION,
            engine_provider: engine_provider.to_owned(),
            is_complete: revision.status == RuntimeRevisionStatus::Complete,
            known_page_count: revision.known_extent.page_count,
            shadowed_page_count: 0,
            shadowed_block_count: 0,
            fitting_page_count: 0,
            overflowing_page_indexes: Vec::new(),
            overflowing_page_omitted_count: 0,
            replay_verified: true,
            serialized_artifact_bytes: 0,
            artifact_digest: String::new(),
        };

        for page in &revision.layout.pages {
            let tree = page_formatting_tree(page)?;
            let space = ConstraintSpace::fragmented(page.width, page.height);
            let first = cache
                .layout(&provider, &tree, tree.root(), &space, None, &cancel)
                .map_err(|error| {
                    EpubError::new(format!("fragment shadow page {}: {error}", page.index))
                })?;
            let replay = cache
                .layout(&provider, &tree, tree.root(), &space, None, &cancel)
                .map_err(|error| {
                    EpubError::new(format!("fragment shadow replay {}: {error}", page.index))
                })?;
            if !replay.from_cache || replay.outcome != first.outcome {
                report.replay_verified = false;
            }
            let bytes = encode_layout_outcome(&first.outcome);
            digest.mix(&bytes);
            report.serialized_artifact_bytes += bytes.len();
            report.shadowed_page_count += 1;
            report.shadowed_block_count += page.content.len();
            if first.outcome.continuation.is_none() {
                report.fitting_page_count += 1;
            } else if report.overflowing_page_indexes.len() < OVERFLOWING_PAGE_INDEX_CAP {
                report.overflowing_page_indexes.push(page.index);
            } else {
                report.overflowing_page_omitted_count += 1;
            }
        }
        report.artifact_digest = digest.hex();
        Ok(report)
    }
}

/// One opaque leaf per top-level production block, in document order. The
/// blocks are unbreakable here: the production engine already decided they
/// fit this page, and the shadow asks whether the fragment model agrees.
fn page_formatting_tree(page: &LayoutRuntimePage) -> EpubResult<FormattingTree> {
    let count = page.content.len() as u32;
    let mut nodes: Vec<FormattingNode> = page
        .content
        .iter()
        .map(|block| FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::SizedLeaf {
                block_size: block.height,
                breakable: false,
            },
            children: Vec::new(),
        })
        .collect();
    nodes.push(FormattingNode {
        style: LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::BlockContainer,
        children: (0..count).map(FormattingNodeId).collect(),
    });
    FormattingTree::new(nodes, FormattingNodeId(count)).map_err(EpubError::new)
}

struct Fnv64(u64);

impl Fnv64 {
    fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }

    fn mix(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    fn hex(&self) -> String {
        format!("{:016x}", self.0)
    }
}
