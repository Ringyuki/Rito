use serde_json::Value;

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
            page_width,
            page_height,
        }
    }

    pub(crate) fn emit_page(&mut self) {
        self.pages.push(RuntimePage::new(
            self.pages.len(),
            self.page_width,
            self.page_height,
            self.page_paint.clone(),
            std::mem::take(&mut self.page_blocks),
        ));
        self.used_height = 0.0;
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
}
