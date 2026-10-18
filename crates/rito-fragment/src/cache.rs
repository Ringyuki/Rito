//! Input-keyed fragment cache.
//!
//! Layout is a deterministic pure function of `(tree, space, token)`, so a
//! cache entry keyed by those inputs can replay an outcome without invoking
//! the provider. The tree component of the key is its content fingerprint:
//! trees are immutable, so a fingerprint match means byte-equal layout
//! input even across rebuilt trees, and a rebuilt chapter naturally misses
//! instead of replaying stale fragments.
//!
//! A tree that carries its style tables folds them into the fingerprint, so
//! a style change misses too. The constraint space joins the key whole.
//!
//! An outcome that reports the inline sizes it holds for (a layout without
//! line text, see `LayoutOutcome::inline_size_range`) also answers a layout
//! at any other size inside them, the rest of its inputs equal: a window
//! being resized asks for a new width every frame, and most paragraphs
//! break into the same lines at the next one.
//!
//! Memory is bounded by a byte budget charged a fixed size per fragment of
//! each outcome: deterministic across platforms, and counted by walking the
//! fragments rather than encoding them. Least-recently-used entries are
//! evicted first.

use std::collections::VecDeque;

use rustc_hash::FxHashMap;

use crate::break_token::BreakToken;
use crate::constraint_space::{ConstraintSpace, FloatBand, LineText};
use crate::context::{CancelFlag, FormattingContext, LayoutError, LayoutOutcome};
use crate::formatting_tree::FormattingTree;
use crate::fragment::Fragment;

/// One cache lookup-or-compute result.
#[derive(Clone, Debug, PartialEq)]
pub struct CachedLayout {
    /// The layout outcome, identical whether replayed or freshly computed.
    pub outcome: LayoutOutcome,
    /// Whether the outcome was replayed from the cache.
    pub from_cache: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct CacheKey {
    tree_fingerprint: u64,
    root: u32,
    space: SpaceKey,
    /// Break token in canonical form; `None` for a from-the-start layout.
    token: Option<TokenKey>,
}

/// Every field of the constraint space, by f64 bit pattern: conservative
/// (distinguishes `0.0` from `-0.0`) but never conflates distinct inputs.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct SpaceKey {
    inline_size: u64,
    fragmentainer_remaining: Option<u64>,
    fragmentainer_size: Option<u64>,
    /// Left inset, right inset and bottom of the float band.
    float_band: Option<[u64; 3]>,
    containing_block_size: Option<u64>,
    line_text: LineTextKey,
}

/// [`LineText`] by the bit patterns of its window.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum LineTextKey {
    Omitted,
    All,
    Within([u64; 2]),
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum TokenStageKey {
    Before,
    Inside { consumed_bits: u64 },
}

/// Recursive token identity: resume path, stage, and the identities of
/// every float the same edge split.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct TokenKey {
    path: Vec<u32>,
    stage: TokenStageKey,
    floats: Vec<(u32, u32, TokenKey)>,
}

fn token_key(token: &BreakToken) -> TokenKey {
    TokenKey {
        path: token.resume_path.iter().map(|node| node.0).collect(),
        stage: match token.stage {
            crate::BreakTokenStage::Before => TokenStageKey::Before,
            crate::BreakTokenStage::Inside {
                consumed_block_size,
            } => TokenStageKey::Inside {
                consumed_bits: consumed_block_size.to_bits(),
            },
        },
        floats: token
            .pending_floats
            .iter()
            .map(|float_break| {
                (
                    float_break.child.0,
                    float_break.depth,
                    token_key(&float_break.token),
                )
            })
            .collect(),
    }
}

struct CacheEntry {
    outcome: LayoutOutcome,
    /// Canonical serialized size, the unit of budget accounting.
    bytes: usize,
    /// Node-arena length of the source tree: every entry covers its whole
    /// tree, so a node invalidates the entry exactly when its id is in range.
    covered_nodes: u32,
    last_used: u64,
}

