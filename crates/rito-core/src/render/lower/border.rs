//! The straight border edge: the browser's measured raster for every style
//! a block border or horizontal rule takes on an axis-aligned edge.
//!
//! An edge arrives as the centerline of its band on an already snapped
//! border box, plus its width, all in CSS pixels. Solid, dashed and thin
//! dotted edges are binary whole-pixel bands anchored at the rounded outer
//! edge; thick dotted edges are round dots; a double edge is two solid
//! thirds. The browser resolves every band on the CSS grid and maps it
//! through the device scale afterwards (a 0.4px, 0.75px or 1.5px border is
//! one CSS row, two device rows at 2×), so no rule here reads the ratio.

use super::super::commands::contract::{
    ReaderBorderStyle, ReaderColor, ReaderColorNoneFlags, ReaderColorSpace,
    ReaderHorizontalRulePaint,
};
use super::{
    DashPattern, DevicePath, DevicePoint, DeviceRect, FillRule, Ground, PathOp, Primitive,
    StrokeCap,
};

#[derive(Debug, Clone, Copy)]
pub(super) struct Edge {
    pub width: f64,
    pub color: ReaderColor,
    pub style: ReaderBorderStyle,
}

pub(super) const BLACK: ReaderColor = ReaderColor {
    space: ReaderColorSpace::Srgb,
    components: [0.0; 3],
    alpha: 1.0,
    none: ReaderColorNoneFlags {
        component_0: false,
        component_1: false,
        component_2: false,
        alpha: false,
    },
};

/// Strokes a rounded outline with the browser's dash vocabulary: dotted
/// shrinks the pen to 0.75w with round-cap dots every 1.5w, dashed runs 3w
/// on and 2w off, anything else strokes solid at full width.
pub(super) fn stroke_outline(edge: Edge, path: DevicePath, out: &mut Vec<Primitive>) {
    let (width, cap, dash) = match edge.style {
        ReaderBorderStyle::Dotted => (
            edge.width * 0.75,
            StrokeCap::Round,
            Some(DashPattern {
                on: 0.001,
                off: edge.width * 1.5,
            }),
        ),
        ReaderBorderStyle::Dashed => (
            edge.width,
            StrokeCap::Butt,
            Some(DashPattern {
                on: edge.width * 3.0,
                off: edge.width * 2.0,
            }),
        ),
        _ => (edge.width, StrokeCap::Butt, None),
    };
    out.push(Primitive::StrokePath {
        path,
        width,
        color: edge.color,
        cap,
        dash,
    });
}

/// A horizontal rule is a border edge (the `<hr>`'s border-top), so every
/// style rasters through the straight-edge model. A rect taller than wide
/// is the rule box's vertical bevel edge and runs along y.
pub(super) fn lower_horizontal_rule(
    rect: DeviceRect,
    paint: &ReaderHorizontalRulePaint,
    out: &mut Vec<Primitive>,
) {
    let edge = |width| Edge {
        width,
        color: paint.color,
        style: paint.style,
    };
    if rect.height > rect.width {
        let center_x = rect.x + rect.width / 2.0;
        stroke_edge(
            edge(rect.width),
            DevicePoint::new(center_x, rect.y),
            DevicePoint::new(center_x, rect.bottom()),
            out,
        );
    } else {
        let center_y = rect.y + rect.height / 2.0;
        stroke_edge(
            edge(rect.height),
            DevicePoint::new(rect.x, center_y),
            DevicePoint::new(rect.right(), center_y),
            out,
        );
    }
}

/// Strokes one axis-aligned edge whose band centerline runs `from` → `to`.
pub(super) fn stroke_edge(
    edge: Edge,
    from: DevicePoint,
    to: DevicePoint,
    out: &mut Vec<Primitive>,
) {
    if edge.width <= 0.0
        || matches!(
            edge.style,
            ReaderBorderStyle::None | ReaderBorderStyle::Hidden
        )
    {
        return;
    }
    let span = Span::new(from, to);
    match edge.style {
        ReaderBorderStyle::Dotted if edge.width.round() >= 1.0 => {
            if edge.width.round() <= 3.0 {
                binary_dotted(edge, span, out);
            } else {
                dot_circles(edge, span, out);
            }
        }
        ReaderBorderStyle::Dashed => dashed(edge, span, out),
        ReaderBorderStyle::Double => {
            // Two lines of a third each with a third of gap: their
            // centerlines sit at ±width/3 around the band's (width/6 and
            // 5·width/6 from the outer edge), each its own solid band.
            let third = edge.width / 3.0;
            let line = Edge {
                width: third,
                style: ReaderBorderStyle::Solid,
                ..edge
            };
            let (dx, dy) = if span.horizontal {
                (0.0, third)
            } else {
                (third, 0.0)
            };
            stroke_edge(line, from.offset(-dx, -dy), to.offset(-dx, -dy), out);
            stroke_edge(line, from.offset(dx, dy), to.offset(dx, dy), out);
        }
        // Solid, and the bevel styles the bridge has already shaded to one
        // tone per edge: the measured solid raster is a binary band that
        // starts at round(outer edge) and spans max(1, floor(width)) CSS
        // rows, with no antialiasing at any sub-pixel phase (a 1.5px border
        // is exactly one full-tone row). Stroking the centerline smeared two
        // antialiased rows and sat one row off at fractional tops.
        _ => solid(edge, span, out),
    }
}

