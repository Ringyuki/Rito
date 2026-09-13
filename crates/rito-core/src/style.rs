pub const NAME: &str = "style";
pub const OWNS: &str = "Stylesheet selection, the Stylo cascade, and the typed style projection";

mod backend;
mod paint_values;
mod stylo_sources;

#[cfg(test)]
pub(crate) use backend::style_backend_metrics;
#[cfg(test)]
pub(crate) use backend::StyleBackendError;
pub(crate) use backend::{resolve_prepared_chapter_style, PreparedStyleChapterInput};
pub(crate) use paint_values::{
    background_position_axis, background_publication_href, background_repeat, background_size,
    paint_color, serialize_font_families,
};

/// The CSS viewport a chapter cascades against: one page's content box, in
/// CSS pixels, at the device pixel ratio and colour scheme the media queries
/// see.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CssViewport {
    pub width: f64,
    pub height: f64,
    pub device_pixel_ratio: f64,
    pub color_scheme: CssColorScheme,
}

impl CssViewport {
    pub(crate) fn new(width: f64, height: f64) -> Self {
        Self {
            width,
            height,
            device_pixel_ratio: 1.0,
            color_scheme: CssColorScheme::Light,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CssColorScheme {
    Light,
    #[expect(dead_code, reason = "production viewport construction is light-only")]
    Dark,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ChapterStyleOptions<'a> {
    pub root_font_size: f64,
    pub line_height_override: Option<f64>,
    pub line_height_force: bool,
    pub font_family_override: Option<&'a str>,
    pub font_family_force: bool,
}