/// Byte-budgeted, input-keyed store of layout outcomes.
pub struct FragmentCache {
    budget_bytes: usize,
    used_bytes: usize,
    clock: u64,
    entries: FxHashMap<CacheKey, CacheEntry>,
    /// Every use of an entry by its stamp, oldest first: eviction takes the
    /// first whose stamp is still its entry's last use instead of scanning
    /// the entries, and a use only appends. Uses an entry has outlived are
    /// skipped, and dropped once they outnumber the entries.
    recency: VecDeque<(u64, CacheKey)>,
    /// The latest entry reporting the inline sizes it holds for, by its key
    /// with the inline size left out.
    widths: FxHashMap<CacheKey, CacheKey>,
}

impl FragmentCache {
    /// An empty cache that will never hold more than `budget_bytes` of
    /// serialized outcome data.
    pub fn new(budget_bytes: usize) -> Self {
        Self {
            budget_bytes,
            used_bytes: 0,
            clock: 0,
            entries: FxHashMap::default(),
            recency: VecDeque::new(),
            widths: FxHashMap::default(),
        }
    }

    /// Replays a cached outcome for these exact inputs, or for the same
    /// inputs at another inline size the outcome reports holding for, or
    /// invokes the provider and caches the result.
    ///
    /// A cancelled or failed invocation inserts nothing. An outcome larger
    /// than the whole budget is returned but not cached.
    pub fn layout(
        &mut self,
        provider: &dyn FormattingContext,
        tree: &FormattingTree,
        node: crate::FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
    ) -> Result<CachedLayout, LayoutError> {
        self.layout_with(
            provider,
            tree,
            node,
            space,
            token,
            cancel,
            |outcome, from_cache| CachedLayout {
                outcome: outcome.clone(),
                from_cache,
            },
        )
    }

    /// [`Self::layout`], reading the outcome where the cache keeps it
    /// (`read` is told whether it was replayed) instead of copying it out:
    /// a layout that only reads its child's lines copies none of them.
    #[allow(clippy::too_many_arguments)]
    pub fn layout_with<R>(
        &mut self,
        provider: &dyn FormattingContext,
        tree: &FormattingTree,
        node: crate::FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
        read: impl FnOnce(&LayoutOutcome, bool) -> R,
    ) -> Result<R, LayoutError> {
        let key = cache_key(tree, node, space, token);
        self.clock += 1;
        let held = if self.entries.contains_key(&key) {
            Some(key.clone())
        } else if space.line_text != LineText::Omitted {
            None
        } else {
            self.widths
                .get(&without_inline_size(&key))
                .filter(|held| {
                    self.entries[*held]
                        .outcome
                        .inline_size_range
                        .is_some_and(|(lo, hi)| lo <= space.inline_size && space.inline_size < hi)
                })
                .cloned()
        };
        if let Some(held) = held {
            self.touch(&held);
            return Ok(read(&self.entries[&held].outcome, true));
        }
        let outcome = provider.layout(tree, node, space, token, cancel)?;
        let bytes = footprint(&outcome);
        if bytes > self.budget_bytes {
            return Ok(read(&outcome, false));
        }
        self.evict_until_fits(bytes);
        self.used_bytes += bytes;
        if outcome.inline_size_range.is_some() {
            self.widths.insert(without_inline_size(&key), key.clone());
        }
        self.recency.push_back((self.clock, key.clone()));
        let entry = self.entries.entry(key).insert_entry(CacheEntry {
            outcome,
            bytes,
            covered_nodes: tree.len() as u32,
            last_used: self.clock,
        });
        Ok(read(&entry.get().outcome, false))
    }

    /// Drops every entry that depends on `node` of `tree` — i.e. every
    /// outcome recorded against this tree's fingerprint whose layout read
    /// the node. Call once per node whose resolved style changed.
    pub fn invalidate_node(&mut self, tree: &FormattingTree, node: crate::FormattingNodeId) {
        let fingerprint = tree.fingerprint();
        self.retain(|key, entry| {
            key.tree_fingerprint != fingerprint || node.0 >= entry.covered_nodes
        });
    }

