//! A cache a pass over many entries cannot empty: an entry used once is
//! kept on probation, one used again is protected, and eviction takes the
//! least recently used entry on probation first. A book-wide layout uses
//! most of its entries once; it displaces other entries used once, and
//! the protected ones (the chapter being read, laid out at every size of
//! a window being resized) stay.
//!
//! Protected entries hold at most their share of the budget; past it the
//! least recently used of them goes back on probation.

use std::{collections::BTreeMap, hash::Hash};

use rustc_hash::FxHashMap;

pub(crate) struct SegmentedLru<K, V> {
    entries: FxHashMap<K, Slot<V>>,
    /// Last use → key, per segment, so the least recently used is first.
    probation: BTreeMap<u64, K>,
    protected: BTreeMap<u64, K>,
    clock: u64,
    probation_bytes: usize,
    protected_bytes: usize,
    budget: usize,
    protected_budget: usize,
}

struct Slot<V> {
    value: V,
    bytes: usize,
    used: u64,
    protected: bool,
}

impl<K: Clone + Eq + Hash, V> SegmentedLru<K, V> {
    /// A cache holding `budget` bytes, of which protected entries hold at
    /// most `protected_budget`.
    pub(crate) fn new(budget: usize, protected_budget: usize) -> Self {
        Self {
            entries: FxHashMap::default(),
            probation: BTreeMap::new(),
            protected: BTreeMap::new(),
            clock: 0,
            probation_bytes: 0,
            protected_bytes: 0,
            budget,
            protected_budget,
        }
    }

    /// The entry under `key`, protected from now on: it was used again.
    pub(crate) fn get(&mut self, key: &K) -> Option<&V> {
        let slot = self.entries.get_mut(key)?;
        self.clock += 1;
        if slot.protected {
            self.protected.remove(&slot.used);
        } else {
            self.probation.remove(&slot.used);
            self.probation_bytes -= slot.bytes;
            self.protected_bytes += slot.bytes;
            slot.protected = true;
        }
        slot.used = self.clock;
        self.protected.insert(self.clock, key.clone());
        self.demote_overflow();
        self.entries.get(key).map(|slot| &slot.value)
    }

    /// Keeps `value`, `bytes` large, under `key`: on probation, unless the
    /// entry it replaces was protected. A value larger than the budget is
    /// not kept.
    pub(crate) fn insert(&mut self, key: K, value: V, bytes: usize) {
        if bytes > self.budget {
            return;
        }
        let protected = self.remove(&key).is_some_and(|old| old.protected);
        self.clock += 1;
        if protected {
            self.protected.insert(self.clock, key.clone());
            self.protected_bytes += bytes;
        } else {
            self.probation.insert(self.clock, key.clone());
            self.probation_bytes += bytes;
        }
        self.entries.insert(
            key,
            Slot {
                value,
                bytes,
                used: self.clock,
                protected,
            },
        );
        self.demote_overflow();
        while self.probation_bytes + self.protected_bytes > self.budget {
            let Some((_, oldest)) = self
                .probation
                .pop_first()
                .or_else(|| self.protected.pop_first())
            else {
                break;
            };
            if let Some(evicted) = self.entries.remove(&oldest) {
                if evicted.protected {
                    self.protected_bytes -= evicted.bytes;
                } else {
                    self.probation_bytes -= evicted.bytes;
                }
            }
        }
    }

    pub(crate) fn clear(&mut self) {
        self.entries.clear();
        self.probation.clear();
        self.protected.clear();
        self.probation_bytes = 0;
        self.protected_bytes = 0;
    }

    fn remove(&mut self, key: &K) -> Option<Slot<V>> {
        let slot = self.entries.remove(key)?;
        if slot.protected {
            self.protected.remove(&slot.used);
            self.protected_bytes -= slot.bytes;
        } else {
            self.probation.remove(&slot.used);
            self.probation_bytes -= slot.bytes;
        }
        Some(slot)
    }

    /// Puts the least recently used protected entries back on probation,
    /// as the most recently used there, until the protected fit their share.
    fn demote_overflow(&mut self) {
        while self.protected_bytes > self.protected_budget {
            let Some((_, oldest)) = self.protected.pop_first() else {
                break;
            };
            let Some(slot) = self.entries.get_mut(&oldest) else {
                continue;
            };
            self.clock += 1;
            slot.protected = false;
            slot.used = self.clock;
            self.protected_bytes -= slot.bytes;
            self.probation_bytes += slot.bytes;
            self.probation.insert(self.clock, oldest);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SegmentedLru;

    fn kept(cache: &SegmentedLru<u32, u32>, keys: impl IntoIterator<Item = u32>) -> Vec<u32> {
        keys.into_iter()
            .filter(|key| cache.entries.contains_key(key))
            .collect()
    }

    #[test]
    fn a_pass_of_entries_used_once_leaves_the_entries_used_again() {
        let mut cache = SegmentedLru::new(10, 7);
        for key in 0..3 {
            cache.insert(key, key, 1);
        }
        for key in 0..3 {
            assert_eq!(cache.get(&key), Some(&key));
        }
        for key in 100..200 {
            cache.insert(key, key, 1);
        }
        assert_eq!(kept(&cache, 0..3), vec![0, 1, 2]);
        // The pass kept its newest on probation, within the budget.
        assert_eq!(kept(&cache, 100..200), (193..200).collect::<Vec<_>>());
    }

    #[test]
    fn entries_used_once_go_least_recently_used_first() {
        let mut cache = SegmentedLru::new(4, 3);
        for key in 0..6 {
            cache.insert(key, key, 1);
        }
        assert_eq!(kept(&cache, 0..6), vec![2, 3, 4, 5]);
    }

    #[test]
    fn protected_entries_past_their_share_go_back_on_probation() {
        let mut cache = SegmentedLru::new(6, 3);
        for key in 0..4 {
            cache.insert(key, key, 1);
            cache.get(&key);
        }
        // 0, the least recently used of four protected, is on probation
        // again: the next pass of entries used once takes it.
        assert_eq!(kept(&cache, 0..4), vec![0, 1, 2, 3]);
        for key in 100..110 {
            cache.insert(key, key, 1);
        }
        assert_eq!(kept(&cache, 0..4), vec![1, 2, 3]);
    }

    #[test]
    fn a_replaced_entry_keeps_its_protection() {
        let mut cache = SegmentedLru::new(4, 3);
        cache.insert(0, 0, 1);
        cache.get(&0);
        cache.insert(0, 10, 1);
        for key in 100..110 {
            cache.insert(key, key, 1);
        }
        assert_eq!(cache.get(&0), Some(&10));
    }

    #[test]
    fn a_value_larger_than_the_budget_is_not_kept() {
        let mut cache = SegmentedLru::new(4, 3);
        cache.insert(0, 0, 1);
        cache.insert(1, 1, 5);
        assert_eq!(kept(&cache, 0..2), vec![0]);
    }
}
