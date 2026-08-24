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

impl ReaderLengthV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Px(_) => 1,
            Self::Percent(_) => 2,
        }
    }

    pub(crate) const fn value(self) -> f64 {
        match self {
            Self::Px(value) | Self::Percent(value) => value,
        }
    }
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

impl ReaderTransformV1 {
    pub(crate) const fn tag(self) -> u8 {
        match self {
            Self::Rotate { .. } => 1,
            Self::Scale { .. } => 2,
            Self::Translate { .. } => 3,
        }
    }
}