    /// Releases every entry, returning the byte accounting to zero.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.recency.clear();
        self.widths.clear();
        self.used_bytes = 0;
    }

    /// Serialized bytes currently held. Never exceeds the budget.
    pub fn used_bytes(&self) -> usize {
        self.used_bytes
    }

    /// Number of cached outcomes.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the cache holds no outcomes.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Records a use of `key`, which is cached, at the current stamp.
    fn touch(&mut self, key: &CacheKey) {
        let entry = self.entries.get_mut(key).expect("a touched key is cached");
        entry.last_used = self.clock;
        self.recency.push_back((self.clock, key.clone()));
        if self.recency.len() > 2 * self.entries.len() + 64 {
            let entries = &self.entries;
            self.recency
                .retain(|(stamp, key)| is_last_use(entries, key, *stamp));
        }
    }

    fn retain(&mut self, keep: impl Fn(&CacheKey, &CacheEntry) -> bool) {
        let mut released = 0usize;
        self.entries.retain(|key, entry| {
            let keep = keep(key, entry);
            if !keep {
                released += entry.bytes;
            }
            keep
        });
        self.used_bytes -= released;
        let entries = &self.entries;
        self.recency
            .retain(|(stamp, key)| is_last_use(entries, key, *stamp));
        self.widths.retain(|_, key| entries.contains_key(key));
    }

    fn evict_until_fits(&mut self, incoming_bytes: usize) {
        while self.used_bytes + incoming_bytes > self.budget_bytes {
            // Unique clock stamps make the least recently used entry the
            // first in stamp order whose stamp is its last use,
            // deterministically.
            let Some((stamp, victim)) = self.recency.pop_front() else {
                return;
            };
            if !is_last_use(&self.entries, &victim, stamp) {
                continue;
            }
            if let Some(entry) = self.entries.remove(&victim) {
                self.used_bytes -= entry.bytes;
                let any_size = without_inline_size(&victim);
                if self.widths.get(&any_size) == Some(&victim) {
                    self.widths.remove(&any_size);
                }
            }
        }
    }
}

/// Whether `stamp` is the last use of the entry `key` names.
fn is_last_use(entries: &FxHashMap<CacheKey, CacheEntry>, key: &CacheKey, stamp: u64) -> bool {
    entries
        .get(key)
        .is_some_and(|entry| entry.last_used == stamp)
}

/// The key every inline size shares with `key`'s other inputs.
fn without_inline_size(key: &CacheKey) -> CacheKey {
    let mut key = key.clone();
    key.space.inline_size = 0;
    key
}

/// What an outcome is charged against the budget: a fixed size per
/// fragment, the unit layout output is made of.
fn footprint(outcome: &LayoutOutcome) -> usize {
    const FRAGMENT_BYTES: usize = 96;
    fn fragments(fragment: &Fragment) -> usize {
        1 + match fragment {
            Fragment::Box(fragment) => fragment.children.iter().map(fragments).sum(),
            Fragment::Line(fragment) => fragment.children.iter().map(fragments).sum(),
            Fragment::Text(_) | Fragment::Image(_) => 0,
        }
    }
    FRAGMENT_BYTES * fragments(&outcome.fragments.root)
}

fn cache_key(
    tree: &FormattingTree,
    node: crate::FormattingNodeId,
    space: &ConstraintSpace,
    token: Option<&BreakToken>,
) -> CacheKey {
    CacheKey {
        tree_fingerprint: tree.fingerprint(),
        root: node.0,
        space: space_key(space),
        token: token.map(token_key),
    }
}

