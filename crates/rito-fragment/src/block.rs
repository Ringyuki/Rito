//! Minimal block formatting context: bounded vertical stacking of sized
//! leaves inside block containers, splitting at fragmentainer boundaries.
//!
//! This exists so the contract's own tests (creation, resumption,
//! determinism, no-gap/no-repeat fragmentation) run against a real provider.
//! It is intentionally not a browser-grade block context: no margins,
//! collapsing, intrinsic sizing, or clearance.

use crate::break_token::{BreakToken, BreakTokenStage};
use crate::constraint_space::ConstraintSpace;
use crate::context::{
    CancelFlag, FormattingContext, IntrinsicInlineSizes, LayoutError, LayoutOutcome,
};
use crate::formatting_tree::{FormattingNodeContent, FormattingNodeId, FormattingTree};
use crate::fragment::{BoxFragment, Fragment, FragmentRect, FragmentTree};

/// The substrate's stub block provider.
#[derive(Clone, Copy, Debug, Default)]
pub struct StubBlockContext;

impl FormattingContext for StubBlockContext {
    fn layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
    ) -> Result<LayoutOutcome, LayoutError> {
        let root = node;
        let children = match &tree.node(root).content {
            FormattingNodeContent::BlockContainer => tree.node(root).children.clone(),
            other => {
                return Err(LayoutError::Invalid(format!(
                    "stub block root must be a container, got {other:?}"
                )))
            }
        };
        let (start_child, mut consumed) = resume_point(&children, token)?;
        let mut remaining = space.fragmentainer_remaining.unwrap_or(f64::INFINITY);
        let mut y = 0.0_f64;
        let mut fragments = Vec::new();
        for (index, child_id) in children.iter().enumerate().skip(start_child) {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            let child = tree.node(*child_id);
            let FormattingNodeContent::SizedLeaf {
                block_size,
                breakable,
            } = child.content
            else {
                return Err(LayoutError::Invalid(
                    "stub block children must be sized leaves".to_owned(),
                ));
            };
            let outstanding = block_size - consumed;
            consumed = 0.0;
            if outstanding <= remaining {
                fragments.push(leaf_fragment(*child_id, y, space.inline_size, outstanding));
                y += outstanding;
                remaining -= outstanding;
                continue;
            }
            if breakable && remaining > 0.0 {
                fragments.push(leaf_fragment(*child_id, y, space.inline_size, remaining));
                let already = block_size - (outstanding - remaining);
                return Ok(outcome_with_break(
                    root,
                    space.inline_size,
                    y + remaining,
                    fragments,
                    BreakToken {
                        resume_path: vec![*child_id],
                        stage: BreakTokenStage::Inside {
                            consumed_block_size: already,
                        },
                    },
                ));
            }
            // The child does not fit and cannot split: break before it. A
            // monolithic child taller than a whole fragmentainer still makes
            // progress on a fresh fragmentainer rather than looping.
            if !fragments.is_empty() || space.fragmentainer_remaining != space.fragmentainer_size {
                return Ok(outcome_with_break(
                    root,
                    space.inline_size,
                    y,
                    fragments,
                    BreakToken {
                        resume_path: vec![*child_id],
                        stage: BreakTokenStage::Before,
                    },
                ));
            }
            fragments.push(leaf_fragment(*child_id, y, space.inline_size, outstanding));
            y += outstanding;
            let next = children.get(index + 1);
            return Ok(LayoutOutcome {
                fragments: sealed(root, space.inline_size, y, fragments),
                continuation: next.map(|next_id| BreakToken {
                    resume_path: vec![*next_id],
                    stage: BreakTokenStage::Before,
                }),
            });
        }
        Ok(LayoutOutcome {
            fragments: sealed(root, space.inline_size, y, fragments),
            continuation: None,
        })
    }

    fn intrinsic_inline_sizes(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
    ) -> Result<IntrinsicInlineSizes, LayoutError> {
        if node.0 as usize >= tree.len() {
            return Err(LayoutError::Invalid(format!(
                "intrinsic-size query for out-of-bounds node {}",
                node.0
            )));
        }
        // Sized leaves are opaque in the inline axis (block-size only), so
        // they contribute no inline preference; a container's bounds are the
        // widest of its children's.
        match &tree.node(node).content {
            FormattingNodeContent::SizedLeaf { .. } => Ok(IntrinsicInlineSizes {
                min_content: 0.0,
                max_content: 0.0,
            }),
            FormattingNodeContent::InlineFlow { .. } => Err(LayoutError::Invalid(
                "stub block context cannot size inline flows".to_owned(),
            )),
            FormattingNodeContent::BlockContainer => {
                let mut sizes = IntrinsicInlineSizes {
                    min_content: 0.0,
                    max_content: 0.0,
                };
                for child in &tree.node(node).children {
                    let child_sizes = self.intrinsic_inline_sizes(tree, *child)?;
                    sizes.min_content = sizes.min_content.max(child_sizes.min_content);
                    sizes.max_content = sizes.max_content.max(child_sizes.max_content);
                }
                Ok(sizes)
            }
        }
    }
}

