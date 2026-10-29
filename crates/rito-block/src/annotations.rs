//! Annotation space across block edges (Blink's block-start annotation
//! space): a paragraph's first-line annotations (ruby, emphasis marks)
//! reach into the space above the line before the line grows — the box's
//! top padding, the collapsed margins above it and the leading the
//! preceding block leaves under its last line's text — unless a top
//! border or the box's own formatting context closes it off. A line that opens a resumed
//! fragment has none of that space: margins meeting the break are gone
//! and the line before it sits on another page.

use crate::*;

/// How the first line a paragraph fragment places takes its ruby growth.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum LineOpening {
    /// The paragraph's first fragment: the annotations spend what the
    /// preceding line lends (`annotation_lent`) and `space` above the line.
    Start { space: f64 },
    /// A resumed fragment: nothing above lends space.
    Resumed,
}

impl LineOpening {
    /// The opening for `node`'s fragment: `space` above it when it is the
    /// paragraph's first, none when it resumes.
    pub(crate) fn for_flow(resumed: bool, space: f64) -> Self {
        if resumed {
            Self::Resumed
        } else {
            Self::Start { space }
        }
    }

    /// `line` as the first line of its fragment, and how much taller that
    /// made it. The growth moves the line's baseline and content down
    /// inside a box grown by as much; the line's top stays.
    pub(crate) fn open(self, line: &Fragment) -> (Fragment, f64) {
        let Fragment::Line(fragment) = line else {
            return (line.clone(), 0.0);
        };
        let growth = match self {
            Self::Start { space } => {
                (fragment.annotation_growth - fragment.annotation_lent - space).max(0.0)
            }
            Self::Resumed => fragment.annotation_overflow,
        };
        let delta = growth - fragment.annotation_growth;
        if delta == 0.0 {
            return (line.clone(), 0.0);
        }
        let mut opened = fragment.clone();
        opened.rect.height += delta;
        opened.baseline += delta;
        opened.annotation_growth = growth;
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
/// the block's bottom edge (bottom padding, whatever a fixed or minimum
/// height adds past the content, and the empty blocks after the line).
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
            // Annotations reaching under a block's last line stay in the
            // block: what follows reuses none of the space past them.
            Fragment::Line(line) if line.annotation_space_end < 0.0 => None,
            Fragment::Line(line) => Some(AnnotationEnd {
                line: PrecedingLine {
                    below: (line.rect.height - line.baseline).max(0.0),
                    fonts: line.fonts,
                    half_leading: flow_font_size(tree, line.source)?
                        .map_or(0.0, |size| line.glyphless_end_space(size)),
                    annotation_space: line.annotation_space_end,
                },
                space: 0.0,
            }),
            Fragment::Box(inner) => {
                let inner_style = container_layout_style(tree, inner.source)?;
                // Floats and positioned boxes are out of flow: the block
                // ends with the in-flow content before them.
                if inner_style.float != Float::None || inner_style.position == Position::Absolute {
                    continue;
                }
                match block_annotation_end(tree, child)? {
                    Some(end) => Some(end),
                    // An empty block passes the space before it on.
                    None if passes_annotation_space(tree, child)? => continue,
                    None => None,
                }
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

/// Whether a placed in-flow block hands the annotation space before it on
/// to what follows, its own block size added: one holding no line box
/// whose block size is not zero, closed off by neither a block-end border
/// nor a formatting context of its own (Blink's block-end annotation space
/// of a block with no content: the space it was given plus its block
/// size; a self-collapsing block leaves none).
pub(crate) fn passes_annotation_space(
    tree: &FormattingTree,
    fragment: &Fragment,
) -> Result<bool, LayoutError> {
    fn holds_line(fragment: &Fragment) -> bool {
        match fragment {
            Fragment::Line(_) => true,
            Fragment::Box(block) => block.children.iter().any(holds_line),
            Fragment::Text(_) | Fragment::Image(_) => false,
        }
    }
    let Fragment::Box(block) = fragment else {
        return Ok(false);
    };
    if block.rect.height <= 0.0 || holds_line(fragment) {
        return Ok(false);
    }
    let style = container_layout_style(tree, block.source)?;
    Ok(!is_flow_root(style) && style.flow_border_widths().block_end.get() == 0.0)
}

/// Whether an inline flow holds any annotation: a ruby annotation, or
/// text that takes emphasis marks.
pub(crate) fn flow_has_annotations(
    tree: &FormattingTree,
    items: &[rito_fragment::InlineItem],
) -> bool {
    let styles = tree.styles();
    items.iter().any(|item| match item {
        rito_fragment::InlineItem::Text {
            ruby_annotation: Some(_),
            ..
        } => true,
        rito_fragment::InlineItem::Text { style, .. } => styles
            .and_then(|styles| styles.inline.style(*style).ok())
            .is_some_and(|style| style.text_flow.text_emphasis.is_some()),
        _ => false,
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
