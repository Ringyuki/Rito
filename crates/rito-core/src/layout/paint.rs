use std::sync::Arc;

use serde_json::{Number, Value};

mod wire;

#[cfg(test)]
mod test_support;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunPaint {
    data: Arc<RunPaintData>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunPaintData {
    pub(crate) measure: MeasurePaint,
    pub(crate) color: String,
    pub(crate) background_color: Option<String>,
    pub(crate) background_radius: Option<f64>,
    pub(crate) text_shadows: Arc<[TextShadowPaint]>,
    pub(crate) decoration: Option<RunDecoration>,
    pub(crate) padding: Option<RunSpacing>,
    pub(crate) border: Option<RunBorder>,
    /// Pre-snapped vertical extent of the run's decorated inline box,
    /// as offsets from the run rect's top (top, bottom). The painter
    /// uses these instead of growing the box from font metrics, so the
    /// box lands on the exact device rows the layout side rounded to.
    pub(crate) box_offsets: Option<(f64, f64)>,
    /// Whether this run opens/closes its inline box. An inline box split
    /// across several shaping runs paints ONE continuous background: only
    /// the opening run rounds its left corners and only the closing run
    /// its right ones (per-segment rounding drew b51's pill badges as
    /// overlapping circles with white seams).
    pub(crate) box_edges: (bool, bool),
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct MeasurePaint {
    pub(crate) font: FontPaint,
    pub(crate) word_spacing_px: Option<f64>,
    pub(crate) letter_spacing_px: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FontPaint {
    pub(crate) style: FontPaintStyle,
    pub(crate) weight: f64,
    pub(crate) size_px: f64,
    pub(crate) family: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TextShadowPaint {
    pub(crate) offset_x: f64,
    pub(crate) offset_y: f64,
    pub(crate) blur: f64,
    pub(crate) color: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunDecoration {
    pub(crate) kind: RunDecorationKind,
    pub(crate) y: f64,
    pub(crate) thickness: f64,
    pub(crate) color: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunSpacing {
    pub(crate) top: f64,
    pub(crate) right: f64,
    pub(crate) bottom: f64,
    pub(crate) left: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct RunBorder {
    pub(crate) top: Option<RunBorderEdge>,
    pub(crate) bottom: Option<RunBorderEdge>,
    pub(crate) start: Option<RunBorderEdge>,
    pub(crate) end: Option<RunBorderEdge>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunBorderEdge {
    pub(crate) width_px: f64,
    pub(crate) paint: BorderEdgePaint,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BorderEdgePaint {
    pub(crate) color: String,
    pub(crate) style: BorderLineStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FontPaintStyle(&'static str);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RunDecorationKind(&'static str);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BorderLineStyle(&'static str);

impl FontPaintStyle {
    pub(crate) const NORMAL: Self = Self("normal");
    pub(crate) const ITALIC: Self = Self("italic");

    pub(crate) fn from_legacy(value: &str) -> Self {
        let value = value.trim();
        if value.eq_ignore_ascii_case("italic") || value.eq_ignore_ascii_case("oblique") {
            Self::ITALIC
        } else {
            Self::NORMAL
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        self.0
    }
}

impl RunDecorationKind {
    pub(crate) const UNDERLINE: Self = Self("underline");
    pub(crate) const LINE_THROUGH: Self = Self("line-through");

    #[cfg(test)]
    pub(crate) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "underline" => Some(Self::UNDERLINE),
            "line-through" => Some(Self::LINE_THROUGH),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        self.0
    }
}

impl BorderLineStyle {
    pub(crate) const SOLID: Self = Self("solid");
    pub(crate) const DOTTED: Self = Self("dotted");
    pub(crate) const DASHED: Self = Self("dashed");

    pub(crate) fn from_legacy(value: &str) -> Option<Self> {
        let value = value.trim();
        if value.eq_ignore_ascii_case("solid") {
            Some(Self::SOLID)
        } else if value.eq_ignore_ascii_case("dotted") {
            Some(Self::DOTTED)
        } else if value.eq_ignore_ascii_case("dashed") {
            Some(Self::DASHED)
        } else {
            None
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        self.0
    }
}

impl RunPaint {
    pub(crate) fn new(data: RunPaintData) -> Self {
        Self {
            data: Arc::new(data),
        }
    }

    pub(crate) fn measure(&self) -> &MeasurePaint {
        &self.data.measure
    }

    pub(crate) fn color(&self) -> &str {
        &self.data.color
    }

    pub(crate) fn background_color(&self) -> Option<&str> {
        self.data.background_color.as_deref()
    }

    pub(crate) fn background_radius(&self) -> Option<f64> {
        self.data.background_radius
    }

    pub(crate) fn text_shadows(&self) -> &[TextShadowPaint] {
        &self.data.text_shadows
    }

    pub(crate) fn decoration(&self) -> Option<&RunDecoration> {
        self.data.decoration.as_ref()
    }

    pub(crate) fn border(&self) -> Option<&RunBorder> {
        self.data.border.as_ref()
    }

    pub(crate) fn padding(&self) -> Option<&RunSpacing> {
        self.data.padding.as_ref()
    }

    pub(crate) fn add_word_spacing(&mut self, delta: f64) {
        if delta != 0.0 {
            let data = Arc::make_mut(&mut self.data);
            data.measure.word_spacing_px =
                Some(data.measure.word_spacing_px.unwrap_or(0.0) + delta);
        }
    }

    pub(crate) fn add_letter_spacing(&mut self, delta: f64) {
        if delta != 0.0 {
            let data = Arc::make_mut(&mut self.data);
            data.measure.letter_spacing_px =
                Some(data.measure.letter_spacing_px.unwrap_or(0.0) + delta);
        }
    }

    pub(crate) fn set_end_border(&mut self, edge: RunBorderEdge) {
        let data = Arc::make_mut(&mut self.data);
        data.border.get_or_insert_with(RunBorder::default).end = Some(edge);
    }

    pub(crate) fn set_box_offsets(&mut self, top: f64, bottom: f64) {
        let data = Arc::make_mut(&mut self.data);
        data.box_offsets = Some((top, bottom));
    }

    pub(crate) fn for_ruby(&self, font_size: f64) -> Self {
        let font = &self.data.measure.font;
        Self::new(RunPaintData {
            color: self.data.color.clone(),
            measure: MeasurePaint {
                font: FontPaint {
                    style: font.style,
                    weight: font.weight,
                    size_px: font_size,
                    family: font.family.clone(),
                },
                word_spacing_px: None,
                letter_spacing_px: None,
            },
            background_color: None,
            background_radius: None,
            text_shadows: Arc::from([]),
            decoration: None,
            padding: None,
            border: None,
            box_offsets: None,
            box_edges: (true, true),
        })
    }

    #[cfg(test)]
    pub(crate) fn shares_storage_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.data, &other.data)
    }
}

impl Default for RunPaint {
    fn default() -> Self {
        Self::new(RunPaintData::default())
    }
}

impl Default for RunPaintData {
    fn default() -> Self {
        Self {
            measure: MeasurePaint::default(),
            color: "#000000".to_owned(),
            background_color: None,
            background_radius: None,
            text_shadows: Arc::from([]),
            decoration: None,
            padding: None,
            border: None,
            box_offsets: None,
            box_edges: (true, true),
        }
    }
}

impl Default for FontPaint {
    fn default() -> Self {
        Self {
            style: FontPaintStyle::NORMAL,
            weight: 400.0,
            size_px: 16.0,
            family: "serif".to_owned(),
        }
    }
}

pub(crate) fn paint_number_value(value: f64) -> Value {
    if value.is_finite()
        && value.fract() == 0.0
        && value >= i64::MIN as f64
        && value < i64::MAX as f64
    {
        return Value::Number(Number::from(value as i64));
    }
    Value::Number(Number::from_f64(value).unwrap_or_else(|| Number::from(0)))
}

#[cfg(test)]
mod tests;
