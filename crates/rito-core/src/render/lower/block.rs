//! Block decoration resolved to primitives exactly as the browser paints
//! it: box shadows, then the background colour and image, then the
//! borders, straight or rounded. Everything here is in CSS pixels; the
//! lowering's final pass scales the result to the device.

use super::super::commands::contract::{
    ReaderBackgroundPaint, ReaderBackgroundRepeat, ReaderBackgroundSize, ReaderBlockBorder,
    ReaderBlockPaint, ReaderBlockRadius, ReaderBorderBox, ReaderBorderEdgePaint, ReaderBorderStyle,
    ReaderBoxShadow, ReaderColor, ReaderLength, ReaderRunBorder, ReaderRunBorderEdge,
};
use super::{
    border::{band_thickness, stroke_edge, stroke_outline, Edge, BLACK},
    path::{
        corner_rounded_rect, inner_elliptical_rect, overlap_scale, polygon, rounded_rect, triangle,
    },
    DevicePath, DevicePoint, DeviceRect, FillRule, Ground, ImageSize, Primitive, TilePlan,
};

/// The most tiles one background paints: a pattern denser than this is a
/// hazard to every renderer, so the grid is cut off here rather than in
/// each renderer differently.
const MAX_BACKGROUND_TILES: f64 = 4096.0;

pub(super) fn lower_block(
    rect: DeviceRect,
    paint: &ReaderBlockPaint,
    border_box: Option<&ReaderBorderBox>,
    images: &dyn Fn(&str) -> Option<ImageSize>,
    out: &mut Vec<Primitive>,
) {
    let radius = Radius::resolve(paint.radius, rect);
    for shadow in paint.box_shadows.iter().rev() {
        lower_shadow(rect, radius, shadow, out);
    }
    if let Some(background) = &paint.background {
        if let Some(color) = background.color {
            background_fill(rect, radius, color, rect, out);
        }
        if let Some(href) = &background.image {
            background_image(rect, radius, background, href, images, out);
        }
    }
    if let (Some(border), Some(widths)) = (paint.border.as_ref(), border_box) {
        let edges = Edges::resolve(border, widths);
        if radius.rx > 0.0 || radius.ry > 0.0 {
            rounded_borders(rect, radius, &edges, out);
        } else {
            straight_borders(rect.snapped(), &edges, out);
        }
    }
}

/// A run's inline box: the background band and the border edges of the
/// border box `rect` (CSS pixels), resolved by the block laws. A radius
/// rounds the border ring on all four corners, while the fill rounds only
/// the corners at a closed end: a box split across lines paints one
/// continuous band whose open ends are square (per-segment rounding drew
/// pill badges as overlapping circles with white seams). An opaque band
/// declares `ground` — the band grown to the run it belongs to — so the
/// run's ink always finds its own band whatever the font's descent.
pub(super) fn lower_inline_box(
    rect: DeviceRect,
    background: Option<ReaderColor>,
    radius: Option<f64>,
    closed: (bool, bool),
    border: Option<&ReaderRunBorder>,
    ground: DeviceRect,
    out: &mut Vec<Primitive>,
) {
    let radius = Radius::inline(radius, closed);
    if let Some(color) = background {
        background_fill(rect, radius, color, ground, out);
    }
    if let Some(border) = border {
        let edges = Edges::from_run(border);
        if radius.rx > 0.0 || radius.ry > 0.0 {
            rounded_borders(rect, radius, &edges, out);
        } else {
            straight_borders(rect.snapped(), &edges, out);
        }
    }
}

/// A block's corner radii. Per-corner radii shape only the background
/// fill and the image clip; shadows and borders see a uniform zero,
/// exactly as the browser resolves them.
#[derive(Debug, Clone, Copy)]
struct Radius {
    rx: f64,
    ry: f64,
    corners: Option<[f64; 4]>,
}

impl Radius {
    fn resolve(radius: Option<ReaderBlockRadius>, rect: DeviceRect) -> Self {
        match radius {
            Some(ReaderBlockRadius::Corners(corners))
                if corners.iter().any(|corner| *corner > 0.0) =>
            {
                Self {
                    rx: 0.0,
                    ry: 0.0,
                    corners: Some(corners),
                }
            }
            Some(ReaderBlockRadius::Percent(percent)) => Self {
                rx: percent / 100.0 * rect.width,
                ry: percent / 100.0 * rect.height,
                corners: None,
            },
            Some(ReaderBlockRadius::Px(value)) => Self {
                rx: value,
                ry: value,
                corners: None,
            },
            _ => Self {
                rx: 0.0,
                ry: 0.0,
                corners: None,
            },
        }
    }

