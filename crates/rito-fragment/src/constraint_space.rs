use crate::fragment::LineFonts;

/// Typed layout constraints for one formatting-context invocation.
///
/// A constraint space is a pure value: equal spaces plus an equal tree and
/// break token must produce byte-equal fragments, which is what makes
/// input-keyed fragment caching sound.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ConstraintSpace {
    /// Available inline-axis size in CSS px.
    pub inline_size: f64,
    /// Remaining block-axis space in the current fragmentainer, in CSS px.
    /// `None` means unfragmented (continuous) layout; this field alone
    /// decides whether an invocation may fragment.
    pub fragmentainer_remaining: Option<f64>,
    /// Total block size of one fragmentainer, in CSS px. Present without
    /// `fragmentainer_remaining`, it is pure context: the layout stays
    /// continuous but describes content that page-sized fragmentainers
    /// will slice, which reader semantics (such as scaling a replaced
    /// image down to one page) need to know about.
    pub fragmentainer_size: Option<f64>,
    /// Inline space floats withhold from the top of this layout. Line
    /// boxes inside the band are narrowed and offset; content below it
    /// uses the full inline size, exactly as CSS floats shorten line
    /// boxes rather than displacing the block box.
    pub float_band: Option<FloatBand>,
    /// The containing block's DEFINITE content height, when the parent
    /// resolved a fixed `height`. Percentage block sizes on replaced
    /// children resolve against it (CSS 2.1 §10.5); absent, they behave
    /// as auto. Distinct from `fragmentainer_size`, which is the page
    /// clamp, not a containing block.
    pub containing_block_size: Option<f64>,
    /// Which line boxes carry their text fragments.
    pub line_text: LineText,
    /// The last line box of the in-flow block before this flow, when this
    /// flow's first-line annotations may reuse the space under its text
    /// (part of Blink's block-start annotation space). Only a flow with
    /// ruby reads it.
    pub preceding_line: Option<PrecedingLine>,
}

/// A line box above a flow's first line, as that line's annotations read
/// it: how far its box reaches below its baseline and which fonts shaped
/// its text.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PrecedingLine {
    /// Distance from the line's baseline to its box bottom, CSS px.
    pub below: f64,
    /// The fonts its glyph runs were shaped with.
    pub fonts: LineFonts,
    /// Its half-leading (see [`empty_line_half_leading`]): all the space
    /// an empty line lends, having no text to measure under.
    pub half_leading: f64,
    /// Its block-end annotation space (`LineFragment::
    /// annotation_space_end`), what an emphasis mark over the next line
    /// may reuse; never negative, as an overflow under a block's last line
    /// stays in that block.
    pub annotation_space: f64,
}

/// The half-leading of a line box `line_height` tall in a flow whose font
/// is `font_size`, on Blink's LayoutUnit grid: what an empty line (no
/// glyph runs) lends a following annotation, its content area being the
/// font size centred in the box.
pub fn empty_line_half_leading(line_height: f64, font_size: f64) -> f64 {
    let height = (line_height * 64.0).round();
    let size = (font_size * 64.0).trunc();
    ((height - size).max(0.0) / 2.0).floor() / 64.0
}

/// Which line boxes of a layout carry their text fragments. Without them a
/// layout breaks, sizes and stacks every line, and breaks every
/// fragmentainer, exactly as with them, but places nothing along a line
/// (inline positions are not meaningful): pagination reads no text, and a
/// page laid out again from its break token with them is the page.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LineText {
    /// No line carries its text.
    Omitted,
    /// Every line does.
    All,
    /// The lines whose box starts within this block range of the inline
    /// flow, in its own coordinates and ends included, do: the lines a
    /// block container slicing the flow can place in one fragmentainer,
    /// or the lines near one window of a continuous layout. Laid out on a
    /// box, the range is in the box's coordinates and reaches the lines of
    /// the flows inside it. Others may carry theirs too (a float's, placed
    /// only once it is laid out, or every line of a flow the range covers
    /// whole); a line without its text is laid out as under
    /// [`LineText::Omitted`].
    Within { top: f64, bottom: f64 },
}

impl LineText {
    /// Whether a line whose box starts `top` into the flow carries its
    /// text.
    pub fn at(self, top: f64) -> bool {
        match self {
            Self::Omitted => false,
            Self::All => true,
            Self::Within { top: start, bottom } => start <= top && top <= bottom,
        }
    }

    /// The same lines, for a box or flow that starts `offset` down this
    /// layout's block axis: a range moves into its coordinates.
    #[must_use]
    pub fn below(self, offset: f64) -> Self {
        match self {
            Self::Within { top, bottom } => Self::Within {
                top: top - offset,
                bottom: bottom - offset,
            },
            other => other,
        }
    }

    /// The same lines, and those down to `by` further: for a flow whose
    /// lines may move up by as much once placed.
    #[must_use]
    pub fn reaching(self, by: f64) -> Self {
        match self {
            Self::Within { top, bottom } => Self::Within {
                top,
                bottom: bottom + by,
            },
            other => other,
        }
    }

    /// Every line, unless none: for a box whose place is only known once it
    /// is laid out (a float), which a range cannot reach into.
    #[must_use]
    pub fn whole(self) -> Self {
        match self {
            Self::Omitted => Self::Omitted,
            Self::All | Self::Within { .. } => Self::All,
        }
    }
}

/// One band of float exclusion at the top of a layout's block axis.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FloatBand {
    /// Inline space withheld on the line-left side.
    pub left_inset: f64,
    /// Inline space withheld on the line-right side.
    pub right_inset: f64,
    /// Block-axis extent of the band, measured from this layout's origin.
    pub bottom: f64,
}

impl ConstraintSpace {
    /// Continuous, unfragmented layout at the given inline size.
    pub fn continuous(inline_size: f64) -> Self {
        Self {
            inline_size,
            fragmentainer_remaining: None,
            fragmentainer_size: None,
            float_band: None,
            containing_block_size: None,
            line_text: LineText::All,
            preceding_line: None,
        }
    }

    /// Fragmented layout with a full fragmentainer available.
    pub fn fragmented(inline_size: f64, fragmentainer_size: f64) -> Self {
        Self {
            inline_size,
            fragmentainer_remaining: Some(fragmentainer_size),
            fragmentainer_size: Some(fragmentainer_size),
            float_band: None,
            containing_block_size: None,
            line_text: LineText::All,
            preceding_line: None,
        }
    }
}
