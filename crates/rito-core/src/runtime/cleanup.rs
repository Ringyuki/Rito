mod frame_cache;
mod revision;
#[cfg(test)]
mod test_support;

#[allow(unused_imports)] // LRU eviction scheduling consumes the single-frame cursor next.
pub(in crate::runtime) use frame_cache::PendingRuntimeCachedFrameCleanup;
pub(in crate::runtime) use frame_cache::PendingRuntimeFrameCacheCleanup;
#[allow(unused_imports)] // The runtime cleanup queue consumes this next.
pub(in crate::runtime) use revision::PendingRuntimeRevisionCleanup;