    /// An inline box's radius: uniform for the border ring, and per
    /// corner for the fill when an end is open (`closed` names the start
    /// and end), so only the closed ends round.
    fn inline(radius: Option<f64>, (start, end): (bool, bool)) -> Self {
        let radius = radius.unwrap_or(0.0).max(0.0);
        if radius <= 0.0 {
            return Self {
                rx: 0.0,
                ry: 0.0,
                corners: None,
            };
        }
        let corners = (!start || !end).then(|| {
            let start = if start { radius } else { 0.0 };
            let end = if end { radius } else { 0.0 };
            [start, end, end, start]
        });
        Self {
            rx: radius,
            ry: radius,
            corners,
        }
    }

    /// The outline the fill and the image clip take on `rect`.
    fn outline(self, rect: DeviceRect) -> DevicePath {
        match self.corners {
            Some(corners) => corner_rounded_rect(rect, corners),
            None => rounded_rect(rect, self.rx, self.ry),
        }
    }
}

/// An outer box shadow: the spread-expanded box blurred at its offset, the
/// box interior excluded. Painted back to front; inset shadows are not
/// painted.
fn lower_shadow(
    rect: DeviceRect,
    radius: Radius,
    shadow: &ReaderBoxShadow,
    out: &mut Vec<Primitive>,
) {
    if shadow.inset {
        return;
    }
    let spread = shadow.spread;
    let expanded = DeviceRect::new(
        rect.x - spread,
        rect.y - spread,
        rect.width + 2.0 * spread,
        rect.height + 2.0 * spread,
    );
    if expanded.is_empty() {
        return;
    }
    out.push(Primitive::Shadow {
        shape: rounded_rect(
            expanded,
            (radius.rx + spread).max(0.0),
            (radius.ry + spread).max(0.0),
        ),
        sigma: shadow.blur / 2.0,
        offset: DevicePoint::new(shadow.offset_x, shadow.offset_y),
        color: shadow.color,
        clip_out: Some(rounded_rect(rect, radius.rx, radius.ry)),
    });
}

/// A background rasters on whole pixels, each edge rounding independently,
/// rounded or not: a float fill at x 57.65625 bled 34% white over a
/// frame's binary 1px border column and greyed it to 88/255, and raw
/// fractional rounded fills smeared every box edge one antialiased row.
/// An opaque fill declares the block ground over `ground`, the unsnapped
/// box the ink typeset inside it is contained by.
fn background_fill(
    rect: DeviceRect,
    radius: Radius,
    color: ReaderColor,
    ground: DeviceRect,
    out: &mut Vec<Primitive>,
) {
    let snapped = rect.snapped();
    if snapped.is_empty() {
        return;
    }
    let ground = if color.alpha >= 1.0 {
        Ground::Block(ground)
    } else {
        Ground::None
    };
    if radius.corners.is_none() && radius.rx <= 0.0 && radius.ry <= 0.0 {
        out.push(Primitive::FillRect {
            rect: snapped,
            color,
            ground,
        });
        return;
    }
    out.push(Primitive::FillPath {
        path: radius.outline(snapped),
        rule: FillRule::NonZero,
        color,
        ground,
    });
}

