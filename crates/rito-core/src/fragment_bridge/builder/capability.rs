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
                shared_box_capability_violation(resolved),
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
    /// elements and images are checked in full.
    pub(super) fn require_inline_capabilities(
        &mut self,
        style: StyleId,
        is_box: bool,
        what: &str,
    ) -> EpubResult<()> {
        let key = (style.raw(), is_box);
        let verdict = match self.checked_inline_styles.get(&key) {
            Some(cached) => cached.clone(),
            None => {
                let resolved = self
                    .inline
                    .style(style)
                    .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?;
                let verdict = if is_box {
                    inline_text_capability_violation(resolved)
                        .or_else(|| inline_box_capability_violation(resolved))
                } else {
                    inline_text_capability_violation(resolved)
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
    if let Some(reason) = shared_box_capability_violation(style) {
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
    if style.min_height != c::MinimumHeight::Auto {
        return Some(format!("block min-height {:?}", style.min_height));
    }
    if style.max_height != c::MaximumHeight::None {
        return Some(format!("block max-height {:?}", style.max_height));
    }
    // list-style-type inherits everywhere but only paints on
    // display: list-item boxes, which the display gate above rejects; the
    // inherited value on plain blocks is inert per CSS.
    None
}

/// Constraints shared by every box the engine lays out, replaced or not.
fn shared_box_capability_violation(style: &LayoutFormattingStyle) -> Option<String> {
    use rito_style_contract as c;
    match style.max_width {
        c::MaximumSize::None | c::MaximumSize::Value(_) => {}
        other => return Some(format!("max-width {other:?} (cap ignored)")),
    }
    // Floated blocks lay out as placed float boxes: a resolvable width is
    // used directly, and an auto width shrinks to fit its content.
    // Floated images (line-box wrapping) stay rejected at collection.
    // `clear` is implemented as clearance past active floats.
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
        c::Position::Absolute => return Some("absolute position".to_owned()),
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
