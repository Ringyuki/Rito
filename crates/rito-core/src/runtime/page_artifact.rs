//! Engine-neutral page boundary consumed by the runtime.
//!
//! Layout backends adapt their retained page representation in `legacy`.
//! Runtime consumers must depend on this contract rather than inspect a
//! backend's box, line, or fragment tree directly.

mod fragment;
mod interaction;

pub(in crate::runtime) use fragment::{FragmentPageArtifact, FragmentRunRecord};

use std::sync::Arc;

use crate::render::DisplayCommand;

pub(super) use interaction::*;

/// Paint-ready output for one spread. This is deliberately independent of a
/// backend's retained pages, boxes, lines, or fragments.
#[derive(Debug)]
pub(super) struct PageArtifactFrame {
    pub(super) page_indexes: Vec<usize>,
    pub(super) commands: FrameCommands,
}

/// A spread's display commands, in paint order: the frame's own around
/// each page's, which the page keeps and the frame shares rather than
/// copies.
#[derive(Debug, Default)]
pub(super) struct FrameCommands {
    parts: Vec<FramePart>,
}

#[derive(Debug)]
enum FramePart {
    Own(Vec<DisplayCommand>),
    Page(Arc<Vec<DisplayCommand>>),
}

impl FrameCommands {
    pub(super) fn push(&mut self, command: DisplayCommand) {
        match self.parts.last_mut() {
            Some(FramePart::Own(commands)) => commands.push(command),
            _ => self.parts.push(FramePart::Own(vec![command])),
        }
    }

    /// Paints a page's commands here.
    pub(super) fn push_page(&mut self, commands: Arc<Vec<DisplayCommand>>) {
        self.parts.push(FramePart::Page(commands));
    }

    pub(super) fn iter(&self) -> impl DoubleEndedIterator<Item = &DisplayCommand> + '_ {
        self.parts.iter().flat_map(|part| match part {
            FramePart::Own(commands) => commands.iter(),
            FramePart::Page(commands) => commands.iter(),
        })
    }

    #[cfg(test)]
    pub(super) fn is_empty(&self) -> bool {
        self.iter().next().is_none()
    }

    /// The commands as one list.
    #[cfg(test)]
    pub(super) fn to_vec(&self) -> Vec<DisplayCommand> {
        self.iter().cloned().collect()
    }
}

impl<'a> IntoIterator for &'a FrameCommands {
    type Item = &'a DisplayCommand;
    type IntoIter = Box<dyn Iterator<Item = &'a DisplayCommand> + 'a>;

    fn into_iter(self) -> Self::IntoIter {
        Box::new(self.iter())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PageArtifactRevisionMetadata {
    pub(super) page_count: usize,
    pub(super) spread_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PageArtifactChapterRange {
    pub(super) start_page: usize,
    pub(super) end_page: usize,
    pub(super) page_count: usize,
    pub(super) block_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PageArtifactSpread {
    pub(super) spread_index: usize,
    pub(super) left_page_index: usize,
    pub(super) right_page_index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PageArtifactSourceRunStart {
    pub(super) page_index: usize,
    pub(super) node_path: std::rc::Rc<[usize]>,
    pub(super) text_offset: usize,
    pub(super) text_length: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct PageArtifactTarget {
    pub(super) block_index: usize,
    pub(super) line_index: usize,
    pub(super) run_index: usize,
    pub(super) bounds: PageArtifactRect,
    pub(super) text: String,
    pub(super) text_length: usize,
    pub(super) href: Option<String>,
    pub(super) source_path: Option<Vec<usize>>,
    pub(super) source_text_offset: Option<usize>,
    pub(super) image_src: Option<String>,
    pub(super) image_alt: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PageArtifactTextRunOffset {
    pub(super) start: usize,
    pub(super) end: usize,
    pub(super) block_index: usize,
    pub(super) line_index: usize,
    pub(super) run_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PageArtifactTextPositions {
    pub(super) text: String,
    pub(super) text_length: usize,
    pub(super) offsets: Vec<PageArtifactTextRunOffset>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PageArtifactTextPosition {
    pub(super) block_index: usize,
    pub(super) line_index: usize,
    pub(super) run_index: usize,
    pub(super) char_index: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct PageArtifactTextRangeRect {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
    pub(super) block_index: usize,
    pub(super) line_index: usize,
    pub(super) run_index: usize,
    pub(super) start_char_index: usize,
    pub(super) end_char_index: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct PageArtifactTextRangeGeometry {
    pub(super) rects: Vec<PageArtifactTextRangeRect>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct PageArtifactMetadata {
    pub(super) page_index: usize,
    pub(super) width: f64,
    pub(super) height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct PageArtifactRect {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PageArtifactSemanticRole {
    Heading,
    Paragraph,
    List,
    ListItem,
    #[expect(
        dead_code,
        reason = "the fragment page semantics expose paragraph nodes only; link and image nodes are a recorded gap"
    )]
    Image,
    #[expect(
        dead_code,
        reason = "the fragment page semantics expose paragraph nodes only; link and image nodes are a recorded gap"
    )]
    Link,
    Blockquote,
    Table,
    Generic,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct PageArtifactSemanticNode {
    pub(super) role: PageArtifactSemanticRole,
    pub(super) level: Option<u8>,
    pub(super) text: Option<String>,
    pub(super) alt: Option<String>,
    pub(super) href: Option<String>,
    pub(super) bounds: PageArtifactRect,
    pub(super) children: Vec<PageArtifactSemanticNode>,
}

/// Borrowed, query-ready page output owned by an arbitrary layout backend.
///
/// Capabilities should be added here only as renderer-neutral artifacts. In
/// particular, do not expose a backend's retained box/fragment tree.
pub(super) trait PageArtifact {
    fn metadata(&self) -> PageArtifactMetadata;

    fn semantic_nodes(&self) -> Vec<PageArtifactSemanticNode>;

    /// The page's text runs in flow order, then its links and images.
    fn targets(&self) -> Vec<PageArtifactTarget>;

    fn text_positions(&self) -> PageArtifactTextPositions;

    fn text_range_geometry(
        &self,
        start: PageArtifactTextPosition,
        end: PageArtifactTextPosition,
    ) -> PageArtifactTextRangeGeometry;
}
