pub const NAME: &str = "layout";
pub const OWNS: &str = "Layout configuration";

use serde::{Deserialize, Serialize};

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
    /// Device pixels per CSS pixel the pages are painted at.
    pub device_pixel_ratio: f64,
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
    let (page_width, spread_gap) = match spread_mode {
        SpreadMode::Double => {
            spread_on_device_grid(input.width, input.spread_gap, input.device_pixel_ratio)
        }
        SpreadMode::Single => (input.width, input.spread_gap),
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
        spread_gap,
        root_font_size: input.root_font_size,
        line_height_override: input.line_height_override,
        line_height_force: input.line_height_force,
        font_family_override: input.font_family_override,
        font_family_force: input.font_family_force,
    }
}

/// The page width and the gap of a two-page spread `width` CSS pixels
/// wide. The pages sit on the device grid, as a browser places a frame:
/// each is a whole number of device pixels wide, and what an odd width
/// leaves over goes to the gap between them, which ends where the right
/// page begins, a page's width short of the viewport's edge.
fn spread_on_device_grid(width: f64, gap: f64, ratio: f64) -> (f64, f64) {
    // A whole number of device pixels the arithmetic missed by a rounding
    // error is that number.
    let page = (((width - gap) * ratio / 2.0) + 1e-6).floor() / ratio;
    (page, width - 2.0 * page)
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
            device_pixel_ratio: 1.0,
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
            device_pixel_ratio: 1.0,
        });

        assert_eq!(config.spread_mode, SpreadMode::Single);
        assert_eq!(config.page_width, 600.0);
        assert_eq!(config.margin_left, 40.0);
        assert_eq!(config.margin_top, 30.0);
    }

    fn spread(width: f64, ratio: f64) -> (f64, f64) {
        let config = create_layout_config(LayoutConfigInput {
            width,
            height: 900.0,
            margin: MarginInput::All(40.0),
            spread: SpreadMode::Double,
            first_page_alone: true,
            spread_gap: 20.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            device_pixel_ratio: ratio,
        });
        (config.page_width, config.spread_gap)
    }

    #[test]
    fn the_pages_of_a_spread_sit_on_the_device_grid() {
        // An even width splits as asked.
        assert_eq!(spread(1200.0, 1.0), (590.0, 20.0));
        // An odd one leaves a device pixel over, and the gap takes it.
        assert_eq!(spread(1201.0, 1.0), (590.0, 21.0));
        // Half a CSS pixel is a whole device pixel at twice the density.
        assert_eq!(spread(1201.0, 2.0), (590.5, 20.0));
        for ratio in [1.25, 1.5, 1.75, 3.0] {
            for width in [1199.0, 1200.0, 1201.0, 1366.0] {
                let (page, gap) = spread(width, ratio);
                let device = page * ratio;
                assert!(
                    (device - device.round()).abs() < 1e-6,
                    "{width} at {ratio}: {device}"
                );
                assert!(
                    gap >= 20.0 && gap < 20.0 + 2.0 / ratio,
                    "{width} at {ratio}: {gap}"
                );
                assert!((2.0 * page + gap - width).abs() < 1e-9);
            }
        }
    }
}
