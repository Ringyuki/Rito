//! Construction, font registration and the host line-metric exchange:
//! the rendering host measures `line-height: normal` envelopes, grid-fit
//! ascent/descent pairs and fallback advances the font tables cannot
//! predict; the context keys, requests and caches them.

use crate::*;

impl ParleyInlineContext {
    /// Creates a context that resolves families against exactly these font
    /// blobs. Fails closed if a blob registers no usable font face.
    ///
    /// The blobs are the resolution universe: they serve every generic
    /// family and every script's fallback, in construction order. Nothing
    /// else exists — the platform font database is explicitly excluded, so
    /// a family the blobs cannot serve resolves the same way on native and
    /// wasm hosts instead of silently borrowing a platform font.
    pub fn new(font_blobs: Vec<Vec<u8>>) -> Result<Self, String> {
        use parley::fontique::{Collection, CollectionOptions, SourceCache, SourceCacheOptions};
        let mut collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        });
        let mut registered_families = Vec::new();
        let mut fallback_ids = Vec::new();
        for (index, bytes) in font_blobs.into_iter().enumerate() {
            let registered = collection.register_fonts(bytes.into(), None);
            if registered.is_empty() {
                return Err(format!("font blob {index} registered no font face"));
            }
            for (family_id, _) in registered {
                if !fallback_ids.contains(&family_id) {
                    fallback_ids.push(family_id);
                }
                if let Some(name) = collection.family_name(family_id) {
                    let name = name.to_string();
                    if !registered_families.contains(&name) {
                        registered_families.push(name);
                    }
                }
            }
        }
        install_universal_fallbacks(&mut collection, &fallback_ids);
        let fonts = FontContext {
            collection,
            source_cache: SourceCache::new(SourceCacheOptions::default()),
        };
        Ok(Self {
            fonts: RefCell::new(fonts),
            layouts: RefCell::new(LayoutContext::new()),
            registered_families,
            normal_strut_cache: RefCell::new(std::collections::HashMap::new()),
            host_line_metrics: RefCell::new(std::collections::HashMap::new()),
            host_metric_requests: RefCell::new(std::collections::BTreeSet::new()),
            host_metric_samples: RefCell::new(std::collections::HashMap::new()),
            halt_feature_cache: RefCell::new(std::collections::HashMap::new()),
            host_char_advances: RefCell::new(std::collections::HashMap::new()),
            char_coverage_cache: RefCell::new(std::collections::HashMap::new()),
            metrics_generation: std::cell::Cell::new(0),
        })
    }

    /// Injects one host-measured `line-height: normal` metric.
    pub fn set_host_line_metric(
        &self,
        family_key: &str,
        size: f64,
        sample: &str,
        metric: HostNormalLineMetric,
    ) {
        // An uncovered-character advance probe: the sentinel-tagged sample
        // carries the character, the metric carries the advance the host's
        // fallback font gives it. Routed to its own map — the line-metric
        // map is keyed per resolved FONT, advances per CHARACTER.
        if let Some(character) = sample.strip_prefix(HOST_CHAR_ADVANCE_SENTINEL) {
            if let (Some(character), Some(advance)) = (character.chars().next(), metric.advance) {
                self.host_char_advances.borrow_mut().insert(
                    (family_key.to_owned(), host_size_key(size), character),
                    advance,
                );
                self.normal_strut_cache.borrow_mut().clear();
                self.metrics_generation
                    .set(self.metrics_generation.get() + 1);
            }
            return;
        }
        self.host_line_metrics.borrow_mut().insert(
            (
                family_key.to_owned(),
                host_size_key(size),
                sample.to_owned(),
            ),
            metric,
        );
        // Struts measured by shaping before this metric arrived are now
        // stale: a layout that ran without host metrics must not survive
        // into one that has them.
        self.normal_strut_cache.borrow_mut().clear();
        self.metrics_generation
            .set(self.metrics_generation.get() + 1);
    }

    /// Bumped whenever injected metrics change, so cached fragments laid
    /// out under older metrics can be discarded.
    pub fn metrics_generation(&self) -> u64 {
        self.metrics_generation.get()
    }

    /// Drains the (family key, size, sample) keys layouts needed but the
    /// host has not measured yet. The host measures each, injects the
    /// metrics, and relayouts; a steady-state layout drains nothing.
    pub fn take_host_metric_requests(&self) -> Vec<(String, f64, String)> {
        std::mem::take(&mut *self.host_metric_requests.borrow_mut())
            .into_iter()
            .map(|(family, key, sample)| (family, key as f64 / 1000.0, sample))
            .collect()
    }

    /// Host-measured advance for a character no registered face covers,
    /// recording an advance-probe request on a miss so the host can
    /// measure it; layout proceeds on the shaped `.notdef` advance until
    /// the injection relayouts.
    pub(crate) fn host_char_advance(
        &self,
        family_key: &str,
        size: f64,
        character: char,
    ) -> Option<f64> {
        let key = (family_key.to_owned(), host_size_key(size), character);
        if let Some(advance) = self.host_char_advances.borrow().get(&key) {
            return Some(*advance);
        }
        self.host_metric_requests.borrow_mut().insert((
            key.0,
            key.1,
            format!("{HOST_CHAR_ADVANCE_SENTINEL}{character}"),
        ));
        None
    }

    /// Host normal-line metric for a style and sample, recording a
    /// measurement request on a miss so the host can fill it in. An empty
    /// sample is the inline box's own strut; a one-character sample is a
    /// text run, measured through the host's own font fallback.
    pub(crate) fn host_normal_line(
        &self,
        style: &InlineFormattingStyle,
        sample: &str,
    ) -> Option<HostNormalLineMetric> {
        self.host_normal_line_sized(style, f64::from(style.font.size.get()), sample)
    }

    /// The style's metric at an explicit size — a ruby annotation rides
    /// the base family at half size, a size no interned style carries.
    pub(crate) fn host_normal_line_sized(
        &self,
        style: &InlineFormattingStyle,
        size: f64,
        sample: &str,
    ) -> Option<HostNormalLineMetric> {
        let family = host_family_key(style);
        let key = (family, host_size_key(size), sample.to_owned());
        if let Some(metric) = self.host_line_metrics.borrow().get(&key) {
            return Some(*metric);
        }
        self.host_metric_requests.borrow_mut().insert(key);
        None
    }

    /// Reads a host metric without recording a request on a miss. Paths
    /// that merely ENRICH fragments (the decorated-box raster anchor)
    /// use this so they never perturb the measure → inject → reflow
    /// convergence the line-metric paths drive; the anchor appears once
    /// those paths have measured the style anyway.
    pub(crate) fn host_normal_line_peek(
        &self,
        style: &InlineFormattingStyle,
        sample: &str,
    ) -> Option<HostNormalLineMetric> {
        let key = (
            host_family_key(style),
            host_size_key(f64::from(style.font.size.get())),
            sample.to_owned(),
        );
        self.host_line_metrics.borrow().get(&key).copied()
    }

    /// The sample character to measure a text run's resolved font with.
    ///
    /// Runs that resolved to the same physical font share one sample: the
    /// first character seen for it. Without this the request set would
    /// grow with the book's character inventory instead of its fonts.
    pub(crate) fn run_sample(
        &self,
        style: &InlineFormattingStyle,
        font: &parley::FontData,
        first_char: char,
    ) -> String {
        let key = (
            host_family_key(style),
            host_size_key(f64::from(style.font.size.get())),
            font.data.id(),
            font.index,
            char_script(first_char),
        );
        self.host_metric_samples
            .borrow_mut()
            .entry(key)
            .or_insert_with(|| first_char.to_string())
            .clone()
    }

    /// Family names the constructor registered, in first-seen order.
    pub fn registered_families(&self) -> &[String] {
        &self.registered_families
    }

    /// Registers one font blob under an explicit family name, the way a
    /// stylesheet's `@font-face` binds a declared family to font bytes.
    /// Styles resolve the declared name regardless of the font's own
    /// internal family name.
    pub fn register_named_font(&mut self, family_name: &str, bytes: Vec<u8>) -> Result<(), String> {
        let fonts = self.fonts.get_mut();
        let registered = fonts.collection.register_fonts(
            bytes.into(),
            Some(parley::fontique::FontInfoOverride {
                family_name: Some(family_name),
                width: None,
                style: None,
                weight: None,
                axes: None,
            }),
        );
        if registered.is_empty() {
            return Err(format!(
                "font blob for family {family_name} registered no font face"
            ));
        }
        if !self
            .registered_families
            .iter()
            .any(|name| name == family_name)
        {
            self.registered_families.push(family_name.to_owned());
        }
        Ok(())
    }
}

