use std::collections::BTreeSet;

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox},
    paint::RunPaint,
    FontVerticalMetricDemand, LayoutRuntimePage,
};

pub(crate) fn summarize_layout_font_families(pages: &[LayoutRuntimePage]) -> Vec<String> {
    let mut families = BTreeSet::new();
    for page in pages {
        for block in &page.content {
            collect_block_font_families(block, &mut families);
        }
    }
    families.into_iter().collect()
}

pub(crate) fn summarize_layout_font_vertical_metric_demands(
    pages: &[LayoutRuntimePage],
) -> Vec<FontVerticalMetricDemand> {
    let mut demands = Vec::new();
    for page in pages {
        for block in &page.content {
            collect_block_font_vertical_metric_demands(block, &mut demands);
        }
    }
    demands.sort_by(|left, right| {
        left.font_family
            .cmp(&right.font_family)
            .then_with(|| left.font_style.cmp(&right.font_style))
            .then_with(|| left.font_weight.cmp(&right.font_weight))
            .then_with(|| left.font_size_px.total_cmp(&right.font_size_px))
    });
    demands.dedup_by(|left, right| {
        left.font_family == right.font_family
            && left.font_style == right.font_style
            && left.font_weight == right.font_weight
            && left.font_size_px.to_bits() == right.font_size_px.to_bits()
    });
    demands
}