/// The background image sized and placed per CSS Backgrounds §3.9 against
/// the unsnapped box and clipped to its outline; every repeat mode other
/// than `no-repeat` tiles both axes from the image's origin.
fn background_image(
    rect: DeviceRect,
    radius: Radius,
    background: &ReaderBackgroundPaint,
    href: &str,
    images: &dyn Fn(&str) -> Option<ImageSize>,
    out: &mut Vec<Primitive>,
) {
    let Some(size) = images(href) else {
        return;
    };
    let (image_width, image_height) = (f64::from(size.width), f64::from(size.height));
    if image_width <= 0.0 || image_height <= 0.0 {
        return;
    }
    let (draw_width, draw_height) = image_size(
        background.size,
        image_width,
        image_height,
        rect.width,
        rect.height,
    );
    // The image's origin: the box origin for auto sizing, its centre once
    // the image is scaled to the box.
    let sized = !matches!(background.size, None | Some(ReaderBackgroundSize::Auto));
    let default_axis = ReaderLength::Percent(if sized { 50.0 } else { 0.0 });
    let (position_x, position_y) = background
        .position
        .map_or((default_axis, default_axis), |position| {
            (position.x, position.y)
        });
    let draw_x = rect.x + position_offset(position_x, rect.width - draw_width);
    let draw_y = rect.y + position_offset(position_y, rect.height - draw_height);

    out.push(Primitive::PushState);
    out.push(Primitive::ClipPath {
        path: radius.outline(rect),
    });
    let repeats = !matches!(background.repeat, Some(ReaderBackgroundRepeat::NoRepeat))
        && draw_width > 0.0
        && draw_height > 0.0;
    if repeats {
        let start_x = draw_x - ((draw_x - rect.x) / draw_width).ceil() * draw_width;
        let start_y = draw_y - ((draw_y - rect.y) / draw_height).ceil() * draw_height;
        let mut columns = tile_count(start_x, draw_width, rect.right());
        let mut rows = tile_count(start_y, draw_height, rect.bottom());
        if columns * rows > MAX_BACKGROUND_TILES {
            let scale = (MAX_BACKGROUND_TILES / (columns * rows)).sqrt();
            columns = (columns * scale).floor().max(1.0);
            rows = (rows * scale).floor().max(1.0);
        }
        out.push(Primitive::DrawImage {
            src: href.to_owned(),
            dest: DeviceRect::new(start_x, start_y, draw_width, draw_height),
            source_rect: None,
            tiles: Some(TilePlan {
                origin: DevicePoint::new(start_x, start_y),
                step_x: draw_width,
                step_y: draw_height,
                columns: columns as u32,
                rows: rows as u32,
            }),
        });
    } else {
        out.push(Primitive::DrawImage {
            src: href.to_owned(),
            dest: DeviceRect::new(draw_x, draw_y, draw_width, draw_height),
            source_rect: None,
            tiles: None,
        });
    }
    out.push(Primitive::PopState);
}

/// How many tiles a stepping loop `for (at = start; at < end; at += step)`
/// visits, stepped the same way so the count never disagrees with the walk.
fn tile_count(start: f64, step: f64, end: f64) -> f64 {
    let mut count = 0.0;
    let mut at = start;
    while at < end {
        count += 1.0;
        at += step;
    }
    count
}

/// CSS Backgrounds §3.9: `cover`/`contain` scale by the box; a length axis
/// resolves against the box, an auto axis derives from the intrinsic
/// ratio once the other axis resolves.
fn image_size(
    size: Option<ReaderBackgroundSize>,
    image_width: f64,
    image_height: f64,
    box_width: f64,
    box_height: f64,
) -> (f64, f64) {
    match size {
        Some(ReaderBackgroundSize::Cover) => {
            let scale = (box_width / image_width).max(box_height / image_height);
            (image_width * scale, image_height * scale)
        }
        Some(ReaderBackgroundSize::Contain) => {
            let scale = (box_width / image_width).min(box_height / image_height);
            (image_width * scale, image_height * scale)
        }
        Some(ReaderBackgroundSize::Explicit { x, y }) => {
            let axis = |axis: Option<ReaderLength>, extent: f64| {
                axis.map(|length| match length {
                    ReaderLength::Px(value) => value,
                    ReaderLength::Percent(percent) => extent * percent / 100.0,
                })
            };
            let explicit_width = axis(x, box_width);
            let explicit_height = axis(y, box_height);
            (
                explicit_width.unwrap_or_else(|| {
                    explicit_height
                        .map_or(image_width, |height| height * image_width / image_height)
                }),
                explicit_height.unwrap_or_else(|| {
                    explicit_width.map_or(image_height, |width| width * image_height / image_width)
                }),
            )
        }
        None | Some(ReaderBackgroundSize::Auto) => (image_width, image_height),
    }
}

fn position_offset(length: ReaderLength, free_space: f64) -> f64 {
    match length {
        ReaderLength::Px(value) => value,
        ReaderLength::Percent(percent) => free_space * percent / 100.0,
    }
}

/// The four border edges as the browser's border model sees them: an edge
/// with no width, no paint or a `none`/`hidden` style is a zero-width solid
/// black edge, which is how the uniform and same-colour tests treat it.
struct Edges {
    top: Edge,
    right: Edge,
    bottom: Edge,
    left: Edge,
}

