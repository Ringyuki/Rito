//! Capability gates. Each style the tree uses is checked once per chapter
//! against a whitelist of the fields the fragment engine implements; an
//! unimplemented value is recorded as a degradation (the box lays out as
//! plain block flow, the constraint is ignored) instead of failing the
//! chapter. The free functions are the whitelists: block boxes, the
//! constraints shared by every box, text-level and box-level inline fields,
//! and box decoration the painter cannot reproduce outside a block box.

use rito_style_contract::{LayoutDisplayOutside, LayoutFormattingStyle, LayoutStyleId, StyleId};

use super::length_percentage_is_zero;
use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::TreeBuilder;

impl TreeBuilder<'_> {
    /// Fail-open gate for block layout styles: an unimplemented field is
    /// recorded as a degradation and the box lays out as plain block flow
    /// (display variants flatten, exotic sizing constraints are ignored),
    /// keeping every chapter representable at reduced fidelity.
    pub(super) fn require_block_capabilities(
        &mut self,
        style: LayoutStyleId,
        what: &str,
    ) -> EpubResult<()> {
        let verdict = match self.checked_block_styles.get(&style.raw()) {
            Some(cached) => cached.clone(),
            None => {
                let resolved = self
                    .layout
                    .style(style)
                    .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?;
                let verdict = block_capability_violation(resolved);
                self.checked_block_styles
                    .insert(style.raw(), verdict.clone());
                verdict
            }
        };
        if let Some(reason) = verdict {
            self.degrade(format!("<{what}> laid out as plain block flow: {reason}"));
        }
        Ok(())
    }

    /// Whitelist gate for an image's layout style: the sizing fields are
    /// consumed by image display sizing, so more values are implemented
    /// than for plain blocks.
    pub(super) fn require_image_capabilities(&mut self, style: LayoutStyleId) -> EpubResult<()> {
        let (floated, violation) = {
            let resolved = self
                .layout
                .style(style)
                .map_err(|error| EpubError::new(format!("image style resolves: {error}")))?;
            (
                resolved.float != rito_style_contract::Float::None,
                shared_box_capability_violation(resolved, false)
                    .or_else(|| image_sizing_violation(resolved)),
            )
        };
        if floated {
            self.degrade(
                "floated image laid out in-flow (line-box wrapping is unimplemented)".to_owned(),
            );
        }
        if let Some(reason) = violation {
            self.degrade(format!("image constraint ignored: {reason}"));
        }
        Ok(())
    }

    /// Whitelist gate for inline styles. Box-level fields (margins,
    /// borders, vertical-align) do not inherit and only apply to actual
    /// inline boxes, so a text run — which borrows its nearest element's
    /// style — is checked against the text-level fields only, while inline
    /// elements and images are checked in full, an atomic inline's
    /// `vertical-align` against what atoms implement.
    pub(super) fn require_inline_capabilities(
        &mut self,
        style: StyleId,
        scope: InlineScope,
        what: &str,
    ) -> EpubResult<()> {
        let key = (style.raw(), scope);
        let verdict = match self.checked_inline_styles.get(&key) {
            Some(cached) => cached.clone(),
            None => {
                let resolved = self
                    .inline
                    .style(style)
                    .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?;
                let verdict = match scope {
                    InlineScope::Text => inline_text_capability_violation(resolved),
                    InlineScope::Box => inline_text_capability_violation(resolved)
                        .or_else(|| inline_box_capability_violation(resolved))
                        .or_else(|| inline_box_alignment_violation(resolved)),
                    InlineScope::Atom => inline_text_capability_violation(resolved)
                        .or_else(|| inline_box_capability_violation(resolved))
                        .or_else(|| atom_alignment_violation(resolved)),
                };
                self.checked_inline_styles.insert(key, verdict.clone());
                verdict
            }
        };
        if let Some(reason) = verdict {
            self.degrade(format!("{what} inline decoration ignored: {reason}"));
        }
        Ok(())
    }
}

