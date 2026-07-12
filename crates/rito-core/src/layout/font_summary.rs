use std::collections::BTreeSet;

use serde_json::Value;

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun},
    LayoutRuntimePage,
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

fn collect_paint_font_family(paint: &Value, families: &mut BTreeSet<String>) {
    if let Some(family) = paint
        .as_object()
        .and_then(|paint| paint.get("font"))
        .and_then(Value::as_object)
        .and_then(|font| font.get("family"))
        .and_then(Value::as_str)
        .filter(|family| !family.is_empty())
    {
        families.insert(family.to_owned());
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::summarize_layout_font_families;
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild},
        line::{LineBox, LineRun, RubyRunBox, TextRunBox},
        page::RuntimePage,
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
                        LineRun::Ruby(RubyRunBox {
                            text: "ルビ".to_owned(),
                            x: 0.0,
                            y: 0.0,
                            width: 20.0,
                            height: 10.0,
                            paint: json!({ "font": { "family": "Ruby" } }),
                        }),
                    ],
                })],
            }],
        )];

        assert_eq!(
            summarize_layout_font_families(&pages),
            vec!["Body".to_owned(), "Ruby".to_owned()]
        );
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
            paint: json!({ "font": { "family": family } }),
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
