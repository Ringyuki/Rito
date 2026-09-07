#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderPointV1 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderSizeV1 {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderRectV1 {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ReaderCornerRadiusV1 {
    pub rx: f64,
    pub ry: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ReaderLengthV1 {
    Px(f64),
    Percent(f64),
}
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ReaderTransformV1 {
    Rotate {
        radians: f64,
    },
    Scale {
        sx: f64,
        sy: f64,
    },
    Translate {
        x: ReaderLengthV1,
        y: ReaderLengthV1,
    },
}
