use crate::layout::{PaginationPolicy, SpreadMode, TextMeasurementMode};

/// Flat remainder of a decomposed layout configuration.
#[derive(Debug)]
pub(super) struct LayoutConfigShell {
    pub(super) viewport_width: f64,
    pub(super) viewport_height: f64,
    pub(super) page_width: f64,
    pub(super) page_height: f64,
    pub(super) margin_top: f64,
    pub(super) margin_right: f64,
    pub(super) margin_bottom: f64,
    pub(super) margin_left: f64,
    pub(super) spread_mode: SpreadMode,
    pub(super) first_page_alone: bool,
    pub(super) spread_gap: f64,
    pub(super) root_font_size: f64,
    pub(super) line_height_override: Option<f64>,
    pub(super) line_height_force: Option<bool>,
    pub(super) font_family_override: Option<String>,
    pub(super) font_family_force: Option<bool>,
    pub(super) pagination_policy: Option<PaginationPolicy>,
    pub(super) text_measurement: TextMeasurementMode,
}

impl LayoutConfigShell {
    pub(super) fn release(self) {
        let Self {
            viewport_width,
            viewport_height,
            page_width,
            page_height,
            margin_top,
            margin_right,
            margin_bottom,
            margin_left,
            spread_mode,
            first_page_alone,
            spread_gap,
            root_font_size,
            line_height_override,
            line_height_force,
            font_family_override,
            font_family_force,
            pagination_policy,
            text_measurement,
        } = self;
        let _ = (
            viewport_width,
            viewport_height,
            page_width,
            page_height,
            margin_top,
            margin_right,
            margin_bottom,
            margin_left,
            spread_mode,
            first_page_alone,
            spread_gap,
            root_font_size,
            line_height_override,
            line_height_force,
            font_family_override,
            font_family_force,
            pagination_policy,
            text_measurement,
        );
    }
}
