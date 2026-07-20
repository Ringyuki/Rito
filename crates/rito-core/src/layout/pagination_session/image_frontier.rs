use std::{collections::BTreeSet, sync::Arc};

use super::{ContinuousLayoutSession, LayoutWorkMeter};
use crate::{
    layout::{continuous_layout::ContinuousLayoutCursor, image_size::ImageSizeIndex, LineBreaking},
    style::{StyledNode, StyledNodeKind},
};

impl ContinuousLayoutSession {
    pub(crate) fn new_with_lazy_image_frontier(
        nodes: Vec<StyledNode>,
        content_width: f64,
        content_height: f64,
        image_sizes: ImageSizeIndex,
        line_breaking: LineBreaking,
    ) -> Self {
        Self::new_with_cursor(
            nodes,
            content_width,
            content_height,
            Arc::new(image_sizes),
            line_breaking,
            ContinuousLayoutCursor::default(),
            Some(0),
        )
    }

    pub(crate) fn reserve_next_image_frontier(
        &mut self,
        work: &LayoutWorkMeter,
    ) -> Option<Vec<String>> {
        if !work.can_prepare_root_frontier()
            || self.cursor.has_active_node()
            || !self.ready_nodes.is_empty()
        {
            return None;
        }
        let prepared = self.prepared_root_image_frontier.as_mut()?;
        if *prepared != 0 {
            return None;
        }
        let node = self.pending_nodes.front()?;
        let mut hrefs = BTreeSet::new();
        collect_image_hrefs(node, &mut hrefs);
        *prepared = 1;
        Some(hrefs.into_iter().collect())
    }

    pub(crate) fn extend_image_sizes(
        &mut self,
        dimensions: impl IntoIterator<Item = (String, u32, u32)>,
    ) {
        Arc::make_mut(&mut self.image_sizes).extend_dimensions(dimensions);
    }
}

fn collect_image_hrefs(root: &StyledNode, hrefs: &mut BTreeSet<String>) {
    let mut pending = vec![root];
    while let Some(node) = pending.pop() {
        if node.node_type == StyledNodeKind::Image {
            if let Some(src) = node.src.as_ref() {
                hrefs.insert(src.clone());
            }
        }
        pending.extend(node.children.iter());
    }
}
