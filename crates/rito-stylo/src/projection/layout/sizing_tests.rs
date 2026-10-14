use std::sync::Arc;

use rito_source::SourceArena;

use super::*;
use crate::{StyleDocument, StylesheetInput, Viewport};

#[test]
fn intrinsic_max_width_retains_the_element_layout_style() {
    let cases = [
        ("max-content", MaximumSize::MaxContent),
        ("min-content", MaximumSize::MinContent),
        ("fit-content", MaximumSize::FitContent),
        ("-webkit-fill-available", MaximumSize::WebkitFillAvailable),
        ("stretch", MaximumSize::Stretch),
        (
            "fit-content(120px)",
            MaximumSize::FitContentFunction(NonNegativeLengthPercentage::new(
                LengthPercentage::Length(CssPx::new(120.0).unwrap()),
            )),
        ),
    ];
    for (value, expected) in cases {
        let source = Arc::new(SourceArena::from_xhtml(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="target">text</div></body></html>"#,
        ).unwrap());
        let target = source.find_element_by_id("target").unwrap();
        let url = "https://example.test/chapter.xhtml";
        let css = format!("#target {{ max-width:{value}; width:120px; padding:8px; margin-left:12px; display:none }}");
        let mut document = StyleDocument::from_source_with_root_font_size(
            source,
            url,
            Viewport::default(),
            16.0,
            &[StylesheetInput::author(&css, url)],
        )
        .unwrap();
        let projection = document.resolve_production_slice().unwrap();
        let style = projection
            .layout()
            .table()
            .style_for_node(target.index())
            .unwrap();
        assert_eq!(style.max_width, expected, "{value}");
        assert_eq!(style.display.outside, LayoutDisplayOutside::None);
        assert_eq!(
            style.width,
            PreferredSize::Value(NonNegativeLengthPercentage::new(LengthPercentage::Length(
                CssPx::new(120.0).unwrap()
            ),))
        );
        assert_eq!(
            style.padding.left.value(),
            LengthPercentage::Length(CssPx::new(8.0).unwrap())
        );
        assert_eq!(
            style.margin.left,
            LengthPercentageOrAuto::Value(LengthPercentage::Length(CssPx::new(12.0).unwrap()))
        );
        assert!(projection.layout().dispositions().iter().any(|disposition| matches!(
            disposition, LayoutStyleDisposition::ContractProjected { node_id, .. } if *node_id == target
        )));
    }
}