impl Edges {
    fn resolve(border: &ReaderBlockBorder, widths: &ReaderBorderBox) -> Self {
        let edge = |paint: Option<ReaderBorderEdgePaint>, width: f64| match paint {
            Some(paint)
                if width > 0.0
                    && !matches!(
                        paint.style,
                        ReaderBorderStyle::None | ReaderBorderStyle::Hidden
                    ) =>
            {
                Edge {
                    width,
                    color: paint.color,
                    style: paint.style,
                }
            }
            _ => ZERO_EDGE,
        };
        Self {
            top: edge(border.top, widths.top_width),
            right: edge(border.right, widths.right_width),
            bottom: edge(border.bottom, widths.bottom_width),
            left: edge(border.left, widths.left_width),
        }
    }

    /// A run's inline box edges: its start edge is the left one, its end
    /// edge the right one; an open end carries no edge at all.
    fn from_run(border: &ReaderRunBorder) -> Self {
        let edge = |edge: Option<ReaderRunBorderEdge>| match edge {
            Some(edge)
                if edge.width_px > 0.0
                    && !matches!(
                        edge.paint.style,
                        ReaderBorderStyle::None | ReaderBorderStyle::Hidden
                    ) =>
            {
                Edge {
                    width: edge.width_px,
                    color: edge.paint.color,
                    style: edge.paint.style,
                }
            }
            _ => ZERO_EDGE,
        };
        Self {
            top: edge(border.top),
            right: edge(border.end),
            bottom: edge(border.bottom),
            left: edge(border.start),
        }
    }

    fn all(&self) -> [Edge; 4] {
        [self.top, self.right, self.bottom, self.left]
    }

    fn any_visible(&self) -> bool {
        self.all().iter().any(|edge| edge.width > 0.0)
    }

    fn uniform(&self) -> bool {
        self.all().iter().all(|edge| {
            edge.width == self.top.width
                && edge.color == self.top.color
                && edge.style == self.top.style
        })
    }
}

const ZERO_EDGE: Edge = Edge {
    width: 0.0,
    color: BLACK,
    style: ReaderBorderStyle::Solid,
};

