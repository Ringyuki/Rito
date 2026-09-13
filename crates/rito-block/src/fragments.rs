//! Building and moving fragments: the empty leaf box, the setters that
//! place a laid-out subtree at a position or shift it by an offset, and
//! sealing a container's children into a fragment tree, with or without
//! the continuation that resumes it.

use crate::*;

/// Moves a fragment and its descendants by a physical offset.
pub(crate) fn translate_fragment(fragment: &mut Fragment, dx: f64, dy: f64) {
    match fragment {
        Fragment::Box(box_fragment) => {
            box_fragment.rect.x += dx;
            box_fragment.rect.y += dy;
        }
        Fragment::Line(line) => {
            line.rect.x += dx;
            line.rect.y += dy;
        }
        Fragment::Text(text) => {
            text.rect.x += dx;
            text.rect.y += dy;
        }
        Fragment::Image(image) => {
            image.rect.x += dx;
            image.rect.y += dy;
        }
    }
}

pub(crate) fn leaf_fragment(
    source: FormattingNodeId,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Fragment {
    Fragment::Box(BoxFragment {
        source,
        rect: FragmentRect {
            x,
            y,
            width,
            height,
        },
        children: Vec::new(),
    })
}

pub(crate) fn set_fragment_position(fragment: &mut Fragment, x: f64, y: f64) {
    match fragment {
        Fragment::Box(inner) => {
            inner.rect.x = x;
            inner.rect.y = y;
        }
        Fragment::Line(inner) => {
            inner.rect.x = x;
            inner.rect.y = y;
        }
        Fragment::Text(inner) => {
            inner.rect.x = x;
            inner.rect.y = y;
        }
        Fragment::Image(inner) => {
            inner.rect.x = x;
            inner.rect.y = y;
        }
    }
}

pub(crate) fn sealed_with_break(
    container: FormattingNodeId,
    inline_size: f64,
    used_block_size: f64,
    fragments: Vec<Fragment>,
    token: BreakToken,
) -> LayoutOutcome {
    LayoutOutcome {
        fragments: sealed(container, inline_size, used_block_size, fragments),
        continuation: Some(token),
        escaped_floats: Vec::new(),
    }
}

pub(crate) fn sealed(
    container: FormattingNodeId,
    inline_size: f64,
    used_block_size: f64,
    children: Vec<Fragment>,
) -> FragmentTree {
    FragmentTree {
        root: Fragment::Box(BoxFragment {
            source: container,
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
