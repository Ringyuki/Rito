//! Ruby annotation space across block edges (Blink's block-start
//! annotation space): a paragraph's first-line annotations reach into the
//! space above the line before the line grows — the box's top padding,
//! the collapsed margins above it and the leading the preceding block
//! leaves under its last line's text — unless a top border or the box's
//! own formatting context closes it off. A line that opens a resumed
//! fragment has none of that space: margins meeting the break are gone
//! and the line before it sits on another page.

use crate::*;

/// How the first line a paragraph fragment places takes its ruby growth.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum LineOpening {
    /// The paragraph's first fragment: the annotations spend what the
    /// preceding line lends (`ruby_lent`) and `space` above the line.
    Start { space: f64 },
    /// A resumed fragment: nothing above lends space.
    Resumed,
    /// The line keeps the growth its provider gave it (a vertical flow,
    /// whose block axis the box model does not turn yet).
    Kept,
}

impl LineOpening {
    /// The opening for `node`'s fragment: `space` above it when it is the
    /// paragraph's first, none when it resumes.
    pub(crate) fn for_flow(
        tree: &FormattingTree,
        node: FormattingNodeId,
        resumed: bool,
        space: f64,
    ) -> Result<Self, LayoutError> {
        Ok(if flow_is_vertical(tree, node)? {
            Self::Kept
        } else if resumed {
            Self::Resumed
        } else {
            Self::Start { space }
        })
    }

    /// `line` as the first line of its fragment, and how much taller that
    /// made it. The growth moves the line's baseline and content down
    /// inside a box grown by as much; the line's top stays.
    pub(crate) fn open(self, line: &Fragment) -> (Fragment, f64) {
        let Fragment::Line(fragment) = line else {
            return (line.clone(), 0.0);
        };
        let growth = match self {
            Self::Start { space } => (fragment.ruby_growth - fragment.ruby_lent - space).max(0.0),
            Self::Resumed => fragment.ruby_overflow,
            Self::Kept => fragment.ruby_growth,
        };
        let delta = growth - fragment.ruby_growth;
        if delta == 0.0 {
            return (line.clone(), 0.0);
        }
        let mut opened = fragment.clone();
        opened.rect.height += delta;
        opened.baseline += delta;
        opened.ruby_growth = growth;
        if let Some(marker) = &mut opened.marker {
            marker.y += delta;
        }
        for child in &mut opened.children {
            let rect = child.rect();
            set_fragment_position(child, rect.x, rect.y + delta);
        }
        (Fragment::Line(opened), delta)
    }
}

/// What an in-flow block leaves for the annotations of the paragraph
/// after it: its last line, and the space from that line's box down to
/// the block's bottom edge (bottom padding, and whatever a fixed height
/// adds past the content).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct AnnotationEnd {
    pub(crate) line: PrecedingLine,
    pub(crate) space: f64,
}

/// The annotation end of a placed in-flow block fragment, or none when a
/// bottom border or the block's own formatting context closes it, or the
/// block does not end with a line box (Blink's block-end annotation
/// space).
pub(crate) fn block_annotation_end(
    tree: &FormattingTree,
    fragment: &Fragment,
) -> Result<Option<AnnotationEnd>, LayoutError> {
    let Fragment::Box(block) = fragment else {
        return Ok(None);
    };
    let style = container_layout_style(tree, block.source)?;
    if is_flow_root(style) || style.flow_border_widths().block_end.get() > 0.0 {
        return Ok(None);
    }
    for child in block.children.iter().rev() {
        let end = match child {
            Fragment::Line(line) => {
                if flow_is_vertical(tree, line.source)? {
                    return Ok(None);
                }
                Some(AnnotationEnd {
                    line: PrecedingLine {
                        below: (line.rect.height - line.baseline).max(0.0),
                        fonts: line.fonts,
                        half_leading: flow_font_size(tree, line.source)?.map_or(0.0, |size| {
                            rito_fragment::empty_line_half_leading(line.rect.height, size)
                        }),
                    },
                    space: 0.0,
                })
            }
            Fragment::Box(inner) => {
                let inner_style = container_layout_style(tree, inner.source)?;
                // Floats and positioned boxes are out of flow: the block
                // ends with the in-flow content before them.
                if inner_style.float != Float::None || inner_style.position == Position::Absolute {
                    continue;
                }
                block_annotation_end(tree, child)?
            }
            Fragment::Text(_) | Fragment::Image(_) => None,
        };
        let rect = child.rect();
        return Ok(end.map(|end| AnnotationEnd {
            space: end.space + (block.rect.height - (rect.y + rect.height)).max(0.0),
            ..end
        }));
    }
    Ok(None)
}

/// Whether an inline flow holds any ruby annotation.
pub(crate) fn flow_has_ruby(items: &[rito_fragment::InlineItem]) -> bool {
    items.iter().any(|item| {
        matches!(
            item,
            rito_fragment::InlineItem::Text {
                ruby_annotation: Some(_),
                ..
            }
        )
    })
}

/// The font size of `node`'s inline flow, as its strut style gives it.
fn flow_font_size(
    tree: &FormattingTree,
    node: FormattingNodeId,
) -> Result<Option<f64>, LayoutError> {
    let (Some(styles), Some(strut)) = (tree.styles(), tree.strut_style(node)) else {
        return Ok(None);
    };
    let style = styles
        .inline
        .style(strut)
        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
    Ok(Some(f64::from(style.font.size.get())))
}

/// Whether `node`'s inline flow sets its lines vertically.
fn flow_is_vertical(tree: &FormattingTree, node: FormattingNodeId) -> Result<bool, LayoutError> {
    let (Some(styles), Some(strut)) = (tree.styles(), tree.strut_style(node)) else {
        return Ok(false);
    };
    let style = styles
        .inline
        .style(strut)
        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
    Ok(style.bidi.writing_mode == rito_style_contract::WritingMode::VerticalRightToLeft)
}