/// The browser paints a straight border box's edges top, bottom, left,
/// right, and a corner belongs to whichever edge overdraws it: an edge
/// whose neighbour paints later with a style that fills its band leaves
/// the corner to that neighbour, while an edge painted after a neighbour
/// of another colour or style keeps only its miter — the quad from its
/// outer corners to the inner corners, antialiased — so the two colours
/// meet on the diagonal (an inset rule's dark top and light right edge
/// share the corner pixel half and half, at every ratio).
fn straight_borders(snapped: DeviceRect, edges: &Edges, out: &mut Vec<Primitive>) {
    #[derive(Clone, Copy, PartialEq)]
    enum Side {
        Top,
        Bottom,
        Left,
        Right,
    }
    let edge_of = |side: Side| match side {
        Side::Top => edges.top,
        Side::Bottom => edges.bottom,
        Side::Left => edges.left,
        Side::Right => edges.right,
    };
    let thickness = |side: Side| {
        let edge = edge_of(side);
        if edge.width > 0.0 {
            band_thickness(edge.width)
        } else {
            0.0
        }
    };
    let fills_band = |style: ReaderBorderStyle| {
        !matches!(
            style,
            ReaderBorderStyle::Dotted | ReaderBorderStyle::Dashed | ReaderBorderStyle::Double
        )
    };
    let (left, top, right, bottom) = (snapped.x, snapped.y, snapped.right(), snapped.bottom());
    let (t_top, t_bottom, t_left, t_right) = (
        thickness(Side::Top),
        thickness(Side::Bottom),
        thickness(Side::Left),
        thickness(Side::Right),
    );
    let mut painted = [false; 4];
    let index = |side: Side| side as usize;
    for side in [Side::Top, Side::Bottom, Side::Left, Side::Right] {
        let edge = edge_of(side);
        if edge.width <= 0.0 {
            painted[index(side)] = true;
            continue;
        }
        let (from, to, neighbours) = match side {
            Side::Top => {
                let center = top + edge.width / 2.0;
                let points = (
                    DevicePoint::new(left, center),
                    DevicePoint::new(right, center),
                );
                (points.0, points.1, [Side::Left, Side::Right])
            }
            Side::Bottom => {
                let center = bottom - edge.width / 2.0;
                let points = (
                    DevicePoint::new(left, center),
                    DevicePoint::new(right, center),
                );
                (points.0, points.1, [Side::Left, Side::Right])
            }
            Side::Left => {
                let center = left + edge.width / 2.0;
                let points = (
                    DevicePoint::new(center, top),
                    DevicePoint::new(center, bottom),
                );
                (points.0, points.1, [Side::Top, Side::Bottom])
            }
            Side::Right => {
                let center = right - edge.width / 2.0;
                let points = (
                    DevicePoint::new(center, top),
                    DevicePoint::new(center, bottom),
                );
                (points.0, points.1, [Side::Top, Side::Bottom])
            }
        };
        let miter = |neighbour: Side| {
            let other = edge_of(neighbour);
            other.width > 0.0
                && (other.color != edge.color || other.style != edge.style)
                && (painted[index(neighbour)] || !fills_band(other.style))
        };
        let [miter_a, miter_b] = neighbours.map(miter);
        if miter_a || miter_b {
            let corner = |x: f64, y: f64| DevicePoint::new(x, y);
            let quad = match side {
                Side::Top => [
                    corner(left, top),
                    corner(if miter_a { left + t_left } else { left }, top + t_top),
                    corner(if miter_b { right - t_right } else { right }, top + t_top),
                    corner(right, top),
                ],
                Side::Bottom => [
                    corner(left, bottom),
                    corner(
                        if miter_a { left + t_left } else { left },
                        bottom - t_bottom,
                    ),
                    corner(
                        if miter_b { right - t_right } else { right },
                        bottom - t_bottom,
                    ),
                    corner(right, bottom),
                ],
                Side::Left => [
                    corner(left, top),
                    corner(left + t_left, if miter_a { top + t_top } else { top }),
                    corner(
                        left + t_left,
                        if miter_b { bottom - t_bottom } else { bottom },
                    ),
                    corner(left, bottom),
                ],
                Side::Right => [
                    corner(right, top),
                    corner(right - t_right, if miter_a { top + t_top } else { top }),
                    corner(
                        right - t_right,
                        if miter_b { bottom - t_bottom } else { bottom },
                    ),
                    corner(right, bottom),
                ],
            };
            if fills_band(edge.style) {
                // The mitered band is the quad itself (its inner edge
                // is the band's inner row), filled as a path so the
                // miter antialiases on every host — a clip does not
                // antialias on every canvas the reader runs in.
                out.push(Primitive::FillPath {
                    path: polygon(&quad),
                    rule: FillRule::NonZero,
                    color: edge.color,
                    ground: Ground::None,
                });
            } else {
                out.push(Primitive::PushState);
                out.push(Primitive::ClipPath {
                    path: polygon(&quad),
                });
                stroke_edge(edge, from, to, out);
                out.push(Primitive::PopState);
            }
        } else {
            stroke_edge(edge, from, to, out);
        }
        painted[index(side)] = true;
    }
}

/// A rounded border box rasters on whole pixels like a straight one (a 1px
/// top border at y 71.6 paints row 72 crisp; the raw fractional stroke
/// split 40/60 across two rows). Four equal edges stroke one ring; four
/// solid edges of one colour but unequal widths fill the crescent between
/// the outer and the padding outline; anything else paints each edge
/// inside the wedge it owns.
fn rounded_borders(rect: DeviceRect, radius: Radius, edges: &Edges, out: &mut Vec<Primitive>) {
    if !edges.any_visible() {
        return;
    }
    let snapped = rect.snapped();
    if edges.uniform() {
        uniform_ring(snapped, radius, edges.top, out);
        return;
    }
    if crescent(snapped, radius, edges, out) {
        return;
    }
    each_side(snapped, radius, edges, out);
}

/// The border ink lives inside the border box: the ring's centerline sits
/// half a width in from the rounded outer outline, matching the straight
/// band and the browser's ink span from the border-box edge to the
/// padding-box edge. A double border is two rings of a third each, their
/// centerlines width/6 in from the outer outline and width/6 out from the
/// padding outline.
fn uniform_ring(snapped: DeviceRect, radius: Radius, edge: Edge, out: &mut Vec<Primitive>) {
    let ring = |inset: f64| {
        rounded_rect(
            snapped.deflate(inset),
            (radius.rx - inset).max(0.0),
            (radius.ry - inset).max(0.0),
        )
    };
    if edge.style == ReaderBorderStyle::Double {
        let third = edge.width / 3.0;
        let line = Edge {
            width: third,
            style: ReaderBorderStyle::Solid,
            ..edge
        };
        for inset in [third / 2.0, edge.width - third / 2.0] {
            stroke_outline(line, ring(inset), out);
        }
        return;
    }
    stroke_outline(edge, ring(edge.width / 2.0), out);
}