/// Host-measured `line-height: normal` geometry for one (font, size,
/// sample).
///
/// A line box is built from these the way CSS builds one: every inline
/// box on the line contributes its own font's metrics, every text run
/// contributes the metrics of the font shaping actually resolved for it,
/// and the line takes the maximum ascent and the maximum descent.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HostNormalLineMetric {
    /// Line box height the host measures for this sample.
    pub height: f64,
    /// Baseline offset from the line box top.
    pub baseline: f64,
    /// The font's grid-fit (ascent, descent) — canvas
    /// `fontBoundingBoxAscent/Descent` — the basis the browser places
    /// FIXED line-height baselines with. It differs from the normal-line
    /// envelope whenever the font carries a line gap; `None` falls back
    /// to that envelope, which keeps un-upgraded hosts converging.
    pub grid: Option<(f64, f64)>,
    /// Advance the host measures for a one-character sample through its
    /// own font fallback. Carried for characters no registered face
    /// covers: shaping such a character lands on a face's `.notdef`
    /// advance while the host paints it with a system fallback font, and
    /// only the host can say how wide that fallback glyph is.
    pub advance: Option<f64>,
}

impl HostNormalLineMetric {
    pub(crate) fn ascent(&self) -> f64 {
        self.baseline
    }

    pub(crate) fn descent(&self) -> f64 {
        self.height - self.baseline
    }

