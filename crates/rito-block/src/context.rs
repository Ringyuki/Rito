//! Constructing a block context and the two entry points it offers the
//! fragment contract: laying a node out into fragments, and reporting
//! its intrinsic inline sizes. The context also owns the inline-outcome
//! cache, so a fragmentainer that resumes a paragraph replays its lines
//! instead of shaping them again.

use crate::*;

impl<I: FormattingContext> BlockFormattingContext<I> {
    /// Creates a block context that lays inline flows out with `inline`.
    pub fn new(inline: I) -> Self {
        Self {
            inline,
            inline_cache: RefCell::new(FragmentCache::new(INLINE_CACHE_BUDGET_BYTES)),
        }
    }

    /// The wrapped inline provider.
    pub fn inline(&self) -> &I {
        &self.inline
    }

    /// Drops every cached inline fragment. Layout inputs the cache cannot
    /// see — host-measured font metrics, for one — make its entries stale,
    /// and a stale entry would silently outlive the change that
    /// invalidated it.
    pub fn clear_inline_cache(&self) {
        self.inline_cache.borrow_mut().clear();
    }
}

impl<I: FormattingContext> FormattingContext for BlockFormattingContext<I> {
    fn layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
    ) -> Result<LayoutOutcome, LayoutError> {
        match &tree.node(node).content {
            FormattingNodeContent::BlockContainer => {
                self.layout_container(tree, node, space, token, cancel, true, false)
            }
            FormattingNodeContent::InlineFlow { .. } => {
                // `space.inline_size` is the border-box width by contract
                // (layout_container upholds it for block children), so an
                // inline flow with its own padding must hand the provider
                // its CONTENT width — line boxes fill the containing
                // block's content area (CSS 2.1 §9.4.2) — and carry its
                // lines inside the padding. Handing the border width
                // through made every aligned line overshoot by exactly the
                // horizontal padding sum (the floated speech-bubble idiom).
                let style = container_layout_style(tree, node)?;
                let pad = |side: rito_style_contract::NonNegativeLengthPercentage| {
                    resolve_length_percentage(side.value(), space.inline_size).max(0.0)
                };
                // Used paddings sit on the LayoutUnit grid (truncation);
                // the untruncated 1em/0.1em pair at 12.16px widened the
                // line's available advance by 1/64 and skewed every
                // justify share on b19's note paragraphs.
                let grid = |px: f64| (px * 64.0).trunc() / 64.0;
                let padding_left = grid(pad(style.padding.left));
                let padding_right = grid(pad(style.padding.right));
                let padding_top = pad(style.padding.top);
                let padding_bottom = pad(style.padding.bottom);
                // A paragraph with a specified height flows at that
                // border-box height exactly like a block container: short
                // content leaves empty space, tall lines overflow visibly
                // (b74's title pill: `height: 30px; padding-top: 1em` flows
                // 54px tall around a 20.8px line).
                let fixed_height = resolve_fixed_height(style, padding_top + padding_bottom)?;
                if padding_left + padding_right + padding_top + padding_bottom == 0.0
                    && fixed_height.is_none()
                {
                    // The flow's own block is its children's containing
                    // block; with an auto height it is indefinite, so a
                    // stale ancestor height must not leak through.
                    if space.containing_block_size.is_none() {
                        return self.inline.layout(tree, node, space, token, cancel);
                    }
                    let cleared = ConstraintSpace {
                        containing_block_size: None,
                        ..*space
                    };
                    return self.inline.layout(tree, node, &cleared, token, cancel);
                }
                // A resumed paragraph left its top padding on its first
                // fragment, exactly like a resumed block container.
                let leading = if token.is_some() { 0.0 } else { padding_top };
                let sub_space = ConstraintSpace {
                    inline_size: (space.inline_size - padding_left - padding_right).max(0.0),
                    fragmentainer_remaining: space
                        .fragmentainer_remaining
                        .map(|remaining| (remaining - leading).max(0.0)),
                    fragmentainer_size: space.fragmentainer_size,
                    float_band: space.float_band,
                    // A fixed height makes this flow's block a DEFINITE
                    // containing block: percentage block sizes on its
                    // replaced children resolve against the content
                    // height (border-box minus the vertical padding).
                    containing_block_size: fixed_height
                        .map(|fixed| (fixed - padding_top - padding_bottom).max(0.0)),
                };
                let mut outcome = self.inline.layout(tree, node, &sub_space, token, cancel)?;
                // Bottom padding rides the last fragment only.
                let trailing = if outcome.continuation.is_some() {
                    0.0
                } else {
                    padding_bottom
                };
                let Fragment::Box(root) = &mut outcome.fragments.root else {
                    return Err(LayoutError::Invalid(
                        "inline provider must produce a box fragment root".to_owned(),
                    ));
                };
                for child in &mut root.children {
                    let rect = child.rect();
                    set_fragment_position(child, rect.x + padding_left, rect.y + leading);
                }
                root.rect.width = space.inline_size;
                root.rect.height += leading + trailing;
                if let Some(fixed) = fixed_height {
                    if outcome.continuation.is_none() {
                        root.rect.height = fixed;
                    }
                }
                Ok(outcome)
            }
            FormattingNodeContent::SizedLeaf { .. } => Err(LayoutError::Invalid(
                "a sized leaf has no formatting context of its own; lay out its container"
                    .to_owned(),
            )),
            FormattingNodeContent::Table => {
                let fill = matches!(
                    container_layout_style(tree, node)?.width,
                    PreferredSize::Value(_)
                );
                let fragment = self.layout_table(tree, node, space.inline_size, fill, cancel)?;
                Ok(LayoutOutcome {
                    fragments: FragmentTree {
                        root: Fragment::Box(fragment),
                    },
                    continuation: None,
                    escaped_floats: Vec::new(),
                })
            }
            FormattingNodeContent::TableRow | FormattingNodeContent::TableCell { .. } => Err(
                LayoutError::Invalid("table rows and cells lay out through their table".to_owned()),
            ),
        }
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
        match &tree.node(node).content {
            FormattingNodeContent::SizedLeaf { .. } => Ok(IntrinsicInlineSizes {
                min_content: 0.0,
                max_content: 0.0,
            }),
            FormattingNodeContent::InlineFlow { .. } => {
                let sizes = self.inline.intrinsic_inline_sizes(tree, node)?;
                Ok(own_width_contribution(tree, node, sizes)?)
            }
            FormattingNodeContent::Table | FormattingNodeContent::TableRow => {
                // A table is as wide as its widest row; a row sums its cells.
                let mut sizes = IntrinsicInlineSizes {
                    min_content: 0.0,
                    max_content: 0.0,
                };
                for child in &tree.node(node).children {
                    let child_sizes = self.intrinsic_inline_sizes(tree, *child)?;
                    if matches!(tree.node(node).content, FormattingNodeContent::TableRow) {
                        sizes.min_content += child_sizes.min_content;
                        sizes.max_content += child_sizes.max_content;
                    } else {
                        sizes.min_content = sizes.min_content.max(child_sizes.min_content);
                        sizes.max_content = sizes.max_content.max(child_sizes.max_content);
                    }
                }
                Ok(sizes)
            }
            FormattingNodeContent::TableCell { .. } | FormattingNodeContent::BlockContainer => {
                let mut sizes = IntrinsicInlineSizes {
                    min_content: 0.0,
                    max_content: 0.0,
                };
                for child in &tree.node(node).children {
                    let child_sizes = self.intrinsic_inline_sizes(tree, *child)?;
                    sizes.min_content = sizes.min_content.max(child_sizes.min_content);
                    sizes.max_content = sizes.max_content.max(child_sizes.max_content);
                }
                own_width_contribution(tree, node, sizes)
            }
        }
    }
}
