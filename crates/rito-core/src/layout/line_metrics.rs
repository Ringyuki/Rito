use serde_json::{Map, Value};

use super::{
    line::LineRun,
    style_values::{number_style, string_style},
    text_measure::{
        measure_text, TextMeasurementFonts, TextMeasurementInput, TextMeasurementPolicy,
        TextMeasurementStyle,
    },
};

pub(crate) fn measure_text_slice_with_fonts(
    text: &str,
    style: &Map<String, Value>,
    fonts: &TextMeasurementFonts<'_>,
) -> f64 {
    measure_text(TextMeasurementInput {
        text,
        style: TextMeasurementStyle::from_style(style),
        policy: TextMeasurementPolicy::FontAware,
        fonts,
    })
    .width
}

pub(crate) fn line_height_px(style: &Map<String, Value>) -> f64 {
    number_style(style, "lineHeightPx").unwrap_or_else(|| {
        number_style(style, "fontSize").unwrap_or(16.0)
            * number_style(style, "lineHeight").unwrap_or(1.2)
    })
}

pub(crate) fn vertical_align_offset(
    style: &Map<String, Value>,
    line_height: f64,
    base_font_size: f64,
) -> f64 {
    let font_size = number_style(style, "fontSize").unwrap_or(16.0);
    match string_style(style, "verticalAlign").as_deref() {
        Some("baseline") => 0.8 * (base_font_size - font_size),
        Some("top" | "text-top") => 0.0,
        Some("super") => 0.8 * (base_font_size - font_size) - base_font_size * 0.4,
        Some("sub") => 0.8 * (base_font_size - font_size) + base_font_size * 0.2,
        Some("middle") => (line_height - font_size) / 2.0,
        Some("bottom" | "text-bottom") => line_height - font_size,
        _ => 0.0,
    }
}

pub(crate) fn runs_width(runs: &[LineRun]) -> f64 {
    runs.iter()
        .map(LineRun::advance_right)
        .fold(0.0_f64, f64::max)
}

pub(crate) fn effective_line_metrics(runs: &[LineRun], base_line_height: f64) -> (f64, f64) {
    let mut min_top = 0.0_f64;
    let mut max_bottom = 0.0_f64;
    let mut ruby_overhang = 0.0_f64;

    for run in runs {
        let (top, bottom, ruby) = match run {
            LineRun::Text(run) => {
                let (top, bottom) = if let Some(line_height_px) = run.line_height_px {
                    let half_leading = (run.font_size - line_height_px) / 2.0;
                    let top = run.y + half_leading;
                    (top, top + line_height_px)
                } else {
                    (run.y, run.y + run.height)
                };
                let ruby = run
                    .ruby_annotation
                    .as_ref()
                    .map(|_| run.font_size * 0.5 + 1.0)
                    .unwrap_or(0.0);
                (top, bottom, ruby)
            }
            LineRun::Atom(run) => (run.y, run.y + run.height, 0.0),
            LineRun::Ruby(_) => continue,
        };
        if top < min_top {
            min_top = top;
        }
        if bottom > max_bottom {
            max_bottom = bottom;
        }
        if ruby > ruby_overhang {
            ruby_overhang = ruby;
        }
    }

    let content_height = base_line_height.max(max_bottom - min_top);
    let height = content_height + ruby_overhang;
    let y_shift = if min_top < 0.0 { -min_top } else { 0.0 } + ruby_overhang;
    (height, y_shift)
}

pub(crate) fn shift_runs_y(runs: Vec<LineRun>, dy: f64) -> Vec<LineRun> {
    if dy == 0.0 {
        return runs;
    }
    runs.into_iter()
        .map(|mut run| {
            run.shift_y(dy);
            run
        })
        .collect()
}
