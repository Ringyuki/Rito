use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun},
    page::RuntimePage,
    summary_json::{hash_json, hash_text, rect_value},
    visual_geometry::{VisualGeometry, VisualRect},
};

const ADJACENCY_EPSILON: f64 = 0.5;

type LinkMapPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMapFlowSummary {
    pub page_count: usize,
    pub totals: LinkMapFlowTotals,
    pub page_digests: Vec<LinkMapFlowPageDigest>,
    pub samples: Vec<Value>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMapFlowTotals {
    pub regions: usize,
    pub text_length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMapFlowPageDigest {
    pub index: usize,
    pub region_count: usize,
    pub text_length: usize,
    pub detail_hash: String,
}

#[derive(Debug, Clone)]
struct LinkMapFlowPageDetail {
    index: usize,
    text_length: usize,
    regions: Vec<Value>,
    value: Value,
}

#[derive(Debug, Clone)]
struct LinkRegionDetail {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    href: String,
    text: String,
}

pub(crate) fn summarize_link_map_flow(
    pages: &[LinkMapPage],
    sample_indices: Vec<usize>,
) -> LinkMapFlowSummary {
    let details = pages
        .iter()
        .map(summarize_link_map_flow_page)
        .collect::<Vec<_>>();
    let values = details
        .iter()
        .map(|detail| detail.value.clone())
        .collect::<Vec<_>>();
    let page_digests = details
        .iter()
        .map(|detail| LinkMapFlowPageDigest {
            index: detail.index,
            region_count: detail.regions.len(),
            text_length: detail.text_length,
            detail_hash: hash_json(&detail.value),
        })
        .collect::<Vec<_>>();
    let samples = sample_indices
        .into_iter()
        .map(|index| values[index].clone())
        .collect::<Vec<_>>();

    LinkMapFlowSummary {
        page_count: details.len(),
        totals: total_link_map_counts(&details),
        page_digests,
        samples,
        full_detail_hash: hash_json(&Value::Array(values)),
    }
}

fn summarize_link_map_flow_page(page: &LinkMapPage) -> LinkMapFlowPageDetail {
    let regions = build_link_map_regions(page)
        .iter()
        .map(link_region_value)
        .collect::<Vec<_>>();
    let text_length = regions.iter().map(link_region_text_len).sum::<usize>();
    let value = json!({
        "index": page.index,
        "textLength": text_length,
        "regions": regions,
    });

    LinkMapFlowPageDetail {
        index: page.index,
        text_length,
        regions,
        value,
    }
}

fn build_link_map_regions(page: &LinkMapPage) -> Vec<LinkRegionDetail> {
    let mut regions = Vec::new();
    let page_visual = VisualGeometry::page();
    for block in &page.content {
        collect_link_map_line_regions(block, 0.0, 0.0, page_visual, &mut regions);
    }
    for block in &page.content {
        collect_link_map_image_regions(block, 0.0, 0.0, page_visual, &mut regions);
    }
    merge_adjacent_link_regions(regions)
}

fn collect_link_map_line_regions(
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    parent_visual: VisualGeometry,
    regions: &mut Vec<LinkRegionDetail>,
) {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Line(line) => {
                collect_link_map_line_box_regions(line, block_x, block_y, visual, regions);
            }
            RuntimeChild::Block(block) => {
                collect_link_map_line_regions(block, block_x, block_y, visual, regions);
            }
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn collect_link_map_line_box_regions(
    line: &LineBox,
    offset_x: f64,
    offset_y: f64,
    visual: VisualGeometry,
    regions: &mut Vec<LinkRegionDetail>,
) {
    let line_x = offset_x + line.x;
    let line_y = offset_y + line.y;
    for run in &line.runs {
        match run {
            LineRun::Text(run) => {
                if let Some(href) = &run.href {
                    push_link_region(
                        regions,
                        VisualRect::new(line_x + run.x, line_y + run.y, run.width, run.height),
                        visual,
                        href,
                        &run.text,
                    );
                }
            }
            LineRun::Atom(run) => {
                if let Some(href) = &run.href {
                    push_link_region(
                        regions,
                        VisualRect::new(line_x + run.x, line_y + run.y, run.width, run.height),
                        visual,
                        href,
                        "",
                    );
                }
            }
            LineRun::Ruby(_) => {}
        }
    }
}

fn collect_link_map_image_regions(
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    parent_visual: VisualGeometry,
    regions: &mut Vec<LinkRegionDetail>,
) {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    let visual = parent_visual.enter_block(block, block_x, block_y);
    for child in &block.children {
        match child {
            RuntimeChild::Image(image) => {
                if let Some(href) = &image.href {
                    push_link_region(
                        regions,
                        VisualRect::new(
                            block_x + image.x,
                            block_y + image.y,
                            image.width,
                            image.height,
                        ),
                        visual,
                        href,
                        image.alt.as_deref().unwrap_or(""),
                    );
                }
            }
            RuntimeChild::Block(block) => {
                collect_link_map_image_regions(block, block_x, block_y, visual, regions);
            }
            RuntimeChild::Line(_) | RuntimeChild::Hr(_) => {}
        }
    }
}

fn push_link_region(
    regions: &mut Vec<LinkRegionDetail>,
    source_bounds: VisualRect,
    visual: VisualGeometry,
    href: &str,
    text: &str,
) {
    let Some(bounds) = visual.resolve_rect(source_bounds) else {
        return;
    };
    regions.push(LinkRegionDetail {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        href: href.to_owned(),
        text: text.to_owned(),
    });
}

fn merge_adjacent_link_regions(regions: Vec<LinkRegionDetail>) -> Vec<LinkRegionDetail> {
    let mut iter = regions.into_iter();
    let Some(mut current) = iter.next() else {
        return Vec::new();
    };
    let mut merged = Vec::new();
    for next in iter {
        if can_merge_link_region(&current, &next) {
            current = merge_link_regions(current, next);
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);
    merged
}

fn can_merge_link_region(left: &LinkRegionDetail, right: &LinkRegionDetail) -> bool {
    let vertical_match = (left.y - right.y).abs() <= ADJACENCY_EPSILON
        && (left.height - right.height).abs() <= ADJACENCY_EPSILON;
    let gap = right.x - (left.x + left.width);
    left.href == right.href && vertical_match && gap.abs() <= ADJACENCY_EPSILON
}

fn merge_link_regions(left: LinkRegionDetail, right: LinkRegionDetail) -> LinkRegionDetail {
    let x = left.x.min(right.x);
    let y = left.y.min(right.y);
    let right_edge = (left.x + left.width).max(right.x + right.width);
    let bottom = (left.y + left.height).max(right.y + right.height);
    LinkRegionDetail {
        x,
        y,
        width: right_edge - x,
        height: bottom - y,
        href: left.href,
        text: format!("{}{}", left.text, right.text),
    }
}

fn link_region_value(region: &LinkRegionDetail) -> Value {
    json!({
        "bounds": rect_value(region.x, region.y, region.width, region.height),
        "href": region.href,
        "text": {
            "length": utf16_len(&region.text),
            "hash": hash_text(&region.text),
        },
    })
}

fn link_region_text_len(region: &Value) -> usize {
    region
        .get("text")
        .and_then(|text| text.get("length"))
        .and_then(Value::as_u64)
        .map(|length| length as usize)
        .unwrap_or(0)
}

fn total_link_map_counts(details: &[LinkMapFlowPageDetail]) -> LinkMapFlowTotals {
    let mut totals = LinkMapFlowTotals::default();
    for detail in details {
        totals.regions += detail.regions.len();
        totals.text_length += detail.text_length;
    }
    totals
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{summarize_link_map_flow, LinkMapFlowTotals};
    use crate::layout::{
        content::{RuntimeBlock, RuntimeChild, RuntimeImage},
        line::{AtomRunBox, LineBox, LineRun, TextRunBox},
        page::RuntimePage,
    };

    #[test]
    fn merges_adjacent_text_links_and_counts_image_links() {
        let page = RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 10.0,
                y: 20.0,
                width: 300.0,
                height: 120.0,
                semantic_tag: None,
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![
                    RuntimeChild::Line(LineBox {
                        x: 1.0,
                        y: 2.0,
                        width: 300.0,
                        height: 20.0,
                        runs: vec![
                            LineRun::Text(link_text_run("He", 0.0)),
                            LineRun::Text(link_text_run("llo", 10.0)),
                            LineRun::Atom(AtomRunBox {
                                x: 30.0,
                                y: 0.0,
                                width: 8.0,
                                height: 8.0,
                                image_src: None,
                                alt: None,
                                href: Some("#other".to_owned()),
                            }),
                        ],
                    }),
                    RuntimeChild::Image(RuntimeImage {
                        x: 0.0,
                        y: 40.0,
                        width: 80.0,
                        height: 60.0,
                        src: "Images/a.png".to_owned(),
                        alt: Some("cover".to_owned()),
                        href: Some("#image".to_owned()),
                    }),
                ],
            }],
        };

        let summary = summarize_link_map_flow(&[page], vec![0]);

        assert_eq!(
            summary.totals,
            LinkMapFlowTotals {
                regions: 3,
                text_length: 10,
            }
        );
        assert_eq!(summary.samples[0]["regions"][0]["text"]["length"], json!(5));
        assert_eq!(summary.samples[0]["regions"][0]["bounds"]["x"], json!(11));
    }

    fn link_text_run(text: &str, x: f64) -> TextRunBox {
        TextRunBox {
            text: text.to_owned(),
            text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
            x,
            y: 0.0,
            width: 10.0,
            height: 12.0,
            font_size: 12.0,
            paint: json!({}),
            line_height_px: None,
            href: Some("#same".to_owned()),
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
            shape: crate::layout::text_shape::fixture_run_shape(10.0),
        }
    }
}