/// Block-box whitelist: `None` means every field is implemented; `Some`
/// names the first violating field and value.
fn block_capability_violation(style: &LayoutFormattingStyle) -> Option<String> {
    use rito_style_contract as c;
    if let Some(reason) = shared_box_capability_violation(style, true) {
        return Some(reason);
    }
    match style.display {
        // A list item lays out as plain block flow; its outside marker
        // paints from the `list_markers` table without touching layout.
        c::LayoutDisplay {
            outside: LayoutDisplayOutside::Block,
            inside: c::LayoutDisplayInside::Flow | c::LayoutDisplayInside::FlowRoot,
            is_list_item: _,
        } => {}
        other => return Some(format!("display {other:?}")),
    }
    // Block width, horizontal margins (including auto centering), padding,
    // and box-sizing resolve through the block context's horizontal box
    // model; the remaining sizing constraints are still unimplemented.
    match style.width {
        c::PreferredSize::Auto | c::PreferredSize::Value(_) => {}
        other => return Some(format!("block width {other:?}")),
    }
    // Fixed heights resolve in the block context (content overflowing a
    // fixed box still fails closed at layout time); max-width caps the
    // horizontal box model.
    match style.height {
        c::PreferredSize::Auto | c::PreferredSize::Value(_) => {}
        other => return Some(format!("block height {other:?}")),
    }
    // A block's minimum and maximum block size bound it in the block
    // context; its minimum inline size and the percentage block bounds
    // (no definite basis in block flow) are not implemented.
    let block_axis_is_height = matches!(
        style.writing_mode,
        rito_style_contract::WritingMode::HorizontalTopToBottom
    );
    let (min_inline, min_block, max_block) = if block_axis_is_height {
        (style.min_width, style.min_height, style.max_height)
    } else {
        (style.min_height, style.min_width, style.max_width)
    };
    if min_inline != c::MinimumSize::Auto {
        return Some(format!("block min inline size {min_inline:?}"));
    }
    if let c::MinimumSize::Percentage(_) = min_block {
        return Some(format!("block min block size {min_block:?} (no basis)"));
    }
    match max_block {
        c::MaximumSize::None => {}
        c::MaximumSize::Value(value) if matches!(value.value(), c::LengthPercentage::Length(_)) => {
        }
        other => return Some(format!("block max block size {other:?}")),
    }
    // list-style-type inherits everywhere but only paints on
    // display: list-item boxes, which the display gate above rejects; the
    // inherited value on plain blocks is inert per CSS.
    None
}

/// Image sizing whitelist: intrinsic and stretch keywords keep the natural
/// size, as for auto.
fn image_sizing_violation(style: &LayoutFormattingStyle) -> Option<String> {
    use rito_style_contract as c;
    for (axis, size) in [("width", style.width), ("height", style.height)] {
        match size {
            c::PreferredSize::Auto | c::PreferredSize::Value(_) => {}
            other => return Some(format!("{axis} {other:?} (natural size used)")),
        }
    }
    None
}

/// Constraints shared by every box the engine lays out, replaced or not.
/// `absolute_laid_out`: the box is block-level, which the block engine
/// takes out of flow and places against its containing block when it is
/// absolutely positioned; an inline image is not.
fn shared_box_capability_violation(
    style: &LayoutFormattingStyle,
    absolute_laid_out: bool,
) -> Option<String> {
    use rito_style_contract as c;
    match style.max_width {
        c::MaximumSize::None | c::MaximumSize::Value(_) => {}
        other => return Some(format!("max-width {other:?} (cap ignored)")),
    }
    // Floated blocks lay out as placed float boxes: a resolvable width is
    // used directly, and an auto width shrinks to fit its content. A
    // floated image opening its block's content is a float box too; one
    // after content on its line stays inline (line-box wrapping), see
    // `require_image_capabilities`. `clear` is implemented as clearance
    // past active floats.
    match style.position {
        c::Position::Static => {}
        c::Position::Relative => {
            let inset_is_inert = [
                style.inset.top,
                style.inset.right,
                style.inset.bottom,
                style.inset.left,
            ]
            .iter()
            .all(|side| matches!(side, c::LengthPercentageOrAuto::Auto));
            if !inset_is_inert {
                return Some("relative position with a non-auto inset".to_owned());
            }
        }
        c::Position::Absolute if !absolute_laid_out => {
            return Some("absolute position".to_owned());
        }
        c::Position::Absolute => {}
    }

    // justify-content / align-items only affect flex containers, which the
    // display gate rejects; overflow does not change layout geometry.
    None
}