    /// Baseline of a fixed-height line under this metric. Measured
    /// (five discriminating anchors, three fonts): the browser FLOORS
    /// the grid-fit half-leading sum; the normal-envelope fallback keeps
    /// the historical rounding, which coincides on gap-free fonts.
    pub(crate) fn fixed_baseline(&self, height: f64) -> f64 {
        match self.grid {
            Some((ascent, descent)) => (ascent + (height - (ascent + descent)) / 2.0).floor(),
            None => fixed_line_baseline(height, self.ascent(), self.descent()),
        }
    }
}

/// The character's Unicode script, as the integer a metric key uses.
///
/// Font fallback is keyed by script in every browser, so this is the axis
/// along which one run can end up drawn by two fonts.
pub(crate) fn char_script(character: char) -> u16 {
    icu_properties::CodePointMapData::<icu_properties::props::Script>::new()
        .get(character)
        .to_icu4c_value()
}

/// Quantizes a font size to a stable host-metric key (millipixels).
pub(crate) fn host_size_key(size: f64) -> u64 {
    (size * 1000.0).round() as u64
}

/// Tags a host-metric sample as an uncovered-character advance probe: the
/// sample is this sentinel plus the character, and the host answers with
/// the advance its own font fallback gives that character.
pub(crate) const HOST_CHAR_ADVANCE_SENTINEL: &str = "\u{e00e}";

/// Serializes a computed family list into the key the host measures with.
pub(crate) fn host_family_key(style: &InlineFormattingStyle) -> String {
    style
        .font
        .families
        .as_slice()
        .iter()
        .map(|family| match family {
            rito_style_contract::FontFamily::Named(name) => name.as_str(),
            rito_style_contract::FontFamily::Generic(generic) => match generic {
                rito_style_contract::GenericFontFamily::Serif => "serif",
                rito_style_contract::GenericFontFamily::SansSerif => "sans-serif",
                rito_style_contract::GenericFontFamily::Monospace => "monospace",
                rito_style_contract::GenericFontFamily::Cursive => "cursive",
                rito_style_contract::GenericFontFamily::Fantasy => "fantasy",
                rito_style_contract::GenericFontFamily::SystemUi => "system-ui",
            },
        })
        .collect::<Vec<_>>()
        .join(",")
}
