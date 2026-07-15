use serde_json::Value;

mod cleanup;

pub(crate) use cleanup::{PendingRuntimePageCleanup, PendingRuntimePageVectorCleanup};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RuntimePage<Content> {
    pub(crate) index: usize,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) paint: Option<Value>,
    pub(crate) content: Vec<Content>,
}

impl<Content> RuntimePage<Content> {
    pub(crate) fn new(
        index: usize,
        width: f64,
        height: f64,
        paint: Option<Value>,
        content: Vec<Content>,
    ) -> Self {
        Self {
            index,
            width,
            height,
            paint,
            content,
        }
    }

    pub(crate) fn set_index(&mut self, index: usize) {
        self.index = index;
    }
}

#[derive(Debug)]
pub(crate) struct RuntimePageAccumulator<Content> {
    pub(crate) pages: Vec<RuntimePage<Content>>,
    pub(crate) page_blocks: Vec<Content>,
    pub(crate) page_paint: Option<Value>,
    pub(crate) used_height: f64,
    emitted_page_count: usize,
    page_width: f64,
    page_height: f64,
}

impl<Content> RuntimePageAccumulator<Content> {
    pub(crate) fn new(page_width: f64, page_height: f64, page_paint: Option<Value>) -> Self {
        Self {
            pages: Vec::new(),
            page_blocks: Vec::new(),
            page_paint,
            used_height: 0.0,
            emitted_page_count: 0,
            page_width,
            page_height,
        }
    }

    pub(crate) fn emit_page(&mut self) {
        let page_index = self.emitted_page_count;
        self.pages.push(RuntimePage::new(
            page_index,
            self.page_width,
            self.page_height,
            self.page_paint.clone(),
            std::mem::take(&mut self.page_blocks),
        ));
        self.emitted_page_count += 1;
        self.used_height = 0.0;
    }

    pub(crate) fn has_emitted_pages(&self) -> bool {
        self.emitted_page_count > 0
    }

    pub(crate) fn take_pages(&mut self) -> Vec<RuntimePage<Content>> {
        std::mem::take(&mut self.pages)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::RuntimePage;
    use super::RuntimePageAccumulator;

    #[test]
    fn stores_page_geometry_paint_and_content() {
        let page = RuntimePage::new(
            7,
            600.0,
            800.0,
            Some(json!({ "backgroundColor": "#ffffff" })),
            vec!["block"],
        );

        assert_eq!(page.index, 7);
        assert_eq!(page.width, 600.0);
        assert_eq!(page.height, 800.0);
        assert_eq!(page.paint, Some(json!({ "backgroundColor": "#ffffff" })));
        assert_eq!(page.content, vec!["block"]);
    }

    #[test]
    fn can_reindex_after_chapter_pages_are_concatenated() {
        let mut page = RuntimePage::new(0, 600.0, 800.0, None, Vec::<()>::new());

        page.set_index(12);

        assert_eq!(page.index, 12);
    }

    #[test]
    fn accumulator_emits_page_and_resets_pending_content() {
        let mut accumulator =
            RuntimePageAccumulator::new(600.0, 800.0, Some(json!({ "backgroundColor": "#fff" })));
        accumulator.page_blocks.push("a");
        accumulator.used_height = 42.0;

        accumulator.emit_page();

        assert_eq!(accumulator.pages.len(), 1);
        assert_eq!(accumulator.pages[0].index, 0);
        assert_eq!(accumulator.pages[0].content, vec!["a"]);
        assert_eq!(
            accumulator.pages[0].paint,
            Some(json!({ "backgroundColor": "#fff" }))
        );
        assert!(accumulator.page_blocks.is_empty());
        assert_eq!(accumulator.used_height, 0.0);
    }

    #[test]
    fn taking_pages_preserves_monotonic_page_indexes() {
        let mut accumulator = RuntimePageAccumulator::new(600.0, 800.0, None);
        accumulator.page_blocks.push("first");
        accumulator.emit_page();

        let first = accumulator.take_pages();

        assert_eq!(first.len(), 1);
        assert_eq!(first[0].index, 0);
        assert!(accumulator.take_pages().is_empty());

        accumulator.page_blocks.push("second");
        accumulator.emit_page();
        let second = accumulator.take_pages();

        assert_eq!(second.len(), 1);
        assert_eq!(second[0].index, 1);
        assert!(accumulator.take_pages().is_empty());
    }
}
