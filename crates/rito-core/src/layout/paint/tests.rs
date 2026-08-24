use std::sync::Arc;

use serde_json::json;

use super::{
    paint_number_value, BorderEdgePaint, BorderLineStyle, FontPaint, FontPaintStyle, MeasurePaint,
    RunBorder, RunBorderEdge, RunDecoration, RunDecorationKind, RunPaint, RunPaintData, RunSpacing,
    TextShadowPaint,
};

#[test]
fn minimal_wire_paint_is_always_valid_for_the_wasm_contract() {
    assert_eq!(
        RunPaint::default().to_wire_value(),
        json!({
            "color": "#000000",
            "font": { "family": "serif", "sizePx": 16, "style": "normal", "weight": 400 },
        })
    );
}

#[test]
fn full_wire_paint_keeps_camel_case_and_omits_no_present_field() {
    let paint = RunPaint::new(RunPaintData {
        measure: MeasurePaint {
            font: FontPaint {
                family: "Rito Serif".to_owned(),
                size_px: 14.125,
                style: FontPaintStyle::ITALIC,
                weight: 650.0,
            },
            word_spacing_px: Some(1.25),
            letter_spacing_px: Some(-0.5),
        },
        color: "color(display-p3 1 0.2 0.1)".to_owned(),
        background_color: Some("#112233".to_owned()),
        background_radius: Some(3.5),
        text_shadows: Arc::from([TextShadowPaint {
            offset_x: 1.23456,
            offset_y: 2.0,
            blur: 3.0,
            color: "#445566".to_owned(),
        }]),
        decoration: Some(RunDecoration {
            kind: RunDecorationKind::UNDERLINE,
            y: 14.125,
            thickness: 1.0,
            color: "#778899".to_owned(),
        }),
        padding: Some(RunSpacing {
            top: 1.0,
            right: 2.0,
            bottom: 3.0,
            left: 4.0,
        }),
        border: Some(RunBorder {
            top: Some(edge(1.0, "#111111", "solid")),
            bottom: Some(edge(2.0, "#222222", "dotted")),
            start: Some(edge(3.0, "#333333", "dashed")),
            end: Some(edge(4.0, "#444444", "solid")),
        }),
        box_offsets: None,
        box_edges: (true, true),
    });

    assert_eq!(
        paint.to_wire_value(),
        json!({
            "color": "color(display-p3 1 0.2 0.1)",
            "font": { "family": "Rito Serif", "sizePx": 14.125, "style": "italic", "weight": 650 },
            "wordSpacingPx": 1.25,
            "letterSpacingPx": -0.5,
            "backgroundColor": "#112233",
            "backgroundRadius": 3.5,
            "textShadow": [{ "offsetX": 1.235, "offsetY": 2, "blur": 3, "color": "#445566" }],
            "decoration": { "kind": "underline", "y": 14.125, "thickness": 1, "color": "#778899" },
            "padding": { "top": 1, "right": 2, "bottom": 3, "left": 4 },
            "border": {
                "top": { "widthPx": 1, "paint": { "color": "#111111", "style": "solid" } },
                "bottom": { "widthPx": 2, "paint": { "color": "#222222", "style": "dotted" } },
                "start": { "widthPx": 3, "paint": { "color": "#333333", "style": "dashed" } },
                "end": { "widthPx": 4, "paint": { "color": "#444444", "style": "solid" } },
            },
        })
    );
}

#[test]
fn clones_share_storage_until_layout_mutates_spacing() {
    let original = RunPaint::default();
    let mut clone = original.clone();
    assert!(original.shares_storage_with(&clone));

    clone.add_letter_spacing(2.0);

    assert!(!original.shares_storage_with(&clone));
    assert_eq!(original.measure().letter_spacing_px, None);
    assert_eq!(clone.measure().letter_spacing_px, Some(2.0));
}

#[test]
fn ordinary_paint_numbers_keep_precision_and_canonicalize_non_finite_values() {
    assert_eq!(paint_number_value(14.123456), json!(14.123456));
    assert_eq!(paint_number_value(-0.0), json!(0));
    assert_eq!(paint_number_value(f64::NAN), json!(0));
    assert_eq!(paint_number_value(f64::INFINITY), json!(0));
    assert_eq!(paint_number_value(f64::NEG_INFINITY), json!(0));
}

fn edge(width_px: f64, color: &str, style: &str) -> RunBorderEdge {
    RunBorderEdge {
        width_px,
        paint: BorderEdgePaint {
            color: color.to_owned(),
            style: BorderLineStyle::from_legacy(style).expect("valid border style"),
        },
    }
}
