//! The device-resolved paint vocabulary.
//!
//! Every coordinate is in device pixels, the grid the host rasterizes on,
//! and every rule about where ink lands has already been applied. The
//! vocabulary is fixed in one piece so the wire and both renderers grow
//! against a stable shape while the block and text laws move into the
//! lowering step by step; the shapes no law produces yet are marked.

use super::super::commands::contract::{
    ReaderBlockPaintV1, ReaderBorderBoxV1, ReaderColorV1, ReaderPointV1, ReaderRectV1,
    ReaderTextCommandV1,
};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DevicePoint {
    pub x: f64,
    pub y: f64,
}

impl DevicePoint {
    pub(crate) const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub(crate) fn scaled(point: &ReaderPointV1, ratio: f64) -> Self {
        Self {
            x: point.x * ratio,
            y: point.y * ratio,
        }
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

    pub(crate) fn scaled(rect: &ReaderRectV1, ratio: f64) -> Self {
        Self {
            x: rect.x * ratio,
            y: rect.y * ratio,
            width: rect.width * ratio,
            height: rect.height * ratio,
        }
    }

    pub(crate) fn right(&self) -> f64 {
        self.x + self.width
    }

    pub(crate) fn bottom(&self) -> f64 {
        self.y + self.height
    }

    /// The box on whole device pixels, each edge rounding independently:
    /// how the browser rasters a border box. A 6px border at a fractional x
    /// paints columns [665, 671) crisp, where stroking the fractional box
    /// bleeds one antialiased column each side.
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
    #[allow(
        dead_code,
        reason = "fixed with the vocabulary; the rounded-border and box-shadow laws fill even-odd once they lower"
    )]
    EvenOdd,
}

#[allow(
    dead_code,
    reason = "fixed with the vocabulary; the rounded-border laws stroke once they lower"
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StrokeCap {
    Butt,
    Round,
}

#[allow(
    dead_code,
    reason = "fixed with the vocabulary; the rounded-border laws stroke once they lower"
)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DashPattern {
    pub on: f64,
    pub off: f64,
}

/// What a fill declares to the renderer's theme override: the page ground
/// (the book's paper, kept or replaced by the theme) or an opaque block
/// ground the ink inside it was typeset against. Other fills declare
/// nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Ground {
    None,
    Page,
    Block,
}

/// A grid of image tiles: `columns` by `rows` copies of the destination,
/// stepping `step_x`/`step_y` from `origin`.
#[allow(
    dead_code,
    reason = "fixed with the vocabulary; the background-image law tiles once it lowers"
)]
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
        color: ReaderColorV1,
        ground: Ground,
    },
    FillPath {
        path: DevicePath,
        rule: FillRule,
        color: ReaderColorV1,
    },
    #[allow(
        dead_code,
        reason = "fixed with the vocabulary; the rounded-border laws stroke once they lower"
    )]
    StrokePath {
        path: DevicePath,
        width: f64,
        color: ReaderColorV1,
        cap: StrokeCap,
        dash: Option<DashPattern>,
    },
    /// A blurred `shape` (Gaussian `sigma`, in device pixels) drawn at
    /// `offset`, with `clip_out` excluded from the result.
    #[allow(
        dead_code,
        reason = "fixed with the vocabulary; the box-shadow law produces it once it lowers"
    )]
    Shadow {
        shape: DevicePath,
        sigma: f64,
        offset: DevicePoint,
        color: ReaderColorV1,
        clip_out: Option<DevicePath>,
    },
    /// `src` sampled over `source_rect` (image pixels; the whole image when
    /// absent) into `dest`, once or per `tiles`.
    DrawImage {
        src: String,
        dest: DeviceRect,
        source_rect: Option<ReaderRectV1>,
        tiles: Option<TilePlan>,
    },
    /// A text run with every length in device pixels; glyph placement is
    /// still the renderer's.
    Text(ReaderTextCommandV1),
    Ruby(ReaderTextCommandV1),
    /// A block whose paint the lowering does not resolve yet (rounded
    /// corners, box shadows, background images), lengths in device pixels.
    Block {
        rect: DeviceRect,
        paint: ReaderBlockPaintV1,
        border_box: Option<ReaderBorderBoxV1>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PrimitiveList {
    /// Device pixels per CSS pixel the list was resolved at.
    pub ratio: f64,
    pub commands: Vec<Primitive>,
}

impl PrimitiveList {
    /// Blocks handed through unlowered: the renderer's remaining share of
    /// the block laws.
    pub(crate) fn passthrough_block_count(&self) -> usize {
        self.commands
            .iter()
            .filter(|command| matches!(command, Primitive::Block { .. }))
            .count()
    }
}
