// Copyright 2024 the Parley Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

/// A box to be laid out inline with text
#[derive(PartialEq, Debug, Clone)]
pub struct InlineBox {
    /// User-specified identifier for the box, which can be used by the user to determine which box in
    /// parley's output corresponds to which box in its input.
    pub id: u64,
    /// Whether the box is in-flow (takes up space in the layout) or out-of-flow (e.g. absolutely positioned or floated)
    pub kind: InlineBoxKind,
    /// The byte offset into the underlying text string at which the box should be placed.
    /// This must not be within a Unicode code point.
    pub index: usize,
    /// The width of the box in pixels
    pub width: f32,
    /// The height of the box in pixels
    pub height: f32,
}

/// Whether a box is in-flow (takes up space in the layout) or out-of-flow (e.g. absolutely positioned)
/// or custom-out-of-flow (line-breaking should yield control flow)
#[derive(PartialEq, Debug, Clone, Copy)]
pub enum InlineBoxKind {
    /// `InFlow` boxes take up space in the layout and flow in line with text
    ///
    /// They correspond to `display: inline-block` boxes in CSS.
    InFlow,
    /// `OutOfFlow` boxes are assigned a position as if they were a zero-sized inline box, but
    /// do not take up space in the layout.
    ///
    /// They correspond to `position: absolute` boxes in CSS.
    OutOfFlow,
    /// `CustomOutOfFlow` boxes also do not take up space in the layout, but they are not assigned a position
    /// by Parley. When they are encountered, control flow is yielded back to the caller who is then responsible
    /// for laying out the box.
    ///
    /// They can be used to implement advanced layout modes such as CSS's `float`
    CustomOutOfFlow,
    /// Rito: the inline-start margin, border and padding of an inline box
    /// opening at this index (Blink's open tag item). It takes its width on
    /// the line but offers no break of its own: a break the text allows at
    /// its index is taken before it, so it opens the next line together
    /// with what follows. A forced break leaves it on the line it ends.
    OpenTag,
    /// Rito: the inline-end margin, border and padding of an inline box
    /// closing at this index (Blink's close tag item). It takes its width
    /// on the line and stays with the content before it: it never opens a
    /// line, and when it overflows, the line breaks at the last opportunity
    /// before that content.
    CloseTag,
}

impl InlineBoxKind {
    /// Rito: whether the box is an inline box's start or end size, which
    /// takes width on its line but no height and no content of its own.
    pub fn is_tag(self) -> bool {
        matches!(self, Self::OpenTag | Self::CloseTag)
    }
}