/// Four solid edges of one colour with unequal widths: the area between
/// the outer rounded outline and the padding outline, whose corners inset
/// by the adjacent edge widths so the ring's thickness sweeps continuously
/// around the arc (a 1px-left/4px-right circle is a crescent, not four
/// stroked quadrants with steps at the joins).
fn crescent(snapped: DeviceRect, radius: Radius, edges: &Edges, out: &mut Vec<Primitive>) -> bool {
    let color = edges.top.color;
    if !edges
        .all()
        .iter()
        .all(|edge| edge.style == ReaderBorderStyle::Solid && edge.color == color)
    {
        return false;
    }
    let (top, right, bottom, left) = (
        edges.top.width,
        edges.right.width,
        edges.bottom.width,
        edges.left.width,
    );
    let inner = DeviceRect::new(
        snapped.x + left,
        snapped.y + top,
        snapped.width - left - right,
        snapped.height - top - bottom,
    );
    if inner.is_empty() {
        return false;
    }
    let (rx, ry) = (radius.rx, radius.ry);
    let inset = |x: f64, y: f64| ((rx - x).max(0.0), (ry - y).max(0.0));
    let mut path = rounded_rect(snapped, rx, ry);
    path.ops.extend(
        inner_elliptical_rect(
            inner,
            [
                inset(left, top),
                inset(right, top),
                inset(right, bottom),
                inset(left, bottom),
            ],
        )
        .ops,
    );
    out.push(Primitive::FillPath {
        path,
        rule: FillRule::EvenOdd,
        color,
        ground: Ground::None,
    });
    true
}

/// Edges that disagree each clip the wedge from the box centre to their two
/// corners: a solid edge fills the outer outline less the padding outline
/// (a uniform inner radius shrunk by the widest edge), a styled edge
/// strokes the outer outline.
fn each_side(snapped: DeviceRect, radius: Radius, edges: &Edges, out: &mut Vec<Primitive>) {
    let (x, y, width, height) = (snapped.x, snapped.y, snapped.width, snapped.height);
    let overlap = overlap_scale(width, height, radius.rx, radius.ry);
    let (corner_rx, corner_ry) = (radius.rx * overlap, radius.ry * overlap);
    let widest = edges
        .all()
        .iter()
        .map(|edge| edge.width)
        .fold(0.0, f64::max);
    let inner = DeviceRect::new(
        x + edges.left.width,
        y + edges.top.width,
        width - edges.left.width - edges.right.width,
        height - edges.top.width - edges.bottom.width,
    );
    let inner_radius = ((corner_rx - widest).max(0.0), (corner_ry - widest).max(0.0));
    let center = DevicePoint::new(x + width / 2.0, y + height / 2.0);
    let (left, top, right, bottom) = (x, y, snapped.right(), snapped.bottom());
    let sides = [
        (
            edges.top,
            DevicePoint::new(left, top),
            DevicePoint::new(right, top),
        ),
        (
            edges.right,
            DevicePoint::new(right, top),
            DevicePoint::new(right, bottom),
        ),
        (
            edges.bottom,
            DevicePoint::new(right, bottom),
            DevicePoint::new(left, bottom),
        ),
        (
            edges.left,
            DevicePoint::new(left, bottom),
            DevicePoint::new(left, top),
        ),
    ];
    for (edge, from, to) in sides {
        if edge.width <= 0.0 {
            continue;
        }
        out.push(Primitive::PushState);
        out.push(Primitive::ClipPath {
            path: triangle(center, from, to),
        });
        if edge.style == ReaderBorderStyle::Solid {
            let mut path = rounded_rect(snapped, corner_rx, corner_ry);
            if !inner.is_empty() {
                path.ops
                    .extend(rounded_rect(inner, inner_radius.0, inner_radius.1).ops);
            }
            out.push(Primitive::FillPath {
                path,
                rule: FillRule::EvenOdd,
                color: edge.color,
                ground: Ground::None,
            });
        } else {
            stroke_outline(edge, rounded_rect(snapped, corner_rx, corner_ry), out);
        }
        out.push(Primitive::PopState);
    }
}