/// An edge's run along its axis, endpoints rounded, and the centerline's
/// position across the axis.
#[derive(Debug, Clone, Copy)]
struct Span {
    horizontal: bool,
    start: f64,
    end: f64,
    center: f64,
}

impl Span {
    fn new(from: DevicePoint, to: DevicePoint) -> Self {
        let horizontal = from.y == to.y;
        let (a, b, center) = if horizontal {
            (from.x, to.x, from.y)
        } else {
            (from.y, to.y, from.x)
        };
        Self {
            horizontal,
            start: a.min(b).round(),
            end: a.max(b).round(),
            center,
        }
    }

    fn length(&self) -> f64 {
        self.end - self.start
    }

    /// The band `thickness` deep from `row` across the axis, covering
    /// `[at, at + length)` along it.
    fn band(&self, row: f64, at: f64, length: f64, thickness: f64) -> DeviceRect {
        if self.horizontal {
            DeviceRect::new(at, row, length, thickness)
        } else {
            DeviceRect::new(row, at, thickness, length)
        }
    }

    fn point_along(&self, at: f64) -> DevicePoint {
        if self.horizontal {
            DevicePoint::new(at, self.center)
        } else {
            DevicePoint::new(self.center, at)
        }
    }

    /// The band anchors at the rounded outer edge: the centerline less half
    /// the width.
    fn outer_row(&self, width: f64) -> f64 {
        (self.center - width / 2.0).round()
    }
}

pub(super) fn band_thickness(width: f64) -> f64 {
    width.floor().max(1.0)
}

fn fill(out: &mut Vec<Primitive>, rect: DeviceRect, color: ReaderColor) {
    if rect.is_empty() {
        return;
    }
    out.push(Primitive::FillRect {
        rect,
        color,
        ground: Ground::None,
    });
}

fn solid(edge: Edge, span: Span, out: &mut Vec<Primitive>) {
    fill(
        out,
        span.band(
            span.outer_row(edge.width),
            span.start,
            span.length(),
            band_thickness(edge.width),
        ),
        edge.color,
    );
}

/// The dashed edge rasters on the same binary band as a solid one, with
/// the browser's stretched cadence: base dash 3w and base gap 2w pick the
/// dash count n = floor((L + 2w) / 5w), then the gap stretches to
/// (L − 3wn) / (n − 1) so a full dash lands flush at both ends (56 dashes
/// across a 280px rule, gap 2.036: mostly two columns with a third where
/// the fraction accumulates). Dash extents stay fractional along the run;
/// their antialiased ends match the browser's.
fn dashed(edge: Edge, span: Span, out: &mut Vec<Primitive>) {
    let row = span.outer_row(edge.width);
    let thickness = band_thickness(edge.width);
    let length = span.length();
    let dash = 3.0 * edge.width;
    let count = ((length + 2.0 * edge.width) / (5.0 * edge.width)).floor();
    if count <= 1.0 || length <= dash {
        fill(
            out,
            span.band(row, span.start, length.min(dash), thickness),
            edge.color,
        );
        return;
    }
    let gap = (length - dash * count) / (count - 1.0);
    for index in 0..count as u32 {
        let at = span.start + f64::from(index) * (dash + gap);
        fill(out, span.band(row, at, dash, thickness), edge.color);
    }
}

