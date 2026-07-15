#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CleanupProgress {
    pub(crate) consumed_units: usize,
    pub(crate) complete: bool,
}
