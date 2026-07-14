use crate::{
    layout::{
        inline_atoms::{create_owned_image_atom, create_owned_inline_block_atom},
        inline_segment::InlineSegment,
        text_work::{AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield},
    },
    style::StyledNode,
};

use super::{context::OwnedInlineContext, ActiveCollection, PendingInlineCandidateCollector};

#[derive(Debug, Clone, Copy)]
pub(super) enum AtomicNodeKind {
    Image,
    InlineBlock,
}

#[derive(Debug)]
pub(super) struct PendingAtomicNode {
    pub(super) kind: AtomicNodeKind,
    pub(super) node: StyledNode,
    pub(super) context: OwnedInlineContext,
    pub(super) image_sizes_enabled: bool,
}

impl PendingInlineCandidateCollector {
    pub(super) fn advance_atomic(
        &mut self,
        atomic: Box<PendingAtomicNode>,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if matches!(
            work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
            TextWorkPermitResult::Yield
        ) {
            self.active = Some(ActiveCollection::Atomic(atomic));
            return Err(TextWorkYield);
        }
        let PendingAtomicNode {
            kind,
            node,
            context,
            image_sizes_enabled,
        } = *atomic;
        let segment = match kind {
            AtomicNodeKind::Image => {
                let image_sizes = image_sizes_enabled
                    .then_some(self.image_sizes.as_deref())
                    .flatten();
                let atom = create_owned_image_atom(node, image_sizes);
                context.finish_image_atom(atom)
            }
            AtomicNodeKind::InlineBlock => create_owned_inline_block_atom(node),
        };
        super::super::reset_whitespace_after_atom(&mut self.whitespace);
        self.active = Some(super::committing(InlineSegment::Atom(segment)));
        Ok(())
    }
}