/// The thin dotted edge (width rounding to 1–3): binary square dashes of
/// side = the rounded width on an exact 2-width period, phase anchored at
/// the span start, plus the browser's endpoint enforcement: the first and
/// last dot redrawn and the run shifted by one pixel so full dots land on
/// both ends whenever the span's remainder modulo the period allows it.
/// The table keys on span % 4 (width 2) and span % 6 (width 3); width 1
/// enforces only on even spans (a double dot at the start: offsets 0, 1,
/// 3, 5, …). Width 2 on a 640px span paints `##.##..##..`.
fn binary_dotted(edge: Edge, span: Span, out: &mut Vec<Primitive>) {
    let size = edge.width.round() as i64;
    let start = span.start as i64;
    let length = span.end as i64 - start;
    let row = span.outer_row(edge.width);
    let thickness = band_thickness(edge.width);
    let mut put = |offset: i64, dots: i64| {
        if dots <= 0 {
            return;
        }
        fill(
            out,
            span.band(row, (start + offset) as f64, dots as f64, thickness),
            edge.color,
        );
    };
    let mod4 = length % 4;
    let mod6 = length % 6;
    let mut use_start_dot = false;
    let mut start_dot_growth = 0;
    let mut start_line_offset = 0;
    let mut use_end_dot = false;
    let mut end_dot_growth = 0;
    if (size == 1 && length % 2 == 0) || (size == 3 && mod6 == 0) {
        use_start_dot = true;
        start_dot_growth = 1;
        start_line_offset = 1;
    }
    if (size == 2 && (mod4 == 0 || mod4 == 1)) || (size == 3 && (mod6 == 1 || mod6 == 2)) {
        use_start_dot = true;
        start_line_offset = -1;
    }
    if (size == 2 && mod4 == 0) || (size == 3 && mod6 == 1) {
        use_end_dot = true;
    }
    if (size == 2 && mod4 == 3) || (size == 3 && (mod6 == 4 || mod6 == 5)) {
        use_start_dot = true;
        start_line_offset = 1;
    }
    if size == 3 && mod6 == 5 {
        use_end_dot = true;
    } else if size == 3 && mod6 == 0 {
        use_end_dot = true;
        end_dot_growth = 1;
    }
    let mut line_start = 0;
    let mut line_end = length;
    if use_start_dot {
        put(0, size + start_dot_growth);
        line_start = 2 * size + start_line_offset;
    }
    if use_end_dot {
        put(length - size - end_dot_growth, size + end_dot_growth);
        line_end = length - (size + end_dot_growth + 1);
    }
    let mut offset = line_start;
    while offset < line_end {
        put(offset, size.min(line_end - offset));
        offset += 2 * size;
    }
}

/// The thick dotted edge (width rounding above 3): round dots of diameter
/// = width, spaced by the gap that best approximates one width between
/// dots. With L the snapped span and w the rounded width, the dot count is
/// n = floor((L + w) / 2w) or n + 1, whichever count's implied gap
/// (L − n·w) / (n − 1) lies closer to w, and the pitch is w + gap less a
/// 0.01 epsilon that keeps the final dot from float accumulation (a 6px
/// rule across 628 pixels: 53 dots at pitch 11.9515, a half-pixel
/// staircase every ~10 dots against any exact-pitch grid). Dots start at
/// the span start + w/2 and center on the band centerline.
fn dot_circles(edge: Edge, span: Span, out: &mut Vec<Primitive>) {
    let dash_width = edge.width.round();
    let radius = edge.width / 2.0;
    let length = span.length();
    let min_dashes = ((length + dash_width) / (2.0 * dash_width)).floor();
    let max_dashes = min_dashes + 1.0;
    let min_gap = (length - min_dashes * dash_width) / (min_dashes - 1.0);
    let max_gap = (length - max_dashes * dash_width) / (max_dashes - 1.0);
    let use_min = max_gap <= 0.0 || (min_gap - dash_width).abs() < (max_gap - dash_width).abs();
    let count = if use_min { min_dashes } else { max_dashes };
    let gap = if use_min { min_gap } else { max_gap };
    let mut ops = Vec::new();
    let mut dot = |at: f64| {
        ops.push(PathOp::Ellipse {
            center: span.point_along(at),
            rx: radius,
            ry: radius,
        });
    };
    if length < 2.0 * dash_width || count <= 1.0 || !gap.is_finite() {
        dot(span.start + dash_width / 2.0);
    } else {
        let pitch = dash_width + gap - 0.01;
        for index in 0..count as u32 {
            dot(span.start + dash_width / 2.0 + f64::from(index) * pitch);
        }
    }
    out.push(Primitive::FillPath {
        path: DevicePath { ops },
        rule: FillRule::NonZero,
        color: edge.color,
        ground: Ground::None,
    });
}