/// Text-level inline whitelist: inherited fields every text run carries.
/// Every field either holds an implemented value or provably cannot affect
/// layout (paint-only properties pass).
fn inline_text_capability_violation(
    style: &rito_style_contract::InlineFormattingStyle,
) -> Option<String> {
    use rito_style_contract as c;
    // font: families/size/weight/slant/line-height all wired into Parley.
    match style.text_flow.text_justify {
        c::TextJustify::Auto => {}
        other => return Some(format!("text-justify {other:?}")),
    }
    if style.text_flow.text_transform.case != c::TextTransformCase::None
        || style.text_flow.text_transform.full_width
        || style.text_flow.text_transform.full_size_kana
    {
        return Some("text-transform".to_owned());
    }
    match style.text_flow.white_space_collapse {
        // Preserve (`pre-wrap`/`pre`) keeps spaces and segment breaks
        // verbatim through the collector's non-collapsing path; the wrap
        // axis rides text-wrap separately (measured: a calibre story's
        // four-space paragraph indents, kept by Blink, erased by the
        // collapsing fallback — every line of the chapter shifted).
        c::WhiteSpaceCollapse::Collapse | c::WhiteSpaceCollapse::Preserve => {}
        other => return Some(format!("white-space {other:?}")),
    }
    // text-wrap, word-break, overflow-wrap, and letter/word spacing are
    // wired straight into Parley's ranged styles; percentages and calc
    // spacings have no basis in inline layout and stay rejected.
    match style.text_flow.line_break {
        c::LineBreak::Auto => {}
        other => return Some(format!("line-break {other:?}")),
    }
    match style.text_flow.letter_spacing {
        c::LengthPercentage::Length(_) => {}
        other => return Some(format!("letter-spacing {other:?}")),
    }
    match style.text_flow.word_spacing {
        c::LengthPercentage::Length(_) => {}
        other => return Some(format!("word-spacing {other:?}")),
    }
    match (
        style.bidi.direction,
        style.bidi.unicode_bidi,
        style.bidi.writing_mode,
    ) {
        // `isolate` is HTML's UA default on flow content and on any
        // `dir` element. The engine performs no bidi reordering at all
        // (a listed capability gap), so isolation is inert here rather
        // than a per-element approximation worth noting.
        (
            c::Direction::LeftToRight,
            c::UnicodeBidi::Normal | c::UnicodeBidi::Isolate,
            c::WritingMode::HorizontalTopToBottom,
        ) => {}
        // Vertical-rl flows lay out under the first vertical slice: the
        // inline axis takes the column length and the paint walk turns
        // lines into right-to-left columns (upright shaping metrics,
        // kinsoku and the pagination axis are still pending).
        (
            c::Direction::LeftToRight,
            c::UnicodeBidi::Normal | c::UnicodeBidi::Isolate,
            c::WritingMode::VerticalRightToLeft,
        ) => {}
        other => return Some(format!("bidi/writing-mode {other:?}")),
    }
    // paint (color, decoration, shadows, background, opacity, transform):
    // paint-only per CSS, no layout effect — passes.
    None
}

