//! The device-resolved paint vocabulary.
//!
//! In a finished list every coordinate is in device pixels, the grid the
//! host rasterizes on, and every rule about where ink lands has already
//! been applied. The lowering builds the same shapes in CSS pixels first —
//! the browser snaps box edges and border widths on that grid whatever the
//! density — and scales the finished list by the render ratio last. Text
//! runs are the one semantic shape left, and they stay in CSS pixels for
//! the renderer to draw under the ratio; their glyph placement is still
//! the renderer's until the text laws move here, while their inline box
//! and decoration line already lower to fills and strokes.

use super::super::commands::contract::{ReaderColor, ReaderPoint, ReaderRect, ReaderTextRun};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DevicePoint {
    pub x: f64,
    pub y: f64,
}

impl DevicePoint {
    pub(crate) const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub(crate) fn offset(self, dx: f64, dy: f64) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DeviceRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl DeviceRect {
    pub(crate) const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub(crate) fn right(&self) -> f64 {
        self.x + self.width
    }

    pub(crate) fn bottom(&self) -> f64 {
        self.y + self.height
    }

    /// The box on whole pixels, each edge rounding independently: how the
    /// browser rasters a border box. A 6px border at a fractional x paints
    /// columns [665, 671) crisp, where stroking the fractional box bleeds
    /// one antialiased column each side. The grid is CSS pixels at any
    /// density (a 2× phase sweep put every box edge on an even device row,
    /// never on the odd row a device round of the same edge picks).
    pub(crate) fn snapped(&self) -> Self {
        let left = self.x.round();
        let top = self.y.round();
        let right = self.right().round();
        let bottom = self.bottom().round();
        Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.width <= 0.0 || self.height <= 0.0
    }

    /// The rect shrunk by `inset` on every side.
    pub(crate) fn deflate(&self, inset: f64) -> Self {
        Self {
            x: self.x + inset,
            y: self.y + inset,
            width: self.width - 2.0 * inset,
            height: self.height - 2.0 * inset,
        }
    }
}

impl From<&ReaderPoint> for DevicePoint {
    fn from(point: &ReaderPoint) -> Self {
        Self::new(point.x, point.y)
    }
}

impl From<&ReaderRect> for DeviceRect {
    fn from(rect: &ReaderRect) -> Self {
        Self::new(rect.x, rect.y, rect.width, rect.height)
    }
}

/// One segment of a device-space outline. Arc angles are radians from the
/// +x axis; a positive sweep turns clockwise on the y-down device plane.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum PathOp {
    MoveTo(DevicePoint),
    LineTo(DevicePoint),
    Arc {
        center: DevicePoint,
        rx: f64,
        ry: f64,
        start: f64,
        sweep: f64,
    },
    /// A whole ellipse as its own closed subpath.
    Ellipse {
        center: DevicePoint,
        rx: f64,
        ry: f64,
    },
    Rect(DeviceRect),
    Close,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DevicePath {
    pub ops: Vec<PathOp>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FillRule {
    NonZero,
    EvenOdd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StrokeCap {
    Butt,
    Round,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DashPattern {
    pub on: f64,
    pub off: f64,
}

/// What a fill declares to the renderer's theme override: the page ground
/// (the book's paper, kept or replaced by the theme) or an opaque block
/// ground over the unsnapped box the ink inside it was typeset against.
/// Other fills declare nothing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Ground {
    None,
    Page,
    Block(DeviceRect),
}

/// A grid of image tiles: `columns` by `rows` copies of the destination,
/// stepping `step_x`/`step_y` from `origin`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TilePlan {
    pub origin: DevicePoint,
    pub step_x: f64,
    pub step_y: f64,
    pub columns: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum DeviceTransform {
    Rotate { radians: f64 },
    Scale { sx: f64, sy: f64 },
    Translate { dx: f64, dy: f64 },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Primitive {
    PushState,
    PopState,
    Translate {
        dx: f64,
        dy: f64,
    },
    Opacity {
        value: f64,
    },
    Transform {
        origin: DevicePoint,
        transforms: Vec<DeviceTransform>,
    },
    ClipPath {
        path: DevicePath,
    },
    FillRect {
        rect: DeviceRect,
        color: ReaderColor,
        ground: Ground,
    },
    FillPath {
        path: DevicePath,
        rule: FillRule,
        color: ReaderColor,
        ground: Ground,
    },
    StrokePath {
        path: DevicePath,
        width: f64,
        color: ReaderColor,
        cap: StrokeCap,
        dash: Option<DashPattern>,
    },
    /// A canvas-style shadow: the `shape` blurred by Gaussian `sigma`
    /// (device pixels) and drawn at `offset`, then the shape itself on
    /// top, both with `clip_out` excluded from the result.
    Shadow {
        shape: DevicePath,
        sigma: f64,
        offset: DevicePoint,
        color: ReaderColor,
        clip_out: Option<DevicePath>,
    },
    /// `src` sampled over `source_rect` (image pixels; the whole image when
    /// absent) into `dest`, once or per `tiles`.
    DrawImage {
        src: String,
        dest: DeviceRect,
        source_rect: Option<ReaderRect>,
        tiles: Option<TilePlan>,
    },
    /// A text run in CSS pixels, drawn under `scale(ratio)`: the
    /// rasterizer needs the CSS size (synthetic bold widens with it) and
    /// the scale separately. Its inline box and decoration line have
    /// lowered to primitives around it; glyph placement is still the
    /// renderer's.
    Text(ReaderTextRun),
    Ruby(ReaderTextRun),
}

impl Primitive {
    /// The `RITODL1` format-2 opcode; state opcodes match format 1.
    pub(crate) const fn opcode(&self) -> u16 {
        match self {
            Self::PushState => 1,
            Self::PopState => 2,
            Self::Translate { .. } => 3,
            Self::Opacity { .. } => 4,
            Self::Transform { .. } => 5,
            Self::ClipPath { .. } => 6,
            Self::FillRect { .. } => 7,
            Self::FillPath { .. } => 8,
            Self::StrokePath { .. } => 9,
            Self::Shadow { .. } => 10,
            Self::DrawImage { .. } => 11,
            Self::Text(_) => 12,
            Self::Ruby(_) => 13,
        }
    }
}

impl PathOp {
    pub(crate) const fn tag(&self) -> u8 {
        match self {
            Self::MoveTo(_) => 1,
            Self::LineTo(_) => 2,
            Self::Arc { .. } => 3,
            Self::Ellipse { .. } => 4,
            Self::Rect(_) => 5,
            Self::Close => 6,
        }
    }
}

impl FillRule {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::NonZero => 1,
            Self::EvenOdd => 2,
        }
    }
}

impl StrokeCap {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Butt => 1,
            Self::Round => 2,
        }
    }
}

impl Ground {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::None => 1,
            Self::Page => 2,
            Self::Block(_) => 3,
        }
    }
}

impl DeviceTransform {
    pub(crate) const fn tag(&self) -> u8 {
        match self {
            Self::Rotate { .. } => 1,
            Self::Scale { .. } => 2,
            Self::Translate { .. } => 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PrimitiveList {
    /// Device pixels per CSS pixel the list was resolved at.
    pub ratio: f64,
    pub commands: Vec<Primitive>,
}
