use std::sync::Arc;

use serde_json::{json, Map, Number, Value};

use super::{
    line_break::utf16_len,
    paint::RunPaint,
    summary_json::{hash_text, number_value, rect_value},
    text_mapping::RunTextMapping,
    text_shape::RunShape,
    FontVerticalMetricSample,
};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LineBox {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) runs: Vec<LineRun>,
}

impl LineBox {
    pub(crate) fn normalized(&self) -> Value {
        json!({
            "bounds": rect_value(self.x, self.y, self.width, self.height),
            "runs": self.runs.iter().map(LineRun::normalized).collect::<Vec<_>>(),
        })
    }

    pub(crate) fn text(&self) -> String {
        self.runs
            .iter()
            .filter_map(LineRun::text)
            .collect::<String>()
    }

    pub(crate) fn text_run_count(&self) -> usize {
        self.runs
            .iter()
            .filter(|run| matches!(run, LineRun::Text(_)))
            .count()
    }

    pub(crate) fn atom_count(&self) -> usize {
        self.runs
            .iter()
            .filter(|run| matches!(run, LineRun::Atom(_)))
            .count()
    }

    pub(crate) fn ruby_count(&self) -> usize {
        self.runs
            .iter()
            .filter(|run| matches!(run, LineRun::Ruby(_)))
            .count()
    }

    pub(crate) fn used_width(&self) -> f64 {
        self.runs.iter().map(LineRun::right).fold(0.0_f64, f64::max)
    }

    pub(crate) fn offset_position(mut self, dx: f64, dy: f64) -> Self {
        if dx != 0.0 {
            self.x += dx;
        }
        if dy != 0.0 {
            self.y += dy;
        }
        self
    }