/// Box decoration the fragment painter cannot reproduce outside a block
/// box (inline boxes and the chapter body). Block boxes paint shadows
/// through `block_box_paint`; backgrounds and borders are checked
/// separately, so they are not this function's concern.
pub(super) fn box_decoration_violation(
    style: &rito_style_contract::InlineFormattingStyle,
) -> Option<String> {
    if !style.paint.box_shadows.is_empty() {
        return Some("box-shadow".to_owned());
    }
    None
}

/// Box-level inline whitelist: non-inherited fields that only apply to an
/// actual inline box (a styled element or an image), never to a text run
/// borrowing its ancestor's style.
fn inline_box_capability_violation(
    style: &rito_style_contract::InlineFormattingStyle,
) -> Option<String> {
    use rito_style_contract as c;
    match style.paint.background {
        c::ComputedColor::Absolute(color) if color.alpha().get() == 0.0 => {}
        other => return Some(format!("inline background {other:?}")),
    }
    if let Some(reason) = box_decoration_violation(style) {
        return Some(format!("inline {reason}"));
    }
    // Transforms paint as a block-box wrapper; an inline box carrying one
    // has no border-box the wrapper could rotate about.
    if !style.paint.transform.is_none() {
        return Some("inline transform".to_owned());
    }
    // Inline horizontal margins are modeled: they displace
    // the inline box like padding/border gaps — advance edits at the box
    // boundaries, a line indent for a span opening a forced-break line —
    // while staying outside the painted box; percentages resolve against
    // the containing block. Vertical margins have no effect on inline
    // boxes in CSS, so dropping them matches the browser.
    // Percentage padding has no inline expression; lengths are modeled.
    for (side, name) in [
        (&style.fragment.padding.top, "padding-top"),
        (&style.fragment.padding.right, "padding-right"),
        (&style.fragment.padding.bottom, "padding-bottom"),
        (&style.fragment.padding.left, "padding-left"),
    ] {
        if !matches!(side.value(), c::LengthPercentage::Length(_))
            && !length_percentage_is_zero(&side.value())
        {
            return Some(format!("inline percentage {name}"));
        }
    }
    None
}

/// The `vertical-align` an inline box implements: its baseline on its
/// parent's, raised or lowered by `super`, `sub` or nothing.
fn inline_box_alignment_violation(
    style: &rito_style_contract::InlineFormattingStyle,
) -> Option<String> {
    use rito_style_contract as c;
    match style.fragment.baseline_shift {
        c::BaselineShift::Offset(offset) if length_percentage_is_zero(&offset) => {}
        c::BaselineShift::Super | c::BaselineShift::Sub => {}
        other => return Some(format!("vertical-align {other:?}")),
    }
    match style.fragment.alignment_baseline {
        c::AlignmentBaseline::Baseline => {}
        other => return Some(format!("alignment-baseline {other:?}")),
    }
    None
}

/// The `vertical-align` an atomic inline implements: an inline box's, and
/// `top` and `middle` besides.
fn atom_alignment_violation(style: &rito_style_contract::InlineFormattingStyle) -> Option<String> {
    use rito_style_contract as c;
    match style.fragment.baseline_shift {
        c::BaselineShift::Offset(offset) if length_percentage_is_zero(&offset) => {}
        c::BaselineShift::Super | c::BaselineShift::Sub | c::BaselineShift::Top => {}
        other => return Some(format!("vertical-align {other:?}")),
    }
    match style.fragment.alignment_baseline {
        c::AlignmentBaseline::Baseline | c::AlignmentBaseline::Middle => {}
        other => return Some(format!("alignment-baseline {other:?}")),
    }
    None
}

/// What an inline style is checked as.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(in crate::fragment_bridge) enum InlineScope {
    /// A text run borrowing its element's style.
    Text,
    /// An inline box.
    Box,
    /// An atomic inline: an image or an inline-block.
    Atom,
}
