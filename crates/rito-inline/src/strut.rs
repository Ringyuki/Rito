//! Struts and measurement: declared and normal line heights, the
//! baseline a fixed-height line places, decorated inline box anchors, and
//! the advance a styled string shapes to.

use crate::*;

impl ParleyInlineContext {
    /// The paragraph's CSS strut height. Declared line-heights resolve
    /// directly; `normal` is the strut style's primary font's normal
    /// line, the metrics a browser strut uses.
    pub(crate) fn resolved_strut_height(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
    ) -> Result<Option<f64>, LayoutError> {
        let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
            return Ok(None);
        };
        let Some(styles) = tree.styles() else {
            return Ok(None);
        };
        let style_id = match tree.strut_style(node) {
            Some(style) => style,
            None => match items.first() {
                Some(InlineItem::Text { style, .. })
                | Some(InlineItem::Image { style, .. })
                | Some(InlineItem::InlineBlock { style, .. })
                | Some(InlineItem::EmptyBox { style, .. }) => *style,
                None => return Ok(None),
            },
        };
        let style = styles
            .inline
            .style(style_id)
            .map_err(|error| LayoutError::Invalid(error.to_string()))?;
        Ok(Some(match style.font.line_height {
            LineHeight::Number(_) | LineHeight::Length(_) => {
                used_declared_line_height(style.font.line_height, f64::from(style.font.size.get()))
                    .unwrap_or(0.0)
            }
            LineHeight::Normal => self
                .normal_line(style, &LineProbe::Strut)
                .map_or(0.0, |metric| metric.height),
        }))
    }

    /// Shaped advance of `text` under `style`, optionally at an
    /// overridden font size, from a one-line throwaway layout. Ruby
    /// spread sizing measures the annotation (at the rt cascade size,
    /// inheriting everything else) and the base against each other.
    pub(crate) fn measure_styled_advance(
        &self,
        style: &InlineFormattingStyle,
        size_override: Option<f32>,
        text: &str,
    ) -> f64 {
        if text.is_empty() {
            return 0.0;
        }
        let mut sized;
        let style = match size_override
            .and_then(|size| rito_style_contract::NonNegativeCssPx::new(size).ok())
        {
            Some(size) => {
                sized = style.clone();
                sized.font.size = size;
                &sized
            }
            None => style,
        };
        let mut fonts = self.fonts.borrow_mut();
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = SpacingBuilder::new(layouts.ranged_builder(&mut fonts, text, 1.0, true));
        push_item_styles(&mut builder, style, 0..text.len());
        let (mut layout, _) = builder.build(text);
        layout.break_all_lines(None);
        let advance = layout
            .lines()
            .next()
            .map_or(0.0, |line| f64::from(line.metrics().advance));
        advance
    }
}

/// Quantizes a CSS length the way Blink's LayoutUnit stores it (1/64 px,
/// nearest). A declared `line-height: 1.2em` at 16px is 19.2 in CSS
/// arithmetic but 19.203125 in every Blink layout position; without this
/// the engine's block stacking drifts a fraction per line against the
/// browser.
pub(crate) fn layout_unit(value: f64) -> f64 {
    (value * 64.0).round() / 64.0
}

/// Quantizes a shaped width the way Blink stores an inline box's inline
/// size: the float advance sum ceiled onto the 1/64 px grid. The 1/1024
/// margin absorbs float summation dust just above a grid point (a width
/// that is exactly on the grid in fixed point must not climb a whole
/// 1/64); real off-grid widths sit at least 1/128 away and keep their
/// ceiling.
pub fn layout_unit_ceil(value: f64) -> f64 {
    (((value - 1.0 / 1024.0) * 64.0).ceil() / 64.0).max(0.0)
}

/// Quantizes a CSS length the way Blink's LayoutUnit float constructor
/// stores it: truncated toward zero onto the 1/64 px grid.
pub(crate) fn layout_unit_trunc(value: f64) -> f64 {
    (value * 64.0).trunc() / 64.0
}

