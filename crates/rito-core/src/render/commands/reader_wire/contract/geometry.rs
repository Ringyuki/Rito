#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderCornerRadius {
    pub rx: f64,
    pub ry: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ReaderLength {
    Px(f64),
    Percent(f64),
}
#[allow(
    dead_code,
    reason = "RITODL1 freezes the transform tags before the style projection emits every operation"
)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ReaderTransform {
    Rotate { radians: f64 },
    Scale { sx: f64, sy: f64 },
    Translate { x: ReaderLength, y: ReaderLength },
}