/// Destructured without a rest pattern: a field added to the constraint
/// space does not compile until it joins the key, so a layout never
/// replays an outcome computed under a different space.
fn space_key(space: &ConstraintSpace) -> SpaceKey {
    let ConstraintSpace {
        inline_size,
        fragmentainer_remaining,
        fragmentainer_size,
        float_band,
        containing_block_size,
        line_text,
    } = *space;
    SpaceKey {
        inline_size: inline_size.to_bits(),
        fragmentainer_remaining: fragmentainer_remaining.map(f64::to_bits),
        fragmentainer_size: fragmentainer_size.map(f64::to_bits),
        float_band: float_band.map(
            |FloatBand {
                 left_inset,
                 right_inset,
                 bottom,
             }| [left_inset, right_inset, bottom].map(f64::to_bits),
        ),
        containing_block_size: containing_block_size.map(f64::to_bits),
        line_text: match line_text {
            LineText::Omitted => LineTextKey::Omitted,
            LineText::All => LineTextKey::All,
            LineText::Within { top, bottom } => {
                LineTextKey::Within([top, bottom].map(f64::to_bits))
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block::StubBlockContext;
    use crate::formatting_tree::{FormattingNode, FormattingNodeContent, FormattingNodeId};
    use rito_style_contract::LayoutStyleId;
    use std::cell::Cell;

    /// Counts provider invocations so tests can prove replay versus recompute.
    struct CountingContext {
        inner: StubBlockContext,
        calls: Cell<usize>,
    }

    impl CountingContext {
        fn new() -> Self {
            Self {
                inner: StubBlockContext,
                calls: Cell::new(0),
            }
        }
    }

    impl FormattingContext for CountingContext {
        fn layout(
            &self,
            tree: &FormattingTree,
            node: FormattingNodeId,
            space: &ConstraintSpace,
            token: Option<&BreakToken>,
            cancel: &CancelFlag,
        ) -> Result<LayoutOutcome, LayoutError> {
            self.calls.set(self.calls.get() + 1);
            self.inner.layout(tree, node, space, token, cancel)
        }

        fn intrinsic_inline_sizes(
            &self,
            tree: &FormattingTree,
            node: FormattingNodeId,
        ) -> Result<crate::IntrinsicInlineSizes, LayoutError> {
            self.inner.intrinsic_inline_sizes(tree, node)
        }
    }

    fn leaf_tree(style: u32, sizes: &[f64]) -> FormattingTree {
        let count = sizes.len() as u32;
        let mut nodes: Vec<FormattingNode> = sizes
            .iter()
            .map(|size| FormattingNode {
                style: LayoutStyleId::from_raw(style),
                content: FormattingNodeContent::SizedLeaf {
                    block_size: *size,
                    breakable: true,
                },
                children: Vec::new(),
            })
            .collect();
        nodes.push(FormattingNode {
            style: LayoutStyleId::from_raw(style),
            content: FormattingNodeContent::BlockContainer,
            children: (0..count).map(FormattingNodeId).collect(),
        });
        FormattingTree::new(nodes, FormattingNodeId(count)).expect("valid tree")
    }

    #[test]
    fn replay_equals_recompute_and_skips_the_provider() {
        let provider = CountingContext::new();
        let tree = leaf_tree(0, &[80.0, 80.0]);
        let space = ConstraintSpace::fragmented(300.0, 200.0);
        let cancel = CancelFlag::new();
        let mut cache = FragmentCache::new(1 << 20);

        let first = cache
            .layout(&provider, &tree, tree.root(), &space, None, &cancel)
            .expect("first");
        assert!(!first.from_cache);
        assert_eq!(provider.calls.get(), 1);

        let second = cache
            .layout(&provider, &tree, tree.root(), &space, None, &cancel)
            .expect("second");
        assert!(second.from_cache);
        assert_eq!(provider.calls.get(), 1);
        assert_eq!(first.outcome, second.outcome);
    }

    #[test]
    fn different_space_or_token_misses() {
        let provider = CountingContext::new();
        let tree = leaf_tree(0, &[150.0, 150.0]);
        let cancel = CancelFlag::new();
        let mut cache = FragmentCache::new(1 << 20);
        let space = ConstraintSpace::fragmented(300.0, 200.0);

        let first = cache
            .layout(&provider, &tree, tree.root(), &space, None, &cancel)
            .expect("first");
        let token = first.outcome.continuation.clone().expect("token");

        let narrower = ConstraintSpace::fragmented(280.0, 200.0);
        assert!(
            !cache
                .layout(&provider, &tree, tree.root(), &narrower, None, &cancel)
                .expect("narrower")
                .from_cache
        );
        assert!(
            !cache
                .layout(&provider, &tree, tree.root(), &space, Some(&token), &cancel)
                .expect("resumed")
                .from_cache
        );
        assert_eq!(provider.calls.get(), 3);
    }

    #[test]
    fn every_field_of_the_space_keys_the_cache() {
        let provider = CountingContext::new();
        let tree = leaf_tree(0, &[80.0]);
        let cancel = CancelFlag::new();
        let mut cache = FragmentCache::new(1 << 20);
        let base = ConstraintSpace::continuous(300.0);
        let band = |left_inset, bottom| {
            Some(FloatBand {
                left_inset,
                right_inset: 0.0,
                bottom,
            })
        };
        // Each differs from the one before it in one field only.
        let spaces = [
            base,
            ConstraintSpace {
                fragmentainer_size: Some(600.0),
                ..base
            },
            ConstraintSpace {
                fragmentainer_size: Some(600.0),
                float_band: band(96.0, 72.0),
                ..base
            },
            ConstraintSpace {
                fragmentainer_size: Some(600.0),
                float_band: band(96.0, 40.0),
                ..base
            },
            ConstraintSpace {
                fragmentainer_size: Some(600.0),
                float_band: band(96.0, 40.0),
                containing_block_size: Some(200.0),
                ..base
            },
        ];
        for space in &spaces {
            let outcome = cache
                .layout(&provider, &tree, tree.root(), space, None, &cancel)
                .expect("lays out");
            assert!(
                !outcome.from_cache,
                "{space:?} replayed another space's outcome"
            );
        }
        for space in &spaces {
            let outcome = cache
                .layout(&provider, &tree, tree.root(), space, None, &cancel)
                .expect("lays out again");
            assert!(
                outcome.from_cache,
                "{space:?} did not replay its own outcome"
            );
        }
        assert_eq!(provider.calls.get(), spaces.len());
    }

    #[test]
    fn rebuilt_tree_with_same_ids_never_replays_stale_fragments() {
        let provider = CountingContext::new();
        let cancel = CancelFlag::new();
        let mut cache = FragmentCache::new(1 << 20);
        let space = ConstraintSpace::continuous(300.0);

        let original = leaf_tree(0, &[80.0]);
        let edited = leaf_tree(0, &[90.0]);
        let first = cache
            .layout(&provider, &original, original.root(), &space, None, &cancel)
            .expect("original");
        let second = cache
            .layout(&provider, &edited, edited.root(), &space, None, &cancel)
            .expect("edited");
        assert!(!second.from_cache);
        assert_ne!(first.outcome, second.outcome);
    }

    #[test]
    fn style_reference_change_alone_changes_the_fingerprint() {
        let plain = leaf_tree(0, &[80.0]);
        let restyled = leaf_tree(1, &[80.0]);
        assert_ne!(plain.fingerprint(), restyled.fingerprint());
    }

    #[test]
    fn invalidate_node_releases_that_tree_only() {
        let provider = CountingContext::new();
        let cancel = CancelFlag::new();
        let mut cache = FragmentCache::new(1 << 20);
        let space = ConstraintSpace::continuous(300.0);
        let tree_a = leaf_tree(0, &[80.0]);
        let tree_b = leaf_tree(0, &[90.0]);

        cache
            .layout(&provider, &tree_a, tree_a.root(), &space, None, &cancel)
            .expect("a");
        cache
            .layout(&provider, &tree_b, tree_b.root(), &space, None, &cancel)
            .expect("b");
        assert_eq!(cache.len(), 2);

        cache.invalidate_node(&tree_a, FormattingNodeId(0));
        assert_eq!(cache.len(), 1);
        assert_eq!(live_uses(&cache), cache.entries.len());
        assert!(
            cache
                .layout(&provider, &tree_b, tree_b.root(), &space, None, &cancel)
                .expect("b again")
                .from_cache
        );
        assert!(
            !cache
                .layout(&provider, &tree_a, tree_a.root(), &space, None, &cancel)
                .expect("a again")
                .from_cache
        );
    }

    #[test]
    fn cancellation_computes_nothing_and_caches_nothing() {
        let provider = CountingContext::new();
        let tree = leaf_tree(0, &[80.0]);
        let space = ConstraintSpace::continuous(300.0);
        let cancel = CancelFlag::new();
        cancel.cancel();
        let mut cache = FragmentCache::new(1 << 20);

        let result = cache.layout(&provider, &tree, tree.root(), &space, None, &cancel);
        assert_eq!(result, Err(LayoutError::Cancelled));
        assert!(cache.is_empty());
        assert_eq!(cache.used_bytes(), 0);
    }

    #[test]
    fn clear_releases_all_bytes() {
        let provider = CountingContext::new();
        let tree = leaf_tree(0, &[80.0]);
        let space = ConstraintSpace::continuous(300.0);
        let cancel = CancelFlag::new();
        let mut cache = FragmentCache::new(1 << 20);

        cache
            .layout(&provider, &tree, tree.root(), &space, None, &cancel)
            .expect("fill");
        assert!(cache.used_bytes() > 0);
        cache.clear();
        assert_eq!(cache.used_bytes(), 0);
        assert!(cache.is_empty());
        assert!(
            !cache
                .layout(&provider, &tree, tree.root(), &space, None, &cancel)
                .expect("recompute")
                .from_cache
        );
    }

    #[test]
    fn byte_budget_is_never_exceeded_and_evicts_least_recently_used() {
        let provider = CountingContext::new();
        let tree = leaf_tree(0, &[80.0]);
        let cancel = CancelFlag::new();
        let one_entry_bytes = {
            let mut probe = FragmentCache::new(1 << 20);
            probe
                .layout(
                    &provider,
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(100.0),
                    None,
                    &cancel,
                )
                .expect("probe");
            probe.used_bytes()
        };

        let mut cache = FragmentCache::new(one_entry_bytes * 2);
        for width in [100.0, 200.0, 300.0] {
            cache
                .layout(
                    &provider,
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(width),
                    None,
                    &cancel,
                )
                .expect("fill");
            assert!(cache.used_bytes() <= cache_budget(&cache));
            assert_eq!(live_uses(&cache), cache.entries.len());
        }
        assert_eq!(cache.len(), 2);
        // Width 100 was least recently used and must have been evicted;
        // widths 200 and 300 must still replay.
        assert!(
            cache
                .layout(
                    &provider,
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(300.0),
                    None,
                    &cancel
                )
                .expect("300")
                .from_cache
        );
        assert!(
            cache
                .layout(
                    &provider,
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(200.0),
                    None,
                    &cancel
                )
                .expect("200")
                .from_cache
        );
        assert!(
            !cache
                .layout(
                    &provider,
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(100.0),
                    None,
                    &cancel
                )
                .expect("100")
                .from_cache
        );
    }

    #[test]
    fn outcome_larger_than_the_whole_budget_is_returned_uncached() {
        let provider = CountingContext::new();
        let tree = leaf_tree(0, &[80.0]);
        let space = ConstraintSpace::continuous(300.0);
        let cancel = CancelFlag::new();
        let mut cache = FragmentCache::new(1);

        let result = cache
            .layout(&provider, &tree, tree.root(), &space, None, &cancel)
            .expect("oversized");
        assert!(!result.from_cache);
        assert!(cache.is_empty());
        assert_eq!(cache.used_bytes(), 0);
    }

    fn cache_budget(cache: &FragmentCache) -> usize {
        cache.budget_bytes
    }

    /// The uses still standing for an entry's last one: one per entry.
    fn live_uses(cache: &FragmentCache) -> usize {
        cache
            .recency
            .iter()
            .filter(|(stamp, key)| is_last_use(&cache.entries, key, *stamp))
            .count()
    }
}