fn resume_point(
    children: &[FormattingNodeId],
    token: Option<&BreakToken>,
) -> Result<(usize, f64), LayoutError> {
    let Some(token) = token else {
        return Ok((0, 0.0));
    };
    let Some(target) = token.resume_path.first() else {
        return Err(LayoutError::Invalid(
            "break token carries an empty resume path".to_owned(),
        ));
    };
    let index = children
        .iter()
        .position(|child| child == target)
        .ok_or_else(|| {
            LayoutError::Invalid(format!("break token resumes at unknown child {}", target.0))
        })?;
    match token.stage {
        BreakTokenStage::Before => Ok((index, 0.0)),
        BreakTokenStage::Inside {
            consumed_block_size,
        } => Ok((index, consumed_block_size)),
    }
}

fn leaf_fragment(source: FormattingNodeId, y: f64, inline_size: f64, height: f64) -> Fragment {
    Fragment::Box(BoxFragment {
        source,
        rect: FragmentRect {
            x: 0.0,
            y,
            width: inline_size,
            height,
        },
        children: Vec::new(),
    })
}

fn outcome_with_break(
    root: FormattingNodeId,
    inline_size: f64,
    used_block_size: f64,
    fragments: Vec<Fragment>,
    token: BreakToken,
) -> LayoutOutcome {
    LayoutOutcome {
        fragments: sealed(root, inline_size, used_block_size, fragments),
        continuation: Some(token),
    }
}

