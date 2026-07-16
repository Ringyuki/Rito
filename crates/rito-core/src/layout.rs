pub const NAME: &str = "layout";
pub const OWNS: &str = "Block layout, inline layout, line breaking, pagination, pages, and spreads";

use std::collections::{BTreeMap, BTreeSet};

mod cleanup;
mod content;
mod continuous_float;
mod continuous_image;
mod continuous_layout;
mod continuous_list;
mod continuous_summary;
mod continuous_table;
mod continuous_table_model;
mod continuous_table_rows;
mod display_list;
mod display_list_flow;
mod font_summary;
mod hit_map;
mod hit_target;
mod hyphenation;
pub(crate) mod image_size;
mod inline_atoms;
mod inline_content;
mod inline_ruby;
mod inline_segment;
mod inline_summary;
mod line;
mod line_align;
mod line_break;
mod line_break_input;
mod line_finalize;
mod line_layout;
mod line_metrics;
mod line_mode;
mod line_optimal;
mod line_prefix;
mod line_ruby;
mod link_map;
mod locator;
mod page;
mod pagination_flow;
pub(crate) mod pagination_session;
pub(crate) mod runtime_session;
mod search_flow;
mod segment_details;
mod segments;
mod semantic_tree;
mod shape_provenance_diagnostic;
mod spread;
mod spread_flow;
mod style_values;
mod summary_json;
mod summary_types;
mod text_geometry;
mod text_grapheme;
mod text_mapping;
mod text_measure;
mod text_position;
mod text_shape;
mod text_work;
#[cfg(test)]
mod text_work_trace;
mod visual_geometry;

use serde::{Deserialize, Serialize};

pub(crate) use cleanup::{CleanupProgress, PendingBuiltLayoutCleanup, PendingLayoutConfigCleanup};
pub(crate) use content::{RuntimeBlock, RuntimeChild};
pub(crate) use display_list::{build_display_list_frame_commands, DisplayListFrameCommands};
pub use display_list_flow::{DisplayListFlowSpreadDigest, DisplayListFlowSummary};
pub(crate) use font_summary::{
    summarize_layout_font_families, summarize_layout_font_vertical_metric_demands,
};
pub use hit_map::{HitMapFlowCounts, HitMapFlowPageDigest, HitMapFlowSummary};
pub(crate) use hit_target::{build_hit_targets, LayoutHitTarget};
#[cfg(test)]
pub(crate) use line::TextRunInteractionGeometry;
pub(crate) use line::{LineBox, LineRun, TextRunBox};
pub use link_map::{LinkMapFlowPageDigest, LinkMapFlowSummary, LinkMapFlowTotals};
pub(crate) use locator::{collect_anchor_pages, collect_source_run_starts, LayoutSourceRunStart};
#[allow(unused_imports)] // Runtime revision retirement consumes these next.
pub(crate) use page::{
    PendingRuntimePageAccumulatorCleanup, PendingRuntimePageCleanup,
    PendingRuntimePageVectorCleanup,
};
pub use pagination_flow::{
    PaginationFlowChapterRange, PaginationFlowCounts, PaginationFlowPageDigest,
    PaginationFlowSummary,
};
pub(crate) use search_flow::{
    search_runtime_pages, SearchRuntimeMatch, SearchSourcePoint, SearchSourceRange,
};
pub use search_flow::{
    SearchFlowQuerySummary, SearchFlowSummary, SearchRuntimeResult, SearchTextPosition,
};
pub(crate) use segments::{
    append_runtime_chapter_pages, build_inline_segments, build_inline_segments_runtime,
    create_empty_runtime_layout, InlineSegmentChapterInput,
};
pub(crate) use semantic_tree::{build_page_semantic_tree, LayoutSemanticNode, LayoutSemanticRole};
pub(crate) use shape_provenance_diagnostic::{
    summarize_shape_provenance, ShapeAffectedCodepointStats, ShapeProvenanceStats,
};
pub(crate) use spread::build_spread_slots;
pub use spread_flow::SpreadFlowSummary;
#[cfg(test)]
pub(crate) use style_values::round_json_value;
pub use summary_types::{
    ContinuousBlockChapterSummary, ContinuousBlockSummary, InlineSegmentBlockSample,
    InlineSegmentBlockSummary, InlineSegmentChapterSummary, InlineSegmentSummary, LayoutSummary,
    LineBoxBlockSample, LineBoxBlockSummary, LineBoxChapterSummary, LineBoxSummary,
    LineBreakInputBlockSample, LineBreakInputBlockSummary, LineBreakInputChapterSummary,
    LineBreakInputSummary,
};
pub(crate) use text_geometry::build_text_range_geometry;
pub use text_geometry::{TextRangeGeometry, TextRangeRect};
#[cfg(test)]
pub(crate) use text_mapping::fixture_logical_text_flow;
pub(crate) use text_mapping::{LogicalTextFlow, LogicalTextSource, RunTextMapping, TextFlowSlice};
pub(crate) use text_measure::{
    parse_font_family_list, TextMeasurementCache, TextMeasurementFontFace, TextMeasurementFonts,
};
pub(crate) use text_position::build_text_position_page;
pub use text_position::{
    RuntimeTextPositionPage, TextPositionFlowPageDigest, TextPositionFlowSummary,
    TextPositionFlowTotals, TextRunOffset,
};
pub(crate) use text_shape::{ExactRunShape, RunShape, RunShapeCaretAffinity, RunShapeCaretStop};
#[cfg(test)]
pub(crate) use text_shape::{
    RunShapeCluster, RunShapeDirection, RunShapeProvenance, RunShapeUnavailableReason,
};
pub(crate) use visual_geometry::{VisualGeometry, VisualRect};

