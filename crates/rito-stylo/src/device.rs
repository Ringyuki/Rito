use style::{
    device::{servo::FontMetricsProvider, Device},
    font_metrics::FontMetrics,
    media_queries::MediaType,
    properties::{style_structs::Font, ComputedValues},
    queries::values::PrefersColorScheme,
    selector_parser::RestyleDamage,
    servo::media_features::PointerCapabilities,
    values::computed::{font::GenericFontFamily, CSSPixelLength, Length},
    values::specified::font::{KeywordInfo, QueryFontMetricsFlags},
};

use crate::session::{ColorScheme, Viewport};

#[derive(Debug)]
struct RitoFontMetricsProvider {
    default_font_size: f32,
}

impl FontMetricsProvider for RitoFontMetricsProvider {
    fn query_font_metrics(
        &self,
        _vertical: bool,
        _font: &Font,
        base_size: CSSPixelLength,
        _flags: QueryFontMetricsFlags,
    ) -> FontMetrics {
        FontMetrics {
            ascent: base_size * 0.8,
            ..FontMetrics::default()
        }
    }

    fn base_size_for_generic(&self, _generic: GenericFontFamily) -> Length {
        Length::new(self.default_font_size)
    }
}

pub(crate) fn make_device(viewport: Viewport, default_font_size: f32) -> Device {
    let viewport_size = euclid::Size2D::new(viewport.width, viewport.height);
    let device_size = euclid::Size2D::new(
        viewport.width * viewport.device_pixel_ratio,
        viewport.height * viewport.device_pixel_ratio,
    );
    let mut default_font = Font::initial_values();
    let mut font_size = default_font.clone_font_size();
    font_size.computed_size.0 = Length::new(default_font_size);
    font_size.used_size.0 = Length::new(default_font_size);
    font_size.keyword_info = KeywordInfo::none();
    default_font.set_font_size(font_size);
    let device = Device::new(
        MediaType::screen(),
        selectors::matching::QuirksMode::NoQuirks,
        viewport_size,
        device_size,
        euclid::Scale::new(viewport.device_pixel_ratio),
        Box::new(RitoFontMetricsProvider { default_font_size }),
        ComputedValues::initial_values_with_font_override(default_font),
        match viewport.color_scheme {
            ColorScheme::Light => PrefersColorScheme::Light,
            ColorScheme::Dark => PrefersColorScheme::Dark,
        },
        PointerCapabilities::default(),
        PointerCapabilities::default(),
    );
    // `Device::new` seeds the rem basis with Stylo's fixed 16px medium.
    // Rito's reader-configured initial root size must be visible while the
    // root itself is cascaded, before Stylo replaces this with the computed
    // root style for descendant rem units.
    device.set_root_font_size(default_font_size);
    device
}

pub(crate) fn full_restyle_damage() -> RestyleDamage {
    RestyleDamage::reconstruct()
}
