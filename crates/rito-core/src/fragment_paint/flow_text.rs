//! Each inline flow's concatenated item text, which its text fragments
//! address by byte range, built once per paint however many of the flow's
//! lines the paint draws: a paragraph of thousands of lines is joined once,
//! not once a line.

use std::{cell::RefCell, ops::Range, rc::Rc, sync::Arc};

use rito_fragment::{FormattingNodeId, InlineItem};
use rustc_hash::FxHashMap;

/// One flow's item text and where each text item sits in it.
pub(super) struct FlowText {
    /// The text items' text in order, shared by every run cut from it.
    pub(super) text: Arc<str>,
    /// Each text item's byte range in `text`, with its item index.
    pub(super) item_ranges: Vec<(Range<usize>, usize)>,
}

/// The flow texts one paint has joined, by inline-flow node.
#[derive(Default)]
pub(super) struct FlowTexts(RefCell<FxHashMap<u32, Rc<FlowText>>>);

impl FlowTexts {
    /// The text of the flow `flow`, whose items are `items`.
    pub(super) fn of(&self, flow: FormattingNodeId, items: &[InlineItem]) -> Rc<FlowText> {
        if let Some(text) = self.0.borrow().get(&flow.0) {
            return Rc::clone(text);
        }
        let mut text = String::new();
        let mut item_ranges = Vec::new();
        for (item_index, item) in items.iter().enumerate() {
            if let InlineItem::Text { text: item_text, .. } = item {
                let start = text.len();
                text.push_str(item_text);
                item_ranges.push((start..text.len(), item_index));
            }
        }
        let joined = Rc::new(FlowText {
            text: text.into(),
            item_ranges,
        });
        self.0.borrow_mut().insert(flow.0, Rc::clone(&joined));
        joined
    }
}