pub(crate) type LayoutRuntimePage = page::RuntimePage<content::RuntimeBlock<line::LineBox>>;

#[derive(Debug, Clone)]
pub(crate) struct BuiltLayout {
    pub(crate) summary: LayoutSummary,
    pub(crate) pages: Vec<LayoutRuntimePage>,
    pub(crate) chapter_start_pages: BTreeSet<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpreadMode {
    Single,
    Double,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineBreaking {
    Greedy,
    Optimal,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextMeasurementMode {
    #[default]
    FixtureCompatible,
    FontAware,
}

impl TextMeasurementMode {
    fn is_default(value: &Self) -> bool {
        *value == Self::FixtureCompatible
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_orphans: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_widows: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontVerticalMetricSample {
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_style")]
    pub font_style: String,
    #[serde(default = "default_font_weight")]
    pub font_weight: u16,
    pub font_size_px: f64,
    pub top_baseline_ascent_px: f64,
    pub top_baseline_descent_px: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontVerticalMetricDemand {
    pub font_family: String,
    pub font_style: String,
    pub font_weight: u16,
    pub font_size_px: f64,
}

impl FontVerticalMetricDemand {
    pub(crate) fn normalized(
        font_family: Option<&str>,
        font_style: Option<&str>,
        font_weight: Option<f64>,
        font_size_px: f64,
    ) -> Option<Self> {
        if !font_size_px.is_finite() || font_size_px <= 0.0 {
            return None;
        }
        Some(Self {
            font_family: normalize_font_descriptor_part(font_family, "serif"),
            font_style: normalize_font_descriptor_part(font_style, "normal"),
            font_weight: normalize_font_weight(font_weight),
            font_size_px,
        })
    }
}

impl FontVerticalMetricSample {
    pub(crate) fn normalized(&self) -> Option<Self> {
        let demand = FontVerticalMetricDemand::normalized(
            Some(&self.font_family),
            Some(&self.font_style),
            Some(f64::from(self.font_weight)),
            self.font_size_px,
        )?;
        if !self.top_baseline_ascent_px.is_finite()
            || self.top_baseline_ascent_px < 0.0
            || !self.top_baseline_descent_px.is_finite()
            || self.top_baseline_descent_px < 0.0
            || self.top_baseline_ascent_px + self.top_baseline_descent_px <= 0.0
        {
            return None;
        }
        Some(Self {
            font_family: demand.font_family,
            font_style: demand.font_style,
            font_weight: demand.font_weight,
            font_size_px: demand.font_size_px,
            top_baseline_ascent_px: self.top_baseline_ascent_px,
            top_baseline_descent_px: self.top_baseline_descent_px,
        })
    }
}

fn normalize_font_descriptor_part(value: Option<&str>, fallback: &str) -> String {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    value.unwrap_or(fallback).to_ascii_lowercase()
}

fn normalize_font_weight(value: Option<f64>) -> u16 {
    let value = value.unwrap_or(f64::from(default_font_weight())).round();
    if value.is_finite() && (1.0..=1000.0).contains(&value) {
        value as u16
    } else {
        default_font_weight()
    }
}

fn default_font_family() -> String {
    "serif".to_owned()
}

fn default_font_style() -> String {
    "normal".to_owned()
}

const fn default_font_weight() -> u16 {
    400
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutConfig {
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub page_width: f64,
    pub page_height: f64,
    pub margin_top: f64,
    pub margin_right: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub spread_mode: SpreadMode,
    pub first_page_alone: bool,
    pub spread_gap: f64,
    pub root_font_size: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height_override: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height_force: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family_override: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family_force: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pagination_policy: Option<PaginationPolicy>,
    #[serde(default, skip_serializing_if = "TextMeasurementMode::is_default")]
    pub text_measurement: TextMeasurementMode,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub generic_serif_advances: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub font_family_advances: BTreeMap<String, BTreeMap<String, f64>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub generic_serif_pair_adjustments: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub font_family_pair_adjustments: BTreeMap<String, BTreeMap<String, f64>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub font_vertical_metrics: Vec<FontVerticalMetricSample>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutConfigInput {
    pub width: f64,
    pub height: f64,
    pub margin: MarginInput,
    pub spread: SpreadMode,
    pub first_page_alone: bool,
    pub spread_gap: f64,
    pub root_font_size: f64,
    pub line_height_override: Option<f64>,
    pub line_height_force: Option<bool>,
    pub font_family_override: Option<String>,
    pub font_family_force: Option<bool>,
    pub pagination_policy: Option<PaginationPolicy>,
    pub text_measurement: Option<TextMeasurementMode>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MarginInput {
    All(f64),
    Axis {
        x: f64,
        y: f64,
    },
    Sides {
        top: f64,
        right: f64,
        bottom: f64,
        left: f64,
    },
}

impl LayoutConfig {
    pub fn content_width(&self) -> f64 {
        self.page_width - self.margin_left - self.margin_right
    }

    pub fn content_height(&self) -> f64 {
        self.page_height - self.margin_top - self.margin_bottom
    }
}

pub fn create_layout_config(input: LayoutConfigInput) -> LayoutConfig {
    let margins = resolve_margins(input.margin);
    let spread_mode = if input.width < input.height {
        SpreadMode::Single
    } else {
        input.spread
    };
    let page_width = match spread_mode {
        SpreadMode::Double => (input.width - input.spread_gap) / 2.0,
        SpreadMode::Single => input.width,
    };

    LayoutConfig {
        viewport_width: input.width,
        viewport_height: input.height,
        page_width,
        page_height: input.height,
        margin_top: margins.top,
        margin_right: margins.right,
        margin_bottom: margins.bottom,
        margin_left: margins.left,
        spread_mode,
        first_page_alone: input.first_page_alone,
        spread_gap: input.spread_gap,
        root_font_size: input.root_font_size,
        line_height_override: input.line_height_override,
        line_height_force: input.line_height_force,
        font_family_override: input.font_family_override,
        font_family_force: input.font_family_force,
        pagination_policy: input.pagination_policy,
        text_measurement: input.text_measurement.unwrap_or_default(),
        generic_serif_advances: BTreeMap::new(),
        font_family_advances: BTreeMap::new(),
        generic_serif_pair_adjustments: BTreeMap::new(),
        font_family_pair_adjustments: BTreeMap::new(),
        font_vertical_metrics: Vec::new(),
    }
}

#[derive(Debug, Clone, Copy)]
struct Margins {
    top: f64,
    right: f64,
    bottom: f64,
    left: f64,
}

fn resolve_margins(input: MarginInput) -> Margins {
    match input {
        MarginInput::All(value) => Margins {
            top: value,
            right: value,
            bottom: value,
            left: value,
        },
        MarginInput::Axis { x, y } => Margins {
            top: y,
            right: x,
            bottom: y,
            left: x,
        },
        MarginInput::Sides {
            top,
            right,
            bottom,
            left,
        } => Margins {
            top,
            right,
            bottom,
            left,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        create_layout_config, FontVerticalMetricSample, LayoutConfig, LayoutConfigInput,
        MarginInput, SpreadMode, TextMeasurementMode,
    };

    #[test]
    fn creates_single_page_layout_config_from_uniform_margin() {
        let config = create_layout_config(LayoutConfigInput {
            width: 420.0,
            height: 640.0,
            margin: MarginInput::All(24.0),
            spread: SpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: None,
        });

        assert_eq!(config.viewport_width, 420.0);
        assert_eq!(config.page_width, 420.0);
        assert_eq!(config.content_width(), 372.0);
        assert_eq!(config.content_height(), 592.0);
    }

    #[test]
    fn portrait_viewports_force_single_spread_mode() {
        let config = create_layout_config(LayoutConfigInput {
            width: 600.0,
            height: 900.0,
            margin: MarginInput::Axis { x: 40.0, y: 30.0 },
            spread: SpreadMode::Double,
            first_page_alone: true,
            spread_gap: 20.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: None,
        });

        assert_eq!(config.spread_mode, SpreadMode::Single);
        assert_eq!(config.page_width, 600.0);
        assert_eq!(config.margin_left, 40.0);
        assert_eq!(config.margin_top, 30.0);
    }

    #[test]
    fn text_measurement_mode_defaults_to_fixture_compatible() {
        let config: LayoutConfig = serde_json::from_value(serde_json::json!({
            "viewportWidth": 420.0,
            "viewportHeight": 640.0,
            "pageWidth": 420.0,
            "pageHeight": 640.0,
            "marginTop": 24.0,
            "marginRight": 24.0,
            "marginBottom": 24.0,
            "marginLeft": 24.0,
            "spreadMode": "single",
            "firstPageAlone": true,
            "spreadGap": 0.0,
            "rootFontSize": 16.0
        }))
        .expect("layout config without text measurement mode deserializes");

        assert_eq!(
            config.text_measurement,
            TextMeasurementMode::FixtureCompatible
        );
        assert!(config.generic_serif_pair_adjustments.is_empty());
        assert!(config.font_family_pair_adjustments.is_empty());
        assert!(config.font_vertical_metrics.is_empty());
    }

    #[test]
    fn text_measurement_config_accepts_host_pair_adjustments() {
        let mut config = create_layout_config(LayoutConfigInput {
            width: 420.0,
            height: 640.0,
            margin: MarginInput::All(24.0),
            spread: SpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: Some(TextMeasurementMode::FontAware),
        });
        config
            .generic_serif_pair_adjustments
            .insert("：「".to_owned(), -0.5);
        config.font_family_pair_adjustments.insert(
            "title".to_owned(),
            std::collections::BTreeMap::from([("：「".to_owned(), -0.25)]),
        );

        let value = serde_json::to_value(&config).expect("layout config serializes");
        assert_eq!(value["genericSerifPairAdjustments"]["：「"], -0.5);
        assert_eq!(value["fontFamilyPairAdjustments"]["title"]["：「"], -0.25);
        let decoded: LayoutConfig =
            serde_json::from_value(value).expect("layout config pair adjustments deserialize");
        assert_eq!(decoded, config);
    }

    #[test]
    fn text_measurement_mode_accepts_font_aware_config() {
        let config = create_layout_config(LayoutConfigInput {
            width: 420.0,
            height: 640.0,
            margin: MarginInput::All(24.0),
            spread: SpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: Some(TextMeasurementMode::FontAware),
        });

        assert_eq!(config.text_measurement, TextMeasurementMode::FontAware);
    }

    #[test]
    fn text_measurement_config_round_trips_host_vertical_metrics() {
        let mut config = create_layout_config(LayoutConfigInput {
            width: 420.0,
            height: 640.0,
            margin: MarginInput::All(24.0),
            spread: SpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None,
            text_measurement: Some(TextMeasurementMode::FontAware),
        });
        config.font_vertical_metrics = vec![FontVerticalMetricSample {
            font_family: "Book".to_owned(),
            font_style: "Italic".to_owned(),
            font_weight: 700,
            font_size_px: 24.0,
            top_baseline_ascent_px: 5.0,
            top_baseline_descent_px: 22.0,
        }];

        let value = serde_json::to_value(&config).expect("layout config serializes");
        assert_eq!(value["fontVerticalMetrics"][0]["fontFamily"], "Book");
        assert_eq!(value["fontVerticalMetrics"][0]["fontSizePx"], 24.0);
        assert_eq!(
            value["fontVerticalMetrics"][0]["topBaselineDescentPx"],
            22.0
        );
        let decoded: LayoutConfig =
            serde_json::from_value(value).expect("layout config vertical metrics deserialize");
        assert_eq!(decoded, config);
    }
}
