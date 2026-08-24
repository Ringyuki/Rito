//! Input-keyed fragment cache.
//!
//! Layout is a deterministic pure function of `(tree, space, token)`, so a
//! cache entry keyed by those inputs can replay an outcome without invoking
//! the provider. The tree component of the key is its content fingerprint:
//! trees are immutable, so a fingerprint match means byte-equal layout
//! input even across rebuilt trees, and a rebuilt chapter naturally misses
//! instead of replaying stale fragments.
//!
//! Styles live outside the tree (typed references into the shared style
//! table), so a style-table edit changes layout without changing the tree.
//! Callers own that dependency and must call [`FragmentCache::invalidate_node`]
//! for every node whose resolved style changed.
//!
//! Memory is bounded by a byte budget measured over the canonical serialized
//! size of each outcome — the same encoding the artifacts cross boundaries
//! with, so accounting is deterministic across platforms. Least-recently-used
//! entries are evicted first.

use std::collections::HashMap;

use crate::break_token::BreakToken;
use crate::constraint_space::ConstraintSpace;
use crate::context::{CancelFlag, FormattingContext, LayoutError, LayoutOutcome};
use crate::formatting_tree::FormattingTree;
use crate::serialize::encode_layout_outcome;

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
    /// Constraint space by f64 bit pattern: conservative (distinguishes
    /// `0.0` from `-0.0`) but never conflates distinct inputs.
    inline_size_bits: u64,
    fragmentainer_remaining_bits: Option<u64>,
    fragmentainer_size_bits: Option<u64>,
    /// Break token in canonical form; `None` for a from-the-start layout.
    token: Option<TokenKey>,
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
    entries: HashMap<CacheKey, CacheEntry>,
}

impl FragmentCache {
    /// An empty cache that will never hold more than `budget_bytes` of
    /// serialized outcome data.
    pub fn new(budget_bytes: usize) -> Self {
        Self {
            budget_bytes,
            used_bytes: 0,
            clock: 0,
            entries: HashMap::new(),
        }
    }

    /// Replays a cached outcome for these exact inputs, or invokes the
    /// provider and caches the result.
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
        let key = cache_key(tree, node, space, token);
        self.clock += 1;
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.last_used = self.clock;
            return Ok(CachedLayout {
                outcome: entry.outcome.clone(),
                from_cache: true,
            });
        }
        let outcome = provider.layout(tree, node, space, token, cancel)?;
        let bytes = encode_layout_outcome(&outcome).len();
        if bytes <= self.budget_bytes {
            self.evict_until_fits(bytes);
            self.used_bytes += bytes;
            self.entries.insert(
                key,
                CacheEntry {
                    outcome: outcome.clone(),
                    bytes,
                    covered_nodes: tree.len() as u32,
                    last_used: self.clock,
                },
            );
        }
        Ok(CachedLayout {
            outcome,
            from_cache: false,
        })
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
    }

    fn evict_until_fits(&mut self, incoming_bytes: usize) {
        while self.used_bytes + incoming_bytes > self.budget_bytes {
            // Unique clock stamps make the LRU victim deterministic even
            // though HashMap iteration order is not.
            let Some(victim) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| key.clone())
            else {
                return;
            };
            if let Some(entry) = self.entries.remove(&victim) {
                self.used_bytes -= entry.bytes;
            }
        }
    }
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
        inline_size_bits: space.inline_size.to_bits(),
        fragmentainer_remaining_bits: space.fragmentainer_remaining.map(f64::to_bits),
        fragmentainer_size_bits: space.fragmentainer_size.map(f64::to_bits),
        token: token.map(token_key),
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
}
