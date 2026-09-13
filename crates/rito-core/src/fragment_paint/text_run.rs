//! One text run inside a horizontal line: its painted baseline (the line
//! box top rounded to a whole CSS pixel, the within-line baseline added,
//! the sum rounded once on the device grid; a run in a decorated inline
//! box re-anchors at the box's own snapped top), the inline box band
//! extent the paint carries, the slice of the ruby annotation this
//! segment of a split base carries and its cluster distribution over the
//! base, and the glyph cluster origins with the enclosing link's target.

use rito_fragment::{InlineItem, LineFragment, TextFragment};

use std::collections::BTreeMap;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::FlowItemSource;
use crate::render::{display_number, display_rect, DisplayCommand, DisplayTextCommand};

use super::run_style::run_paint;
use super::{cluster_x, painted_baseline, snap_css, PaintFamilyPolicy, CANVAS_TOP_ASCENT_RATIO};

#[allow(clippy::too_many_arguments)]
pub(super) fn append_text_run_command(
    commands: &mut Vec<DisplayCommand>,
    items: &[InlineItem],
    styles: &rito_fragment::FormattingTreeStyles,
    full_text: &str,
    text_ranges: &[(std::ops::Range<usize>, usize)],
    item_extents: &BTreeMap<usize, (f64, f64)>,
    line: &LineFragment,
    run: &TextFragment,
    line_x: f64,
    line_y: f64,
    family_policy: Option<&PaintFamilyPolicy>,
    item_sources: Option<&[FlowItemSource]>,
    ruby_annotation_runs: Option<&BTreeMap<(u32, usize), rito_inline::MeasuredRuby>>,
    snap_origin_y: f64,
    ratio: f64,
) -> EpubResult<()> {
    let start = run.text_start as usize;
    let end = run.text_end as usize;
    // The inline provider brushes every glyph run with its item index, so
    // a run always lies inside exactly one item; a run that straddles two
    // items would paint one item's style over the other's text.
    let (_, item_index) = text_ranges
        .iter()
        .find(|(range, _)| range.start <= start && end <= range.end)
        .ok_or_else(|| {
            EpubError::new(format!(
                "text run bytes {start}..{end} do not lie inside one inline item"
            ))
        })?;
    let InlineItem::Text {
        style,
        baseline_shift_px,
        ruby_annotation,
        ..
    } = &items[*item_index]
    else {
        return Err(EpubError::new("text run maps to a non-text inline item"));
    };
    let style = styles
        .inline
        .style(*style)
        .map_err(|error| EpubError::new(format!("text run has no inline style: {error}")))?;
    // A span shaping into several glyph runs still paints ONE inline box:
    // only the run at the item's start carries the start edge and left
    // padding, only the run at its end carries the end edge and right
    // padding.
    let (item_range, _) = text_ranges
        .iter()
        .find(|(range, _)| range.start <= start && end <= range.end)
        .cloned()
        .unwrap_or((start..end, 0));
    // The run closing its item on this line ends where the browser's
    // item fragment ends: the item's start plus its width on the 1/64
    // grid (its band and decoration line end there too).
    let rect_width = item_extents
        .get(item_index)
        .filter(|(_, right)| (run.rect.x + run.rect.width - right).abs() < 1e-9)
        .map_or(run.rect.width, |(left, right)| {
            left + rito_inline::layout_unit_ceil(right - left) - run.rect.x
        });
    let mut paint = run_paint(
        style,
        family_policy,
        // A ruby spread's interior gap rides the same painted
        // letter-spacing knob as justify shares (they never coexist on
        // one run: a spread base receives no interior justification).
        run.justify_px + run.ruby_gap_px,
        start == item_range.start,
        end == item_range.end,
    )?;
    let font_size = f64::from(style.font.size.get());
    // The run's baseline is the line's, raised by the item's own shift;
    // the paint rect starts one canvas-'top' ascent above it and spans the
    // em box. The line box height travels separately so consumers can
    // reconstruct line geometry.
    //
    // Blink's raster snap is TWO-STAGE (probed, 16/16 discriminating
    // matrix at 1×): the line box top rounds to a whole CSS pixel, and
    // the run's within-line baseline rounds on top of it — on the DEVICE
    // grid, the one place the ratio enters (a 64-phase sweep at 1.5×, 2×
    // and 3× lands every glyph on round(ratio × (round(top) + baseline));
    // rounding the within-line baseline to a device row on its own
    // matched only half the phases at 2× and 3×). Canvas 'alphabetic'
    // fillText rounds the value it is handed once, so the two stages are
    // pre-composed here. For the common integer within-line baseline the
    // integer commutes with the round and this equals rounding the sum —
    // which is why handing the fractional sum through reproduced the
    // browser's 27/27/28 alternating ink pitch. A raised marker image
    // gives the line a FRACTIONAL within-line baseline, and there the
    // stages disagree with the summed round by one row (a footnote
    // marker line at line top .609375 with baseline 20.71875 paints at
    // 132 + 21, not round(152.328125) = 152).
    // The line-top round happens in the snap origin's space: absolute
    // outside transforms (origin 0), border-box-relative inside one —
    // composed with the transform command's layer-origin translate this
    // reproduces round(box) + round(local), the browser's quantized
    // layer raster.
    // A run inside a decorated inline box re-anchors at the BOX instead
    // (measured on 22px/24px bordered spans sharing one 309.5625 layout
    // baseline that raster one row apart): the box's absolute top rounds
    // to a whole CSS pixel, the top border+padding edge rounds within
    // it, and the baseline hangs the primary font's integer ascent
    // below, the whole sum rounded once on the device grid like any
    // other baseline. The box's snapped extent rides the paint so the
    // painter strokes the decoration on those exact rows. For an
    // undecorated run the formula would collapse to the line-box snap
    // (integer ascent and integer within-line baseline commute with the
    // round), so bare text keeps the two-stage path verbatim.
    // Beside the painted (device-grid) baseline, the CSS-grid baseline:
    // the same line-top round without the device round of the sum. The
    // inline band and the decoration line snap on the CSS grid from it —
    // the browser rounds them from the layout baseline to whole CSS
    // pixels — where the glyph baseline at 2× can sit on an odd device
    // row, half a CSS pixel from the line the browser draws.
    let (baseline, css_baseline) = match &run.box_snap {
        Some(snap) => {
            let layout_baseline = line_y + line.baseline - baseline_shift_px;
            let box_top = layout_baseline - snap.int_ascent - snap.edge_top;
            let box_bottom = layout_baseline + snap.int_descent + snap.edge_bottom;
            let painted_top = snap_origin_y + snap_css(box_top - snap_origin_y);
            let painted_bottom = snap_origin_y + snap_css(box_bottom - snap_origin_y);
            let within_box = snap_css(snap.edge_top) + snap.int_ascent;
            let baseline = painted_baseline(snap_origin_y, box_top, within_box, ratio);
            let em_top = baseline - CANVAS_TOP_ASCENT_RATIO * font_size;
            paint.set_box_offsets(painted_top - em_top, painted_bottom - em_top);
            (baseline, painted_top + within_box)
        }
        None => {
            // The ruby-annotation growth belongs to the LINE BOX TOP:
            // the browser shifts the grown line down by the analytic
            // growth and then rasters it exactly like a plain line —
            // round(top + growth) + round(natural baseline). Measured
            // on the dual-pipeline ruby probe (six line-top phases,
            // FZBWKS 16px/rt 0.55, lh 20.8, interior growth 5.2): the
            // painted pitch from the previous plain line is the integer
            // layout pitch 26 at EVERY phase, where folding the growth
            // into the baseline and ceiling it painted 27 on five of
            // the six phases. The historical interior case (top
            // 553.1875, baseline 15, growth 6.484375 rastering at 575)
            // satisfies this law too: round(559.671875) + 15 = 575 —
            // the earlier per-stage-ceil reading fit that one point but
            // not the phase sweep.
            let line_top = line_y + line.ruby_growth;
            let within_line = line.baseline - baseline_shift_px - line.ruby_growth;
            (
                painted_baseline(snap_origin_y, line_top, within_line, ratio),
                snap_origin_y + snap_css(line_top - snap_origin_y) + within_line,
            )
        }
    };
    let em_top = baseline - CANVAS_TOP_ASCENT_RATIO * font_size;
    // The decoration line rides the CSS-grid baseline: its offset was
    // resolved against the run rect, which hangs off the painted one.
    paint.shift_decoration(css_baseline - baseline);
    // A run with a background but no padding or border is no decorated
    // box for layout (it anchors off the line box like bare text), yet
    // the browser still paints its band from the primary font's grid-fit
    // ascent to its descent around the baseline (canvas fontBoundingBox:
    // a highlighted 20px title paints a 24px band, not its em box). The
    // extent rides the paint so the lowering fills the rows the browser
    // does; without a grid metric the lowering falls back to the em box.
    if run.box_snap.is_none() && paint.has_box_paint() {
        if let Some((ascent, descent)) = run.font_grid {
            paint.set_box_offsets(
                css_baseline - ascent - em_top,
                css_baseline + descent - em_top,
            );
        }
    }
    // A base split across lines carries the annotation words whose
    // character midpoints fall over each segment (measured: 正|规勇者
    // under "Legal Brave" paints Legal on 正's line and Brave on the
    // next; single-word Leprechaun rides whichever segment holds its
    // midpoint — the whole annotation for front-heavy splits). The
    // allocation replays the same pure function layout used.
    let segment_annotation = ruby_annotation.as_ref().and_then(|annotation| {
        let total = item_range.end.saturating_sub(item_range.start);
        if total == 0 {
            return None;
        }
        let seg_start = full_text
            .get(item_range.start..start)
            .map_or(0.0, |prefix| prefix.chars().count() as f64);
        let seg_end = full_text
            .get(item_range.start..end)
            .map_or(0.0, |prefix| prefix.chars().count() as f64);
        let total_chars = full_text
            .get(item_range.clone())
            .map_or(0.0, |base| base.chars().count() as f64);
        if total_chars <= 0.0 {
            return None;
        }
        let range = rito_fragment::allocate_ruby_annotation_range(
            &annotation.text,
            seg_start / total_chars,
            if end >= item_range.end {
                // The final segment closes the interval so a midpoint
                // exactly at its end still lands inside.
                f64::INFINITY
            } else {
                seg_end / total_chars
            },
        )?;
        Some((range, annotation))
    });
    if let Some((range, annotation)) = segment_annotation {
        // The annotation paints at the rt cascade size over the base
        // run's laid-out extent.
        let annotation_size = font_size * f64::from(annotation.size_ratio);
        let text = annotation.text.get(range.clone()).unwrap_or_default();
        // A space-around spread base advance holds (n−1) interior gaps,
        // and the annotation spans one more share — half a gap of
        // overhang past each base edge — so widening the rect by one gap
        // reconstructs the annotation's exact extent. Justify spacing
        // (justify_px) deliberately does NOT widen the rect: a justified
        // narrow-annotation base grows through its own extent and the
        // annotation only re-centers over it.
        let rect_x = line_x + run.rect.x - run.ruby_overhang_px;
        // The column's extent is its width on the 1/64 layout grid, the
        // way the browser stores the base line the annotation aligns to
        // (a four-glyph base whose justified shares sum to 64.268 gives
        // the annotation 64.28125: DOM-measured, the difference moved a
        // second Latin word across a quarter-pixel raster bucket).
        let rect_width = rito_inline::layout_unit_ceil(
            run.rect.width + run.ruby_overhang_px + run.ruby_overhang_right_px,
        );
        // The annotation was shaped whole when the chapter was built;
        // this segment's words are one contiguous slice of it, re-based
        // to their first cluster, and the computed `ruby-align` places
        // every cluster over the segment's extent.
        let measured = ruby_annotation_runs
            .and_then(|runs| runs.get(&(line.source.0, *item_index)))
            .ok_or_else(|| {
                EpubError::new("ruby annotation painted before its string was measured")
            })?;
        // The annotation line sits over the base the way Chromium
        // places it: its baseline the measured em-height offset above
        // the base's painted baseline (whole pixels, so it lands on a
        // device row wherever the base did).
        let annotation_baseline = baseline - measured.over_offset;
        let measured = &measured.run;
        let slice: Vec<&rito_fragment::ClusterPosition> = measured
            .clusters
            .iter()
            .filter(|cluster| range.contains(&(cluster.byte as usize)))
            .collect();
        let first_x = slice.first().map_or(0.0, |cluster| cluster.x);
        let natural: Vec<rito_fragment::ClusterPosition> = slice
            .iter()
            .map(|cluster| rito_fragment::ClusterPosition {
                byte: cluster.byte - range.start as u32,
                x: cluster.x - first_x,
            })
            .collect();
        let slice_end = measured
            .clusters
            .iter()
            .find(|cluster| cluster.byte as usize >= range.end)
            .map_or(measured.advance, |cluster| cluster.x);
        let origins = rito_fragment::distribute_ruby_annotation(
            text,
            &natural,
            slice_end - first_x,
            rect_x,
            rect_width,
            annotation.align,
            annotation_size,
        );
        let annotation_top = annotation_baseline - CANVAS_TOP_ASCENT_RATIO * annotation_size;
        let clusters = natural
            .iter()
            .zip(origins)
            .map(|(cluster, x)| (cluster.byte, x, annotation_baseline))
            .collect();
        commands.push(DisplayCommand::PaintRuby(DisplayTextCommand {
            text: text.to_owned(),
            rect: display_rect(rect_x, annotation_top, rect_width, annotation_size),
            paint: paint.for_ruby(annotation_size),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
            clusters,
        }));
    }
    // The origin every cluster paints at: the run's start (the centred
    // origin of a packed ruby base) plus the offset layout stepped to,
    // which already moves a halt-trimmed opener left by its blank half.
    // An all-CJK run at a fractional size lands each origin on the 1/64
    // grid; every other run keeps the float sum the browser's pen
    // accumulates.
    let cluster_origin_x = line_x + run.rect.x + run.ruby_center_shift_px;
    let run_origin_x = cluster_origin_x - run.opener_trim_px;
    let clusters = run
        .clusters
        .iter()
        .map(|cluster| {
            (
                cluster.byte - run.text_start,
                cluster_x(cluster_origin_x + cluster.x, run.cluster_grid),
                baseline,
            )
        })
        .collect();
    commands.push(DisplayCommand::PaintText(DisplayTextCommand {
        text: full_text[start..end].to_owned(),
        // A halt-trimmed opener was laid at half width, but the painter
        // draws the untrimmed glyph whose outline sits one blank half
        // further right — shift the draw origin left by the removed half
        // so the ink lands where Blink's halt variant puts it (measured
        // at 64px: full-width 「 inks at box+41, the halt variant at
        // box+9 — the outline itself moves left by the trimmed half).
        rect: display_rect(
            run_origin_x,
            em_top,
            rect_width + run.opener_trim_px,
            font_size,
        ),
        paint,
        line_height_px: Some(display_number(line.rect.height)),
        // The nearest enclosing link rides the painted run so a host
        // resolves taps against the display list alone.
        href: item_sources
            .and_then(|sources| sources.get(*item_index))
            .and_then(|source| source.href.clone()),
        source_text: None,
        source_text_offset: None,
        clusters,
    }));
    Ok(())
}
