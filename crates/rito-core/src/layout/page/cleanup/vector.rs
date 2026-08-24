use std::{num::NonZeroUsize, vec::IntoIter};

use super::{CleanupProgress, LayoutPage, PendingRuntimePageCleanup};

#[derive(Debug)]
#[allow(dead_code)] // Runtime revision retirement consumes this cursor next.
pub(crate) struct PendingRuntimePageVectorCleanup {
    owner: Option<Vec<LayoutPage>>,
    pages: Option<IntoIter<LayoutPage>>,
    page: Option<PendingRuntimePageCleanup>,
    stage: PageVectorCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageVectorCleanupStage {
    PagesSource,
    Pages,
    Complete,
}

#[allow(dead_code)] // Direct tests precede runtime revision retirement wiring.
impl PendingRuntimePageVectorCleanup {
    pub(crate) fn new(owner: Vec<LayoutPage>) -> Self {
        Self {
            owner: Some(owner),
            pages: None,
            page: None,
            stage: PageVectorCleanupStage::PagesSource,
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        self.stage == PageVectorCleanupStage::Complete
    }

    pub(crate) fn advance_one(&mut self) -> bool {
        match self.stage {
            PageVectorCleanupStage::PagesSource => self.start_pages(),
            PageVectorCleanupStage::Pages => self.advance_pages(),
            PageVectorCleanupStage::Complete => false,
        }
    }

    pub(crate) fn advance(&mut self, budget: NonZeroUsize) -> CleanupProgress {
        let mut consumed_units = 0;
        while consumed_units < budget.get() && self.advance_one() {
            consumed_units += 1;
        }
        let progress = CleanupProgress {
            consumed_units,
            complete: self.is_complete(),
        };
        debug_assert!(progress.complete || progress.consumed_units == budget.get());
        progress
    }

    pub(crate) fn drain(&mut self) {
        loop {
            let progress = self.advance(NonZeroUsize::MAX);
            debug_assert!(progress.complete || progress.consumed_units == usize::MAX);
            if progress.complete {
                return;
            }
        }
    }

    fn start_pages(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its page vector");
        self.pages = Some(owner.into_iter());
        self.stage = PageVectorCleanupStage::Pages;
        true
    }

    fn advance_pages(&mut self) -> bool {
        if self.page.as_ref().is_some_and(|page| page.is_complete()) {
            self.page = None;
            return true;
        }
        if let Some(page) = self.page.as_mut() {
            return page.advance_one();
        }
        let pages = self.pages.as_mut().expect("page source exists");
        if let Some(page) = pages.next() {
            self.page = Some(PendingRuntimePageCleanup::new(page));
            return self
                .page
                .as_mut()
                .expect("active page cleanup exists")
                .advance_one();
        }
        self.pages = None;
        self.stage = PageVectorCleanupStage::Complete;
        true
    }
}

impl Drop for PendingRuntimePageVectorCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}