fn sealed(
    root: FormattingNodeId,
    inline_size: f64,
    used_block_size: f64,
    children: Vec<Fragment>,
) -> FragmentTree {
    FragmentTree {
        root: Fragment::Box(BoxFragment {
            source: root,
            rect: FragmentRect {
                x: 0.0,
                y: 0.0,
                width: inline_size,
                height: used_block_size,
            },
            children,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rito_style_contract::LayoutStyleId;

    fn leaf(block_size: f64, breakable: bool) -> crate::FormattingNode {
        crate::FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::SizedLeaf {
                block_size,
                breakable,
            },
            children: Vec::new(),
        }
    }

    fn tree(leaves: Vec<crate::FormattingNode>) -> FormattingTree {
        let count = leaves.len() as u32;
        let mut nodes = leaves;
        nodes.push(crate::FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::BlockContainer,
            children: (0..count).map(FormattingNodeId).collect(),
        });
        FormattingTree::new(nodes, FormattingNodeId(count)).expect("valid tree")
    }

    fn box_children(outcome: &LayoutOutcome) -> &[Fragment] {
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("stub block roots are box fragments");
        };
        &root.children
    }

    #[test]
    fn fragments_across_fragmentainers_with_no_gap_and_no_repeat() {
        let tree = tree(vec![leaf(80.0, true), leaf(80.0, true), leaf(80.0, true)]);
        let space = ConstraintSpace::fragmented(300.0, 200.0);
        let context = StubBlockContext;

        let first = context
            .layout(&tree, tree.root(), &space, None, &CancelFlag::new())
            .expect("first page");
        let first_children = box_children(&first);
        assert_eq!(first_children.len(), 3);
        assert_eq!(first_children[2].rect().height, 40.0);
        let token = first.continuation.clone().expect("break token");
        assert_eq!(
            token.stage,
            BreakTokenStage::Inside {
                consumed_block_size: 40.0
            }
        );

        let second = context
            .layout(&tree, tree.root(), &space, Some(&token), &CancelFlag::new())
            .expect("second page");
        let second_children = box_children(&second);
        assert_eq!(second_children.len(), 1);
        assert_eq!(second_children[0].rect().height, 40.0);
        assert!(second.continuation.is_none());

        let total: f64 = first_children
            .iter()
            .chain(second_children)
            .map(|fragment| fragment.rect().height)
            .sum();
        assert_eq!(total, 240.0);
    }

    #[test]
    fn resumption_is_deterministic() {
        let tree = tree(vec![leaf(150.0, true), leaf(150.0, true)]);
        let space = ConstraintSpace::fragmented(300.0, 200.0);
        let context = StubBlockContext;
        let first = context
            .layout(&tree, tree.root(), &space, None, &CancelFlag::new())
            .expect("first");
        let token = first.continuation.clone().expect("token");
        let resumed_a = context
            .layout(&tree, tree.root(), &space, Some(&token), &CancelFlag::new())
            .expect("a");
        let resumed_b = context
            .layout(&tree, tree.root(), &space, Some(&token), &CancelFlag::new())
            .expect("b");
        assert_eq!(resumed_a, resumed_b);
    }

    #[test]
    fn unbreakable_child_moves_whole_to_the_next_fragmentainer() {
        let tree = tree(vec![leaf(150.0, true), leaf(120.0, false)]);
        let space = ConstraintSpace::fragmented(300.0, 200.0);
        let context = StubBlockContext;

        let first = context
            .layout(&tree, tree.root(), &space, None, &CancelFlag::new())
            .expect("first");
        assert_eq!(box_children(&first).len(), 1);
        let token = first.continuation.clone().expect("token");
        assert_eq!(token.stage, BreakTokenStage::Before);

        let second = context
            .layout(&tree, tree.root(), &space, Some(&token), &CancelFlag::new())
            .expect("second");
        let children = box_children(&second);
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].rect().height, 120.0);
        assert!(second.continuation.is_none());
    }

    #[test]
    fn monolithic_child_taller_than_a_fragmentainer_still_progresses() {
        let tree = tree(vec![leaf(500.0, false), leaf(50.0, true)]);
        let space = ConstraintSpace::fragmented(300.0, 200.0);
        let context = StubBlockContext;

        let first = context
            .layout(&tree, tree.root(), &space, None, &CancelFlag::new())
            .expect("first");
        assert_eq!(box_children(&first)[0].rect().height, 500.0);
        let token = first.continuation.clone().expect("token");

        let second = context
            .layout(&tree, tree.root(), &space, Some(&token), &CancelFlag::new())
            .expect("second");
        assert_eq!(box_children(&second)[0].rect().height, 50.0);
        assert!(second.continuation.is_none());
    }

    #[test]
    fn continuous_layout_never_breaks() {
        let tree = tree(vec![leaf(500.0, true), leaf(500.0, true)]);
        let space = ConstraintSpace::continuous(300.0);
        let context = StubBlockContext;
        let outcome = context
            .layout(&tree, tree.root(), &space, None, &CancelFlag::new())
            .expect("continuous");
        assert!(outcome.continuation.is_none());
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("stub block roots are box fragments");
        };
        assert_eq!(root.rect.height, 1000.0);
    }
}
