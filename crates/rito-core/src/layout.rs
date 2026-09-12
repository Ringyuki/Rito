pub const NAME: &str = "layout";
pub const OWNS: &str = "Layout configuration and the page ranges a revision publishes per chapter";

use serde::{Deserialize, Serialize};

/// One chapter's page span inside a revision's page table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationFlowChapterRange {
    pub start_page: usize,
    pub end_page: usize,
    pub page_count: usize,
    pub block_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpreadMode {
    Single,
    Double,
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
    use super::{create_layout_config, LayoutConfigInput, MarginInput, SpreadMode};

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
        });

        assert_eq!(config.spread_mode, SpreadMode::Single);
        assert_eq!(config.page_width, 600.0);
        assert_eq!(config.margin_left, 40.0);
        assert_eq!(config.margin_top, 30.0);
    }
}