fn collect_block_font_vertical_metric_demands(
    block: &RuntimeBlock<LineBox>,
    demands: &mut Vec<FontVerticalMetricDemand>,
) {
    for child in &block.children {
        match child {
            RuntimeChild::Block(block) => {
                collect_block_font_vertical_metric_demands(block, demands)
            }
            RuntimeChild::Line(line) => collect_line_font_vertical_metric_demands(line, demands),
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_line_font_vertical_metric_demands(
    line: &LineBox,
    demands: &mut Vec<FontVerticalMetricDemand>,
) {
    for run in &line.runs {
        if let LineRun::Text(run) = run {
            if run.interaction_geometry.is_some() {
                continue;
            }
            if let Some(demand) = font_vertical_metric_demand(run) {
                demands.push(demand);
            }
        }
    }
}

fn font_vertical_metric_demand(run: &TextRunBox) -> Option<FontVerticalMetricDemand> {
    let font = &run.paint.measure().font;
    FontVerticalMetricDemand::normalized(
        Some(&font.family),
        Some(font.style.as_str()),
        Some(font.weight),
        run.font_size,
    )
}

fn collect_block_font_families(block: &RuntimeBlock<LineBox>, families: &mut BTreeSet<String>) {
    for child in &block.children {
        match child {
            RuntimeChild::Block(block) => collect_block_font_families(block, families),
            RuntimeChild::Line(line) => collect_line_font_families(line, families),
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_line_font_families(line: &LineBox, families: &mut BTreeSet<String>) {
    for run in &line.runs {
        match run {
            LineRun::Text(run) => collect_paint_font_family(&run.paint, families),
            LineRun::Ruby(run) => collect_paint_font_family(&run.paint, families),
            LineRun::Atom(_) => {}
        }
    }
}

fn collect_paint_font_family(paint: &RunPaint, families: &mut BTreeSet<String>) {
    let family = &paint.measure().font.family;
    if !family.is_empty() {
        families.insert(family.clone());
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{summarize_layout_font_families, summarize_layout_font_vertical_metric_demands};
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild},
        line::{LineBox, LineRun, RubyRunBox, TextRunBox},
        page::RuntimePage,
        paint::RunPaint,
        FontVerticalMetricSample, TextRunInteractionGeometry,
    };

    #[test]
    fn summarizes_text_and_ruby_font_families_from_layout_pages() {
        let pages = vec![RuntimePage::new(
            0,
            600.0,
            800.0,
            None,
            vec![RuntimeBlock {
                x: 0.0,
                y: 0.0,
                width: 600.0,
                height: 40.0,
                semantic_tag: None,
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![RuntimeChild::Line(LineBox {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 20.0,
                    runs: vec![
                        LineRun::Text(text_run("Body")),
                        LineRun::Text(text_run("Body")),
                        LineRun::Ruby(RubyRunBox {
                            text: "ルビ".to_owned(),
                            x: 0.0,
                            y: 0.0,
                            width: 20.0,
                            height: 10.0,
                            paint: RunPaint::from_test_wire_value(
                                json!({ "font": { "family": "Ruby" } }),
                            ),
                        }),
                    ],
                })],
            }],
        )];

        assert_eq!(
            summarize_layout_font_families(&pages),
            vec!["Body".to_owned(), "Ruby".to_owned()]
        );
        assert_eq!(
            summarize_layout_font_vertical_metric_demands(&pages),
            vec![crate::layout::FontVerticalMetricDemand {
                font_family: "body".to_owned(),
                font_style: "normal".to_owned(),
                font_weight: 400,
                font_size_px: 12.0,
            }]
        );
    }

    #[test]
    fn omits_demands_for_runs_with_resolved_interaction_geometry() {
        let mut run = text_run("Body");
        run.interaction_geometry = TextRunInteractionGeometry::from_font_metrics(
            &FontVerticalMetricSample {
                font_family: "body".to_owned(),
                font_style: "normal".to_owned(),
                font_weight: 400,
                font_size_px: 12.0,
                top_baseline_ascent_px: 9.0,
                top_baseline_descent_px: 3.0,
            },
            12.0,
        );
        let pages = page_with_runs(vec![LineRun::Text(run)]);

        assert!(summarize_layout_font_vertical_metric_demands(&pages).is_empty());
    }

    #[test]
    fn metric_demands_normalize_sort_and_deduplicate_exact_descriptors() {
        let alpha = metric_demand_run(" Alpha ", " ITALIC ", 699.6, 12.25);
        let zed = metric_demand_run("Zed", "normal", 400.0, 10.5);
        let pages = page_with_runs(vec![
            LineRun::Text(zed),
            LineRun::Text(alpha.clone()),
            LineRun::Text(alpha),
        ]);

        assert_eq!(
            summarize_layout_font_vertical_metric_demands(&pages),
            vec![
                crate::layout::FontVerticalMetricDemand {
                    font_family: "alpha".to_owned(),
                    font_style: "italic".to_owned(),
                    font_weight: 700,
                    font_size_px: 12.25,
                },
                crate::layout::FontVerticalMetricDemand {
                    font_family: "zed".to_owned(),
                    font_style: "normal".to_owned(),
                    font_weight: 400,
                    font_size_px: 10.5,
                },
            ]
        );
    }

    fn page_with_runs(runs: Vec<LineRun>) -> Vec<RuntimePage<RuntimeBlock<LineBox>>> {
        vec![RuntimePage::new(
            0,
            600.0,
            800.0,
            None,
            vec![RuntimeBlock {
                x: 0.0,
                y: 0.0,
                width: 600.0,
                height: 12.0,
                semantic_tag: None,
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![RuntimeChild::Line(LineBox {
                    x: 0.0,
                    y: 0.0,
                    width: 20.0,
                    height: 12.0,
                    runs,
                })],
            }],
        )]
    }

    fn metric_demand_run(family: &str, style: &str, weight: f64, size: f64) -> TextRunBox {
        let mut run = text_run(family);
        run.font_size = size;
        run.paint = RunPaint::from_test_wire_value(json!({
            "font": {
                "family": family,
                "style": style,
                "weight": weight,
                "sizePx": size,
            }
        }));
        run
    }

    fn text_run(family: &str) -> TextRunBox {
        TextRunBox {
            text: "text".to_owned(),
            text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
            x: 0.0,
            y: 0.0,
            width: 20.0,
            height: 12.0,
            font_size: 12.0,
            interaction_geometry: None,
            paint: RunPaint::from_test_wire_value(json!({
                "font": {
                    "family": family,
                    "style": "normal",
                    "weight": 400,
                    "sizePx": 12,
                }
            })),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
            shape: crate::layout::text_shape::fixture_run_shape(20.0),
        }
    }
}
