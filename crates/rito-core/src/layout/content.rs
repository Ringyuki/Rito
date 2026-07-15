use serde_json::Value;

mod cleanup;

pub(crate) use cleanup::PendingRuntimeBlockCleanup;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RuntimeBlock<Line> {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) semantic_tag: Option<String>,
    pub(crate) anchor_id: Option<String>,
    pub(crate) paint: Option<Value>,
    pub(crate) border_box: Option<Value>,
    pub(crate) page_break_before: bool,
    pub(crate) page_break_after: bool,
    pub(crate) orphans: Option<usize>,
    pub(crate) widows: Option<usize>,
    pub(crate) children: Vec<RuntimeChild<Line>>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum RuntimeChild<Line> {
    Block(Box<RuntimeBlock<Line>>),
    Line(Line),
    Image(RuntimeImage),
    Hr(RuntimeHorizontalRule),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RuntimeImage {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) src: String,
    pub(crate) alt: Option<String>,
    pub(crate) href: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RuntimeHorizontalRule {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) color: String,
    pub(crate) style: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{RuntimeBlock, RuntimeChild, RuntimeHorizontalRule, RuntimeImage};

    #[test]
    fn block_stores_geometry_semantics_paint_and_children() {
        let block = RuntimeBlock {
            x: 1.0,
            y: 2.0,
            width: 300.0,
            height: 40.0,
            semantic_tag: Some("p".to_owned()),
            anchor_id: Some("anchor".to_owned()),
            paint: Some(json!({ "opacity": 0.5 })),
            border_box: Some(json!({ "topWidth": 1 })),
            page_break_before: false,
            page_break_after: true,
            orphans: Some(3),
            widows: Some(4),
            children: vec![RuntimeChild::Line("line")],
        };

        assert_eq!(block.semantic_tag.as_deref(), Some("p"));
        assert_eq!(block.anchor_id.as_deref(), Some("anchor"));
        assert_eq!(block.children.len(), 1);
        assert!(block.page_break_after);
        assert_eq!((block.orphans, block.widows), (Some(3), Some(4)));
    }

    #[test]
    fn image_and_hr_children_store_runtime_draw_inputs() {
        let image = RuntimeChild::<()>::Image(RuntimeImage {
            x: 0.0,
            y: 1.0,
            width: 10.0,
            height: 20.0,
            src: "cover.jpg".to_owned(),
            alt: Some("cover".to_owned()),
            href: None,
        });
        let hr = RuntimeChild::<()>::Hr(RuntimeHorizontalRule {
            x: 0.0,
            y: 10.0,
            width: 100.0,
            height: 1.0,
            color: "#000000".to_owned(),
            style: "solid".to_owned(),
        });

        assert!(matches!(image, RuntimeChild::Image(_)));
        assert!(matches!(hr, RuntimeChild::Hr(_)));
    }
}