/// A font size as Blink's style reports it to layout: the computed size
/// rounded to a whole pixel (`FontDescription::ComputedPixelSize`, and
/// `ComputedStyle::FontSize()` returns that int). Laws that scale a font
/// size — a ruby overhang's cap at half the annotation font, a font-size
/// comparison between neighbours — read this, not the float size.
pub(crate) fn computed_pixel_size(size: f32) -> i32 {
    (size + 0.5).floor() as i32
}

/// The used line-box height of a declared line-height, on Blink's grid.
/// The quantization is TYPE-sensitive (measured, pinned Latin and CJK
/// faces agree on every case — font metrics never enter): a NUMBER
/// multiplies the font size and FLOORS to 1/64 (1.35 × 12.16 = 16.416
/// lays 16.40625; 1.2 × 16 = 19.2 lays 19.1875), while a LENGTH — px,
/// em, %, all resolved to px at computed-value time — ROUNDS half-up
/// (line-height: 19.2px lays 19.203125; 1.35em over 12.16px, the same
/// 16.416, lays 16.421875; 15.8046875px lays 15.8125). The engine's old
/// uniform round put the b20 note strut two 64ths tall and shifted every
/// later paragraph in the column by 1/32.
pub(crate) fn used_declared_line_height(line_height: LineHeight, font_size: f64) -> Option<f64> {
    match line_height {
        // The number multiplies the font size AFTER it snaps to the
        // LayoutUnit grid by rounding; the product then floors. Measured
        // in Chromium across 14 font sizes (five content shapes each,
        // content-independent): every on-grid size matches a plain
        // floored product, while off-grid sizes discriminate in both
        // directions — 24.32×1.35 lays 32.8125 = floor64(1.35 ×
        // round64(24.32)=24.3125), one 64th SHORTER than the floored raw
        // product, and 30.4×1.35 lays 41.046875, one 64th TALLER (13.3,
        // 17.1, 19.55 likewise). A real book's 1.6em divider paragraphs
        // under 0.95em body sizing sat one 64th tall per divider and
        // pushed a mid-page line across a device-row boundary.
        LineHeight::Number(number) => {
            let grid_font_size = (font_size * 64.0).round() / 64.0;
            Some((f64::from(number.get()) * grid_font_size * 64.0).floor() / 64.0)
        }
        LineHeight::Length(px) => Some(layout_unit(f64::from(px.get()))),
        LineHeight::Normal => None,
    }
}

/// The raster anchor a decorated inline box hands its runs, or `None`
/// for an undecorated span (bare text snaps off the line box). The
/// browser's paint re-anchors at the decorated box: its absolute top
/// rounds to a device row, the top edge (border + LayoutUnit-quantized
/// padding) rounds within it, and the baseline sits the primary font's
/// integer ascent below — measured on 22px/24px bordered spans sharing a
/// 309.5625 layout baseline that raster one row apart (309 and 310).
pub(crate) fn item_box_snap(
    resolved: &InlineFormattingStyle,
    metric: Option<NormalLineMetric>,
) -> Option<rito_fragment::BoxSnap> {
    use rito_style_contract::BorderStyle;
    let side_px = |value: &rito_style_contract::NonNegativeLengthPercentage| match value.value() {
        LengthPercentage::Length(px) => f64::from(px.get()),
        _ => 0.0,
    };
    let edge_px = |edge: &rito_style_contract::BorderEdge| {
        if matches!(edge.style, BorderStyle::None | BorderStyle::Hidden) {
            0.0
        } else {
            f64::from(edge.resolved_width.get())
        }
    };
    let padding = &resolved.fragment.padding;
    let border = &resolved.fragment.border;
    let decorated = [
        side_px(&padding.top),
        side_px(&padding.right),
        side_px(&padding.bottom),
        side_px(&padding.left),
        edge_px(&border.top),
        edge_px(&border.right),
        edge_px(&border.bottom),
        edge_px(&border.left),
    ]
    .iter()
    .any(|px| *px > 0.0);
    if !decorated {
        return None;
    }
    let (int_ascent, int_descent) = metric?.grid;
    Some(rito_fragment::BoxSnap {
        int_ascent,
        int_descent,
        edge_top: edge_px(&border.top) + layout_unit(side_px(&padding.top)),
        edge_bottom: edge_px(&border.bottom) + layout_unit(side_px(&padding.bottom)),
    })
}
