//! Inline images: the display size an author box, the intrinsic ratio and
//! the page clamp resolve to.

use crate::*;

/// How a percentage-sized replaced element behaves in a sizing pass with
/// no percentage basis, i.e. intrinsic (min/max-content) sizing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PercentageImageSizing {
    /// Contributes its intrinsic size (the max-content contribution, and
    /// the only sensible behavior once a real basis exists).
    Intrinsic,
    /// Contributes nothing: the element can shrink to any size, which is
    /// its min-content contribution.
    Shrunk,
}

/// Resolves an image's display size from its intrinsic dimensions and the
/// CSS sizing fields of its layout style.
///
/// The supported slice: `auto` sizes use the intrinsic dimension (scaled by
/// ratio when the other axis is fixed), fixed lengths are used as written,
/// and a `max-width` length or percentage caps the result preserving the
/// ratio. Percentages resolve against `available_inline_size`; in intrinsic
/// (min/max-content) sizing there is none, and percentage-based fields are
/// treated as their auto/none behavior per CSS. Everything else fails
/// closed.
#[allow(clippy::too_many_arguments)]
pub(crate) fn image_display_size(
    intrinsic_width: f64,
    intrinsic_height: f64,
    layout_style: &LayoutFormattingStyle,
    available_inline_size: Option<f64>,
    available_block_size: Option<f64>,
    containing_block_size: Option<f64>,
    percentage_images: PercentageImageSizing,
    viewport: Option<(f64, f64)>,
) -> Result<(f32, f32), LayoutError> {
    // A percentage with no basis appears only in intrinsic (min/max-
    // content) sizing, where resolving it would be circular. CSS makes
    // such a replaced element contribute nothing to its container's
    // intrinsic size, which is how a percentage-sized image lets a table
    // cell keep its own specified width instead of being forced to the
    // image's natural width.
    let percentage_without_basis = std::cell::Cell::new(false);
    let resolve = |value: LengthPercentage| -> Option<f64> {
        match value {
            LengthPercentage::Length(px) => Some(f64::from(px.get())),
            LengthPercentage::Percentage(ratio) => match available_inline_size {
                Some(basis) => Some(f64::from(ratio.ratio()) * basis),
                None => {
                    percentage_without_basis.set(true);
                    None
                }
            },
            LengthPercentage::Linear { length, percentage } => match available_inline_size {
                Some(basis) => {
                    Some(f64::from(length.get()) + f64::from(percentage.ratio()) * basis)
                }
                None => {
                    percentage_without_basis.set(true);
                    None
                }
            },
        }
    };
    // A percentage height resolves against the containing block's height,
    // not its width, and computes to `auto` when that height is indefinite
    // (CSS 2.1 §10.5) — which is the usual case in a continuous flow. Only
    // a length is definite here.
    // The containing block's height is INDEFINITE in a continuous flow,
    // so a percentage height computes to auto (CSS 2.1 §10.5) — the
    // `available_block_size` here is the reader's page CLAMP, not a
    // definite containing height (measured on b77's svg-wrapped plates:
    // height=100% resolved against the 850 clamp blew every plate to
    // full page, where the browser lays 627.219 × width·viewBox-ratio).
    // When the containing block resolved a FIXED height, that content
    // height is definite and percentages resolve against it (measured on
    // b2's plates: `height: 90vh` on the wrapper makes the img's
    // `max-height: 100%` bite at 765px where the indefinite-flow rule
    // left it at the 850px page clamp — one blank page per plate).
    let resolve_block = |value: LengthPercentage| -> Option<f64> {
        match value {
            LengthPercentage::Length(px) => Some(f64::from(px.get())),
            LengthPercentage::Percentage(ratio) => {
                containing_block_size.map(|basis| f64::from(ratio.ratio()) * basis)
            }
            LengthPercentage::Linear { length, percentage } => containing_block_size
                .map(|basis| f64::from(length.get()) + f64::from(percentage.ratio()) * basis),
        }
    };
    let preferred =
        |value: PreferredSize, axis: &str, block: bool| -> Result<Option<f64>, LayoutError> {
            match value {
                PreferredSize::Auto => Ok(None),
                PreferredSize::Value(value) => Ok(if block {
                    resolve_block(value.value())
                } else {
                    resolve(value.value())
                }),
                other => Err(LayoutError::Invalid(format!(
                    "image {axis} sizing {other:?} is not representable yet"
                ))),
            }
        };
    // The ELEMENT box of an svg-folded image sizes by the svg's own
    // viewBox ratio, not the inner raster's (they differ on covers:
    // viewBox 1434x2048 vs raster 1119x1600); the raster then
    // contain-fits inside via `fit_contain` at paint time.
    let ratio = if let Some((viewport_width, viewport_height)) = viewport {
        if viewport_width > 0.0 && viewport_height > 0.0 {
            viewport_height / viewport_width
        } else {
            1.0
        }
    } else if intrinsic_width > 0.0 && intrinsic_height > 0.0 {
        intrinsic_height / intrinsic_width
    } else {
        1.0
    };
    let preferred_width = preferred(layout_style.width, "width", false)?;
    let preferred_height = preferred(layout_style.height, "height", true)?;
    // A percentage `max-width` makes the element just as shrinkable as a
    // percentage `width` does, so it collapses the same way when there is
    // no basis to resolve against.
    if let MaximumSize::Value(cap) = layout_style.max_width {
        let _ = resolve(cap.value());
    }
    let width_percentage_without_basis = percentage_without_basis.get();
    // With BOTH axes author-specified the aspect ratio is out of the
    // picture: max-width/max-height constrain each axis independently,
    // distortion included (measured: a 723x1 strip declared 538395x1430
    // stretches full-page in the browser, not ratio-preserving). The
    // reader PAGE clamp below is different: it scales the authored box
    // uniformly, keeping whatever ratio the author resolved.
    let (mut width, mut height) = match (preferred_width, preferred_height) {
        (Some(width), Some(height)) => (width, height),
        // The ratio-derived cross axis truncates onto the 1/64 grid:
        // Blink resolves a width-authored image's auto height as a
        // LayoutUnit (measured: width 43.78125 x ratio 249/248 shows
        // 43.953125 = trunc64(43.9578) in the DOM rect).
        (Some(width), None) => (width, (width * ratio * 64.0).floor() / 64.0),
        (None, Some(height)) => (height / ratio.max(f64::EPSILON), height),
        (None, None) => (intrinsic_width, intrinsic_height),
    };
    if percentage_images == PercentageImageSizing::Shrunk {
        // Every image is width-capped at its container by the reader's
        // display policy (the truth side mirrors it as max-width: 100%),
        // and a percentage-capped replaced element is fully shrinkable in
        // the min-content pass — a table column holding a fixed-width
        // portrait shrinks to its TEXT minimum, not the image (measured:
        // a 5-column 8em/2.5em grid under a 25.5em table distributes
        // 59.2/19.4/72.3 where image-hard minimums pinned every column).
        let _ = width_percentage_without_basis;
        return Ok((0.0, 0.0));
    }
    if let MaximumSize::Value(cap) = layout_style.max_width {
        if let Some(cap) = resolve(cap.value()) {
            if width > cap && width > 0.0 {
                let scale = cap / width;
                width = cap;
                // A clamp rescales only the AUTO cross axis: an
                // author-specified axis holds and the image distorts,
                // exactly as the browser resolves CSS 2.1 §10.4 (measured:
                // a width:100% manga plate under the page-height clamp
                // keeps its 640px width — the ratio-preserving shrink to
                // 598px shifted every halftone dot on the page).
                if preferred_height.is_none() {
                    height *= scale;
                }
            }
        }
    }
    // `max-height` mirrors `max-width`: a length always binds; a
    // percentage binds only against a definite containing height. The
    // clamp rescales only the AUTO cross axis, like the max-width arm.
    let max_height_cap = match layout_style.max_height {
        rito_style_contract::MaximumHeight::None => None,
        rito_style_contract::MaximumHeight::Length(px) => Some(f64::from(px.get())),
        rito_style_contract::MaximumHeight::Percentage(ratio) => {
            containing_block_size.map(|basis| f64::from(ratio.ratio()) * basis)
        }
    };
    if let Some(cap) = max_height_cap {
        if height > cap && height > 0.0 {
            let scale = cap / height;
            height = cap;
            if preferred_width.is_none() {
                width *= scale;
            }
        }
    }
    // Reader UA policy, declared rather than implicit: a replaced element
    // never exceeds one page, and the page clamp scales the AUTHORED box
    // uniformly — both axes by one factor — so the clamp never distorts
    // (b52's 705x1000 cover under `img{width:100%}` squashed 640x907.8
    // into 640x850 when the axes clamped independently; the reader is the
    // product surface and a stretched cover is a defect, whatever a
    // browser under an injected max-height would do). A box the author
    // deliberately distorted keeps its authored ratio while shrinking.
    // The truth harness mirrors this exact policy per element.
    {
        let mut scale = 1.0_f64;
        if let Some(page_height) = available_block_size {
            if height > page_height && height > 0.0 && page_height > 0.0 {
                scale = scale.min(page_height / height);
            }
        }
        // The width cap binds on its own: inside a table cell there is
        // no block-size budget, but the container cap still holds (the
        // truth side's max-width: 100% shrinks a 6.5em portrait into its
        // 57.2px column; gating the width cap on the page height left it
        // at its authored size).
        if let Some(basis_width) = available_inline_size {
            if width > basis_width && width > 0.0 && basis_width > 0.0 {
                scale = scale.min(basis_width / width);
            }
        }
        if scale < 1.0 {
            width *= scale;
            height *= scale;
        }
    }
    // Blink stores used lengths as LayoutUnits: the resolved size floors
    // to the 1/64 grid (measured: `height: 1.2em` at a 12px font is
    // 14.390625 used, not 14.4 — the un-floored height left a footnote
    // marker's line 0.009px tall and flipped its baseline rounding).
    let layout_unit_floor = |value: f64| (value * 64.0).floor() / 64.0;
    Ok((
        layout_unit_floor(width) as f32,
        layout_unit_floor(height) as f32,
    ))
}