    pub(crate) fn offset_with_runs(mut self, dx: f64, dy: f64) -> Self {
        self = self.offset_position(dx, dy);
        self.runs = self
            .runs
            .into_iter()
            .map(|run| run.offset(dx, dy))
            .collect();
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LineRun {
    Text(TextRunBox),
    Atom(AtomRunBox),
    Ruby(RubyRunBox),
}

impl LineRun {
    pub(crate) fn normalized(&self) -> Value {
        match self {
            Self::Text(run) => run.normalized(),
            Self::Atom(run) => run.normalized(),
            Self::Ruby(run) => run.normalized(),
        }
    }

    pub(crate) fn text(&self) -> Option<&str> {
        match self {
            Self::Text(run) => Some(&run.text),
            Self::Atom(_) | Self::Ruby(_) => None,
        }
    }

    pub(crate) fn right(&self) -> f64 {
        match self {
            Self::Text(run) => run.x + run.width,
            Self::Atom(run) => run.x + run.width,
            Self::Ruby(run) => run.x + run.width,
        }
    }

    pub(crate) fn advance_right(&self) -> f64 {
        match self {
            Self::Text(run) => {
                run.x
                    + run.width
                    + run.trailing_inline_extension()
                    + run.inline_margin_right.unwrap_or(0.0)
            }
            Self::Atom(run) => run.x + run.width,
            Self::Ruby(run) => run.x + run.width,
        }
    }

    pub(crate) fn y(&self) -> f64 {
        match self {
            Self::Text(run) => run.y,
            Self::Atom(run) => run.y,
            Self::Ruby(run) => run.y,
        }
    }

    pub(crate) fn geometry(&self) -> (f64, f64) {
        match self {
            Self::Text(run) => (run.x, run.width),
            Self::Atom(run) => (run.x, run.width),
            Self::Ruby(run) => (run.x, run.width),
        }
    }

    pub(crate) fn shift_x(&mut self, dx: f64) {
        match self {
            Self::Text(run) => run.x += dx,
            Self::Atom(run) => run.x += dx,
            Self::Ruby(run) => run.x += dx,
        }
    }

    pub(crate) fn shift_y(&mut self, dy: f64) {
        match self {
            Self::Text(run) => run.y += dy,
            Self::Atom(run) => run.y += dy,
            Self::Ruby(run) => run.y += dy,
        }
    }

    pub(crate) fn offset(mut self, dx: f64, dy: f64) -> Self {
        self.shift_x(dx);
        self.shift_y(dy);
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TextRunBox {
    pub(crate) text: String,
    pub(crate) text_mapping: RunTextMapping,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) font_size: f64,
    pub(crate) interaction_geometry: Option<TextRunInteractionGeometry>,
    pub(crate) paint: RunPaint,
    pub(crate) line_height_px: Option<f64>,
    pub(crate) href: Option<String>,
    pub(crate) source_path: Option<Vec<usize>>,
    pub(crate) source_text: Option<Arc<str>>,
    pub(crate) source_text_offset: Option<usize>,
    pub(crate) inline_margin_right: Option<f64>,
    pub(crate) ruby_annotation: Option<String>,
    pub(crate) shape: RunShape,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TextRunInteractionGeometry {
    top_offset: f64,
    top_baseline_ascent_px: f64,
    top_baseline_descent_px: f64,
}

impl TextRunInteractionGeometry {
    pub(crate) fn from_font_metrics(
        metrics: &FontVerticalMetricSample,
        line_height: f64,
    ) -> Option<Self> {
        if !line_height.is_finite()
            || line_height < 0.0
            || !metrics.top_baseline_ascent_px.is_finite()
            || metrics.top_baseline_ascent_px < 0.0
            || !metrics.top_baseline_descent_px.is_finite()
            || metrics.top_baseline_descent_px < 0.0
        {
            return None;
        }
        let height = metrics.top_baseline_ascent_px + metrics.top_baseline_descent_px;
        let top_offset = ((line_height - height) / 2.0).floor();
        (top_offset.is_finite() && height.is_finite() && height > 0.0).then_some(Self {
            top_offset,
            top_baseline_ascent_px: metrics.top_baseline_ascent_px,
            top_baseline_descent_px: metrics.top_baseline_descent_px,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunSourceProvenance {
    pub(crate) source_path: Option<Vec<usize>>,
    pub(crate) source_text: Option<Arc<str>>,
    pub(crate) source_text_offset: Option<usize>,
}

impl RunSourceProvenance {
    pub(crate) fn checked(
        source_path: Option<&[usize]>,
        source_text: Option<&Arc<str>>,
        source_text_offset: Option<usize>,
        relative_offset: Option<usize>,
    ) -> Self {
        if source_path.is_none() && source_text.is_none() {
            return Self::unavailable();
        }
        let Some(offset) = relative_offset
            .and_then(|relative| source_text_offset.unwrap_or(0).checked_add(relative))
        else {
            return Self::unavailable();
        };
        Self {
            source_path: source_path.map(<[usize]>::to_vec),
            source_text: source_text.cloned(),
            source_text_offset: Some(offset),
        }
    }

    const fn unavailable() -> Self {
        Self {
            source_path: None,
            source_text: None,
            source_text_offset: None,
        }
    }
}

impl TextRunBox {
    pub(crate) fn interaction_vertical_bounds(&self) -> (f64, f64) {
        let Some(geometry) = self.interaction_geometry else {
            return (self.y, self.height);
        };
        // Absolute CSS line heights keep `y` at the canvas content top while
        // line finalization normalizes the inline box by its half-leading.
        // Range geometry is relative to that inline box, not the canvas text
        // origin, so recover its top before applying the measured font box.
        let inline_box_top = self.y
            + self
                .line_height_px
                .map(|line_height| (self.font_size - line_height) / 2.0)
                .unwrap_or(0.0);
        let y = inline_box_top + geometry.top_offset;
        let height = geometry.top_baseline_ascent_px + geometry.top_baseline_descent_px;
        if y.is_finite() && height.is_finite() && height > 0.0 {
            (y, height)
        } else {
            (self.y, self.height)
        }
    }

    fn trailing_inline_extension(&self) -> f64 {
        let Some(end) = self.paint.border().and_then(|border| border.end.as_ref()) else {
            return 0.0;
        };
        self.paint
            .padding()
            .map(|padding| padding.right)
            .unwrap_or(0.0)
            + end.width_px
    }

    fn normalized(&self) -> Value {
        let mut value = Map::new();
        value.insert("type".to_owned(), Value::String("text-run".to_owned()));
        value.insert(
            "text".to_owned(),
            json!({
                "hash": hash_text(&self.text),
                "length": utf16_len(&self.text),
            }),
        );
        value.insert(
            "bounds".to_owned(),
            rect_value(self.x, self.y, self.width, self.height),
        );
        insert_optional_string(&mut value, "href", self.href.as_deref());
        insert_optional_path(&mut value, "sourcePath", self.source_path.as_ref());
        if let Some(offset) = self.source_text_offset {
            value.insert(
                "sourceTextOffset".to_owned(),
                Value::Number(Number::from(offset)),
            );
        }
        insert_optional_number(&mut value, "inlineMarginRight", self.inline_margin_right);
        Value::Object(value)
    }

    #[cfg(test)]
    pub(crate) fn add_paint_spacing(&mut self, key: &str, delta: f64) {
        if delta == 0.0 {
            return;
        }
        let (word_spacing_delta, letter_spacing_delta) = match key {
            "wordSpacingPx" => {
                self.add_word_spacing_value(delta);
                (delta, 0.0)
            }
            "letterSpacingPx" => {
                self.add_letter_spacing_value(delta);
                (0.0, delta)
            }
            _ => return,
        };
        self.shape.apply_spacing_delta_in_place(
            &self.text,
            word_spacing_delta,
            letter_spacing_delta,
            self.width,
        );
    }

    pub(crate) fn add_word_spacing_value(&mut self, delta: f64) {
        self.paint.add_word_spacing(delta);
    }

    pub(crate) fn add_letter_spacing_value(&mut self, delta: f64) {
        self.paint.add_letter_spacing(delta);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AtomRunBox {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) image_src: Option<String>,
    pub(crate) alt: Option<String>,
    pub(crate) href: Option<String>,
}

impl AtomRunBox {
    fn normalized(&self) -> Value {
        let mut value = Map::new();
        value.insert("type".to_owned(), Value::String("inline-atom".to_owned()));
        value.insert(
            "bounds".to_owned(),
            rect_value(self.x, self.y, self.width, self.height),
        );
        insert_optional_string(&mut value, "imageSrc", self.image_src.as_deref());
        insert_optional_string(&mut value, "alt", self.alt.as_deref());
        insert_optional_string(&mut value, "href", self.href.as_deref());
        Value::Object(value)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RubyRunBox {
    pub(crate) text: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) paint: RunPaint,
}

impl RubyRunBox {
    fn normalized(&self) -> Value {
        json!({
            "type": "ruby-annotation",
            "text": {
                "hash": hash_text(&self.text),
                "length": utf16_len(&self.text),
            },
            "bounds": rect_value(self.x, self.y, self.width, self.height),
        })
    }
}

fn insert_optional_string(output: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), Value::String(value.to_owned()));
    }
}

fn insert_optional_path(output: &mut Map<String, Value>, key: &str, value: Option<&Vec<usize>>) {
    if let Some(value) = value {
        output.insert(
            key.to_owned(),
            Value::Array(
                value
                    .iter()
                    .map(|part| Value::Number(Number::from(*part)))
                    .collect(),
            ),
        );
    }
}

fn insert_optional_number(output: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        output.insert(key.to_owned(), number_value(value));
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{AtomRunBox, LineBox, LineRun, RubyRunBox, TextRunBox, TextRunInteractionGeometry};
    use crate::layout::{paint::RunPaint, FontVerticalMetricSample};

    #[test]
    fn zero_line_height_accepts_finite_font_vertical_metrics() {
        let geometry = TextRunInteractionGeometry::from_font_metrics(
            &FontVerticalMetricSample {
                font_family: "serif".to_owned(),
                font_style: "normal".to_owned(),
                font_weight: 400,
                font_size_px: 16.0,
                top_baseline_ascent_px: 9.0,
                top_baseline_descent_px: 3.0,
            },
            0.0,
        )
        .expect("zero CSS line-height retains measurable glyph geometry");

        assert_eq!(geometry.top_offset, -6.0);
        assert_eq!(geometry.top_baseline_ascent_px, 9.0);
        assert_eq!(geometry.top_baseline_descent_px, 3.0);
    }

    #[test]
    fn invalid_line_height_still_rejects_font_vertical_metrics() {
        let sample = FontVerticalMetricSample {
            font_family: "serif".to_owned(),
            font_style: "normal".to_owned(),
            font_weight: 400,
            font_size_px: 16.0,
            top_baseline_ascent_px: 9.0,
            top_baseline_descent_px: 3.0,
        };

        assert!(TextRunInteractionGeometry::from_font_metrics(&sample, -1.0).is_none());
        assert!(TextRunInteractionGeometry::from_font_metrics(&sample, f64::NAN).is_none());
    }

    #[test]
    fn line_box_reports_text_counts_and_used_width() {
        let line = LineBox {
            x: 0.0,
            y: 0.0,
            width: 120.0,
            height: 20.0,
            runs: vec![
                LineRun::Text(TextRunBox {
                    text: "Hello".to_owned(),
                    text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
                    x: 1.0,
                    y: 2.0,
                    width: 30.0,
                    height: 12.0,
                    font_size: 12.0,
                    interaction_geometry: None,
                    paint: RunPaint::from_test_wire_value(json!({ "color": "#000000" })),
                    line_height_px: None,
                    href: None,
                    source_path: Some(vec![0, 1]),
                    source_text: Some("Hello".into()),
                    source_text_offset: Some(0),
                    inline_margin_right: Some(2.0),
                    ruby_annotation: None,
                    shape: crate::layout::text_shape::fixture_run_shape(30.0),
                }),
                LineRun::Atom(AtomRunBox {
                    x: 40.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    image_src: Some("img.png".to_owned()),
                    alt: None,
                    href: Some("#target".to_owned()),
                }),
                LineRun::Ruby(RubyRunBox {
                    text: "ruby".to_owned(),
                    x: 1.0,
                    y: -8.0,
                    width: 30.0,
                    height: 6.0,
                    paint: RunPaint::from_test_wire_value(json!({ "color": "#000000" })),
                }),
            ],
        };

        assert_eq!(line.text(), "Hello");
        assert_eq!(line.text_run_count(), 1);
        assert_eq!(line.atom_count(), 1);
        assert_eq!(line.ruby_count(), 1);
        assert_eq!(line.runs[0].advance_right(), 33.0);
        assert_eq!(line.used_width(), 50.0);
        assert_eq!(line.normalized()["runs"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn advance_right_requires_end_border_before_counting_padding() {
        let padding_without_border = text_run_with_paint(json!({
            "padding": { "right": 10 }
        }));
        let padding_with_border = text_run_with_paint(json!({
            "padding": { "right": 10 },
            "border": {
                "end": { "widthPx": 2, "paint": { "color": "#000", "style": "solid" } }
            }
        }));

        assert_eq!(LineRun::Text(padding_without_border).advance_right(), 31.0);
        assert_eq!(LineRun::Text(padding_with_border).advance_right(), 43.0);
    }

    #[test]
    fn line_and_run_offsets_update_geometry() {
        let line = LineBox {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 20.0,
            runs: vec![LineRun::Text(TextRunBox {
                text: "A".to_owned(),
                text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
                x: 2.0,
                y: 3.0,
                width: 8.0,
                height: 12.0,
                font_size: 12.0,
                interaction_geometry: None,
                paint: RunPaint::default(),
                line_height_px: None,
                href: None,
                source_path: None,
                source_text: None,
                source_text_offset: None,
                inline_margin_right: None,
                ruby_annotation: None,
                shape: crate::layout::text_shape::fixture_run_shape(8.0),
            })],
        }
        .offset_with_runs(5.0, -2.0);

        assert_eq!(line.x, 15.0);
        assert_eq!(line.y, 18.0);
        assert_eq!(line.runs[0].geometry(), (7.0, 8.0));
        assert_eq!(line.runs[0].y(), 1.0);
    }

    #[test]
    fn text_run_accumulates_paint_spacing() {
        let mut run = TextRunBox {
            text: "A B".to_owned(),
            text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 12.0,
            font_size: 12.0,
            interaction_geometry: None,
            paint: RunPaint::from_test_wire_value(json!({ "wordSpacingPx": 1 })),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
            shape: crate::layout::text_shape::fixture_run_shape(20.0),
        };

        run.add_paint_spacing("wordSpacingPx", 2.5);
        run.add_paint_spacing("letterSpacingPx", 8.0 / 29.0);

        assert_eq!(run.paint.measure().word_spacing_px, Some(3.5));
        assert_eq!(run.paint.measure().letter_spacing_px, Some(8.0 / 29.0));
    }

    #[test]
    fn retained_text_mapping_does_not_change_normalized_render_geometry() {
        let mut run = text_run_with_paint(json!({ "color": "#123456" }));
        let normalized = run.normalized();

        run.text_mapping = crate::layout::text_mapping::RunTextMapping::Unavailable(
            crate::layout::text_mapping::TextMappingUnavailableReason::NonLinearTextTransform,
        );

        assert_eq!(run.normalized(), normalized);
    }

    fn text_run_with_paint(paint: serde_json::Value) -> TextRunBox {
        TextRunBox {
            text: "Hello".to_owned(),
            text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
            x: 1.0,
            y: 0.0,
            width: 30.0,
            height: 12.0,
            font_size: 12.0,
            interaction_geometry: None,
            paint: RunPaint::from_test_wire_value(paint),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
            shape: crate::layout::text_shape::fixture_run_shape(30.0),
        }
    }
}
