//! Parley-backed inline formatting context.
//!
//! Implements the `rito-fragment` provider contract for inline flows: one
//! paragraph of typed-styled text items in, line and text fragments out.
//! Fonts are explicit — the context lays out with exactly the font bytes it
//! was constructed with, never a platform font database — which is what
//! makes its output reproducible across platforms and comparable against
//! the pinned-browser oracle. Parley supplies shaping and line breaking;
//! everything it cannot express (fragmentation, resumed layout, non-text
//! inline items) fails closed instead of degrading.

use std::borrow::Cow;
use std::cell::RefCell;

use parley::{
    FontContext, InlineBox, InlineBoxKind, LayoutContext, PositionedLayoutItem, RangedBuilder,
    StyleProperty,
};
use rito_fragment::{
    BoxFragment, CancelFlag, ConstraintSpace, FormattingContext, FormattingNodeContent,
    FormattingNodeId, FormattingTree, Fragment, FragmentRect, FragmentTree, InlineItem,
    IntrinsicInlineSizes, LayoutError, LayoutOutcome, LineFragment, TextFragment,
};
use rito_style_contract::{
    FontFamily, FontSlant, GenericFontFamily, InlineFormattingStyleV1, LayoutFormattingStyleV1,
    LengthPercentage, LineHeight, MaximumSizeV1, PreferredSizeV1, TextAlign,
};

/// One paragraph's built Parley layout plus the metadata the fragment
/// assembly needs.
struct ParagraphLayout {
    layout: parley::Layout<[u8; 4]>,
    text: String,
    alignment: parley::Alignment,
    /// Byte ranges of the flow text whose runs carry a baseline shift
    /// (positive raises), in content order.
    shifted_ranges: Vec<(std::ops::Range<usize>, f64)>,
    /// The `text-indent` margin Parley reserves on the first line, which
    /// narrows that line's available advance for fit decisions.
    first_line_indent: f32,
    /// Every applied punctuation pair trim as (left char byte, right char
    /// byte): the trim is only valid while both sit on one line, so the
    /// layout loop suppresses any pair a line break separates and re-lays.
    pair_trims: Vec<(usize, usize)>,
    /// Byte ranges shaped with the opener-side `halt` trim and the half
    /// width each removed — the painter draws the untrimmed glyph shifted
    /// left by that amount so its ink lands where the halt variant sits.
    opener_halt_trims: Vec<(std::ops::Range<usize>, f64)>,
    /// Per item index: advance the item's LAST cluster gained from inline
    /// box gaps (its own trailing padding/border, plus the leading
    /// padding/border of a box opening right after it). Emitted fragment
    /// widths shed it so the run rect stays the ink advance the painter
    /// grows the inline box from.
    item_box_sheds: std::collections::HashMap<usize, f64>,
    /// Per forced-break line start (flow-text byte): the box lead
    /// (margin, padding, border) of a span opening that line. A lead
    /// riding the previous character's letter spacing would widen the
    /// PREVIOUS line across a `<br/>`; Blink indents the span's own line
    /// (u3000/inline-margin oracle: margin box at x=30, padding glyph at
    /// +30, both on the span's line), so the line loop shifts the whole
    /// line instead.
    forced_line_indents: std::collections::HashMap<usize, f64>,
    /// Per item index: the `ruby-align: space-around` interior gap a
    /// wide annotation opens between its base's clusters. The gap is
    /// already injected as letter spacing on every base cluster but the
    /// last, so line breaking sees the spread advance; the emitted
    /// fragment re-applies it as justify spacing so the painter spreads
    /// identically, and the annotation paints over the grown extent
    /// plus one half-gap of overhang on each side.
    ruby_spreads: std::collections::HashMap<usize, f64>,
    /// Per spread item: the LEFT overhang (edge share capped at half the
    /// annotation size, zero against a blocked side) — the annotation
    /// rect grows by it while `ruby_spreads` carries the interior gap.
    ruby_spread_overhangs: std::collections::HashMap<usize, f64>,
    /// Per spread item: the RIGHT overhang (same law as the left; the
    /// two differ when only one side may overhang).
    ruby_spread_overhangs_right: std::collections::HashMap<usize, f64>,
    /// Per annotated item index: the shaped advance of its annotation.
    /// A base segment SPLIT onto its own line carries the whole
    /// annotation and widens to at least this advance, which is what the
    /// split-fit rewind checks.
    ruby_annotation_widths: std::collections::HashMap<usize, f64>,
    /// Per annotated item index: the overhang cap (half the annotation
    /// size), shared by the split-fit box computation.
    ruby_annotation_caps: std::collections::HashMap<usize, f64>,
    /// Per item: the paint-side right shift centering a packed base
    /// under its wide `ruby-align: center` annotation.
    ruby_center_shifts: std::collections::HashMap<usize, f64>,
    /// Laid-out inline-block atoms by item index: the mini paragraph's
    /// baseline (its LAST line's, from the box top) and its fragment,
    /// emitted at the inline box's position during line assembly.
    inline_block_boxes: std::collections::HashMap<u64, (f64, rito_fragment::BoxFragment)>,
    /// The same atoms' baselines by hidden-node id, surviving the
    /// per-line emission so the line envelope can read them after the
    /// fragment moved into the line.
    inline_block_baselines: std::collections::HashMap<u32, f64>,
    /// Per image atom id: the (left, right) edge insets from the image
    /// element's own border, absorbed as padding by the bridge. The atom's
    /// advance spans them; the raster paints inside (measured on the b60
    /// cover's 1px flank borders — dropping them shifted the whole plate
    /// one pixel against Blink).
    image_edge_insets: std::collections::HashMap<u64, (f64, f64)>,
}

/// Inline formatting context backed by Parley shaping and line breaking.
///
/// Holds its font and layout scratch state behind `RefCell`: layout is a
/// pure function of its inputs, but Parley's contexts require mutable
/// access, so one `ParleyInlineContext` must not be re-entered from within
/// its own call stack.
pub struct ParleyInlineContext {
    fonts: RefCell<FontContext>,
    layouts: RefCell<LayoutContext<[u8; 4]>>,
    registered_families: Vec<String>,
    /// `line-height: normal` strut heights per inline style, measured by
    /// shaping with the style's own resolved font (what a browser's strut
    /// does), cached because struts repeat per paragraph.
    normal_strut_cache: RefCell<std::collections::HashMap<u32, f64>>,
    /// Host-measured `line-height: normal` metrics per (family key, size,
    /// sample): the rendering host measures them because its font scaler
    /// grid-fits ascent and descent to integers per size, which font
    /// tables do not predict. The sample is what the host puts on the
    /// measured line — empty for an inline box's own strut, or one
    /// character for a text run, so the host resolves the same fallback
    /// font for it that shaping did. Keyed by [`host_size_key`].
    host_line_metrics:
        RefCell<std::collections::HashMap<(String, u64, String), HostNormalLineMetric>>,
    /// Keys a layout needed but the host has not measured yet; the host
    /// drains these, measures, injects, and relayouts.
    host_metric_requests: RefCell<std::collections::BTreeSet<(String, u64, String)>>,
    /// Sample character already requested for a (family, size, resolved
    /// font, script) key. Every character that resolves to the same font
    /// measures the same, so one sample per font is enough to bound the
    /// request set by fonts rather than by the book's character inventory
    /// — but the script has to be part of the key too: the engine's font
    /// universe is the book's, so it may serve two scripts from one font
    /// where the host picks a different fallback per script, and a single
    /// sample would then hide one of the host's two metrics.
    host_metric_samples: RefCell<std::collections::HashMap<(String, u64, u64, u32, u16), String>>,
    /// Per-face `halt` feature presence, keyed by (blob id, face index) —
    /// the Han-kerning trim gate consults it for every trimmed character.
    halt_feature_cache: RefCell<std::collections::HashMap<(u64, u32), bool>>,
    /// Host-measured advances for characters no registered face covers,
    /// keyed by (family key, size key, character). Shaping resolves such
    /// a character to a face's `.notdef` while the host paints it with a
    /// system fallback font; the host's canvas advance is the only source
    /// for the width that glyph actually occupies.
    host_char_advances: RefCell<std::collections::HashMap<(String, u64, char), f64>>,
    /// Whether any face of (family key, character)'s stack covers the
    /// character — the gate for the host-advance path, cached because the
    /// stack walk touches every face's charmap.
    char_coverage_cache: RefCell<std::collections::HashMap<(String, char), bool>>,
    metrics_generation: std::cell::Cell<u64>,
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
    fn ascent(&self) -> f64 {
        self.baseline
    }

    fn descent(&self) -> f64 {
        self.height - self.baseline
    }

    /// Baseline of a fixed-height line under this metric. Measured
    /// (five discriminating anchors, three fonts): the browser FLOORS
    /// the grid-fit half-leading sum; the normal-envelope fallback keeps
    /// the historical rounding, which coincides on gap-free fonts.
    fn fixed_baseline(&self, height: f64) -> f64 {
        match self.grid {
            Some((ascent, descent)) => (ascent + (height - (ascent + descent)) / 2.0).floor(),
            None => fixed_line_baseline(height, self.ascent(), self.descent()),
        }
    }
}

/// Quantizes a CSS length the way Blink's LayoutUnit stores it (1/64 px,
/// nearest). A declared `line-height: 1.2em` at 16px is 19.2 in CSS
/// arithmetic but 19.203125 in every Blink layout position; without this
/// the engine's block stacking drifts a fraction per line against the
/// browser.
fn layout_unit(value: f64) -> f64 {
    (value * 64.0).round() / 64.0
}

/// The used line-box height of a declared line-height, on Blink's grid.
/// The quantization is TYPE-sensitive (measured, pinned Latin and CJK
/// faces agree on every case — font metrics never enter): a NUMBER
/// multiplies the font size and FLOORS to 1/64 (1.35 × 12.16 = 16.416
/// lays 16.40625; 1.2 × 16 = 19.2 lays 19.1875), while a LENGTH — px,
/// em, %, all resolved to px at computed-value time — ROUNDS half-up
/// (line-height: 19.2px lays 19.203125; 1.35em over 12.16px, the same
/// 16.416, lays 16.421875; 15.8046875px lays 15.8125). The engine's old
/// uniform round put the b20 note strut two 64ths tall and shifted every
/// later paragraph in the column by 1/32.
fn used_declared_line_height(line_height: LineHeight, font_size: f64) -> Option<f64> {
    match line_height {
        // The number multiplies the font size AFTER it snaps to the
        // LayoutUnit grid by rounding; the product then floors. Measured
        // in Chromium across 14 font sizes (five content shapes each,
        // content-independent): every on-grid size matches a plain
        // floored product, while off-grid sizes discriminate in both
        // directions — 24.32×1.35 lays 32.8125 = floor64(1.35 ×
        // round64(24.32)=24.3125), one 64th SHORTER than the floored raw
        // product, and 30.4×1.35 lays 41.046875, one 64th TALLER (13.3,
        // 17.1, 19.55 likewise). A real book's 1.6em divider paragraphs
        // under 0.95em body sizing sat one 64th tall per divider and
        // pushed a mid-page line across a device-row boundary.
        LineHeight::Number(number) => {
            let grid_font_size = (font_size * 64.0).round() / 64.0;
            Some((f64::from(number.get()) * grid_font_size * 64.0).floor() / 64.0)
        }
        LineHeight::Length(px) => Some(layout_unit(f64::from(px.get()))),
        LineHeight::Normal => None,
    }
}

/// The half-leaded baseline offset inside a fixed-height line box, the way
/// Blink places it: the strut font's integer ascent plus half the leading,
/// rounded to a whole pixel (measured: Tinos 14/4 under 19.2px lands the
/// baseline at 15 — round(14.6) — and SourceHan 18/5 at 16 — round(16.1)).
fn fixed_line_baseline(height: f64, ascent: f64, descent: f64) -> f64 {
    (ascent + (height - (ascent + descent)) / 2.0).round()
}

/// The raster anchor a decorated inline box hands its runs, or `None`
/// for an undecorated span (bare text snaps off the line box). The
/// browser's paint re-anchors at the decorated box: its absolute top
/// rounds to a device row, the top edge (border + LayoutUnit-quantized
/// padding) rounds within it, and the baseline sits the primary font's
/// integer ascent below — measured on 22px/24px bordered spans sharing a
/// 309.5625 layout baseline that raster one row apart (309 and 310).
/// Without a host grid metric the anchor is withheld; the measure →
/// inject → reflow loop converges it the same way line metrics do.
fn item_box_snap(
    resolved: &InlineFormattingStyleV1,
    metric: Option<HostNormalLineMetric>,
) -> Option<rito_fragment::BoxSnap> {
    use rito_style_contract::BorderStyle;
    let side_px = |value: &rito_style_contract::NonNegativeLengthPercentage| match value.value() {
        LengthPercentage::Length(px) => f64::from(px.get()),
        _ => 0.0,
    };
    let edge_px = |edge: &rito_style_contract::BorderEdge| {
        if matches!(edge.style, BorderStyle::None | BorderStyle::Hidden) {
            0.0
        } else {
            f64::from(edge.resolved_width.get())
        }
    };
    let padding = &resolved.fragment.padding;
    let border = &resolved.fragment.border;
    let decorated = [
        side_px(&padding.top),
        side_px(&padding.right),
        side_px(&padding.bottom),
        side_px(&padding.left),
        edge_px(&border.top),
        edge_px(&border.right),
        edge_px(&border.bottom),
        edge_px(&border.left),
    ]
    .iter()
    .any(|px| *px > 0.0);
    if !decorated {
        return None;
    }
    let (int_ascent, int_descent) = metric?.grid?;
    Some(rito_fragment::BoxSnap {
        int_ascent,
        int_descent,
        edge_top: edge_px(&border.top) + layout_unit(side_px(&padding.top)),
        edge_bottom: edge_px(&border.bottom) + layout_unit(side_px(&padding.bottom)),
    })
}

/// The character's Unicode script, as the integer a metric key uses.
///
/// Font fallback is keyed by script in every browser, so this is the axis
/// along which one run can end up drawn by two fonts.
fn char_script(character: char) -> u16 {
    icu_properties::CodePointMapData::<icu_properties::props::Script>::new()
        .get(character)
        .to_icu4c_value()
}

/// Quantizes a font size to a stable host-metric key (millipixels).
fn host_size_key(size: f64) -> u64 {
    (size * 1000.0).round() as u64
}

/// Tags a host-metric sample as an uncovered-character advance probe: the
/// sample is this sentinel plus the character, and the host answers with
/// the advance its own font fallback gives that character.
const HOST_CHAR_ADVANCE_SENTINEL: &str = "\u{e00e}";

/// Serializes a computed family list into the key the host measures with.
fn host_family_key(style: &InlineFormattingStyleV1) -> String {
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
            if let (Some(character), Some(advance)) =
                (character.chars().next(), metric.advance)
            {
                self.host_char_advances.borrow_mut().insert(
                    (family_key.to_owned(), host_size_key(size), character),
                    advance,
                );
                self.normal_strut_cache.borrow_mut().clear();
                self.metrics_generation.set(self.metrics_generation.get() + 1);
            }
            return;
        }
        self.host_line_metrics.borrow_mut().insert(
            (family_key.to_owned(), host_size_key(size), sample.to_owned()),
            metric,
        );
        // Struts measured by shaping before this metric arrived are now
        // stale: a layout that ran without host metrics must not survive
        // into one that has them.
        self.normal_strut_cache.borrow_mut().clear();
        self.metrics_generation.set(self.metrics_generation.get() + 1);
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
    fn host_char_advance(&self, family_key: &str, size: f64, character: char) -> Option<f64> {
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
    fn host_normal_line(
        &self,
        style: &InlineFormattingStyleV1,
        sample: &str,
    ) -> Option<HostNormalLineMetric> {
        self.host_normal_line_sized(style, f64::from(style.font.size.get()), sample)
    }

    /// The style's metric at an explicit size — a ruby annotation rides
    /// the base family at half size, a size no interned style carries.
    fn host_normal_line_sized(
        &self,
        style: &InlineFormattingStyleV1,
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
    fn host_normal_line_peek(
        &self,
        style: &InlineFormattingStyleV1,
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
    fn run_sample(
        &self,
        style: &InlineFormattingStyleV1,
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

    /// The paragraph's CSS strut height. Declared line-heights resolve
    /// directly; `normal` is measured through the shaping engine with the
    /// strut style's own resolved font — the same metrics a browser strut
    /// uses — and cached per style.
    fn resolved_strut_height(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
    ) -> Result<Option<f64>, LayoutError> {
        let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
            return Ok(None);
        };
        let Some(styles) = tree.styles() else {
            return Ok(None);
        };
        let style_id = match tree.strut_style(node) {
            Some(style) => style,
            None => match items.first() {
                Some(InlineItem::Text { style, .. })
                | Some(InlineItem::Image { style, .. })
                | Some(InlineItem::InlineBlock { style, .. }) => *style,
                None => return Ok(None),
            },
        };
        let style = styles
            .inline
            .style(style_id)
            .map_err(|error| LayoutError::Invalid(error.to_string()))?;
        Ok(Some(match style.font.line_height {
            LineHeight::Number(_) | LineHeight::Length(_) => used_declared_line_height(
                style.font.line_height,
                f64::from(style.font.size.get()),
            )
            .unwrap_or(0.0),
            LineHeight::Normal => {
                // The host's measured strut is authoritative; the shaped
                // fallback only covers hosts that never inject metrics.
                if let Some(host) = self.host_normal_line(style, "") {
                    return Ok(Some(host.height));
                }
                if let Some(cached) = self.normal_strut_cache.borrow().get(&style_id.raw()) {
                    return Ok(Some(*cached));
                }
                let measured = self.measure_normal_line_height(style)?;
                self.normal_strut_cache
                    .borrow_mut()
                    .insert(style_id.raw(), measured);
                measured
            }
        }))
    }

    /// Shapes a single space with the style to read the font's `normal`
    /// line height from the engine itself.
    fn measure_normal_line_height(
        &self,
        style: &InlineFormattingStyleV1,
    ) -> Result<f64, LayoutError> {
        let mut fonts = self.fonts.borrow_mut();
        let mut layouts = self.layouts.borrow_mut();
        let text = " ";
        let mut builder = layouts.ranged_builder(&mut fonts, text, 1.0, true);
        push_item_styles(&mut builder, style, 0..text.len());
        let mut layout = builder.build(text);
        layout.break_all_lines(None);
        let height = layout
            .lines()
            .next()
            .map(|line| f64::from(line.metrics().line_height))
            .unwrap_or_else(|| 1.2 * f64::from(style.font.size.get()));
        Ok(height)
    }

    /// Shaped advance of `text` under `style`, optionally at an
    /// overridden font size, from a one-line throwaway layout. Ruby
    /// spread sizing measures the annotation (at the rt cascade size,
    /// inheriting everything else) and the base against each other.
    fn measure_styled_advance(
        &self,
        style: &InlineFormattingStyleV1,
        size_override: Option<f32>,
        text: &str,
    ) -> f64 {
        if text.is_empty() {
            return 0.0;
        }
        let mut sized;
        let style = match size_override
            .and_then(|size| rito_style_contract::NonNegativeCssPx::new(size).ok())
        {
            Some(size) => {
                sized = style.clone();
                sized.font.size = size;
                &sized
            }
            None => style,
        };
        let mut fonts = self.fonts.borrow_mut();
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = layouts.ranged_builder(&mut fonts, text, 1.0, true);
        push_item_styles(&mut builder, style, 0..text.len());
        let mut layout = builder.build(text);
        layout.break_all_lines(None);
        let advance = layout
            .lines()
            .next()
            .map_or(0.0, |line| f64::from(line.metrics().advance));
        advance
    }

    fn build_layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        available_inline_size: Option<f64>,
        available_block_size: Option<f64>,
        containing_block_size: Option<f64>,
        percentage_images: PercentageImageSizing,
        end_trims: &[usize],
        suppressed_pair_trims: &[usize],
        cancel: &CancelFlag,
    ) -> Result<ParagraphLayout, LayoutError> {
        let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
            return Err(LayoutError::Invalid(format!(
                "parley inline context requires an inline flow, got {:?}",
                tree.node(node).content
            )));
        };
        let styles = tree.styles().ok_or_else(|| {
            LayoutError::Invalid("inline flow tree carries no style tables".to_owned())
        })?;
        if cancel.is_cancelled() {
            return Err(LayoutError::Cancelled);
        }

        let mut text = String::new();
        let mut runs = Vec::with_capacity(items.len());
        let mut shifted_ranges: Vec<(std::ops::Range<usize>, f64)> = Vec::new();
        let mut image_boxes = Vec::new();
        // Laid-out inline-block atoms by item index: the mini paragraph's
        // baseline (its LAST line's, from the box top) and its fragment,
        // emitted at the inline box's position during line assembly.
        let mut inline_block_boxes: std::collections::HashMap<
            u64,
            (f64, rito_fragment::BoxFragment),
        > = std::collections::HashMap::new();
        // The same atoms' baselines by hidden-node id, surviving the
        // per-line emission so the line envelope can read them after the
        // fragment moved into the line.
        let mut inline_block_baselines: std::collections::HashMap<u32, f64> =
            std::collections::HashMap::new();
        let mut image_edge_insets: std::collections::HashMap<u64, (f64, f64)> =
            std::collections::HashMap::new();
        // Blink consults its pair-preference table only under
        // `word-break: normal`; `break-all`/`keep-all` change the break
        // opportunities the table would otherwise veto.
        let mut chromium_tailoring = true;
        let mut break_all = false;
        let mut strict_kinsoku = false;
        let mut break_anywhere = false;
        for (item_index, item) in items.iter().enumerate() {
            match item {
                InlineItem::Text {
                    text: item_text,
                    style,
                    baseline_shift_px,
                    ..
                } => {
                    let start = text.len();
                    text.push_str(item_text);
                    if *baseline_shift_px != 0.0 {
                        shifted_ranges.push((start..text.len(), *baseline_shift_px));
                    }
                    let style = styles
                        .inline
                        .style(*style)
                        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
                    if style.text_flow.word_break != rito_style_contract::WordBreak::Normal {
                        chromium_tailoring = false;
                    }
                    if style.text_flow.word_break == rito_style_contract::WordBreak::BreakAll {
                        break_all = true;
                    }
                    if style.text_flow.line_break == rito_style_contract::LineBreak::Strict {
                        strict_kinsoku = true;
                    }
                    if style.text_flow.line_break == rito_style_contract::LineBreak::Anywhere {
                        break_anywhere = true;
                    }
                    runs.push((start..text.len(), style, item_index));
                }
                InlineItem::Image {
                    intrinsic_width,
                    intrinsic_height,
                    layout_style,
                    viewport,
                    ..
                } => {
                    let layout_style = styles
                        .layout
                        .style(*layout_style)
                        .map_err(|error| LayoutError::Invalid(error.to_string()))?;
                    let (width, height) = image_display_size(
                        *intrinsic_width,
                        *intrinsic_height,
                        layout_style,
                        available_inline_size,
                        available_block_size,
                        containing_block_size,
                        percentage_images,
                        *viewport,
                    )?;
                    // A vertical-rl flow's replaced atom advances by its
                    // PHYSICAL height along the (vertical) inline axis
                    // and takes a column as wide as its physical width
                    // (measured on a 318x2048 chapter plate: the column
                    // is 318 wide, the image runs the page's length and
                    // clips); the swapped box maps back to the physical
                    // raster in the vertical paint walk.
                    let (width, height) = if tree
                        .strut_style(node)
                        .and_then(|id| styles.inline.style(id).ok())
                        .is_some_and(|strut| {
                            strut.bidi.writing_mode
                                == rito_style_contract::WritingMode::VerticalRightToLeft
                        }) {
                        (height, width)
                    } else {
                        (width, height)
                    };
                    // The image element's own flank borders (absorbed as
                    // padding by the bridge) widen the atom's advance; the
                    // raster paints inside them (measured on the b60
                    // cover's `border: none solid` — dropping the 1px
                    // flanks shifted the whole plate against Blink).
                    let edge = |side: rito_style_contract::NonNegativeLengthPercentage| {
                        match side.value() {
                            LengthPercentage::Length(px) => f64::from(px.get()).max(0.0),
                            _ => 0.0,
                        }
                    };
                    let inset_left = edge(layout_style.padding.left);
                    let inset_right = edge(layout_style.padding.right);
                    if inset_left > 0.0 || inset_right > 0.0 {
                        image_edge_insets
                            .insert(item_index as u64, (inset_left, inset_right));
                    }
                    image_boxes.push(InlineBox {
                        id: item_index as u64,
                        kind: InlineBoxKind::InFlow,
                        index: text.len(),
                        width: width + (inset_left + inset_right) as f32,
                        height,
                    });
                }
                InlineItem::InlineBlock { node, .. } => {
                    // The atomic inline is its own mini paragraph, laid
                    // out recursively through the full pipeline at CSS
                    // 2.1 §10.3.5 shrink-to-fit width against the host.
                    let sizes = self.intrinsic_inline_sizes(tree, *node)?;
                    let available = available_inline_size.unwrap_or(sizes.max_content);
                    let width = sizes.max_content.min(sizes.min_content.max(available));
                    let outcome = FormattingContext::layout(
                        self,
                        tree,
                        *node,
                        &ConstraintSpace::continuous(width),
                        None,
                        cancel,
                    )?;
                    let rito_fragment::Fragment::Box(root_box) = outcome.fragments.root else {
                        return Err(LayoutError::Invalid(
                            "inline-block layout must produce a box fragment".to_owned(),
                        ));
                    };
                    // The atom's baseline is its LAST line's baseline
                    // (CSS §10.8.1); a line-less box uses its bottom.
                    let baseline = root_box
                        .children
                        .iter()
                        .rev()
                        .find_map(|child| match child {
                            rito_fragment::Fragment::Line(line) => {
                                Some(line.rect.y + line.baseline)
                            }
                            _ => None,
                        })
                        .unwrap_or(root_box.rect.height);
                    image_boxes.push(InlineBox {
                        id: item_index as u64,
                        kind: InlineBoxKind::InFlow,
                        index: text.len(),
                        width: root_box.rect.width as f32,
                        height: root_box.rect.height as f32,
                    });
                    inline_block_baselines.insert(node.0, baseline);
                    inline_block_boxes.insert(item_index as u64, (baseline, root_box));
                }
            }
        }

        // `ruby-align: space-around` (the UA initial value): an annotation
        // wider than its base spreads the base. Measured Blink law: the
        // excess E = annotation advance − base advance splits into n equal
        // shares (n = base cluster count); half a share overhangs the
        // adjacent text on each side, capped at half the annotation font
        // size, and a full share opens between each pair of base clusters.
        // The interior gaps ride per-range letter spacing on all but the
        // last base cluster so line breaking sees the spread advance; the
        // emitted fragment re-applies them as justify spacing and the
        // annotation paints over the grown extent plus the overhangs.
        // Measured here, before the builder takes the font borrow. A
        // justified paragraph spreads identically (measured: a justified
        // wide-annotation ruby is bit-identical to the left-aligned one)
        // — justification then adds NO opportunities inside the spread
        // base (see `line_justify_plan`), only at its outer boundaries.
        let mut ruby_spreads: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        // Per item: the overhang each side of the spread box (edge share,
        // capped at half the annotation size).
        let mut ruby_spread_overhangs: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        let mut ruby_spread_overhangs_right: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        // Every annotated item's shaped annotation advance, for the
        // split-fit rule: a base segment split onto its own line carries
        // the WHOLE annotation and widens to at least its advance.
        let mut ruby_annotation_widths: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        // Per annotated item: half the annotation font size — the
        // overhang cap the split-fit box shares with the spread law.
        let mut ruby_annotation_caps: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        let mut ruby_spread_edits: Vec<(std::ops::Range<usize>, f32)> = Vec::new();
        // Per item: the paint-side right shift centering a packed base
        // under its wide `ruby-align: center` annotation.
        let mut ruby_center_shifts: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        for (range, style, item_index) in &runs {
            let Some(InlineItem::Text {
                ruby_annotation: Some(annotation),
                ..
            }) = items.get(*item_index)
            else {
                continue;
            };
            if annotation.text.is_empty() || range.is_empty() {
                continue;
            }
            let base_text = &text[range.clone()];
            let cluster_count = base_text.chars().count();
            if cluster_count == 0 {
                continue;
            }
            let annotation_size = style.font.size.get() * annotation.size_ratio;
            let annotation_advance =
                self.measure_styled_advance(style, Some(annotation_size), &annotation.text);
            let base_advance = self.measure_styled_advance(style, None, base_text);
            ruby_annotation_widths.insert(*item_index, annotation_advance);
            ruby_annotation_caps.insert(*item_index, f64::from(annotation_size) / 2.0);
            let excess = annotation_advance - base_advance;
            if excess <= 0.01 {
                continue;
            }
            let is_ruby_item = |index: Option<usize>| {
                index
                    .and_then(|index| items.get(index))
                    .is_some_and(|item| {
                        matches!(item, InlineItem::Text { ruby_annotation: Some(_), .. })
                    })
            };
            let neighbor_item = |byte: Option<usize>| {
                byte.and_then(|byte| {
                    runs.iter()
                        .find(|(other, _, _)| other.contains(&byte))
                        .map(|(_, _, other_index)| *other_index)
                })
            };
            let prev_byte = text[..range.start].char_indices().next_back().map(|(i, _)| i);
            let next_byte = (range.end < text.len()).then_some(range.end);
            if style.text_flow.ruby_align == rito_style_contract::RubyAlign::Center {
                // `ruby-align: center` under a WIDE annotation (measured
                // matrix, FZWBKS 16px/rt 0.55-0.7-0.4, re-fit 2026-08-20
                // with justified wrapped lines): the rb box stretches to
                // the annotation width with the base glyphs packed
                // CENTERED inside — also on justified lines, where the
                // column keeps this fixed width and the justify shares
                // land on the adjacent characters. The annotation
                // OVERHANGS an adjacent text neighbor per side by
                // min(floor(annoSize/2), excess/2n) truncated onto the
                // 1/64 grid (n = base cluster count; the old excess/4
                // was this formula's n = 2 special case misread as a
                // constant) — zero against a flow edge or an adjacent
                // ruby — and the flow column narrows to anno − ovL −
                // ovR. The remainder rides a trailing carrier; the
                // painter shifts the packed base right by excess/2 −
                // ovL, centering it in the stretched rb box.
                let cap = f64::from(annotation_size / 2.0).floor();
                let edge_share = excess / (2.0 * cluster_count as f64);
                let side = |byte: Option<usize>| {
                    if byte.is_none() || is_ruby_item(neighbor_item(byte)) {
                        0.0
                    } else {
                        (cap.min(edge_share) * 64.0).trunc() / 64.0
                    }
                };
                let overhang_left = side(prev_byte);
                let overhang_right = side(next_byte);
                let delta = (excess - overhang_left - overhang_right).max(0.0);
                if delta > 0.0 {
                    let author = match style.text_flow.letter_spacing {
                        LengthPercentage::Length(px) => px.get(),
                        _ => 0.0,
                    };
                    let last_cluster_start = base_text
                        .char_indices()
                        .next_back()
                        .map_or(range.start, |(offset, _)| range.start + offset);
                    ruby_spread_edits
                        .push((last_cluster_start..range.end, author + delta as f32));
                }
                ruby_spreads.insert(*item_index, 0.0);
                ruby_spread_overhangs.insert(*item_index, overhang_left);
                ruby_spread_overhangs_right.insert(*item_index, overhang_right);
                ruby_center_shifts.insert(*item_index, excess / 2.0 - overhang_left);
                continue;
            }
            // `ruby-align: space-around` per-side accounting (measured on
            // pinned Chromium, pinned faces: 「小(tsuku)月(chan)」 pairs):
            // the excess splits into n shares, half a share per edge and
            // one share per interior gap. An edge OVERHANGS its neighbor
            // (capped at half the annotation size; the cap remainder
            // folds into the interior gaps — b42's long-annotation law)
            // only when that neighbor is overhang-eligible; against an
            // adjacent ruby or the flow edge the half share is ABSORBED
            // into the column instead — the base shifts right by the
            // left absorption and the flow advance grows by both (a
            // lone wide ruby between text keeps column = base width;
            // an adjacent pair widens each column by its inner half).
            let edge_share = excess / (2.0 * cluster_count as f64);
            let cap = f64::from(annotation_size) / 2.0;
            let eligible = |byte: Option<usize>| {
                byte.is_some() && !is_ruby_item(neighbor_item(byte))
            };
            let (mut overhang_left, mut fold_left, mut absorbed_left) = (0.0, 0.0, edge_share);
            if eligible(prev_byte) {
                overhang_left = edge_share.min(cap);
                fold_left = edge_share - overhang_left;
                absorbed_left = 0.0;
            }
            let (mut overhang_right, mut fold_right, mut absorbed_right) =
                (0.0, 0.0, edge_share);
            if eligible(next_byte) {
                overhang_right = edge_share.min(cap);
                fold_right = edge_share - overhang_right;
                absorbed_right = 0.0;
            }
            let gap = if cluster_count >= 2 {
                excess / cluster_count as f64
                    + (fold_left + fold_right) / (cluster_count as f64 - 1.0)
            } else {
                // No interior on a single cluster: cap remainders join
                // the edge absorption instead.
                absorbed_left += fold_left;
                absorbed_right += fold_right;
                0.0
            };
            let author = match style.text_flow.letter_spacing {
                LengthPercentage::Length(px) => px.get(),
                _ => 0.0,
            };
            let last_cluster_start = base_text
                .char_indices()
                .next_back()
                .map_or(range.start, |(offset, _)| range.start + offset);
            if cluster_count >= 2 && last_cluster_start > range.start && gap > 0.0 {
                ruby_spread_edits.push((range.start..last_cluster_start, author + gap as f32));
            }
            let edge_carrier = absorbed_left + absorbed_right;
            if edge_carrier > 0.0 {
                ruby_spread_edits
                    .push((last_cluster_start..range.end, author + edge_carrier as f32));
            }
            if absorbed_left > 0.0 {
                ruby_center_shifts.insert(*item_index, absorbed_left);
            }
            ruby_spreads.insert(*item_index, gap);
            ruby_spread_overhangs.insert(*item_index, overhang_left);
            ruby_spread_overhangs_right.insert(*item_index, overhang_right);
        }

        let mut fonts = self.fonts.borrow_mut();
        // Computed before the builder takes the font borrow: the trim
        // gate resolves each trimmed character's font to check `halt`.
        let inline_box_bytes: Vec<usize> =
            image_boxes.iter().map(|inline_box| inline_box.index).collect();
        let punctuation_trims = compute_cjk_punctuation_trims(
            &mut fonts,
            &self.registered_families,
            &mut self.halt_feature_cache.borrow_mut(),
            &text,
            &runs,
            suppressed_pair_trims,
            &inline_box_bytes,
        );
        let pair_trims: Vec<(usize, usize)> = punctuation_trims
            .iter()
            .map(|trim| (trim.left_byte, trim.right_byte))
            .collect();
        // Characters no registered face covers: shaping lands on a face's
        // `.notdef` advance while the canvas paints the browser's own
        // fallback glyph (measured: b12's U+2764 shaped 12.445px against a
        // painted 14.5625px, skewing every justify share on the line). The
        // host measures the fallback advance with the same canvas that
        // paints; the difference rides as letter spacing on the character,
        // the edit channel the punctuation trims already use.
        let mut uncovered_char_edits: Vec<(std::ops::Range<usize>, f32)> = Vec::new();
        {
            let mut coverage = self.char_coverage_cache.borrow_mut();
            let mut cursor = 0usize;
            for (byte, character) in text.char_indices() {
                if character.is_whitespace() || character.is_control() {
                    continue;
                }
                while cursor < runs.len() && runs[cursor].0.end <= byte {
                    cursor += 1;
                }
                let Some((_, style, _)) =
                    runs.get(cursor).filter(|(range, ..)| range.contains(&byte))
                else {
                    continue;
                };
                let family_key = host_family_key(style);
                let covered = *coverage
                    .entry((family_key.clone(), character))
                    .or_insert_with(|| {
                        stack_covers_character(
                            &mut fonts,
                            &self.registered_families,
                            style,
                            character,
                        )
                    });
                if covered {
                    continue;
                }
                let Some(host_advance) = self.host_char_advance(
                    &family_key,
                    f64::from(style.font.size.get()),
                    character,
                ) else {
                    continue;
                };
                let Some(notdef) = stack_notdef_advance_px(
                    &mut fonts,
                    &self.registered_families,
                    style,
                    shaping_font_size(style.font.size.get()),
                ) else {
                    continue;
                };
                let author = match style.text_flow.letter_spacing {
                    LengthPercentage::Length(px) => px.get(),
                    _ => 0.0,
                };
                uncovered_char_edits.push((
                    byte..byte + character.len_utf8(),
                    author + (host_advance - notdef) as f32,
                ));
            }
        }
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = layouts.ranged_builder(&mut fonts, &text, 1.0, true);
        // The pinned-browser baseline: Chromium's ASCII break tailoring plus
        // its CJK-context treatment of ambiguous curly quotes.
        if break_anywhere {
            // `line-break: anywhere`: a soft wrap opportunity around every
            // typographic character unit — kinsoku and pair tables are
            // disregarded entirely (b50's afterword packs two more
            // full-width characters per line than any kinsoku-aware rule
            // set allows, breaking mid-ellipsis and before commas).
            builder.set_line_break_override(Some(&break_anywhere_override));
        } else if chromium_tailoring {
            if strict_kinsoku {
                builder.set_line_break_override(Some(&cjk_aware_chromium_break_override_strict));
            } else {
                builder.set_line_break_override(Some(&cjk_aware_chromium_break_override));
            }
        } else if break_all {
            builder.set_line_break_override(Some(&break_all_box_dash_override));
        }
        // `text-indent` is the block container's own inherited property and
        // indents its first line whatever sits on it — a line holding only
        // an image included. Reading it off whichever text run happens to
        // start at byte zero would skip every image-only first line.
        let first_line_indent = tree
            .strut_style(node)
            .or_else(|| {
                items.first().and_then(|item| match item {
                    InlineItem::Text { style, .. }
                    | InlineItem::Image { style, .. }
                    | InlineItem::InlineBlock { style, .. } => Some(*style),
                })
            })
            .and_then(|style_id| styles.inline.style(style_id).ok())
            .map_or(0.0_f32, |style| resolved_text_indent(&style));
        for (range, style, item_index) in &runs {
            if range.is_empty() {
                continue;
            }
            push_item_styles(&mut builder, style, range.clone());
            // Parley merges adjacent resolved styles that compare equal,
            // which would fuse glyph runs across item boundaries whenever
            // neighbouring items differ only in properties Parley never
            // sees (color, decoration, other pure paint). A distinct
            // per-item brush keeps every glyph run inside exactly one
            // source item, so consumers can map a run back to its item —
            // and that item's paint style — by byte range alone.
            builder.push(
                StyleProperty::Brush((*item_index as u32).to_le_bytes()),
                range.clone(),
            );
            // A <ruby> element's edge is a SHAPING boundary in Blink: the
            // base shapes alone, so a kern pair straddling the edge never
            // applies (measured: <ruby>ウ</ruby>，spans the full 加0.08em
            // where plain/span/b ウ，closes it; the b20 Shou line's slack
            // grew 1.216px through exactly that pair). A <span> edge does
            // NOT break shaping. Parley only splits shaped runs where
            // font features (or size/locale/spacing) change, so the base
            // carries a no-op feature — an explicitly-off `halt` (off is
            // its default: zero shaping effect) — to force the split.
            // Alternating with `vhal` (also off, inert in horizontal
            // flow) keeps DIRECTLY adjacent mono-ruby bases from merging
            // with each other.
            let is_ruby = matches!(
                items.get(*item_index),
                Some(InlineItem::Text {
                    ruby_annotation: Some(_),
                    ..
                })
            );
            if is_ruby {
                let tag = if item_index % 2 == 0 { b"halt" } else { b"vhal" };
                builder.push(
                    StyleProperty::FontFeatures(parley::FontFeatures::List(
                        std::borrow::Cow::Owned(vec![parley::FontFeature::new(
                            parley::setting::Tag::new(tag),
                            0,
                        )]),
                    )),
                    range.clone(),
                );
            }
        }
        // A space takes the FIRST family of its stack in the browser
        // (every face covers U+0020), while parley merges a space into
        // the neighbouring script run: a space between a CJK glyph and
        // a latin word shaped with the CJK face's 0.232em space where
        // the browser uses the latin face's 0.25em, and the rest of the
        // line walked 0.27px apart. An inert-off font feature forces a
        // CJK-PRECEDED space into its own shaping run, which then
        // resolves against the stack head. A space whose PRECEDING
        // character is latin inherits the latin run already (stack-head
        // face either way), and must stay merged so the word's trailing
        // kern pair keeps applying — the browser kerns latin+space
        // inside one segment (measured: Tinos A+space carries a -113
        // GPOS pair, and the justified CJK line around `A 班` spread
        // its shares from the kerned natural width; the split-both-ways
        // rule inflated the natural 0.883px and every share with it).
        {
            let chars: Vec<(usize, char)> = text.char_indices().collect();
            for (position, (byte, character)) in chars.iter().enumerate() {
                if *character != ' ' {
                    continue;
                }
                let prev_cjk = position
                    .checked_sub(1)
                    .and_then(|index| chars.get(index))
                    .is_some_and(|(_, prev)| is_cjk_context(*prev));
                if prev_cjk {
                    builder.push(
                        StyleProperty::FontFeatures(parley::FontFeatures::List(
                            std::borrow::Cow::Owned(vec![parley::FontFeature::new(
                                parley::setting::Tag::new(b"smcp"),
                                0,
                            )]),
                        )),
                        *byte..*byte + 1,
                    );
                }
            }
        }

        // Inline box advances: a span's horizontal padding and borders
        // widen the gap at each box boundary. The gap rides as letter
        // spacing on the character left of the boundary (the same
        // mechanism as the punctuation trims); a box opening at the very
        // start of the flow folds its lead into the first-line indent.
        // Each edit is (range, box gap, author letter-spacing): standalone
        // pushes apply author + gap; an edit landing on a trimmed
        // character adds only the gap (the trim value already carries the
        // author spacing).
        let mut box_edits: Vec<(std::ops::Range<usize>, f32, f32)> = Vec::new();
        let mut leading_box_indent = 0.0_f32;
        let mut item_box_sheds: std::collections::HashMap<usize, f64> = std::collections::HashMap::new();
        let mut forced_line_indents: std::collections::HashMap<usize, f64> =
            std::collections::HashMap::new();
        {
            let box_side = |value: &rito_style_contract::NonNegativeLengthPercentage| match value
                .value()
            {
                LengthPercentage::Length(px) => px.get(),
                _ => 0.0,
            };
            let edge_width = |edge: &rito_style_contract::BorderEdge| {
                use rito_style_contract::BorderStyle;
                if matches!(edge.style, BorderStyle::None | BorderStyle::Hidden) {
                    0.0
                } else {
                    edge.resolved_width.get()
                }
            };
            let author = |style: &InlineFormattingStyleV1| match style.text_flow.letter_spacing {
                LengthPercentage::Length(px) => px.get(),
                _ => 0.0,
            };
            // Inline horizontal margins displace the inline box
            // exactly like padding/border gaps, but stay OUTSIDE the
            // painted box (the pen grows the box by paint padding only).
            // Percentages resolve against the containing block's inline
            // size; vertical inline margins have no effect in CSS.
            let margin_side = |value: &rito_style_contract::LengthPercentageOrAuto| match value {
                rito_style_contract::LengthPercentageOrAuto::Auto => 0.0_f32,
                rito_style_contract::LengthPercentageOrAuto::Value(inner) => match inner {
                    LengthPercentage::Length(px) => px.get(),
                    LengthPercentage::Percentage(pct) => available_inline_size
                        .map_or(0.0, |basis| pct.ratio() * basis as f32),
                    _ => 0.0,
                },
            };
            for (index, (range, style, item_index)) in runs.iter().enumerate() {
                if range.is_empty() {
                    continue;
                }
                let lead = box_side(&style.fragment.padding.left)
                    + edge_width(&style.fragment.border.left)
                    + margin_side(&style.fragment.margin.left);
                let trail = box_side(&style.fragment.padding.right)
                    + edge_width(&style.fragment.border.right)
                    + margin_side(&style.fragment.margin.right);
                if trail > 0.0 {
                    if let Some((last, _)) = text[range.clone()].char_indices().last() {
                        box_edits.push((range.start + last..range.end, trail, author(style)));
                        *item_box_sheds.entry(*item_index).or_insert(0.0) += f64::from(trail);
                    }
                }
                if lead > 0.0 {
                    if range.start == 0 {
                        leading_box_indent += lead;
                    } else if text.as_bytes().get(range.start - 1) == Some(&b'\n') {
                        // The span opens a forced-break line: the lead
                        // indents that line (a previous-char edit would
                        // widen the line ABOVE). Breaking does not see
                        // the reserved width — an indented long span may
                        // overfit vs Blink; b60-style badge lines hold
                        // one glyph and are exact.
                        *forced_line_indents.entry(range.start).or_insert(0.0) +=
                            f64::from(lead);
                    } else if let Some((prev_range, prev_style, prev_item)) = runs
                        .get(..index)
                        .and_then(|earlier| {
                            earlier
                                .iter()
                                .rev()
                                .find(|(earlier_range, ..)| !earlier_range.is_empty())
                        })
                    {
                        if let Some((last, _)) = text[prev_range.clone()].char_indices().last() {
                            box_edits.push((
                                prev_range.start + last..prev_range.end,
                                lead,
                                author(prev_style),
                            ));
                            *item_box_sheds.entry(*prev_item).or_insert(0.0) += f64::from(lead);
                        }
                    }
                }
            }
        }
        // Coincident box edits sum: one character can carry BOTH its own
        // box's trailing gap and the next box's leading gap (b74's title
        // cards — four adjacent bordered spans). Pushed separately they
        // land on the same builder range and the later LetterSpacing
        // OVERWRITES the earlier, silently dropping one gap (every
        // non-final card lost its 4px trail). The author spacing on both
        // edits comes from the same character's style, so merging keeps
        // it single-counted.
        {
            let mut coalesced: Vec<(std::ops::Range<usize>, f32, f32)> = Vec::new();
            for (range, gap, author) in box_edits.drain(..) {
                if let Some(existing) =
                    coalesced.iter_mut().find(|(seen, ..)| *seen == range)
                {
                    existing.1 += gap;
                } else {
                    coalesced.push((range, gap, author));
                }
            }
            box_edits = coalesced;
        }
        let first_line_indent = first_line_indent + leading_box_indent;
        let opener_halt_trims: Vec<(std::ops::Range<usize>, f64)> = punctuation_trims
            .iter()
            .filter_map(|trim| match trim.edit {
                PunctuationTrimEdit::OpenerHalt(half) => {
                    Some((trim.edit_range.clone(), f64::from(half)))
                }
                PunctuationTrimEdit::LetterSpacing(_) => None,
            })
            .collect();
        for trim in punctuation_trims {
            let range = trim.edit_range;
            let spacing = match trim.edit {
                PunctuationTrimEdit::OpenerHalt(_) => {
                    builder.push(
                        StyleProperty::FontFeatures(parley::FontFeatures::List(
                            std::borrow::Cow::Owned(vec![parley::FontFeature::new(
                                parley::setting::Tag::new(b"halt"),
                                1,
                            )]),
                        )),
                        range,
                    );
                    continue;
                }
                PunctuationTrimEdit::LetterSpacing(spacing) => spacing,
            };
            // A box gap on the same character composes with the trim (the
            // trim value already carries the author spacing).
            let boxed = box_edits
                .iter()
                .position(|(edit_range, ..)| *edit_range == range);
            let spacing = match boxed {
                Some(found) => {
                    let (_, gap, _) = box_edits.remove(found);
                    spacing + gap
                }
                None => spacing,
            };
            builder.push(StyleProperty::LetterSpacing(spacing), range);
        }
        // A box gap landing on an uncovered character composes with its
        // advance edit instead of being overwritten by it.
        for (range, gap, author) in box_edits {
            if let Some((_, spacing)) = uncovered_char_edits
                .iter_mut()
                .find(|(edit_range, _)| *edit_range == range)
            {
                *spacing += gap;
                continue;
            }
            builder.push(StyleProperty::LetterSpacing(author + gap), range);
        }
        for (range, spacing) in &uncovered_char_edits {
            builder.push(StyleProperty::LetterSpacing(*spacing), range.clone());
        }
        for (range, spacing) in &ruby_spread_edits {
            builder.push(StyleProperty::LetterSpacing(*spacing), range.clone());
        }
        push_line_end_trims(&mut builder, &text, &runs, end_trims);
        for image_box in image_boxes {
            builder.push_inline_box(image_box);
        }
        if cancel.is_cancelled() {
            return Err(LayoutError::Cancelled);
        }
        // text-align inherits, so the paragraph's own strut style carries
        // its alignment; a first-item fallback covers strut-less flows.
        // The item fallback must NOT read an inline-block's style: the
        // atom's own text-align (a centered verse card) aligns the atom's
        // CONTENT, not the host line it rides (measured: Blink keeps the
        // card at the host paragraph's left edge).
        let alignment = tree
            .strut_style(node)
            .or_else(|| {
                items.first().map(|item| match item {
                    InlineItem::Text { style, .. }
                    | InlineItem::Image { style, .. }
                    | InlineItem::InlineBlock { style, .. } => *style,
                })
            })
            .map(|style_id| {
                styles
                    .inline
                    .style(style_id)
                    .map(|style| paragraph_alignment(style.text_flow.text_align))
                    .map_err(|error| LayoutError::Invalid(error.to_string()))
            })
            .transpose()?
            .unwrap_or(parley::Alignment::Start);
        let mut layout = builder.build(&text);
        // Parley's own first-line indent: a start-edge margin on the
        // indented line. Reserving the space with an inline box instead
        // would invent a break opportunity that CSS does not have, and an
        // atomic inline too wide for the rest of the line would wrap to a
        // line of its own rather than overflow beside the indent.
        if first_line_indent != 0.0 {
            layout.set_text_indent(first_line_indent, parley::IndentOptions::default());
        }
        Ok(ParagraphLayout {
            layout,
            text,
            alignment,
            shifted_ranges,
            first_line_indent,
            inline_block_boxes,
            inline_block_baselines,
            image_edge_insets,
            pair_trims,
            opener_halt_trims,
            item_box_sheds,
            forced_line_indents,
            ruby_spreads,
            ruby_spread_overhangs,
            ruby_spread_overhangs_right,
            ruby_annotation_widths,
            ruby_annotation_caps,
            ruby_center_shifts,
        })
    }
}

impl FormattingContext for ParleyInlineContext {
    fn layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&rito_fragment::BreakToken>,
        cancel: &CancelFlag,
    ) -> Result<LayoutOutcome, LayoutError> {
        if token.is_some() {
            return Err(LayoutError::Invalid(
                "inline flows resume through their block container, not a break token".to_owned(),
            ));
        }
        if space.fragmentainer_remaining.is_some() {
            return Err(LayoutError::Invalid(
                "inline flows fragment through their block container; continuous space only"
                    .to_owned(),
            ));
        }
        let root = node;
        // Float exclusion: lines inside the band are broken at the reduced
        // width and shifted past the left inset; the flow returns to the
        // full inline size below the band. CSS shortens line boxes around
        // a float rather than moving the block box.
        let band = space.float_band.filter(|band| {
            band.bottom > 0.0 && (band.left_inset > 0.0 || band.right_inset > 0.0)
        });
        // Lines break through one manual loop so a specific line index can
        // be FORCED to hold an exact cluster count: the browser's rejected
        // line-end trim extension rewinds the whole overflowing item to
        // the next line (measured: a razor-fit note line breaks as
        // [span ①][whole text item] where greedy would split the text),
        // and `break_next_with_length` reproduces that rewind.
        // Blink accepts a line that overflows its available width by up to
        // one LayoutUnit: NGLineBreaker::CanFitOnLine compares against
        // available_width_.AddEpsilon(). Measured on the Tinos body idiom:
        // a 626.695-wide line fits a 626.6875 column (threshold scanned to
        // the 1/64), so a strict compare here wrapped one word early and
        // drifted whole paragraphs. The epsilon widens only the FIT — the
        // justify target below keeps the true width, exactly as Blink
        // justifies to the unwidened line box.
        const LINE_FIT_EPSILON: f64 = 1.0 / 64.0;
        let break_lines = |layout: &mut parley::Layout<[u8; 4]>,
                          forced: &[(usize, u32)]| {
            if band.is_none() && forced.is_empty() {
                layout.break_all_lines(Some((space.inline_size + LINE_FIT_EPSILON) as f32));
                return;
            }
            let mut breaker = layout.break_lines();
            breaker
                .state_mut()
                .set_layout_max_advance((space.inline_size + LINE_FIT_EPSILON) as f32);
            let mut index = 0usize;
            loop {
                // Every line gets its advance set explicitly: a forced
                // break leaves breaker state the next natural break must
                // not inherit.
                if let Some(band) = band {
                    let band_inline_size =
                        (space.inline_size - band.left_inset - band.right_inset).max(0.0);
                    let inside = f64::from(breaker.committed_y() as f32) < band.bottom;
                    let (advance, offset) = if inside {
                        (band_inline_size, band.left_inset)
                    } else {
                        (space.inline_size, 0.0)
                    };
                    let state = breaker.state_mut();
                    state.set_line_max_advance((advance + LINE_FIT_EPSILON) as f32);
                    state.set_line_x(offset as f32);
                } else {
                    breaker
                        .state_mut()
                        .set_line_max_advance((space.inline_size + LINE_FIT_EPSILON) as f32);
                }
                let forced_count = forced
                    .iter()
                    .find(|(line, _)| *line == index)
                    .map(|(_, count)| *count);
                let progressed = match forced_count {
                    Some(count) => breaker.break_next_with_length(count).is_some(),
                    None => breaker.break_next().is_some(),
                };
                if !progressed {
                    break;
                }
                index += 1;
            }
            breaker.finish();
        };
        // The max advance the breaker gave a line, reconstructed from the
        // same rule the loop above applied: band width while the line's top
        // sits inside the band, the full inline size below it.
        let line_max_advance = |line_top: f64| match band {
            Some(band) if line_top < band.bottom => {
                (space.inline_size - band.left_inset - band.right_inset).max(0.0) as f32
            }
            _ => space.inline_size as f32,
        };
        // Conditional line-end trim, to a fixpoint: find the first soft
        // break Chromium would have extended past a trimmed closing glyph,
        // apply that trim, re-lay, and keep it only if the line then breaks
        // exactly after the trimmed closer — parley's own fitting and break
        // rules stay the authority over what an accepted trim produces.
        // Each accepted trim finalizes one more line, so the loop is
        // bounded by the line count (plus one rebuild per rejection).
        // Byte range each item occupies in the flow text (images occupy
        // none). Hoisted above the layout loop: the rewind detection maps
        // an overflowing character back to its item.
        let item_text_ranges: Vec<std::ops::Range<usize>> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => {
                let mut cursor = 0usize;
                items
                    .iter()
                    .map(|item| match item {
                        InlineItem::Text { text, .. } => {
                            let start = cursor;
                            cursor += text.len();
                            start..cursor
                        }
                        InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => {
                            cursor..cursor
                        }
                    })
                    .collect()
            }
            _ => Vec::new(),
        };
        // Flow-text positions of in-flow atomic inlines (images, inline
        // blocks): they occupy no flow bytes, but Blink counts them as
        // ideographs on both sides when enumerating justification
        // opportunities, and their justified x rides the shares before
        // them like any glyph.
        let atom_positions: Vec<usize> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .zip(item_text_ranges.iter())
                .filter(|(item, _)| {
                    matches!(
                        item,
                        InlineItem::Image { .. } | InlineItem::InlineBlock { .. }
                    )
                })
                .map(|(_, range)| range.start)
                .collect(),
            _ => Vec::new(),
        };
        let mut end_trims: Vec<usize> = Vec::new();
        let mut rejected_trims: Vec<usize> = Vec::new();
        let mut suppressed_pair_trims: Vec<usize> = Vec::new();
        let mut forced_line_breaks: Vec<(usize, u32)> = Vec::new();
        let mut pending_trim: Option<usize> = None;
        let (
            layout,
            alignment,
            shifted_ranges,
            first_line_indent,
            item_box_sheds,
            forced_line_indents,
            ruby_spreads,
            ruby_spread_overhangs,
            ruby_spread_overhangs_right,
            ruby_center_shifts,
            opener_halt_trims,
            mut inline_block_boxes,
            inline_block_baselines,
            image_edge_insets,
        ) = loop {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            let ParagraphLayout {
                mut layout,
                alignment,
                shifted_ranges,
                text,
                first_line_indent,
                pair_trims,
                opener_halt_trims,
                item_box_sheds,
                forced_line_indents,
                ruby_spreads,
                ruby_spread_overhangs,
                ruby_spread_overhangs_right,
                ruby_annotation_widths,
                ruby_annotation_caps,
                ruby_center_shifts,
                inline_block_boxes,
                inline_block_baselines,
                image_edge_insets,
            } = self.build_layout(
                tree,
                root,
                Some(space.inline_size),
                space.fragmentainer_size,
                space.containing_block_size,
                PercentageImageSizing::Intrinsic,
                &end_trims,
                &suppressed_pair_trims,
                cancel,
            )?;
            break_lines(&mut layout, &forced_line_breaks);
            // A pair trim is only real while both glyphs share a line
            // (measured: a line-final comma keeps its full width when its
            // partner bracket opens the next line, and the line's justify
            // slack follows). Suppress every straddled pair and re-lay to
            // a fixpoint; suppression only widens lines, so breaks only
            // move earlier and the loop is bounded by the pair count.
            {
                let mut straddled = false;
                for (left_byte, right_byte) in &pair_trims {
                    if layout
                        .lines()
                        .any(|line| line.text_range().start == *right_byte)
                        && !suppressed_pair_trims.contains(left_byte)
                    {
                        suppressed_pair_trims.push(*left_byte);
                        straddled = true;
                    }
                }
                if straddled {
                    forced_line_breaks.clear();
                    continue;
                }
            }
            if let Some(byte) = pending_trim.take() {
                let trimmed_end = byte + text[byte..].chars().next().map_or(1, char::len_utf8);
                let confirmed = layout.lines().any(|line| line.text_range().end == trimmed_end);
                if !confirmed {
                    end_trims.retain(|&trim| trim != byte);
                    rejected_trims.push(byte);
                    continue;
                }
            }
            // Ruby split-fit, before any trim reasoning: a soft break
            // inside a ruby base is legal only while the first segment
            // still fits carrying its WHOLE annotation — the segment
            // widens to at least the annotation's advance (measured:
            // 608px of text plus 异 at 16px fit a 627.2px line, but the
            // segment carries Talent at 23px and Blink sends the ruby
            // down; 黄金妖|精 stays split because 黄金妖 at 48px covers
            // Leprechaun's 44px). An overflowing split rewinds the line
            // to the item start and re-lays.
            if !ruby_annotation_widths.is_empty() {
                let mut rewound_ruby = false;
                let mut line_top = 0.0_f64;
                for index in 0..layout.len().saturating_sub(1) {
                    let indent = if index == 0 { first_line_indent } else { 0.0 };
                    let max_advance =
                        f64::from(line_max_advance(line_top) - indent) + LINE_FIT_EPSILON;
                    line_top += layout
                        .get(index)
                        .map_or(0.0, |line| f64::from(line.metrics().line_height));
                    if forced_line_breaks.iter().any(|(line, _)| *line == index) {
                        continue;
                    }
                    let Some(line) = layout.get(index) else {
                        continue;
                    };
                    if line.break_reason() != parley::layout::BreakReason::Regular {
                        continue;
                    }
                    let range = line.text_range();
                    let Some((item_start, annotation_width)) = item_text_ranges
                        .iter()
                        .enumerate()
                        .find_map(|(item, item_range)| {
                            (item_range.start < range.end && range.end < item_range.end)
                                .then(|| {
                                    ruby_annotation_widths
                                        .get(&item)
                                        .map(|width| (item_range.start, *width))
                                })
                                .flatten()
                        })
                    else {
                        continue;
                    };
                    // The split's first segment must START on this line;
                    // a base already split earlier has nothing to rewind.
                    if item_start < range.start {
                        continue;
                    }
                    let mut segment_advance = 0.0_f64;
                    let mut cluster =
                        parley::layout::Cluster::from_byte_index(&layout, item_start);
                    while let Some(current) = cluster {
                        if current.text_range().start >= range.end {
                            break;
                        }
                        segment_advance += f64::from(current.advance());
                        cluster = current.next_logical();
                    }
                    // A multi-word annotation splits at its spaces and
                    // only the words allocated to THIS segment (by
                    // character-midpoint position) must fit over it —
                    // 正|规勇者 under "Legal Brave" keeps the split
                    // because 正 carries only Legal (measured matrix).
                    let segment_annotation_width = {
                        let item_index = item_text_ranges
                            .iter()
                            .position(|candidate| candidate.start == item_start);
                        let annotation = item_index.and_then(|index| {
                            match &tree.node(root).content {
                                FormattingNodeContent::InlineFlow { items } => {
                                    match items.get(index) {
                                        Some(InlineItem::Text {
                                            ruby_annotation: Some(annotation),
                                            ..
                                        }) => Some(annotation.text.clone()),
                                        _ => None,
                                    }
                                }
                                _ => None,
                            }
                        });
                        let item_range = item_index.map(|index| item_text_ranges[index].clone());
                        let total_chars = item_range
                            .as_ref()
                            .and_then(|item| text.get(item.clone()))
                            .map_or(0, |base| base.chars().count());
                        let segment_chars = text
                            .get(item_start..range.end)
                            .map_or(0, |segment| segment.chars().count());
                        match annotation {
                            Some(annotation) if total_chars > 0 => {
                                let ratio = segment_chars as f64 / total_chars as f64;
                                let allocated = rito_fragment::allocate_ruby_annotation(
                                    &annotation,
                                    0.0,
                                    ratio,
                                );
                                if allocated == annotation {
                                    annotation_width
                                } else if allocated.is_empty() {
                                    0.0
                                } else {
                                    // Approximate the allocated words'
                                    // advance by character share — exact
                                    // enough for the fit decision, and
                                    // both ends stay measurement-free.
                                    annotation_width * allocated.chars().count() as f64
                                        / annotation.chars().count().max(1) as f64
                                }
                            }
                            _ => annotation_width,
                        }
                    };
                    // The segment's box presses its allocated
                    // annotation's advance on the line, minus the RUBY's
                    // own spread overhang — an unspread ruby (annotation
                    // narrower than the whole base) overhangs nothing, so
                    // its full allocated advance presses (measured:
                    // 异/Talent rewinds at 19.875 where the segment-local
                    // half-excess would have squeaked by; spread
                    // 咒/Thaumaturgy keeps its split at 42.95 − 2.74).
                    let segment_box = {
                        let overhang = item_text_ranges
                            .iter()
                            .position(|candidate| candidate.start == item_start)
                            .and_then(|index| ruby_spread_overhangs.get(&index))
                            .copied()
                            .unwrap_or(0.0);
                        (segment_annotation_width - overhang).max(segment_advance)
                    };
                    if segment_box <= segment_advance + LINE_FIT_EPSILON {
                        continue;
                    }
                    let metrics = line.metrics();
                    let natural =
                        f64::from(metrics.advance) - f64::from(metrics.trailing_whitespace);
                    if natural - segment_advance + segment_box <= max_advance {
                        continue;
                    }
                    if item_start <= range.start {
                        continue;
                    }
                    let Some(count) = text
                        .get(range.start..item_start)
                        .map(|held| held.chars().count())
                        .filter(|count| *count > 0)
                        .and_then(|count| u32::try_from(count).ok())
                    else {
                        continue;
                    };
                    forced_line_breaks.push((index, count));
                    rewound_ruby = true;
                    break;
                }
                if rewound_ruby {
                    continue;
                }
            }
            let mut line_top = 0.0_f64;
            let candidate = (0..layout.len().saturating_sub(1)).find_map(|index| {
                // The text-indent margin narrows the first line's
                // available advance exactly as it narrowed Parley's fit.
                let indent = if index == 0 { first_line_indent } else { 0.0 };
                // The trim candidate models the breaker's fit, so it sees
                // the same epsilon-widened advance the breaker used.
                let max_advance = line_max_advance(line_top) + LINE_FIT_EPSILON as f32 - indent;
                line_top += layout
                    .get(index)
                    .map_or(0.0, |line| f64::from(line.metrics().line_height));
                // An engine-forced break (a rewind, a ruby split) is not a
                // fit decision, but parley stamps it BreakReason::Regular
                // all the same — extending past one would fabricate a
                // candidate out of the very content the rewind pushed
                // down and then unwind the rewind (measured: b1's
                // razor-fit ① note line re-merged this way).
                if forced_line_breaks.iter().any(|(line, _)| *line == index) {
                    return None;
                }
                line_end_trim_candidate(
                    &layout,
                    &text,
                    index,
                    max_advance,
                    &end_trims,
                    &rejected_trims,
                )
            });
            match candidate {
                Some(byte) => {
                    end_trims.push(byte);
                    pending_trim = Some(byte);
                    forced_line_breaks.clear();
                }
                None => {
                    // Rejected-extension rewind: when the line-end trim
                    // extension would fit but the line crosses an element
                    // boundary (the single-item gate), the browser sends
                    // the WHOLE overflowing item to the next line instead
                    // of breaking greedily inside it. Force that line to
                    // hold exactly the clusters before the item and
                    // re-lay; one rewind per pass keeps earlier line
                    // indices stable.
                    let mut line_top = 0.0_f64;
                    let mut rewound = false;
                    for index in 0..layout.len().saturating_sub(1) {
                        let indent = if index == 0 { first_line_indent } else { 0.0 };
                        let max_advance =
                            f64::from(line_max_advance(line_top) - indent) + LINE_FIT_EPSILON;
                        line_top += layout
                            .get(index)
                            .map_or(0.0, |line| f64::from(line.metrics().line_height));
                        if forced_line_breaks.iter().any(|(line, _)| *line == index) {
                            continue;
                        }
                        let Some(count) = rewind_break_count(
                            &layout,
                            &text,
                            index,
                            max_advance,
                            &item_text_ranges,
                        ) else {
                            continue;
                        };
                        forced_line_breaks.push((index, count));
                        rewound = true;
                        break;
                    }
                    if rewound {
                        continue;
                    }
                    break (
                        layout,
                        alignment,
                        shifted_ranges,
                        first_line_indent,
                        item_box_sheds,
                        forced_line_indents,
                        ruby_spreads,
                        ruby_spread_overhangs,
                        ruby_spread_overhangs_right,
                        ruby_center_shifts,
                        opener_halt_trims,
                        inline_block_boxes,
                        inline_block_baselines,
                        image_edge_insets,
                    );
                }
            }
        };
        let mut layout = layout;
        // Always align, `Start` included: alignment is where Parley applies
        // the first-line indent's start-edge offset, so skipping it for the
        // default alignment would leave indented lines flush.
        //
        // Justified paragraphs align to the start edge here: Parley's own
        // justification expands whitespace clusters only, while the line
        // loop below spreads each line's slack across Blink's expansion
        // opportunities (CJK boundaries included) itself.
        let justify = alignment == parley::Alignment::Justify;
        layout.align(
            if justify {
                parley::Alignment::Start
            } else {
                alignment
            },
            parley::AlignmentOptions::default(),
        );
        let strut_height = self.resolved_strut_height(tree, root)?;
        let item_shifts: Vec<f64> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .map(|item| match item {
                    InlineItem::Text {
                        baseline_shift_px, ..
                    }
                    | InlineItem::Image {
                        baseline_shift_px, ..
                    }
                    | InlineItem::InlineBlock {
                        baseline_shift_px, ..
                    } => *baseline_shift_px,
                })
                .collect(),
            _ => Vec::new(),
        };
        // Per item: a declared line-height resolves to a fixed height; a
        // `normal` item defers to host-measured metrics chosen per line by
        // CJK content. Indexed like `item_text_ranges`.
        /// One text item's line-height inputs: the style whose host
        /// metrics size its content area, and its declared line-height
        /// when it has one (`None` for `normal`).
        struct ItemLineHeight {
            style: rito_style_contract::StyleId,
            declared: Option<f64>,
        }
        let style_tables = tree.styles();
        let flow_text: String = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .map(|item| match item {
                    InlineItem::Text { text, .. } => text.as_str(),
                    InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => "",
                })
                .collect(),
            _ => String::new(),
        };
        let item_line_heights: Vec<Option<ItemLineHeight>> = match &tree.node(root).content {
            FormattingNodeContent::InlineFlow { items } => items
                .iter()
                .map(|item| match item {
                    InlineItem::Text { style, .. } => {
                        let resolved = style_tables?.inline.style(*style).ok()?;
                        Some(ItemLineHeight {
                            style: *style,
                            declared: used_declared_line_height(
                                resolved.font.line_height,
                                f64::from(resolved.font.size.get()),
                            ),
                        })
                    }
                    // An image carries its own style so a line holding
                    // only images can still find the host metrics that
                    // size the space around it; an inline-block the same.
                    InlineItem::Image { style, .. } | InlineItem::InlineBlock { style, .. } => {
                        Some(ItemLineHeight {
                            style: *style,
                            declared: None,
                        })
                    }
                })
                .collect(),
            _ => Vec::new(),
        };
        let shift_for_range = |range: &std::ops::Range<usize>| -> f64 {
            shifted_ranges
                .iter()
                .find(|(shifted, _)| shifted.start < range.end && range.start < shifted.end)
                .map(|(_, shift)| *shift)
                .unwrap_or(0.0)
        };
        if cancel.is_cancelled() {
            return Err(LayoutError::Cancelled);
        }

        // Outside list marker: Blink derives the disc from the list item's
        // primary font and hangs it off the first line (see
        // `list_marker_geometry`).
        let list_marker = list_marker_geometry(
            &mut self.fonts.borrow_mut(),
            &self.registered_families,
            tree,
            root,
        );
        let mut lines = Vec::new();
        // Line boxes stack by their CSS line height: the box model the
        // browser's per-character range rects expose. Parley's block
        // min/max coordinates track ink extents, which drift from the
        // line-height stack by rounding and leading distribution, so the
        // block position comes from accumulation instead.
        let mut running_top = 0.0_f64;
        // The previous line's leading below its text, spent by a ruby
        // annotation on the next line before the line has to grow.
        let mut prev_ruby_below: Option<f64> = None;
        // The distinct fonts that shaped the previous line's glyph runs.
        // The browser's under-edge allowance depends on the previous
        // line's font composition (measured: one Latin glyph — a space
        // included — shrinks the gap a following annotation may reuse by
        // one pixel at 16px), so the reuse probe must match it.
        let mut prev_line_fonts: Vec<(u64, u32)> = Vec::new();
        for line in layout.lines() {
            let metrics = line.metrics();
            let line_top = running_top;
            let has_inline_box = line
                .items()
                .any(|item| matches!(&item, PositionedLayoutItem::InlineBox(_)));
            // Env-gated line forensics for the native probe binary (wasm
            // has no env; the flag simply never sets there).
            // Flow-text ranges of the spread ruby bases: justification must
        // not open interior opportunities inside them.
        let spread_ranges: Vec<std::ops::Range<usize>> = ruby_spreads
            .keys()
            .filter_map(|index| item_text_ranges.get(*index).cloned())
            .collect();
        let line_debug = std::env::var_os("RITO_LINE_DEBUG").is_some();
            let mut debug_misses: Vec<String> = Vec::new();
            let ink_top = f64::from(metrics.block_min_coord);
            // css-text: trailing white space HANGS at the line end and is
            // excluded from alignment (while intrinsic/table sizing keeps
            // it — measured, u3000-hang oracle: a shrink-to-fit table box
            // keeps three trailing U+3000 but the centered line inside it
            // drops them, inking dead-centre). Parley's own exclusion
            // covers only its whitespace class (ASCII spaces) — the
            // ideographic space slips through and shifted b52's centered
            // title left by half its run. The uncovered hang is the
            // Unicode-whitespace tail minus what parley already excluded.
            let (hang_uncovered, trailing_nbsp_kept) = {
                let range = line.text_range();
                let content = flow_text.get(range.clone()).unwrap_or_default();
                let mut hang = 0.0_f64;
                // A trailing U+00A0 is NOT hangable white space: the
                // browser keeps its advance inside the aligned line
                // (b11's right-aligned link ends with two of them and
                // sits their width in from the edge), while parley's
                // trailing-whitespace class drops it — the kept sum
                // pulls the aligned start back.
                let mut nbsp_kept = 0.0_f64;
                let mut byte = range.end;
                for character in content.chars().rev() {
                    if !character.is_whitespace() {
                        break;
                    }
                    byte -= character.len_utf8();
                    if let Some(cluster) =
                        parley::layout::Cluster::from_byte_index(&layout, byte)
                    {
                        hang += f64::from(cluster.advance());
                        if character == '\u{a0}' {
                            nbsp_kept += f64::from(cluster.advance());
                        }
                    }
                }
                ((hang - f64::from(metrics.trailing_whitespace)).max(0.0), nbsp_kept)
            };
            // A span opening this forced-break line indents it by its box
            // lead (margins/padding/border of a post-<br/> span land on
            // the span's own line).
            let forced_indent = forced_line_indents
                .get(&line.text_range().start)
                .copied()
                .unwrap_or(0.0);
            let parley_line_x = f64::from(metrics.offset);
            // The hang shift moves the PAINTED line: children below are
            // relativized against parley's own aligned offset so the
            // shift survives into net positions (the first landing
            // relativized against the shifted value and cancelled itself
            // to a pixel-null — asserted by the paint-position test).
            // The 1/64 fit tolerance added to the BREAKING width leaks
            // into parley's free space, shifting every end-aligned line
            // right by 1/64 and every centered one by 1/128 (measured:
            // b12's right-aligned closing line started at 411.625 where
            // the browser's Range put it at 411.609375, and the browser
            // keeps alignment offsets unquantized). Subtract it back
            // whenever parley actually applied the alignment (free space
            // at the padded width positive).
            let alignment_epsilon = {
                let free_padded = f64::from(line_max_advance(line_top)) + LINE_FIT_EPSILON
                    - (f64::from(metrics.advance) - f64::from(metrics.trailing_whitespace));
                if free_padded > 0.0 {
                    match alignment {
                        parley::Alignment::End | parley::Alignment::Right => LINE_FIT_EPSILON,
                        parley::Alignment::Center => LINE_FIT_EPSILON / 2.0,
                        _ => 0.0,
                    }
                } else {
                    0.0
                }
            };
            // An alignment offset lands on the LayoutUnit grid by
            // FLOORING (Range-measured: a right-aligned 4-glyph 15.2px
            // line starts at 579.1875 = floor64(579.2), the .8 fraction
            // discriminating floor from round; centering behaves alike).
            // Start-aligned lines carry no offset and keep raw floats.
            let line_x = {
                let raw = parley_line_x - alignment_epsilon
                    + forced_indent
                    + match alignment {
                        parley::Alignment::Center => (hang_uncovered - trailing_nbsp_kept) / 2.0,
                        parley::Alignment::End | parley::Alignment::Right => {
                            hang_uncovered - trailing_nbsp_kept
                        }
                        _ => 0.0,
                    };
                match alignment {
                    parley::Alignment::Center
                    | parley::Alignment::End
                    | parley::Alignment::Right => (raw * 64.0).floor() / 64.0,
                    _ => raw,
                }
            };
            // A justified line spreads its slack equally across Blink's
            // expansion opportunities (see `line_justify_plan`); the
            // paragraph's last line and forced breaks keep the start edge.
            let justify_plan = if justify
                && matches!(
                    line.break_reason(),
                    parley::layout::BreakReason::Regular
                        | parley::layout::BreakReason::Emergency
                ) {
                let range = line.text_range();
                let indent = if range.start == 0 { first_line_indent } else { 0.0 };
                let target =
                    f64::from(line_max_advance(line_top)) - f64::from(indent) - forced_indent;
                // The hanging U+3000 tail leaves the measure like parley's
                // own trailing whitespace does: Blink justifies the line's
                // content to the full measure with the spaces hung outside.
                // The line width joins the slack as the sum of its STYLE
                // ITEMS' advances, each rounded UP onto the 1/64 grid
                // (DOM-measured: a 14+13+10-glyph three-span 15.2px line
                // justifies at share (590.765625 - Σ ceil64(item))/36
                // with zero pixel diff, while both the raw float width
                // and ceil64 of the whole advance leave glyphs one
                // raster phase off; a font-fallback split inside ONE
                // element does not round — the next run continues at the
                // float advance, caret floor64(15.19998) = 15.1875).
                // (key, advance, ceils) per piece: an atomic inline's used
                // width is already a LayoutUnit value and joins the sum
                // as-is — rounding it up moved every following glyph on
                // the noteref-image lines one grid phase right of the
                // browser; only shaped text widths round up.
                let mut item_advances: Vec<(u32, f64, bool)> = Vec::new();
                for item in line.items() {
                    let (key, width, ceils) = match item {
                        PositionedLayoutItem::GlyphRun(glyph_run) => (
                            u32::from_le_bytes(glyph_run.style().brush),
                            f64::from(glyph_run.advance()),
                            true,
                        ),
                        PositionedLayoutItem::InlineBox(inline_box) => (
                            u32::MAX - inline_box.id as u32,
                            f64::from(inline_box.width),
                            false,
                        ),
                    };
                    match item_advances.last_mut() {
                        Some((last, sum, _)) if *last == key => *sum += width,
                        _ => item_advances.push((key, width, ceils)),
                    }
                }
                // Trailing whitespace and the hanging tail sit on the
                // line's last item; they leave before the rounding.
                if let Some((_, sum, _)) = item_advances.last_mut() {
                    *sum -= f64::from(metrics.trailing_whitespace) + hang_uncovered;
                }
                // A line break is a shaping boundary: the browser
                // re-measures the broken line, so a kern pair straddling
                // the break never applies and the line-final cluster
                // keeps its base advance (measured: SourceHan ン+ス
                // carries a -29/1000 kern pair; the paragraph-shaped ン
                // leaked that kern into the line's justified natural
                // width, inflating the slack 0.416px and phasing every
                // share-driven glyph mid-line).
                {
                    use skrifa::MetadataProvider as _;
                    use skrifa::raw::TableProvider as _;
                    let content = flow_text
                        .get(range.clone())
                        .map(str::trim_end)
                        .unwrap_or("");
                    if let Some(last_char) = content.chars().next_back().filter(|last| {
                        // Only the MEASURED domain takes the delta: a
                        // kana or ideograph line end (SourceHan pair
                        // kerns live there). Fullwidth punctuation runs
                        // the trim/hang machinery — the delta
                        // double-counted a trailing 、's compression —
                        // and a latin or fullwidth-symbol line end
                        // (~, letters) moved a credits line off the
                        // truth when the delta was applied wholesale.
                        matches!(u32::from(*last),
                            0x3041..=0x30FF
                            | 0x3400..=0x9FFF
                            | 0xF900..=0xFAFF
                            | 0x20000..=0x2FA1F)
                    }) {
                        let last_byte = range.start + content.len() - last_char.len_utf8();
                        if let Some(cluster) =
                            parley::layout::Cluster::from_byte_index(&layout, last_byte)
                        {
                            let shaped = f64::from(cluster.advance());
                            let run = cluster.run();
                            let font = run.font();
                            if let Ok(font_ref) =
                                skrifa::FontRef::from_index(font.data.as_ref(), font.index)
                            {
                                // Unscaled font units scaled in f64:
                                // skrifa's pre-scaled metrics quantize
                                // the scale factor and return 14.3907
                                // for a 1000-unit glyph at 14.4px — a
                                // phantom -0.0093 delta on every
                                // ideograph line end.
                                let upem = font_ref
                                    .head()
                                    .map(|head| f64::from(head.units_per_em()))
                                    .unwrap_or(1000.0);
                                let upem = if upem > 0.0 { upem } else { 1000.0 };
                                let glyph_metrics = font_ref.glyph_metrics(
                                    skrifa::instance::Size::unscaled(),
                                    skrifa::instance::LocationRef::default(),
                                );
                                let scale = f64::from(run.font_size()) / upem;
                                let base: f64 = cluster
                                    .glyphs()
                                    .map(|glyph| {
                                        glyph_metrics
                                            .advance_width(skrifa::GlyphId::new(u32::from(
                                                glyph.id,
                                            )))
                                            .map(|units| f64::from(units) * scale)
                                            .unwrap_or(f64::from(glyph.advance))
                                    })
                                    .sum();
                                let delta = base - shaped;
                                // Only a REAL pair adjustment: kern
                                // pairs move whole font units (1/128px
                                // and up), while float dust between the
                                // shaper's f32 sum and the metrics read
                                // is ~1e-5 — letting dust through pushed
                                // an ideograph-final line's advance over
                                // the ceil64 margin and dropped its
                                // slack a whole 1/64. Features that
                                // legitimately resize a glyph (halved
                                // ruby punctuation via halt) move half
                                // an em or more and stay shaped.
                                if std::env::var_os("RITO_BRK_DEBUG").is_some() {
                                    eprintln!(
                                        "[brk] last='{last_char}' shaped={shaped:.6} base={base:.6} delta={delta:.6}"
                                    );
                                }
                                if delta.abs() > 1.0 / 128.0
                                    && delta.abs() < f64::from(run.font_size()) * 0.25
                                {
                                    if let Some((_, sum, _)) = item_advances.last_mut() {
                                        *sum += delta;
                                    }
                                }
                            }
                        }
                    }
                }
                let advance: f64 = item_advances
                    .iter()
                    .map(|(_, sum, ceils)| {
                        if *ceils {
                            // The shaper's advances carry a small positive
                            // dust (measured: a 40-glyph 15.2px line whose
                            // exact width is 608 sums to 608.000183, about
                            // +5e-6 per glyph), while the browser's width
                            // for the same line stays at-or-below the
                            // grid; ceiling the raw sum bumped such lines
                            // a whole 1/64 and their smaller share drifted
                            // glyphs across raster half-buckets mid-line.
                            // The margin only changes sums within ~1e-3
                            // ABOVE a grid point — real off-grid widths
                            // sit ≥ 1/128 away and keep their ceil.
                            ((sum - 1.0 / 1024.0) * 64.0).ceil() / 64.0
                        } else {
                            *sum
                        }
                    })
                    .sum();
                line_justify_plan(
                    &flow_text,
                    range,
                    target - advance,
                    &spread_ranges,
                    &atom_positions,
                )
            } else {
                None
            };
            if std::env::var_os("RITO_JUST_DEBUG").is_some() {
                let range = line.text_range();
                let prefix: String = flow_text
                    .get(range.clone())
                    .unwrap_or_default()
                    .chars()
                    .take(8)
                    .collect();
                eprintln!(
                    "[just-debug] '{prefix}' reason={:?} max={} indent={} advance={} trailing={} justified={}",
                    line.break_reason(),
                    line_max_advance(line_top),
                    first_line_indent,
                    metrics.advance,
                    metrics.trailing_whitespace,
                    justify_plan.is_some(),
                );
            }
            // Expansion shares consumed at boundaries before the walk's
            // current position; each share moves everything after it.
            let mut justify_shares_used = 0u32;
            // (item index, truth item start, engine item start) for the
            // LayoutUnit item cursor on justified lines.
            let mut justify_item_track: Option<(usize, f64, f64)> = None;
            // The same LayoutUnit item cursor for UNJUSTIFIED lines at
            // OFF-GRID font sizes: a style-item boundary re-anchors the
            // next item's start at the ceiling of the running float end
            // on the 1/64 grid (Range-measured: adjacent 15.2px spans
            // put the second run at 45.609375 = ceil64(45.6), where the
            // raw float continuation sits at 45.6); interiors keep the
            // float accumulation from the anchored start. Integer sizes
            // stay on the raw floats — their advances already sit on
            // the grid and re-anchoring there moved verified rows.
            let mut natural_item_track: Option<(usize, f64, f64, f64)> = None;
            // Collect the line's content first, remembering each child's
            // baseline shift, so the line box can grow by however far
            // shifted content rises above the strut before positions are
            // finalized (a browser's line box contains its risen content).
            let mut children: Vec<(Fragment, f64)> = Vec::new();
            let mut max_rise = 0.0_f64;
            // Ordinal per flow position for atoms sharing a byte (two
            // adjacent images), so each looks up its own share count.
            let mut atom_ordinals: std::collections::HashMap<usize, usize> =
                std::collections::HashMap::new();
            // The justified x offset of an atomic inline: Parley places
            // the box at its NATURAL advance; the shares consumed before
            // the atom (its left boundary included) shift it right, the
            // same way every glyph's advance carries its expansion —
            // measured on b20's note badge, which painted 5.67px (run1's
            // whole expansion) left of Blink until this ride-along.
            let mut atom_justify = |id: u64| -> f64 {
                let (Some(plan), Some(range)) =
                    (&justify_plan, item_text_ranges.get(id as usize))
                else {
                    return 0.0;
                };
                let ordinal = atom_ordinals.entry(range.start).or_insert(0);
                let shares = plan.atom_shares_at(range.start, *ordinal);
                *ordinal += 1;
                shares.map_or(0.0, |shares| plan.share * f64::from(shares))
            };
            // Every text run on this line, as (inline item, sample
            // character for the font shaping resolved). A run whose
            // characters the declared family cannot serve resolves to a
            // fallback font with its own metrics, and the host must be
            // asked about that font — not about the declared family.
            let mut line_run_samples: Vec<(usize, String)> = Vec::new();
            for item in line.items() {
                match item {
                    PositionedLayoutItem::GlyphRun(glyph_run) => {
                        let shaping_range = glyph_run.run().text_range();
                        let item_index = u32::from_le_bytes(glyph_run.style().brush) as usize;
                        let item_range =
                            item_text_ranges.get(item_index).cloned().ok_or_else(|| {
                                LayoutError::Invalid(format!(
                                    "glyph run brush names item {item_index} outside the flow"
                                ))
                            })?;
                        // A glyph run never crosses a brush (item) boundary,
                        // and one shaping run holds at most one glyph run
                        // per item, so this intersection is the run's exact
                        // byte range.
                        let run_range = shaping_range.start.max(item_range.start)
                            ..shaping_range.end.min(item_range.end);
                        if run_range.start >= run_range.end {
                            return Err(LayoutError::Invalid(format!(
                                "glyph run range {shaping_range:?} does not intersect its \
                                 item's range {item_range:?}"
                            )));
                        }
                        if let Some(style) = style_tables.and_then(|tables| {
                            item_line_heights
                                .get(item_index)
                                .and_then(|entry| entry.as_ref())
                                .and_then(|entry| tables.inline.style(entry.style).ok())
                        }) {
                            // One sample per script inside the run, not just
                            // the run's first character: the host resolves
                            // fallback per character, so a run the engine
                            // shapes with one font can be two fonts there.
                            let mut seen_scripts: Vec<u16> = Vec::new();
                            // An ideographic space is a GLYPH here, not
                            // white space: its resolved (CJK) font sizes
                            // the line in Blink — a "　　1" heading line
                            // measures 23, the CJK strut, not the Latin
                            // digit's 18 (measured on the shinmai article
                            // books, where dropping it shifted every
                            // chapter 4px from the second block on).
                            for character in flow_text
                                .get(run_range.clone())
                                .unwrap_or_default()
                                .chars()
                                .filter(|c| !c.is_whitespace() || *c == '\u{3000}')
                            {
                                let script = char_script(character);
                                if seen_scripts.contains(&script) {
                                    continue;
                                }
                                seen_scripts.push(script);
                                let sample =
                                    self.run_sample(&style, glyph_run.run().font(), character);
                                if !line_run_samples
                                    .iter()
                                    .any(|(index, seen)| *index == item_index && *seen == sample)
                                {
                                    line_run_samples.push((item_index, sample));
                                }
                            }
                        }
                        let shift = shift_for_range(&run_range);
                        max_rise = max_rise.max(shift);
                        let run_x = f64::from(glyph_run.offset()) - parley_line_x;
                        // A run inside a bordered/padded span carries the
                        // box's raster anchor: the browser snaps the
                        // decorated box to its own device row and hangs
                        // the baseline off it (integer primary-font
                        // ascent below the rounded top edge), instead of
                        // the bare-text line-box snap.
                        let run_box_snap = style_tables.and_then(|tables| {
                            let entry = item_line_heights.get(item_index)?.as_ref()?;
                            let resolved = tables.inline.style(entry.style).ok()?;
                            let metric = self.host_normal_line_peek(&resolved, "");
                            item_box_snap(&resolved, metric)
                        });
                        // A ruby spread's interior gap re-applies at paint
                        // as extra letter spacing (like justify spacing,
                        // but kept apart: the annotation extent derives
                        // from it while justify shares never widen the
                        // annotation).
                        let ruby_gap = ruby_spreads.get(&item_index).copied().unwrap_or(0.0);
                        let ruby_overhang =
                            ruby_spread_overhangs.get(&item_index).copied().unwrap_or(0.0);
                        let ruby_overhang_right = ruby_spread_overhangs_right
                            .get(&item_index)
                            .copied()
                            .unwrap_or(ruby_overhang);
                        let opener_halt_trims = &opener_halt_trims;
                        let mut emit = |range: std::ops::Range<usize>,
                                        x: f64,
                                        width: f64,
                                        justify_px: f64| {
                            let opener_trim_px = opener_halt_trims
                                .iter()
                                .find(|(halt, _)| {
                                    halt.start < range.end && range.start < halt.end
                                })
                                .map_or(0.0, |(_, half)| *half);
                            children.push((
                                Fragment::Text(TextFragment {
                                    source: root,
                                    rect: FragmentRect {
                                        x,
                                        y: 0.0,
                                        width,
                                        height: 0.0,
                                    },
                                    text_start: range.start as u32,
                                    text_end: range.end as u32,
                                    justify_px,
                                    ruby_gap_px: ruby_gap,
                                    ruby_overhang_px: ruby_overhang,
                                    ruby_overhang_right_px: ruby_overhang_right,
                                    opener_trim_px,
                                    box_snap: run_box_snap,
                                    ruby_center_shift_px: ruby_center_shifts
                                        .get(&item_index)
                                        .copied()
                                        .unwrap_or(0.0),
                                }),
                                shift,
                            ));
                        };
                        // The advance a box gap parked on this run's last
                        // cluster: shed it so the rect stays ink-sized.
                        let box_shed = if run_range.end == item_range.end {
                            item_box_sheds.get(&item_index).copied().unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        match &justify_plan {
                            None => {
                                // The canvas shapes each fillText call on
                                // its own: its space advances 4.0 where the
                                // pinned face's is 510/2048 (3.984375), and
                                // it skips space-adjacent kern pairs the
                                // browser applies (Tinos `r A` closes
                                // 0.859px) — every word painted after a
                                // space drifts right of the browser's ink.
                                // Splitting the run at space boundaries
                                // re-anchors each word at the shaped
                                // position, and no canvas call crosses a
                                // space. (Justified lines already split
                                // there: a space boundary carries a share.)
                                // Every style-item boundary re-anchors:
                                // the browser holds each ITEM's shaped
                                // width on the LayoutUnit grid (a
                                // truncated 11.99px superscript span
                                // starts its 14px successor at +12.0 =
                                // ceil64 of the span's width), while
                                // inter-item gaps (span margins, inline
                                // boxes) and the chain's own fractional
                                // origin pass through untouched — a
                                // mixed-size title whose items are all
                                // grid-exact keeps its float origin
                                // (position-ceiling it moved a 24px
                                // title word 0.4/64 right of the
                                // browser). The width ceil carries the
                                // shaper-dust margin so an on-grid item
                                // width plus float dust stays a no-op.
                                let run_advance = f64::from(glyph_run.advance());
                                let run_x = match &mut natural_item_track {
                                    slot @ None => {
                                        *slot =
                                            Some((item_index, run_x, run_x, run_advance));
                                        run_x
                                    }
                                    Some((item, truth_start, engine_start, item_width)) => {
                                        if *item != item_index {
                                            let delta = run_x - *engine_start;
                                            let gap = delta - *item_width;
                                            let ceiled = ((*item_width - 1.0 / 1024.0) * 64.0)
                                                .ceil()
                                                / 64.0;
                                            // Only a genuinely off-grid item
                                            // width anchors; a grid width
                                            // plus shaper dust keeps the
                                            // engine's float chain (title
                                            // spans with exact 24px glyphs
                                            // matched the browser bit-for-
                                            // bit before any anchoring).
                                            let width = if ceiled - *item_width > 1.0 / 1024.0 {
                                                ceiled
                                            } else {
                                                *item_width
                                            };
                                            let truth = *truth_start + width + gap;
                                            *item = item_index;
                                            *truth_start = truth;
                                            *engine_start = run_x;
                                            *item_width = run_advance;
                                            truth
                                        } else {
                                            let truth =
                                                *truth_start + (run_x - *engine_start);
                                            *item_width += run_advance;
                                            truth
                                        }
                                    }
                                };
                                let has_space = flow_text
                                    .get(run_range.clone())
                                    .is_some_and(|text| text.contains(' '));
                                // A kern pair inside a CJK run (SourceHan
                                // kana pairs) pulls the following clusters
                                // off the 1/64 grid even at an INTEGER
                                // font size; the browser still floors
                                // every glyph's cumulative onto the grid,
                                // while one whole-run canvas call
                                // accumulates the float advances raw and
                                // the glyphs after the pair raster one
                                // device column away (measured: サダメ at
                                // 16px, pair -0.8, second glyph +1px).
                                // Splitting at the off-grid boundaries
                                // re-anchors each stretch at floor64 of
                                // its shaped position.
                                // Ruby carriers keep their single run:
                                // the annotation gap/center-shift fields
                                // ride ONE fragment, and splitting the
                                // base re-applied them per piece (b20's
                                // name-pun ruby pages grew when the
                                // split first landed unguarded).
                                let run_has_ruby = match &tree.node(root).content {
                                    FormattingNodeContent::InlineFlow { items } => items
                                        .get(item_index)
                                        .is_some_and(|item| {
                                            matches!(
                                                item,
                                                InlineItem::Text {
                                                    ruby_annotation: Some(_),
                                                    ..
                                                }
                                            )
                                        }),
                                    _ => false,
                                };
                                // A shadowed run also keeps one piece:
                                // its glyphs render through the shadow
                                // scratch bitmap, whose fractional-phase
                                // handling is per PIECE — splitting a
                                // decorated line re-phased every
                                // segment's shadow edge (b42's outlined
                                // caption pages grew ~100px each under
                                // the unguarded split).
                                let run_has_shadow = style_tables
                                    .and_then(|tables| {
                                        let item_style =
                                            match &tree.node(root).content {
                                                FormattingNodeContent::InlineFlow {
                                                    items,
                                                } => items.get(item_index).map(|item| {
                                                    match item {
                                                        InlineItem::Text { style, .. }
                                                        | InlineItem::Image { style, .. }
                                                        | InlineItem::InlineBlock {
                                                            style, ..
                                                        } => *style,
                                                    }
                                                }),
                                                _ => None,
                                            }?;
                                        tables.inline.style(item_style).ok()
                                    })
                                    .is_some_and(|resolved| {
                                        !resolved.paint.text_shadows.is_empty()
                                    });
                                let run_letter_spacing = style_tables
                                    .and_then(|tables| {
                                        let item_style =
                                            match &tree.node(root).content {
                                                FormattingNodeContent::InlineFlow {
                                                    items,
                                                } => items.get(item_index).map(|item| {
                                                    match item {
                                                        InlineItem::Text { style, .. }
                                                        | InlineItem::Image { style, .. }
                                                        | InlineItem::InlineBlock {
                                                            style, ..
                                                        } => *style,
                                                    }
                                                }),
                                                _ => None,
                                            }?;
                                        tables.inline.style(item_style).ok()
                                    })
                                    .map_or(0.0_f64, |resolved| {
                                        match resolved.text_flow.letter_spacing {
                                            LengthPercentage::Length(px) => {
                                                f64::from(px.get())
                                            }
                                            _ => 0.0,
                                        }
                                    });
                                // The browser's pen advances on 16.16
                                // fixed-point pixels: scale = round(size *
                                // 65536), px = trunc(units * scale / upem)
                                // / 65536. A 19.2px 1000-unit ideograph
                                // advances 19.199997px, not the raw f32
                                // product 19.200001px — the raw sum
                                // crosses the next 1/64 cell one cluster
                                // early and every glyph after it paints
                                // one device column right of the
                                // browser's (Range-measured on a
                                // pinned-Chromium 19.2px contents line:
                                // cluster 8 lands at 10087/64, the raw
                                // sum floors to 10088/64).
                                let hb_cluster_advance =
                                    |current: &parley::layout::Cluster<'_, _>| -> f64 {
                                        use skrifa::raw::TableProvider as _;
                                        let advance = f64::from(current.advance());
                                        let run = current.run();
                                        let font = run.font();
                                        let Ok(font_ref) = skrifa::FontRef::from_index(
                                            font.data.as_ref(),
                                            font.index,
                                        ) else {
                                            return advance;
                                        };
                                        let Ok(head) = font_ref.head() else {
                                            return advance;
                                        };
                                        let upem = i64::from(head.units_per_em());
                                        let size = f64::from(run.font_size());
                                        if upem <= 0 || size <= 0.0 {
                                            return advance;
                                        }
                                        let scale = (size * 65536.0).round() as i64;
                                        // The author letter-spacing was folded
                                        // into every cluster advance after
                                        // shaping; the browser adds spacing
                                        // OUTSIDE the fixed-point glyph
                                        // advance (a 16px run spaced 1.333px
                                        // steps 16.000000 + 1.333 — round-
                                        // tripping the folded sum through
                                        // font units pulled every spaced
                                        // glyph 0.0053px left per cluster
                                        // across a whole book).
                                        let bare = advance - run_letter_spacing;
                                        let units = (bare * upem as f64 / size).round() as i64;
                                        (units * scale / upem) as f64 / 65536.0 + run_letter_spacing
                                    };
                                let (cjk_kern_splits, cjk_anchor_correction, cjk_hb_total): (
                                    Vec<(usize, f64)>,
                                    f64,
                                    f64,
                                ) = if !has_space
                                    && !run_has_ruby
                                    && !run_has_shadow
                                    && flow_text
                                        .get(run_range.clone())
                                        .is_some_and(|text| {
                                            !text.is_empty()
                                                && text.chars().all(|ch| {
                                                    matches!(u32::from(ch),
                                                        0xB7
                                                        | 0x2E80..=0x9FFF
                                                        | 0xF900..=0xFAFF
                                                        | 0xFF00..=0xFFEF
                                                        | 0x20000..=0x3FFFF)
                                                })
                                        }) {
                                    // The run anchor is parley's raw f32
                                    // cumulative from the line start;
                                    // re-express the prefix in the
                                    // fixed-point domain so the absolute
                                    // positions the splits floor onto
                                    // match the browser's pen (measured
                                    // on a pinned-Chromium contents line:
                                    // a raw anchor 2.9e-5 high tipped the
                                    // next cluster across its 1/64 cell).
                                    // This split path never runs on a
                                    // justified line, so no share joins
                                    // the prefix; inline boxes are not
                                    // clusters and their widths agree in
                                    // both domains.
                                    let mut anchor_correction = 0.0_f64;
                                    let mut prefix = parley::layout::Cluster::from_byte_index(
                                        &layout,
                                        line.text_range().start,
                                    );
                                    while let Some(current) = prefix {
                                        let byte = current.text_range().start;
                                        if byte >= run_range.start {
                                            break;
                                        }
                                        anchor_correction += hb_cluster_advance(&current)
                                            - f64::from(current.advance());
                                        prefix = current.next_logical();
                                    }
                                    let mut splits = Vec::new();
                                    let mut cumulative = 0.0_f64;
                                    let mut cluster = parley::layout::Cluster::from_byte_index(
                                        &layout,
                                        run_range.start,
                                    );
                                    while let Some(current) = cluster {
                                        let byte = current.text_range().start;
                                        if byte >= run_range.end {
                                            break;
                                        }
                                        if byte > run_range.start {
                                            let scaled =
                                                (anchor_correction + cumulative) * 64.0;
                                            if (scaled - scaled.round()).abs() > 1e-3 {
                                                splits.push((byte, cumulative));
                                            }
                                        }
                                        cumulative += hb_cluster_advance(&current);
                                        cluster = current.next_logical();
                                    }
                                    (splits, anchor_correction, cumulative)
                                } else {
                                    (Vec::new(), 0.0, 0.0)
                                };
                                if !has_space && !cjk_kern_splits.is_empty() {
                                    let mut seg_start = run_range.start;
                                    let mut seg_offset = 0.0_f64;
                                    for (byte, cumulative) in cjk_kern_splits
                                        .into_iter()
                                        .chain(std::iter::once((run_range.end, cjk_hb_total)))
                                    {
                                        if byte > seg_start {
                                            emit(
                                                seg_start..byte,
                                                run_x + cjk_anchor_correction + seg_offset,
                                                cumulative - seg_offset
                                                    - if byte == run_range.end {
                                                        box_shed
                                                    } else {
                                                        0.0
                                                    },
                                                0.0,
                                            );
                                            seg_start = byte;
                                            seg_offset = cumulative;
                                        }
                                    }
                                } else if !has_space {
                                    emit(
                                        run_range,
                                        run_x,
                                        f64::from(glyph_run.advance()) - box_shed,
                                        0.0,
                                    );
                                } else {
                                    let mut seg_start = run_range.start;
                                    let mut seg_x = run_x;
                                    let mut natural_x = run_x;
                                    let mut previous_space = false;
                                    let mut cluster =
                                        parley::layout::Cluster::from_byte_index(
                                            &layout,
                                            run_range.start,
                                        );
                                    while let Some(current) = cluster {
                                        let byte = current.text_range().start;
                                        if byte >= run_range.end {
                                            break;
                                        }
                                        if previous_space && byte > seg_start {
                                            emit(
                                                seg_start..byte,
                                                seg_x,
                                                natural_x - seg_x,
                                                0.0,
                                            );
                                            seg_start = byte;
                                            seg_x = natural_x;
                                        }
                                        previous_space = flow_text
                                            .get(byte..current.text_range().end)
                                            == Some(" ");
                                        natural_x += f64::from(current.advance());
                                        cluster = current.next_logical();
                                    }
                                    if seg_start < run_range.end {
                                        emit(
                                            seg_start..run_range.end,
                                            seg_x,
                                            run_x + f64::from(glyph_run.advance())
                                                - seg_x
                                                - box_shed,
                                            0.0,
                                        );
                                    }
                                }
                            }
                            Some(plan) => {
                                // Shares at the boundary against the
                                // previous run shift this whole run; shares
                                // inside it ride the run's letter spacing
                                // while their count stays uniform, and cut
                                // the run into separately placed stretches
                                // where it changes (a deferred double
                                // share, a latin word's zero-share gaps).
                                justify_shares_used += plan.count_at(run_range.start);
                                // A justified run's anchor rides the
                                // fixed-point prefix too: the natural part
                                // of its position is the sum of every
                                // preceding cluster's HB 16.16 advance,
                                // not parley's raw f32 cumulative (a mixed
                                // line's latin page-reference put the
                                // following CJK run 0.0117px right of the
                                // browser's pen while the share plan
                                // matched exactly).
                                let run_x = {
                                    let mut correction = 0.0_f64;
                                    let mut prefix = parley::layout::Cluster::from_byte_index(
                                        &layout,
                                        line.text_range().start,
                                    );
                                    while let Some(current) = prefix {
                                        let byte = current.text_range().start;
                                        if byte >= run_range.start {
                                            break;
                                        }
                                        // A whitespace prefix keeps the raw
                                        // anchor: the space's advance rides
                                        // word-spacing and justification
                                        // machinery outside the glyph
                                        // round-trip (fixing across one
                                        // moved a spaced dialog line a
                                        // fifth of a pixel).
                                        if flow_text
                                            .get(byte..current.text_range().end)
                                            .is_some_and(|t| {
                                                t.chars().any(char::is_whitespace)
                                            })
                                        {
                                            correction = 0.0;
                                            break;
                                        }
                                        correction += hb_fixed_cluster_advance(
                                            &current, 0.0,
                                        )
                                            - f64::from(current.advance());
                                        prefix = current.next_logical();
                                    }
                                    run_x + correction
                                };
                                // The browser holds every inline item's
                                // justified advance on the LayoutUnit
                                // grid: the next style item starts at
                                // ceil64 of the running sum (probed: a
                                // 12px superscript span's 12.5671875
                                // advance starts its successor at
                                // +12.578125). Runs re-anchor on that
                                // cursor so a postil span doesn't leave
                                // the rest of its line a fraction adrift
                                // of the browser's raster ties.
                                let justified_x = run_x
                                    + plan.share * f64::from(justify_shares_used);
                                // Shaper-dust margin like the natural
                                // cursor: an on-grid item end plus float
                                // dust must not bump a whole 1/64.
                                let ceil64 = |value: f64| ((value - 1.0 / 1024.0) * 64.0).ceil() / 64.0;
                                let run_x = run_x
                                    + match &mut justify_item_track {
                                        slot @ None => {
                                            *slot = Some((item_index, justified_x, justified_x));
                                            0.0
                                        }
                                        Some((item, truth_start, engine_start)) => {
                                            if *item != item_index {
                                                let advance = justified_x - *engine_start;
                                                let truth = ceil64(*truth_start + advance);
                                                *item = item_index;
                                                *truth_start = truth;
                                                *engine_start = justified_x;
                                                truth - justified_x
                                            } else {
                                                *truth_start - *engine_start
                                            }
                                        }
                                    };
                                let mut stretch_start = run_range.start;
                                // A CJK character right after a non-CJK one
                                // paints its INK one share right of its
                                // advance position (Blink adds the
                                // deferred "before" share to the glyph
                                // offset too); the stretch starting there
                                // shifts its rect without touching the
                                // advance accounting, so neighbours stay.
                                let mut stretch_x = run_x
                                    + plan.share * f64::from(justify_shares_used)
                                    + if plan.before_share_at(run_range.start) {
                                        plan.share
                                    } else {
                                        0.0
                                    };
                                let mut stretch_natural = 0.0_f64;
                                let mut stretch_shares = 0u32;
                                let mut uniform: Option<u32> = None;
                                let mut natural_x = run_x;
                                let mut cluster = parley::layout::Cluster::from_byte_index(
                                    &layout,
                                    run_range.start,
                                );
                                while let Some(current) = cluster {
                                    let byte = current.text_range().start;
                                    if byte >= run_range.end {
                                        break;
                                    }
                                    if byte > stretch_start {
                                        let count = plan.count_at(byte);
                                        let ink_shift = plan.before_share_at(byte);
                                        // A cut must not land INSIDE a
                                        // joined punctuation sequence
                                        // (dash/ellipsis pairs shape as one
                                        // rule): cut at the sequence's
                                        // entry boundary instead, so the
                                        // whole sequence stays in one
                                        // canvas call and re-forms its
                                        // joined glyphs.
                                        let joined_entry = flow_text
                                            .get(current.text_range())
                                            .and_then(|text| text.chars().next())
                                            .is_some_and(|character| {
                                                joins_with_identical_neighbor(character)
                                                    && flow_text
                                                        .get(
                                                            current.text_range().end
                                                                ..run_range.end,
                                                        )
                                                        .and_then(|text| text.chars().next())
                                                        == Some(character)
                                                    && flow_text
                                                        .get(run_range.start..byte)
                                                        .and_then(|text| {
                                                            text.chars().next_back()
                                                        })
                                                        != Some(character)
                                            });
                                        if !ink_shift
                                            && count <= 1
                                            && uniform.map_or(true, |value| value == count)
                                            && !joined_entry
                                        {
                                            uniform = Some(count);
                                            stretch_shares += count;
                                            justify_shares_used += count;
                                        } else {
                                            emit(
                                                stretch_start..byte,
                                                stretch_x,
                                                stretch_natural
                                                    + plan.share * f64::from(stretch_shares),
                                                plan.share * f64::from(uniform.unwrap_or(0)),
                                            );
                                            justify_shares_used += count;
                                            stretch_start = byte;
                                            stretch_x = natural_x
                                                + plan.share * f64::from(justify_shares_used)
                                                + if ink_shift { plan.share } else { 0.0 };
                                            stretch_natural = 0.0;
                                            stretch_shares = 0;
                                            uniform = None;
                                        }
                                    }
                                    stretch_natural += f64::from(current.advance());
                                    natural_x += f64::from(current.advance());
                                    cluster = current.next_logical();
                                }
                                if stretch_start < run_range.end {
                                    emit(
                                        stretch_start..run_range.end,
                                        stretch_x,
                                        stretch_natural + plan.share * f64::from(stretch_shares)
                                            - box_shed,
                                        plan.share * f64::from(uniform.unwrap_or(0)),
                                    );
                                }
                            }
                        }
                    }
                    PositionedLayoutItem::InlineBox(inline_box) => {
                        // An atomic inline item — an image, or a laid-out
                        // inline-block. Its vertical position is measured
                        // in Parley's ink coordinates, so it maps into the
                        // line box through the ink top.
                        let shift = item_shifts
                            .get(inline_box.id as usize)
                            .copied()
                            .unwrap_or(0.0);
                        max_rise = max_rise.max(shift);
                        if let Some((baseline, mini)) =
                            inline_block_boxes.remove(&inline_box.id)
                        {
                            // Parley rests the box bottom on the text
                            // baseline; an inline-block instead hangs its
                            // LAST line's baseline there (CSS §10.8.1),
                            // so the box drops by its own descent.
                            let height = f64::from(inline_box.height);
                            let justified = atom_justify(inline_box.id);
                            children.push((
                                Fragment::Box(rito_fragment::BoxFragment {
                                    source: mini.source,
                                    rect: FragmentRect {
                                        // A justified atom holds the
                                        // LayoutUnit grid like any inline
                                        // item boundary: its shifted
                                        // position lands on ceil64
                                        // (Range-measured: cum 49.579
                                        // paints the atom at 49.59375).
                                        x: if justify_plan.is_some() {
                                            ((f64::from(inline_box.x) - parley_line_x + justified)
                                                * 64.0)
                                                .ceil()
                                                / 64.0
                                        } else {
                                            f64::from(inline_box.x) - parley_line_x + justified
                                        },
                                        y: f64::from(inline_box.y) - ink_top
                                            + (height - baseline),
                                        width: f64::from(inline_box.width),
                                        height,
                                    },
                                    children: mini.children,
                                }),
                                shift,
                            ));
                        } else {
                            // The atom's advance spans the element's flank
                            // borders; the raster rect sits inside them.
                            let (inset_left, inset_right) = image_edge_insets
                                .get(&inline_box.id)
                                .copied()
                                .unwrap_or((0.0, 0.0));
                            let justified = atom_justify(inline_box.id);
                            // A justified atom holds the LayoutUnit grid
                            // like any inline item boundary: its shifted
                            // position lands on ceil64 (Range-measured:
                            // cum 49.579 paints the atom at 49.59375).
                            let atom_x = f64::from(inline_box.x) - parley_line_x
                                + inset_left
                                + justified;
                            let atom_x = if justify_plan.is_some() {
                                (atom_x * 64.0).ceil() / 64.0
                            } else {
                                atom_x
                            };
                            children.push((
                                Fragment::Image(rito_fragment::ImageFragment {
                                    source: root,
                                    rect: FragmentRect {
                                        x: atom_x,
                                        y: f64::from(inline_box.y) - ink_top,
                                        width: f64::from(inline_box.width)
                                            - inset_left
                                            - inset_right,
                                        height: f64::from(inline_box.height),
                                    },
                                    item_index: inline_box.id as u32,
                                }),
                                shift,
                            ));
                        }
                    }
                }
            }
            // Text-only lines take Parley's line height (the CSS strut).
            // A line holding an atomic inline is sized by the CSS envelope
            // instead: baseline-aligned content ascent plus descent, never
            // smaller than the strut — Parley's own line height inflates
            // beyond what a browser gives such lines. Risen content grows
            // the box above the strut by its overflow.
            // Host-measured normal line height: the line's `normal` runs
            // contribute the host's strut or CJK-lifted metric (chosen by
            // whether the line carries any CJK glyph), declared runs keep
            // their fixed heights, and the line takes the max — the model
            // the reference browser was observed to follow.
            let line_text_range = children
                .iter()
                .filter_map(|(fragment, _)| match fragment {
                    Fragment::Text(text) => {
                        Some((text.text_start as usize, text.text_end as usize))
                    }
                    _ => None,
                })
                .fold(None::<(usize, usize)>, |acc, (start, end)| {
                    Some(match acc {
                        Some((lo, hi)) => (lo.min(start), hi.max(end)),
                        None => (start, end),
                    })
                })
                // An empty line (a lone forced break) has no text
                // fragments, but the break that ends it still sizes its
                // box (measured on b39 id210: the 16px <br><br> empty
                // line is 20.2031, not the bare 19.2031 strut) — fall
                // back to the layout line's own byte range so the
                // break-item predicate below can find it.
                .or_else(|| {
                    let range = line.text_range();
                    Some((range.start, range.end))
                });
            // Host font metrics for this line: the content height
            // (ascent + descent) and ascent the host's scaler grid-fits
            // for the line's dominant style, in the script case the line
            // falls into. Both `normal` and declared line-heights derive
            // from this pair, exactly as CSS computes leading.
            // The line's dominant style (largest font) and the tallest
            // declared line-height among the runs on it.
            let mut line_declared_height: Option<f64> = None;
            // Items on this line: text runs by byte range, atomic inlines
            // by item index. Either can carry the style whose host metrics
            // size the line.
            let line_image_items: Vec<usize> = children
                .iter()
                .filter_map(|(fragment, _)| match fragment {
                    Fragment::Image(image) => Some(image.item_index as usize),
                    _ => None,
                })
                .collect();
            // The line box, built the way CSS builds one: every inline box
            // on the line contributes its own font's metrics, every text
            // run contributes the metrics of the font shaping resolved for
            // it, and the line takes the greatest ascent and the greatest
            // descent among them. `None` means at least one contributor is
            // still unmeasured — the host is asked, and the shaped
            // fallback covers this pass.
            let mut contributors: Vec<(rito_style_contract::StyleId, &str)> = Vec::new();
            for (index, range) in item_text_ranges.iter().enumerate() {
                // The ending forced break contributes too (see the
                // entries loop below): a <br>'s style sizes the line it
                // ends even though Parley's line range stops before it.
                let on_line = line_image_items.contains(&index)
                    || line_text_range.is_some_and(|(start, end)| {
                        (range.start < end && start < range.end)
                            || (range.start <= end
                                && end < range.end
                                && flow_text
                                    .get(end..)
                                    .is_some_and(|rest| rest.starts_with('\n')))
                    });
                if !on_line {
                    continue;
                }
                let Some(Some(item)) = item_line_heights.get(index) else {
                    continue;
                };
                if let Some(declared) = item.declared {
                    line_declared_height =
                        Some(line_declared_height.map_or(declared, |best: f64| best.max(declared)));
                    continue;
                }
                // The inline box's own strut, then each of its runs' fonts.
                contributors.push((item.style, ""));
                for (run_item, sample) in &line_run_samples {
                    if *run_item == index {
                        contributors.push((item.style, sample.as_str()));
                    }
                }
            }
            let host_line = if contributors.is_empty() {
                None
            } else {
                let mut ascent = 0.0_f64;
                let mut descent = 0.0_f64;
                let mut complete = true;
                for (style_id, sample) in contributors {
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(style_id).ok())
                    else {
                        complete = false;
                        continue;
                    };
                    match self.host_normal_line(resolved, sample) {
                        Some(metric) => {
                            ascent = ascent.max(metric.ascent());
                            descent = descent.max(metric.descent());
                        }
                        None => complete = false,
                    }
                }
                (complete && ascent + descent > 0.0).then_some((ascent + descent, ascent))
            };
            // CSS 2.1 §10.8 for a line holding an atomic inline: every
            // inline-level contributor sets its own (above, below) around
            // the shared baseline — a text run its half-leaded strut
            // (floored half-leading over its declared-or-normal line
            // height, shifted by its vertical-align), an atomic inline its
            // box over the baseline plus its raise — and the line box is
            // max(above) + max(below), baseline at max(above). Measured on
            // the footnote-marker idiom (16px/19.2px text, a 14.4px sup
            // image raised 6.33): Chromium sizes the line img-above 20.72
            // + strut-below 3.2 = 23.92, not the normal-metric envelope.
            // A flattened empty inline (a <sup> holding only the image)
            // loses its own strut here; the atomic box dominates it in
            // every corpus shape measured. Any unmeasured host metric
            // falls back to the envelope path below, keeping the
            // measure → inject → reflow loop converging.
            let tree_items: &[InlineItem] = match &tree.node(root).content {
                FormattingNodeContent::InlineFlow { items } => items,
                _ => &[],
            };
            let contributions = if has_inline_box || line_declared_height.is_some() {
                let mut complete = true;
                // (resolved style, sample, shift) per text-strut
                // contributor: the container's strut, then every on-line
                // text item's declared-family strut plus each font its
                // runs actually resolved to — the latter only under
                // `line-height: normal`, where the browser lets the
                // fallback font grow the line. Under a fixed line-height
                // the browser sizes and places the line from the strut
                // font alone (measured: 19.2px over Tinos+SourceHan puts
                // the baseline at 15 for empty, Latin and CJK samples
                // alike).
                let mut entries: Vec<(&InlineFormattingStyleV1, &str, f64, bool)> = Vec::new();
                let mut strut_resolved: Option<&InlineFormattingStyleV1> = None;
                match tree.strut_style(root).or_else(|| {
                    item_line_heights
                        .iter()
                        .flatten()
                        .next()
                        .map(|item| item.style)
                }) {
                    Some(strut_style_id) => match style_tables
                        .and_then(|tables| tables.inline.style(strut_style_id).ok())
                    {
                        Some(resolved) => {
                            strut_resolved = Some(resolved);
                            entries.push((resolved, "", 0.0, false));
                        }
                        None => {
                            complete = false;
                            if line_debug {
                                debug_misses.push("strut style resolve".to_owned());
                            }
                        }
                    },
                    None => {
                        complete = false;
                        if line_debug {
                            debug_misses.push("no strut style".to_owned());
                        }
                    }
                }
                // A super/sub-shifted span's line envelope is MEASURED, not
                // derived: Blink quantizes the shifted box's above-baseline
                // contribution onto whole pixels through interplay no font
                // table exposes (a 64-configuration oracle matrix refused
                // every closed form; the raise itself IS floor64(S/3)+1,
                // identical to ours — only the envelope term diverges, +2
                // on b74's 0.8em bold ① marker). The U+E00C/U+E00D probes
                // measure the exact paragraph idiom — strut font and
                // line-height with the span raised inside — so the metric's
                // baseline/height ARE the line's (above, below) with the
                // raise already embedded.
                let sup_samples: Vec<(usize, String)> = strut_resolved
                    .map(|strut| {
                        let strut_size = f64::from(strut.font.size.get());
                        item_shifts
                            .iter()
                            .enumerate()
                            .filter(|(_, shift)| **shift != 0.0)
                            .filter_map(|(index, shift)| {
                                let item = item_line_heights.get(index)?.as_ref()?;
                                let resolved =
                                    style_tables?.inline.style(item.style).ok()?;
                                // A span that DECLARES its own line-height
                                // keeps the fixed-box path (measured exact on
                                // b1's .postil-b1, line-height 1.2); the probe
                                // models only the inherited-line-height idiom.
                                if resolved.font.line_height_is_declared {
                                    return None;
                                }
                                let ratio =
                                    f64::from(resolved.font.size.get()) / strut_size;
                                let sentinel = if *shift > 0.0 {
                                    '\u{E00C}'
                                } else {
                                    '\u{E00D}'
                                };
                                let line_height = used_declared_line_height(
                                    strut.font.line_height,
                                    strut_size,
                                )
                                .map_or_else(|| "n".to_owned(), |px| format!("{px}"));
                                Some((index, format!("{sentinel}{ratio:.4}:{line_height}")))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                for (index, range) in item_text_ranges.iter().enumerate() {
                    // A forced break belongs to the line it ENDS: Parley's
                    // line range stops before the newline, but the <br>'s
                    // own style still sizes that line's box in Blink
                    // (measured on b39 id210: a 16px span's leading <br>
                    // after a 12px line grows the box 20.2031 → 21.2031,
                    // and the EMPTY line its second <br> forms is 20.2031
                    // tall, not the bare strut) — so an item also joins
                    // when it holds the newline sitting at the line's end.
                    let on_line = line_text_range.is_some_and(|(start, end)| {
                        (range.start < end && start < range.end)
                            || (range.start <= end
                                && end < range.end
                                && flow_text.get(end..).is_some_and(|rest| {
                                    rest.starts_with('\n')
                                }))
                    });
                    if !on_line || range.is_empty() {
                        continue;
                    }
                    let Some(Some(item)) = item_line_heights.get(index) else {
                        continue;
                    };
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(item.style).ok())
                    else {
                        complete = false;
                        if line_debug {
                            debug_misses.push(format!("item {index} style resolve"));
                        }
                        continue;
                    };
                    let shift = item_shifts.get(index).copied().unwrap_or(0.0);
                    if shift != 0.0 {
                        if let Some((strut, key)) = strut_resolved.zip(
                            sup_samples
                                .iter()
                                .find(|(sample_index, _)| *sample_index == index)
                                .map(|(_, key)| key.as_str()),
                        ) {
                            entries.push((strut, key, 0.0, false));
                            if self.host_normal_line_peek(strut, key).is_some() {
                                // The measured envelope replaces the computed
                                // fallback entirely — the fallback's normal-line
                                // ascent overshoots Blink's quantized term.
                                continue;
                            }
                        }
                    }
                    entries.push((resolved, "", shift, false));
                    // Run-font samples join the entries under `normal`
                    // line-height, and for SHIFTED items too: a raised
                    // marker contributes the envelope of the font its
                    // glyphs actually resolved to (a CJK circled digit
                    // the Latin pin cannot serve rides the CJK face's
                    // taller ascent). Shifted samples are OPTIONAL —
                    // until the host measures the new key the strut
                    // entry stands, instead of the whole line falling
                    // back to the shaped envelope.
                    // A span that DECLARES its own line-height keeps a
                    // content-independent fixed box even when shifted
                    // (measured: CJK and Latin superscripts in a
                    // declared-1.2 span size identically); only an
                    // INHERITED line-height defers to the run font.
                    let optional_sample = shift != 0.0 && !resolved.font.line_height_is_declared;
                    if matches!(resolved.font.line_height, LineHeight::Normal) || optional_sample {
                        for (run_item, sample) in &line_run_samples {
                            if *run_item == index {
                                entries.push((resolved, sample.as_str(), shift, optional_sample));
                            }
                        }
                    }
                }
                // Max over contributors, allowing NEGATIVE halves: a
                // declared line-height smaller than the strut's grid
                // envelope puts the baseline BELOW the line box bottom
                // (h1 at an inherited 19.2px: Blink's box is 19.203125
                // tall with the baseline 20 down — below is −0.797).
                // Starting the accumulators at 0.0 silently clamped that
                // to 0 and grew the line by a pixel, shifting everything
                // under the heading (measured on the cover colophon).
                let mut above = f64::NEG_INFINITY;
                let mut below = f64::NEG_INFINITY;
                for (resolved, sample, shift, optional) in entries {
                    let Some(metric) = self.host_normal_line(resolved, sample) else {
                        if optional {
                            continue;
                        }
                        complete = false;
                        if line_debug {
                            debug_misses.push(format!(
                                "entry metric {}@{}\"{}\"",
                                host_family_key(resolved),
                                resolved.font.size.get(),
                                sample
                            ));
                        }
                        continue;
                    };
                    let (asc, desc) = (metric.ascent(), metric.descent());
                    // A super/sub-shifted inline box contributes its
                    // FONT's normal envelope around its raised baseline,
                    // not its line-height box: a 12px superscript inside
                    // a 20.8px fixed-height paragraph grows the line to
                    // normal-ascent 14 + raise, where the fixed-height
                    // model overshot by two rows (measured; totals agreed
                    // and only the baseline moved).
                    let (item_above, item_below) = if sample.starts_with('\u{E00C}')
                        || sample.starts_with('\u{E00D}')
                    {
                        // Host-measured super/sub line envelope: the probe's
                        // baseline/height are the line's above/below with the
                        // raise already embedded (shift is 0 on this entry).
                        (asc, desc)
                    } else if shift != 0.0
                        && !resolved.font.line_height_is_declared
                    {
                        (asc, desc)
                    } else {
                        match used_declared_line_height(
                            resolved.font.line_height,
                            f64::from(resolved.font.size.get()),
                        ) {
                            None => (asc, desc),
                            Some(height) => {
                                let a = metric.fixed_baseline(height);
                                (a, height - a)
                            }
                        }
                    };
                    above = above.max(item_above + shift);
                    below = below.max(item_below - shift);
                }
                // Every atomic inline: its box above the baseline plus its
                // raise; a sub-shifted box hangs below by its drop. The
                // atom's INHERITED strut contributes too — CSS 2.1 §10.8
                // gives every enclosing inline box its leading, and the
                // atom's inherited style carries exactly that box's font
                // (measured: a footnote marker image alone inside a
                // 12px <sup> still grows the line by the sup strut raised
                // with it, 0.6px above what the image box alone gives).
                let mut top_aligned_heights: Vec<f64> = Vec::new();
                for (fragment, shift) in &children {
                    if let Fragment::Image(image) = fragment {
                        let align_top = tree_items
                            .get(image.item_index as usize)
                            .is_some_and(|item| {
                                matches!(item, InlineItem::Image { align_top: true, .. })
                            });
                        if align_top {
                            // A top-aligned box sits outside the baseline
                            // envelope; it only grows the line DOWNWARD
                            // when taller than it (handled after the max).
                            top_aligned_heights.push(image.rect.height);
                        } else {
                            above = above.max(image.rect.height + shift);
                            below = below.max(-shift);
                        }
                        let item = tree_items
                            .get(image.item_index as usize)
                            .and_then(|item| match item {
                                InlineItem::Image { style, .. } => Some(*style),
                                _ => None,
                            });
                        let resolved = item.and_then(|style_id| {
                            style_tables.and_then(|tables| tables.inline.style(style_id).ok())
                        });
                        let Some(resolved) = resolved else {
                            if line_debug {
                                debug_misses.push("atom style resolve".to_owned());
                            }
                            continue;
                        };
                        let Some(metric) = self.host_normal_line(resolved, "") else {
                            complete = false;
                            if line_debug {
                                debug_misses.push(format!(
                                    "atom metric {}@{}",
                                    host_family_key(resolved),
                                    resolved.font.size.get()
                                ));
                            }
                            continue;
                        };
                        let (asc, desc) = (metric.ascent(), metric.descent());
                        let (item_above, item_below) = match used_declared_line_height(
                            resolved.font.line_height,
                            f64::from(resolved.font.size.get()),
                        ) {
                            None => (asc, desc),
                            Some(height) => {
                                let a = metric.fixed_baseline(height);
                                (a, height - a)
                            }
                        };
                        above = above.max(item_above + shift);
                        below = below.max(item_below - shift);
                    }
                }
                // An inline-block atom: its box straddles the baseline —
                // its LAST line's baseline rests on the shared one, so it
                // contributes (baseline, height − baseline) around it,
                // plus its inherited strut like any enclosing inline box.
                for (fragment, shift) in &children {
                    let Fragment::Box(atom) = fragment else {
                        continue;
                    };
                    let baseline = inline_block_baselines
                        .get(&atom.source.0)
                        .copied()
                        .unwrap_or(atom.rect.height);
                    above = above.max(baseline + shift);
                    below = below.max((atom.rect.height - baseline) - shift);
                    let item_style = tree_items.iter().find_map(|item| match item {
                        InlineItem::InlineBlock { node, style, .. } if node.0 == atom.source.0 => {
                            Some(*style)
                        }
                        _ => None,
                    });
                    let resolved = item_style.and_then(|style_id| {
                        style_tables.and_then(|tables| tables.inline.style(style_id).ok())
                    });
                    let Some(resolved) = resolved else {
                        continue;
                    };
                    let Some(metric) = self.host_normal_line(resolved, "") else {
                        complete = false;
                        continue;
                    };
                    let (asc, desc) = (metric.ascent(), metric.descent());
                    let (item_above, item_below) = match used_declared_line_height(
                        resolved.font.line_height,
                        f64::from(resolved.font.size.get()),
                    ) {
                        None => (asc, desc),
                        Some(height) => {
                            let a = metric.fixed_baseline(height);
                            (a, height - a)
                        }
                    };
                    above = above.max(item_above + shift);
                    below = below.max(item_below - shift);
                }
                // A `vertical-align: top` box hangs from the line-box top
                // and grows the line DOWNWARD only when taller than the
                // baseline envelope (the badge stays inside the sup-strut
                // envelope; a tall top-aligned plate would extend below).
                for top_height in &top_aligned_heights {
                    let line_height = above + below;
                    if *top_height > line_height {
                        below += top_height - line_height;
                    }
                }
                (complete && above + below > 0.0).then_some((above, below))
            } else {
                None
            };
            // CSS 2.1 §10.8: the paragraph's `normal` strut is one more
            // contributor around the shared baseline — its host ascent
            // above, its host descent below — and the line box takes
            // max(above) + max(below) with the baseline at max(above).
            // Centering the content envelope inside the strut height
            // instead sank sub-sized runs' baselines: a 16px paragraph of
            // 0.75em spans paints baselines at the strut's 14, not the
            // centered 12 (measured on the calibre colophon idiom, where
            // every publisher line sat two rows high of the browser). A
            // DECLARED line-height keeps the centering model — the
            // browser sizes and places fixed lines from the strut box
            // (committed rule) — so the envelope only covers `normal`.
            let strut_envelope: Option<(f64, f64)> = tree
                .strut_style(root)
                .or_else(|| {
                    item_line_heights
                        .iter()
                        .flatten()
                        .next()
                        .map(|item| item.style)
                })
                .and_then(|id| style_tables.and_then(|tables| tables.inline.style(id).ok()))
                .filter(|resolved| matches!(resolved.font.line_height, LineHeight::Normal))
                .and_then(|resolved| self.host_normal_line(resolved, ""))
                .map(|metric| (metric.ascent(), metric.descent()));
            let base_height = if let Some((above, below)) = contributions {
                above + below
            } else if has_inline_box {
                // An atomic inline sits on the baseline, so the line still
                // reserves the strut's space below it — a browser's line
                // box around an image is the image plus that descent, not
                // the image alone. Above the baseline the taller of the
                // two wins.
                let (above, below) = match host_line {
                    Some((content_height, ascent)) => (ascent, content_height - ascent),
                    None => (0.0, 0.0),
                };
                let envelope = f64::from(metrics.ascent).max(above)
                    + f64::from(metrics.descent).max(below);
                envelope.max(strut_height.unwrap_or(0.0))
            } else if let Some(declared) = line_declared_height {
                declared.max(strut_height.unwrap_or(0.0))
            } else if let Some((host, host_ascent)) = host_line {
                match strut_envelope {
                    Some((strut_ascent, strut_descent)) => {
                        host_ascent.max(strut_ascent) + (host - host_ascent).max(strut_descent)
                    }
                    None => host.max(strut_height.unwrap_or(0.0)),
                }
            } else if children.is_empty() {
                // An empty line (a forced break with no content) is sized
                // by the strut alone; the shaped fallback metric only
                // covers flows whose strut could not resolve.
                strut_height.unwrap_or(f64::from(metrics.line_height))
            } else {
                // Every line box includes the strut: the container's own
                // line-height floors lines whose runs declare less.
                f64::from(metrics.line_height).max(strut_height.unwrap_or(0.0))
            };
            // A contributions-sized line already contains every raise
            // inside its (above, below); adding max_rise on top of it
            // again is exactly the overshoot the model replaced.
            let line_height = if contributions.is_some() {
                base_height
            } else {
                base_height + max_rise
            };
            running_top += line_height;
            // The host's measured baseline wins whenever its metric sized
            // the line: where the baseline sits inside a `normal` line is
            // grid-fitted by the host's scaler, not derivable from the
            // shaped ascent. Shaped half-leading covers every other line.
            // CSS leading, over host-fitted metrics: half the difference
            // between the line box and the content area sits above the
            // baseline. The host floors that half-leading (its scaler
            // works in whole pixels), which is what places glyphs on the
            // same rows the reference browser uses.
            let baseline = if let Some((above, _)) = contributions {
                above
            } else if has_inline_box {
                // The envelope of an atomic-inline line is already exactly
                // ascent + descent, so its baseline sits at that ascent —
                // there is no leading to redistribute around it.
                max_rise + f64::from(metrics.ascent).max(host_line.map_or(0.0, |(_, a)| a))
            } else {
                match host_line {
                Some((content_height, ascent)) => match strut_envelope {
                    Some((strut_ascent, _)) => max_rise + ascent.max(strut_ascent),
                    None => max_rise + ((base_height - content_height) / 2.0).floor() + ascent,
                },
                None => {
                    let half_leading = (base_height
                        - f64::from(metrics.ascent)
                        - f64::from(metrics.descent))
                        / 2.0;
                    max_rise + half_leading + f64::from(metrics.ascent)
                }
                }
            };
            // Ruby annotations grow the line. Measured to exactness (24/24
            // configurations: two fonts x three line-heights x two sizes x
            // first/subsequent lines): the browser places the annotation's
            // BASELINE one pixel above the base font's typographic-ascent
            // edge, so the line's baseline must sit at least
            //   annotation grid ascent + 1 + floor(sTypoAscender x size)
            // below the line top. A later line may also spend the gap the
            // PREVIOUS line leaves under its own typographic-descent edge
            // (its below-baseline extent minus ceil(sTypoDescender x
            // size)). Whatever the baseline still lacks becomes growth.
            let base_typo =
                |range: &std::ops::Range<usize>, fs: f64| -> Option<(f64, f64, (u64, u32))> {
                    use skrifa::raw::TableProvider as _;
                    for item in line.items() {
                        let PositionedLayoutItem::GlyphRun(glyph_run) = item else {
                            continue;
                        };
                        let run = glyph_run.run();
                        let shaped = run.text_range();
                        if shaped.start >= range.end || range.start >= shaped.end {
                            continue;
                        }
                        let font = run.font();
                        let font_key = (font.data.id(), font.index);
                        let font_ref =
                            skrifa::FontRef::from_index(font.data.as_ref(), font.index).ok()?;
                        let os2 = font_ref.os2().ok()?;
                        let upem = f64::from(font_ref.head().ok()?.units_per_em());
                        let asc = f64::from(os2.s_typo_ascender()) / upem * fs;
                        let desc = f64::from(-i32::from(os2.s_typo_descender())) / upem * fs;
                        return Some((asc, desc, font_key));
                    }
                    None
                };
            // A vertical-rl flow's annotation shares NO half-leading with
            // its base the way a horizontal line's does: the annotation
            // column needs its own width beyond the base's half-leading
            // (measured matrix, 4 line-heights x 3 font sizes x 2 rt
            // ratios x 3 annotation lengths: growth = rt size minus the
            // half-leading, floored at zero, independent of annotation
            // length, the whole growth landing on the line's right).
            let vertical_flow = tree
                .styles()
                .and_then(|tables| {
                    let strut = tree.strut_style(root)?;
                    tables.inline.style(strut).ok()
                })
                .is_some_and(|strut| {
                    strut.bidi.writing_mode
                        == rito_style_contract::WritingMode::VerticalRightToLeft
                });
            let ruby_growth = if vertical_flow {
                let mut growth = 0.0_f64;
                for (index, range) in item_text_ranges.iter().enumerate() {
                    let on_line = line_text_range
                        .is_some_and(|(start, end)| range.start < end && start < range.end);
                    if !on_line || range.is_empty() {
                        continue;
                    }
                    let Some(InlineItem::Text {
                        ruby_annotation: Some(annotation),
                        style,
                        ..
                    }) = tree_items.get(index)
                    else {
                        continue;
                    };
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(*style).ok())
                    else {
                        continue;
                    };
                    let fs = f64::from(resolved.font.size.get());
                    let annotation_size = fs * f64::from(annotation.size_ratio);
                    // The annotation column asks for its font size plus a
                    // half pixel under the pinned CJK serif (matrix:
                    // rt 6/8/10/14 across four line-heights and three
                    // base sizes all measure need = rt + 0.5).
                    growth =
                        growth.max((annotation_size + 0.5 - (line_height - fs) / 2.0).max(0.0));
                }
                growth
            } else {
                let mut growth = 0.0_f64;
                for (index, range) in item_text_ranges.iter().enumerate() {
                    let on_line = line_text_range
                        .is_some_and(|(start, end)| range.start < end && start < range.end);
                    if !on_line || range.is_empty() {
                        continue;
                    }
                    let Some(InlineItem::Text {
                        ruby_annotation: Some(annotation),
                        style,
                        ..
                    }) = tree_items.get(index)
                    else {
                        continue;
                    };
                    // A split base grows only the lines whose segment is
                    // allocated annotation words (character-midpoint
                    // rule): 正|规勇者 under "Legal Brave" grows both
                    // lines, 黄金妖|精 under Leprechaun grows only the
                    // first.
                    if let Some((line_start, line_end)) = line_text_range {
                        let seg_start = range.start.max(line_start);
                        let seg_end = range.end.min(line_end);
                        let total_chars = flow_text
                            .get(range.clone())
                            .map_or(0.0, |base| base.chars().count() as f64);
                        if total_chars > 0.0 && (seg_start > range.start || seg_end < range.end) {
                            let before = flow_text
                                .get(range.start..seg_start)
                                .map_or(0.0, |prefix| prefix.chars().count() as f64);
                            let through = flow_text
                                .get(range.start..seg_end)
                                .map_or(0.0, |prefix| prefix.chars().count() as f64);
                            let allocated = rito_fragment::allocate_ruby_annotation(
                                &annotation.text,
                                before / total_chars,
                                if seg_end >= range.end {
                                    f64::INFINITY
                                } else {
                                    through / total_chars
                                },
                            );
                            if allocated.is_empty() {
                                continue;
                            }
                        }
                    }
                    let Some(resolved) =
                        style_tables.and_then(|tables| tables.inline.style(*style).ok())
                    else {
                        continue;
                    };
                    let fs = f64::from(resolved.font.size.get());
                    let ratio = f64::from(annotation.size_ratio);
                    // The browser's ruby geometry is measured, not derived:
                    // the U+E000 host probe is a one-line ruby whose
                    // baseline IS the minimum baseline the annotation
                    // demands (verified invariant: independent of
                    // line-height, 32/32 configurations), and the U+E001
                    // two-line probe exposes how much of the previous
                    // line's under-edge the annotation may reuse. Font
                    // tables cannot substitute: three fonts yielded three
                    // inconsistent hhea/OS-2 decompositions.
                    // The probe key carries the annotation's size ratio so
                    // the host measures the ruby with the rt size the
                    // cascade actually produced — and the probe's CONTENT
                    // mirrors two font bits the geometry depends on
                    // (measured matrix, fs16/rt50%: each shifts growth by
                    // one pixel, additively): the annotation's script
                    // picks the rt face, and the PREVIOUS line's font
                    // composition (any non-CJK glyph, a space included)
                    // shrinks its reusable under-edge.
                    let (typo_asc, typo_desc, base_font) = base_typo(range, fs)
                        .map_or((fs * 0.88, fs * 0.12, None), |(asc, desc, font)| {
                            (asc, desc, Some(font))
                        });
                    let is_cjk = |ch: char| {
                        matches!(u32::from(ch), 0x2E80..=0x9FFF | 0xF900..=0xFAFF
                            | 0xFF00..=0xFFEF | 0x20000..=0x3FFFF)
                    };
                    let anno_cjk =
                        !annotation.text.is_empty() && annotation.text.chars().all(is_cjk);
                    // The BASE's script picks the probed base face too: a
                    // pure-latin base resolves the latin pin, whose
                    // annotation stack sits one pixel lower than the CJK
                    // face's (measured on the b96 long-base ruby: Blink's
                    // latin-base paragraph is 26px where a CJK base gets
                    // 27). E006-E00B mirror E000-E005 with a latin rb.
                    let base_latin = flow_text
                        .get(range.clone())
                        .is_some_and(|base| !base.chars().any(is_cjk));
                    let prev_mixed = !prev_line_fonts.is_empty()
                        && base_font.is_some_and(|base| {
                            prev_line_fonts.iter().any(|key| *key != base)
                        });
                    let one_sentinel = match (base_latin, anno_cjk) {
                        (false, false) => '\u{E000}',
                        (false, true) => '\u{E002}',
                        (true, false) => '\u{E006}',
                        (true, true) => '\u{E007}',
                    };
                    let two_sentinel = match (base_latin, anno_cjk, prev_mixed) {
                        (false, false, false) => '\u{E001}',
                        (false, true, false) => '\u{E003}',
                        (false, false, true) => '\u{E004}',
                        (false, true, true) => '\u{E005}',
                        (true, false, false) => '\u{E008}',
                        (true, true, false) => '\u{E009}',
                        (true, false, true) => '\u{E00A}',
                        (true, true, true) => '\u{E00B}',
                    };
                    // The probe's rt carries the annotation's ACTUAL text:
                    // the annotation stack height depends on which face
                    // the family list resolves for those characters, and
                    // a script-class sample can land on a different face
                    // (measured on b9's FZBWKS: the Han-only book face
                    // covers the real 破坏神 annotation but not the あ
                    // class sample, whose SourceHan fallback stack sits
                    // one pixel taller — every ruby opener overgrew by
                    // that pixel and shifted the rest of the page).
                    let one_key = format!("{one_sentinel}{ratio:.4}:{}", annotation.text);
                    let two_key = format!("{two_sentinel}{ratio:.4}:{}", annotation.text);
                    let ruby_one = self.host_normal_line_sized(resolved, fs, &one_key);
                    let ruby_two = self.host_normal_line_sized(resolved, fs, &two_key);
                    // The reuse derivation subtracts the two-line probe's
                    // FIRST-line baseline, and that line is the probe's own
                    // CJK text — so the term must be the CJK-sample metric,
                    // not the empty-sample strut (a Latin-first family made
                    // them differ by four pixels and the derived allowance
                    // swallowed the whole reuse).
                    let plain = self.host_normal_line_sized(resolved, fs, "\u{4E2D}");
                    let annotation_ascent = self
                        .host_normal_line_sized(resolved, fs * ratio, "")
                        .map_or(fs * ratio, |metric| metric.ascent());
                    let required = ruby_one.map_or_else(
                        // Fallback until the host answers: the table law
                        // (exact for Source Han and FZBWKS, one px off for
                        // fonts whose tables disagree with the scaler).
                        || typo_asc.floor() + annotation_ascent + (typo_desc * 0.5).round(),
                        |metric| metric.ascent(),
                    );
                    let reuse = match (plain, ruby_one, ruby_two) {
                        (Some(plain), Some(one), Some(two)) => {
                            // below-edge allowance = below extent minus the
                            // measured second-line reduction.
                            (two.height - one.height - plain.ascent()).max(0.0)
                        }
                        _ => typo_desc.round(),
                    };
                    let prev_gap =
                        prev_ruby_below.map_or(0.0, |below| (below - reuse).max(0.0));
                    growth = growth.max((required - baseline - prev_gap).max(0.0));
                }
                // The browser pushes a growing FIRST line down
                // by a WHOLE pixel count — ceil of the baseline deficit —
                // while an interior line's growth keeps its analytic
                // value. Measured (pins verified, four line-heights at
                // fs 15.2 / rt 0.7 latin): opener pushes 10/9/8/6 at lh
                // 19.765625/22/24/28.109375 == ceil(25 − natural baseline)
                // 4/4, while the lh-19.765625 INTERIOR line measures
                // 7.234375 exactly — un-ceiled (the only fractional
                // interior case in the matrix). b20's un-ceiled openers
                // sat 0.55px high and binned to −1 rows on half the
                // dialog lines.
                if prev_ruby_below.is_none() {
                    // The paragraph's own padding-top absorbs a FIRST
                    // line's annotation growth: the annotation overflows
                    // upward into the padding and the line keeps its
                    // natural height (padding oracle: an 8px pad absorbs
                    // the whole 6px growth, a 4px pad absorbs 4; b52's
                    // contents rows sat 8px low when the growth ignored
                    // their 0.9em padding). Percentages have no basis
                    // here and absorb nothing.
                    let padding_absorb = tree
                        .styles()
                        .and_then(|tables| {
                            tables.layout.style(tree.node(root).style).ok()
                        })
                        .map_or(0.0, |style| match style.padding.top.value() {
                            rito_style_contract::LengthPercentage::Length(px) => {
                                f64::from(px.get())
                            }
                            _ => 0.0,
                        });
                    (growth - padding_absorb).max(0.0).ceil()
                } else {
                    growth
                }
            };
            let line_height = line_height + ruby_growth;
            let baseline = baseline + ruby_growth;
            running_top += ruby_growth;
            prev_ruby_below = Some((line_height - baseline).max(0.0));
            prev_line_fonts.clear();
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(glyph_run) = item {
                    let font = glyph_run.run().font();
                    let key = (font.data.id(), font.index);
                    if !prev_line_fonts.contains(&key) {
                        prev_line_fonts.push(key);
                    }
                }
            }
            if line_debug
                && (has_inline_box || item_shifts.iter().any(|shift| *shift != 0.0))
            {
                eprintln!(
                    "[line-debug] contributions={contributions:?} host_line={host_line:?} \
                     baseline={baseline} height={line_height} max_rise={max_rise} \
                     misses={debug_misses:?}"
                );
            }
            // A spread base's per-range letter spacing splits its glyph
            // run at the last cluster (the one cluster without a gap).
            // Painted apart, each piece would repeat the annotation over
            // its own extent; merged back, one fragment with the gap as
            // justify spacing paints every cluster at its shaped position
            // — the trailing gap after the last cluster falls outside the
            // rect and the canvas never draws it.
            if !ruby_spreads.is_empty() {
                merge_ruby_spread_fragments(&mut children, &item_text_ranges, &ruby_spreads);
            }
            let children: Vec<Fragment> = children
                .into_iter()
                .map(|(mut fragment, shift)| {
                    let adjust = max_rise - shift + ruby_growth;
                    match &mut fragment {
                        Fragment::Text(text) => {
                            text.rect.y = adjust;
                            text.rect.height = base_height;
                        }
                        // An atomic inline sits on the line's baseline:
                        // its bottom margin edge rests there, however tall
                        // the line's own strut is. Parley's ink-relative
                        // position only agrees while the image is the
                        // tallest thing on the line; whenever the strut
                        // reaches higher, the image has to come down.
                        Fragment::Image(image) => {
                            let align_top = tree_items
                                .get(image.item_index as usize)
                                .is_some_and(|item| {
                                    matches!(item, InlineItem::Image { align_top: true, .. })
                                });
                            image.rect.y = if align_top {
                                // `vertical-align: top` aligns to the line
                                // box top as if nothing were shifted, but
                                // an enclosing super/sub chain still
                                // displaces the box afterwards — the
                                // browser aligns the pending box from its
                                // unshifted metrics and the ancestor's
                                // baseline shift has already moved the
                                // fragment (measured: a footnote badge
                                // inside a 16px paragraph's <sup> inks its
                                // top 6.328125px ABOVE the line box top =
                                // trunc64(16/3) + 1, line-height
                                // independent).
                                -shift
                            } else {
                                baseline - shift - image.rect.height
                            };
                        }
                        // An inline-block atom hangs its own baseline —
                        // its LAST line's (CSS §10.8.1) — on the line
                        // baseline, so its top sits that far above it.
                        Fragment::Box(atom) => {
                            let mini_baseline = inline_block_baselines
                                .get(&atom.source.0)
                                .copied()
                                .unwrap_or(atom.rect.height);
                            atom.rect.y = baseline - shift - mini_baseline;
                        }
                        _ => {}
                    }
                    fragment
                })
                .collect();
            let marker = if lines.is_empty() {
                list_marker.map(|(diameter, x_flow, rise)| rito_fragment::MarkerFragment {
                    x: x_flow - line_x,
                    y: baseline - rise - diameter / 2.0,
                    diameter,
                })
            } else {
                None
            };
            lines.push(Fragment::Line(LineFragment {
                source: root,
                rect: FragmentRect {
                    x: line_x,
                    y: line_top,
                    width: f64::from(metrics.advance),
                    height: line_height,
                },
                baseline,
                trailing_whitespace: f64::from(metrics.trailing_whitespace),
                ruby_growth,
                marker,
                children,
            }));
        }
        // A forced break at the very end of the flow leaves one empty
        // trailing line; a browser generates no line box for a block-final
        // <br> unless it is the block's only content.
        if lines.len() > 1 {
            if let Some(Fragment::Line(last)) = lines.last() {
                if last.children.is_empty() {
                    running_top -= last.rect.height;
                    lines.pop();
                }
            }
        }
        Ok(LayoutOutcome {
            fragments: FragmentTree {
                root: Fragment::Box(BoxFragment {
                    source: root,
                    rect: FragmentRect {
                        x: 0.0,
                        y: 0.0,
                        width: space.inline_size,
                        height: running_top,
                    },
                    children: lines,
                }),
            },
            continuation: None,
            escaped_floats: Vec::new(),
        })
    }

    fn intrinsic_inline_sizes(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
    ) -> Result<IntrinsicInlineSizes, LayoutError> {
        if node.0 as usize >= tree.len() {
            return Err(LayoutError::Invalid(format!(
                "intrinsic-size query for out-of-bounds node {}",
                node.0
            )));
        }
        // A percentage-sized replaced element can shrink to anything, so
        // it contributes nothing to the minimum, while the maximum keeps
        // its intrinsic size — the two passes below are exactly that
        // distinction, and it is what lets a table cell with a specified
        // width hold a `width: 100%` image without the column inflating
        // to the image's natural width.
        let shrunk = self.build_layout(
            tree,
            node,
            None,
            None,
            None,
            PercentageImageSizing::Shrunk,
            &[],
            &[],
            &CancelFlag::new(),
        )?;
        let intrinsic = self.build_layout(
            tree,
            node,
            None,
            None,
            None,
            PercentageImageSizing::Intrinsic,
            &[],
            &[],
            &CancelFlag::new(),
        )?;
        // text-indent joins the first line's intrinsic contribution, as in
        // Chromium: a table cell whose one line carries a 2em indent
        // measures indent + text, and a column sized without the indent
        // wraps that line (b20 contents: a 9-ideograph title broke after
        // its 7th character because the column took only the text width).
        // The negative side stays out of min-content so a hanging indent
        // cannot squeeze a column below its widest unbreakable unit.
        // ONLY the CSS text-indent counts: the layout-time first-line
        // indent also folds in a leading inline box's padding/border,
        // which the measured run widths already include — adding that
        // component again double-counts it (a padded leading box on the
        // b52 title page grew its table column and rescaled the cell's
        // image).
        let min_text = f64::from(shrunk.layout.calculate_content_widths().min);
        let max_text = f64::from(intrinsic.layout.calculate_content_widths().max);
        let css_indent = tree
            .strut_style(node)
            .or_else(|| match &tree.node(node).content {
                FormattingNodeContent::InlineFlow { items } => {
                    items.first().and_then(|item| match item {
                        InlineItem::Text { style, .. }
                        | InlineItem::Image { style, .. }
                        | InlineItem::InlineBlock { style, .. } => Some(*style),
                    })
                }
                _ => None,
            })
            .and_then(|style_id| {
                tree.styles()
                    .and_then(|styles| styles.inline.style(style_id).ok())
            })
            .map_or(0.0_f32, |style| resolved_text_indent(&style));
        let indent = if intrinsic.text.is_empty() && max_text <= 0.0 {
            0.0
        } else {
            f64::from(css_indent)
        };
        // The browser stores preferred widths as LayoutUnits, CEILING the
        // shaped float sum onto the 1/64 grid (measured: a lone '1' cell
        // measures 21.4921875 shaped but sizes its table column 21.5, and
        // the half-pixel landed the neighbouring image cell on the other
        // side of a whole-pixel snap).
        let ceil64 = |value: f64| (value * 64.0).ceil() / 64.0;
        let min_content = ceil64(min_text + indent.max(0.0));
        Ok(IntrinsicInlineSizes {
            min_content,
            max_content: ceil64(max_text + indent).max(min_content),
        })
    }
}

/// Chromium's line-break tailoring, extended with its CJK quote classes.
///
/// UAX-14 gives the curly quotes class QU (no break on either side), but
/// Blink reclassifies them in CJK context: an opening curly quote breaks
/// like an opening bracket (opportunity before, none after) and a closing
/// curly quote like a closing bracket (opportunity after, none before).
/// CJK dialogue in translated novels hangs on this. Everything else
/// defers to Parley's Chromium ASCII table.
/// Fills the one gap in Parley's `word-break: break-all` relaxation.
///
/// Under break-all Parley already breaks between latin letters (a|b) and
/// before the prolonged sound mark (ず|ー), but it still carries the CJK
/// novel dash pair ── (U+2500 BOX DRAWINGS LIGHT HORIZONTAL) as one
/// unbreakable word, while Blink splits it across the line boundary
/// (b93 truth: the first ─ closes the line, the second opens the next).
/// Everything else defers to Parley's break-all logic.
fn break_anywhere_override(_context: parley::LineBreakContext) -> Option<bool> {
    Some(true)
}

fn break_all_box_dash_override(context: parley::LineBreakContext) -> Option<bool> {
    if context.before == '\u{2500}' && context.after == '\u{2500}' {
        return Some(true);
    }
    None
}

fn cjk_aware_chromium_break_override(context: parley::LineBreakContext) -> Option<bool> {
    if let Some(verdict) = cjk_quote_reclassification(context) {
        return Some(verdict);
    }
    // Blink's default line-break (auto/normal/loose — measured matrix
    // zh-CN/ja/en × auto/normal/loose, 2026-08-11) resolves the UAX-14
    // CJ class (small kana + the prolonged sound mark) to ID: the
    // character may START a line (b39 truth: あず|ーる splits with ー
    // opening the next line). Parley keeps CJ as NS, so the pair
    // retreated whole. Only `line-break: strict` keeps the prohibition —
    // that path installs the strict variant below.
    if is_cj_conditional_starter(context.after)
        && is_cjk_context(context.before)
        && !['\u{2018}', '\u{201C}'].contains(&context.before)
        && fullwidth_punctuation_class(context.before) != PunctuationClass::Open
    {
        return Some(true);
    }
    (parley::CHROMIUM_LINE_BREAK_OVERRIDE)(context)
}

/// The `line-break: strict` variant: Chromium's quote reclassification
/// without the CJ line-start relaxation (strict keeps CJ as NS, measured
/// PAIR-RETREATS on the same matrix).
fn cjk_aware_chromium_break_override_strict(context: parley::LineBreakContext) -> Option<bool> {
    if let Some(verdict) = cjk_quote_reclassification(context) {
        return Some(verdict);
    }
    (parley::CHROMIUM_LINE_BREAK_OVERRIDE)(context)
}

/// UAX-14 gives the curly quotes class QU (no break on either side), but
/// Blink reclassifies them in CJK context: an opening curly quote breaks
/// like an opening bracket (opportunity before, none after) and a closing
/// curly quote like a closing bracket (opportunity after, none before).
/// CJK dialogue in translated novels hangs on this.
fn cjk_quote_reclassification(context: parley::LineBreakContext) -> Option<bool> {
    const OPEN_QUOTES: [char; 2] = ['\u{2018}', '\u{201C}'];
    const CLOSE_QUOTES: [char; 2] = ['\u{2019}', '\u{201D}'];
    // A close/stop before the opening quote KEEPS the prohibition: the
    // browser carries 说，'Caster' as one unbreakable block — the comma
    // never sheds the quote that follows it (pinned-Chromium b112 line:
    // …这点来 | 说，'Caster'… breaks before 说, not after the comma).
    // Only an ideograph ahead of the opening quote releases the break.
    if OPEN_QUOTES.contains(&context.after)
        && is_cjk_context(context.before)
        && matches!(
            fullwidth_punctuation_class(context.before),
            PunctuationClass::Other | PunctuationClass::Middle
        )
        && !OPEN_QUOTES.contains(&context.before)
    {
        return Some(true);
    }
    // The em/horizontal-bar dashes join the after-side context: a
    // closing curly quote breaks before a novel dash pair exactly like
    // before an ideograph (pinned-Chromium b112 line: 怕”|——可见 puts
    // the dash pair on the next line while the quote closes the first;
    // treating the pair as unbreakable-after-quote dragged 怕” down
    // with it and re-broke every following line of the chapter).
    let after_joins_cjk = is_cjk_context(context.after)
        || matches!(context.after, '\u{2014}' | '\u{2015}');
    if CLOSE_QUOTES.contains(&context.before)
        && after_joins_cjk
        && fullwidth_punctuation_class(context.after) != PunctuationClass::CloseOrStop
        && !CLOSE_QUOTES.contains(&context.after)
        && !OPEN_QUOTES.contains(&context.after)
    {
        return Some(true);
    }
    None
}

/// The UAX-14 CJ class: small kana and the katakana-hiragana prolonged
/// sound mark, whose line-start prohibition is conditional on
/// `line-break` strictness.
fn is_cj_conditional_starter(character: char) -> bool {
    matches!(u32::from(character),
        0x3041 | 0x3043 | 0x3045 | 0x3047 | 0x3049
        | 0x3063 | 0x3083 | 0x3085 | 0x3087 | 0x308E | 0x3095 | 0x3096
        | 0x30A1 | 0x30A3 | 0x30A5 | 0x30A7 | 0x30A9
        | 0x30C3 | 0x30E3 | 0x30E5 | 0x30E7 | 0x30EE | 0x30F5 | 0x30F6
        | 0x30FC
        | 0x31F0..=0x31FF
        | 0xFF67..=0xFF70)
}

/// Whether the character puts the boundary in CJK typographic context.
fn is_cjk_context(character: char) -> bool {
    matches!(u32::from(character),
        0x2E80..=0x303F
        | 0x3040..=0x312F
        | 0x3130..=0x318F
        | 0x31C0..=0x9FFF
        | 0xAC00..=0xD7AF
        | 0xF900..=0xFAFF
        | 0xFF00..=0xFFEF
        | 0x20000..=0x3FFFF)
}

/// Blink's justification character class (`Character::IsCJKIdeographOrSymbol`
/// by block): ideographs, kana, CJK punctuation, and fullwidth forms.
/// Measured against pinned Chromium (scratchpad justify probes,
/// 2026-07-28): em dashes, ellipses, middle dots and curly quotes are NOT
/// in the class even when a CJK face serves them — the class is decided
/// by code point, not by the resolved font. Enclosed alphanumerics
/// (U+2460 circled digits — postil markers) ARE in the class, plain and
/// superscripted alike (measured 2026-08-03).
fn is_cjk_justify(character: char) -> bool {
    matches!(u32::from(character),
        0x2460..=0x24FF
        // Geometric shapes and the star pair count as CJK symbols in the
        // browser's justify classes (measured share-after on a 20-symbol
        // matrix: \u{25A0}\u{25B2}\u{25B3}\u{25C7}\u{25CB}\u{25CE}\u{25CF}
        // and \u{2605}\u{2606} each open one share; math operators
        // \u{2220}\u{2252}\u{2260}, \u{00D7}\u{00F7}, the em dash, the
        // ellipsis, and Greek letters open none).
        | 0x25A0..=0x25FF
        | 0x2605..=0x2606
        | 0x2E80..=0x2EFF
        | 0x3000..=0x303F
        | 0x3041..=0x30FF
        | 0x31C0..=0x31EF
        | 0x3200..=0x33FF
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xF900..=0xFAFF
        | 0xFE30..=0xFE4F
        // Blink's CJK symbol table cuts at U+FF1A: the fullwidth
        // semicolon ；(U+FF1B) neither expands after itself nor takes a
        // "before" share (measured boundary-by-boundary on the OO；觉
        // line: the engine's CJK classification minted two phantom
        // shares there, inflating the denominator 48 → 50 and shifting
        // every glyph after the first latin run).
        | 0xFF00..=0xFF1A
        | 0xFF1C..=0xFF60
        | 0xFFE0..=0xFFE6
        | 0x20000..=0x2FA1F)
}

/// Whether a justified line expands after this character: word separators
/// and CJK ideographs/symbols both open a share on their right side.
fn justify_expands_after(character: char) -> bool {
    character == ' ' || is_cjk_justify(character)
}

/// Punctuation that CJK fonts join into one continuous rule when repeated
/// (em dash and ellipsis pairs —— / …… via GSUB contextual/ligature
/// substitution). The canvas shapes each fillText call independently, so a
/// paint cut inside such a sequence severs the substitution and the glyphs
/// raster in their isolated form (measured on an embedded face: the joined
/// dash pair's bar sits 2px lower than two isolated dashes; the browser
/// keeps the pair in one shaping run because no justify share separates
/// them).
fn joins_with_identical_neighbor(character: char) -> bool {
    matches!(character, '\u{2014}' | '\u{2015}' | '\u{2026}')
}

/// One justified line's expansion plan.
///
/// Blink (`text-align: justify`, default `text-justify: auto`) spreads a
/// line's slack in equal shares across its expansion opportunities.
/// Measured against pinned Chromium (scratchpad justify probes,
/// 2026-07-28, five discriminating lines):
///
/// - every boundary whose left character is a space or CJK gets one share
///   (CJK-CJK, CJK-latin, CJK-space, space-anything: all one share, so
///   fullwidth punctuation expands exactly like an ideograph);
/// - latin-latin and latin-space boundaries get none;
/// - a CJK character right of a non-expansive character opens a share
///   that lands one boundary LATE (measured: `t|花` stays natural while
///   `花|鸟` doubles — Blink defers the "before" opportunity it cannot
///   apply at the boundary itself);
/// - the line's edges never expand, and trailing whitespace hangs
///   outside the distribution.
///
/// Glyph positions follow the ideal float accumulation truncated to the
/// device's 1/64px grid; painting the share as canvas letter spacing (or
/// per-cluster placement) reproduces the DOM raster bit-for-bit
/// (measured: 0-diff over all 250 line columns, all three paint models).
struct JustifyPlan {
    /// Pixels one expansion share adds.
    share: f64,
    /// Share count at each inter-character boundary, keyed by the byte
    /// index (into the flow text) of the boundary's right-hand character,
    /// ascending. Boundaries without shares are absent.
    counts: Vec<(usize, u32)>,
    /// Byte indices of CJK characters that follow a non-CJK character.
    /// Their deferred "before" share lands in the NEXT boundary's count
    /// (the advance side), but Blink additionally paints the glyph's INK
    /// one share to the right (ShapeResult::ApplySpacingOrExpansion adds
    /// `spacing_before` to the glyph offset as well as the advance), so
    /// the run starting here shifts its rect without moving its
    /// neighbours.
    before_bytes: Vec<usize>,
    /// Per in-flow atom on the line, in flow order: (flow-text position,
    /// shares accumulated up to AND INCLUDING the atom's left boundary).
    /// The atom's justified x adds `share × shares` — measured on b20's
    /// note badge: the image sits at the END of its prefix's EXPANDED
    /// advance (the [text-atom] boundary's share rides the preceding
    /// glyph), while the [atom-text] boundary's share shifts the
    /// following run only.
    atom_shares: Vec<(usize, u32)>,
}

impl JustifyPlan {
    fn count_at(&self, byte: usize) -> u32 {
        self.counts
            .binary_search_by_key(&byte, |(index, _)| *index)
            .map(|found| self.counts[found].1)
            .unwrap_or(0)
    }

    fn before_share_at(&self, byte: usize) -> bool {
        self.before_bytes.binary_search(&byte).is_ok()
    }

    /// Shares carried by the `ordinal`-th atom at `position` (flow-text
    /// byte), or `None` when the atom sits outside the plan's line.
    fn atom_shares_at(&self, position: usize, ordinal: usize) -> Option<u32> {
        self.atom_shares
            .iter()
            .filter(|(byte, _)| *byte == position)
            .nth(ordinal)
            .map(|(_, shares)| *shares)
    }
}

/// Builds the expansion plan for one line, or `None` when the line has no
/// slack or no opportunities (then the start-aligned positions stand).
fn line_justify_plan(
    text: &str,
    range: std::ops::Range<usize>,
    slack: f64,
    spread_ranges: &[std::ops::Range<usize>],
    atom_positions: &[usize],
) -> Option<JustifyPlan> {
    if !(slack > 0.0) {
        return None;
    }
    let content = text.get(range.clone())?.trim_end();
    let content_end = range.start + content.len();
    let mut counts: Vec<(usize, u32)> = Vec::new();
    let mut before_bytes: Vec<usize> = Vec::new();
    let mut atom_shares: Vec<(usize, u32)> = Vec::new();
    let mut total = 0u32;
    let mut pending = 0u32;
    // The left neighbour of the next boundary: a character, or an atomic
    // inline. Blink counts an atomic inline (an image, an inline-block)
    // as an ideograph on BOTH sides — measured on b20's badge line, the
    // truth carries a share at [text-atom] AND at [atom-text] where the
    // engine's text-only walk saw one adjacency.
    enum Left {
        Char(char),
        Atom,
    }
    let expands_after = |left: &Left| match left {
        Left::Char(character) => justify_expands_after(*character),
        // An atomic inline is NON-expansive on its trailing side: a
        // Chromium justify map on a badge line gives [atom|，] ZERO
        // shares and ，|有 TWO — the following CJK char's before-share
        // defers one boundary late, the usual deferral machinery. (An
        // earlier reading that an atom expands on both sides overfit
        // its line; the leading [text|atom] boundary DOES expand via
        // the left character's own class.)
        Left::Atom => false,
    };
    let mut previous: Option<Left> = None;
    let mut atoms = atom_positions
        .iter()
        .copied()
        .filter(|position| range.start < *position && *position <= content_end)
        .peekable();
    let mut walk = content.char_indices().peekable();
    loop {
        let boundary = match walk.peek() {
            Some((offset, _)) => range.start + offset,
            None => content_end,
        };
        // Atoms sitting at this boundary join the walk as ideographs:
        // the [left, atom] boundary's share is counted here and also
        // recorded as the atom's own placement share.
        while atoms.peek() == Some(&boundary) {
            atoms.next();
            let mut count = 0u32;
            if let Some(left) = &previous {
                count = pending;
                pending = 0;
                if expands_after(left) {
                    count += 1;
                }
            }
            atom_shares.push((boundary, total + count));
            if count > 0 {
                counts.push((boundary, count));
                total += count;
            }
            previous = Some(Left::Atom);
        }
        let Some((offset, character)) = walk.next() else {
            break;
        };
        // Zero-width characters are TRANSPARENT to justification: the
        // boundary they sit on neither takes a share nor defers one
        // (Range-measured on a justified line carrying U+FEFF: the
        // preceding ideograph's boundary keeps its one share and the
        // zero-width cluster steps 0, while counting it as a normal
        // character both inflated the denominator and deferred a
        // phantom share past it).
        if matches!(
            character,
            '\u{FEFF}' | '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}'
        ) {
            continue;
        }
        if let Some(left) = &previous {
            // A spread ruby base receives NO interior expansion: its
            // clusters already sit at the annotation-dictated spacing
            // (measured: a justified wide-annotation ruby is
            // bit-identical to the left-aligned one, while a
            // narrow-annotation base justifies like plain text). Only
            // its outer boundaries carry shares.
            let boundary = range.start + offset;
            if spread_ranges
                .iter()
                .any(|spread| spread.start < boundary && boundary < spread.end)
            {
                pending = 0;
                previous = Some(Left::Char(character));
                continue;
            }
            let mut count = pending;
            pending = 0;
            if expands_after(left) {
                count += 1;
            } else if is_cjk_justify(character) {
                pending += 1;
                before_bytes.push(boundary);
            }
            if count > 0 {
                // An atom at this byte may have deposited its own count
                // already; the counts vec stays unique-keyed for the
                // binary search.
                if let Some(entry) = counts.last_mut().filter(|(byte, _)| *byte == boundary) {
                    entry.1 += count;
                } else {
                    counts.push((boundary, count));
                }
                total += count;
            }
        }
        previous = Some(Left::Char(character));
    }
    // A share deferred into the line's end has nowhere to land, but
    // Blink still counts it in the denominator: a justified line ending
    // `……唉` distributes slack/(shares+1) and stays one share short of
    // the right edge (measured 2026-08-03, replica vs live: Blink share
    // 26.688/33 = 0.809 with the line ending 0.81px shy; the engine's
    // slack/32 overfilled).
    if pending > 0 {
        total += pending;
    }
    if total == 0 {
        return None;
    }
    if std::env::var_os("RITO_JUST_DEBUG").is_some() {
        let sample: String = content.chars().take(6).collect();
        eprintln!(
            "[plan] '{sample}' slack={slack} total={total} share={} counts={:?}",
            slack / f64::from(total),
            counts
                .iter()
                .map(|(byte, count)| {
                    let ch = text[*byte..].chars().next().unwrap_or(' ');
                    (ch, *count)
                })
                .collect::<Vec<_>>()
        );
    }
    Some(JustifyPlan {
        share: slack / f64::from(total),
        counts,
        before_bytes,
        atom_shares,
    })
}

/// Which glyph loses its blank half at a fullwidth-punctuation boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrimmedGlyph {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PunctuationClass {
    Open,
    CloseOrStop,
    Middle,
    Other,
}

fn fullwidth_punctuation_class(character: char) -> PunctuationClass {
    match character {
        // The curly quotes are ambiguous-width, but in the CJK faces this
        // engine shapes with they are fullwidth, and the pinned Chromium
        // trims them exactly like brackets (pair probe, 2026-07-26,
        // 17-pair matrix incl. quotes): `。”` costs 8+16, `”。` costs
        // 8+16, `「“` costs 16+8, and none of them trim against an
        // ideograph. Blink types them kOpenQuote/kCloseQuote, which its
        // Han kerning treats as kOpen/kClose.
        '「' | '『' | '（' | '【' | '〔' | '《' | '〈' | '〖' | '〘' | '〚' | '｛' | '［'
        | '｟' | '‘' | '“' => PunctuationClass::Open,
        '」' | '』' | '）' | '】' | '〕' | '》' | '〉' | '〗' | '〙' | '〛' | '｝' | '］'
        | '｠' | '。' | '、' | '，' | '．' | '：' | '；' | '’' | '”' => {
            PunctuationClass::CloseOrStop
        }
        // The ideographic space is fullwidth-punctuation CONTEXT: an
        // opener after it halts (　「 = 16+8) and a close/stop before it
        // halts (』　 = 8+16), while the space itself never trims —
        // 　　 and 　、 stay full (measured 6-pair matrix, 2026-08-08).
        // The Middle class carries exactly that trigger-but-never-
        // trimmed behaviour.
        '・' | '　' => PunctuationClass::Middle,
        _ => PunctuationClass::Other,
    }
}

/// The half-width trim at the boundary between `left` and `right`, if any.
///
/// Chromium ships `text-spacing-trim: normal` on by default for CJK text
/// (Blink "Han kerning"): where two fullwidth punctuation glyphs meet, the
/// blank half at the boundary collapses so the pair advances 1.5em instead
/// of 2em. Characterized against pinned Chromium (scratchpad trim probes,
/// 2026-07-23, 54-pair matrix): an opening bracket trims its blank left
/// half after any fullwidth punctuation; a close/stop/colon trims its
/// blank right half before any fullwidth punctuation; nothing trims
/// against an ideograph or at a line edge, `！？・` never trim themselves,
/// the trim applies with or without justification, and it crosses inline
/// element boundaries.
fn cjk_punctuation_trim(left: char, right: char) -> Option<TrimmedGlyph> {
    let left_class = fullwidth_punctuation_class(left);
    let right_class = fullwidth_punctuation_class(right);
    if right_class == PunctuationClass::Open && left_class != PunctuationClass::Other {
        return Some(TrimmedGlyph::Right);
    }
    if left_class == PunctuationClass::CloseOrStop && right_class != PunctuationClass::Other {
        return Some(TrimmedGlyph::Left);
    }
    None
}

/// Applies the boundary trims as negative letter-spacing on the character
/// left of each trimming boundary — geometrically identical to removing
/// the blank half, and visible to shaping, line breaking, and run
/// splitting alike (the distinct resolved style isolates the trimmed
/// character in its own glyph run, so painted runs stay position-exact).
/// The boundary trims as (range, letter-spacing) edits, computed before
/// the shaping builder exists so the trim gate can consult the font
/// collection. Blink's Han kerning only adjusts glyphs whose resolved
/// font carries the OpenType `halt` feature (measured: a book-embedded
/// face without it keeps `。」` at two full advances while the pinned
/// SourceHan trims), so each trimmed character resolves its font first.
/// One boundary trim: the pair identity for straddle bookkeeping, the
/// character range the edit applies to, and the edit itself.
struct PunctuationTrim {
    left_byte: usize,
    right_byte: usize,
    edit_range: std::ops::Range<usize>,
    edit: PunctuationTrimEdit,
}

enum PunctuationTrimEdit {
    /// A close/stop's blank right half collapses: negative letter-spacing
    /// on the trimmed character itself (correct fit attribution — the
    /// credit belongs to the line holding that character).
    LetterSpacing(f32),
    /// An opener's blank LEFT half collapses: the OpenType `halt`
    /// feature on the opener itself, exactly Blink's Han kerning. A
    /// left-char letter-spacing here would leak the credit into the
    /// PREVIOUS line's fit at a break boundary (measured: a compressed
    /// ，squeezed onto the prior line, straddling the pair and killing
    /// the trim, while Blink's full-width ，broke earlier and kept
    /// 作，『 together). Carries the removed half width (half the
    /// opener's font size) for the painter's draw-origin compensation.
    OpenerHalt(f32),
}

fn compute_cjk_punctuation_trims(
    fonts: &mut FontContext,
    registered_families: &[String],
    halt_cache: &mut std::collections::HashMap<(u64, u32), bool>,
    text: &str,
    runs: &[(std::ops::Range<usize>, &InlineFormattingStyleV1, usize)],
    suppressed_pairs: &[usize],
    inline_box_bytes: &[usize],
) -> Vec<PunctuationTrim> {
    fn style_at<'a>(
        cursor: &mut usize,
        runs: &[(std::ops::Range<usize>, &'a InlineFormattingStyleV1, usize)],
        byte: usize,
    ) -> Option<&'a InlineFormattingStyleV1> {
        while *cursor < runs.len() && runs[*cursor].0.end <= byte {
            *cursor += 1;
        }
        runs.get(*cursor)
            .filter(|(range, ..)| range.contains(&byte))
            .map(|(_, style, _)| *style)
    }
    let mut trims = Vec::new();
    let mut cursor = 0usize;
    let mut previous: Option<(usize, char)> = None;
    for (byte, character) in text.char_indices() {
        if let Some((left_byte, left)) = previous {
            // A pair a line break was found to separate keeps both
            // glyphs at full width, exactly as the browser trims within
            // lines only.
            if suppressed_pairs.contains(&left_byte) {
                previous = Some((byte, character));
                continue;
            }
            // An inline box (an image — flow text carries no placeholder
            // for it) sitting between the two characters separates them:
            // the browser keeps 的。<img>』at full width while 。』
            // alone trims (measured on b20's note badge, p143).
            if inline_box_bytes.contains(&byte) {
                previous = Some((byte, character));
                continue;
            }
            if let Some(trimmed) = cjk_punctuation_trim(left, character) {
                let left_style = style_at(&mut cursor, runs, left_byte);
                let (trimmed_style, trimmed_char) = match trimmed {
                    TrimmedGlyph::Left => (left_style, left),
                    TrimmedGlyph::Right => (style_at(&mut cursor, runs, byte), character),
                };
                if let (Some(left_style), Some(trimmed_style)) = (left_style, trimmed_style) {
                    let Some(halt_covers_glyph) = resolved_font_halt(
                        fonts,
                        registered_families,
                        halt_cache,
                        trimmed_style,
                        trimmed_char,
                    ) else {
                        previous = Some((byte, character));
                        continue;
                    };
                    match trimmed {
                        TrimmedGlyph::Left => {
                            let author = match left_style.text_flow.letter_spacing {
                                LengthPercentage::Length(px) => px.get(),
                                _ => 0.0,
                            };
                            trims.push(PunctuationTrim {
                                left_byte,
                                right_byte: byte,
                                edit_range: left_byte..byte,
                                edit: PunctuationTrimEdit::LetterSpacing(
                                    author - 0.5 * trimmed_style.font.size.get(),
                                ),
                            });
                        }
                        TrimmedGlyph::Right if halt_covers_glyph => {
                            trims.push(PunctuationTrim {
                                left_byte,
                                right_byte: byte,
                                edit_range: byte..byte + character.len_utf8(),
                                edit: PunctuationTrimEdit::OpenerHalt(
                                    0.5 * trimmed_style.font.size.get(),
                                ),
                            });
                        }
                        TrimmedGlyph::Right => {
                            // The face declares `halt` but its lookups skip
                            // this opener (b12's BuMing): the browser still
                            // trims, synthesizing the half-width — the
                            // opener's ink already hugs its right half, so
                            // removing the blank left half from the gap
                            // BEFORE it reproduces the compressed pair
                            // without any paint shift.
                            let author = match left_style.text_flow.letter_spacing {
                                LengthPercentage::Length(px) => px.get(),
                                _ => 0.0,
                            };
                            trims.push(PunctuationTrim {
                                left_byte,
                                right_byte: byte,
                                edit_range: left_byte..byte,
                                edit: PunctuationTrimEdit::LetterSpacing(
                                    author - 0.5 * trimmed_style.font.size.get(),
                                ),
                            });
                        }
                    }
                }
            }
        }
        previous = Some((byte, character));
    }
    trims
}

/// Whether the font the style resolves for `character` carries the
/// OpenType `halt` feature. Resolution mirrors CSS font matching: the
/// first stack family whose matched face covers the character wins, and
/// the registered families (the engine's installed fallback order) stand
/// in for script fallback. An unresolvable character trims nothing.
/// Disc geometry for a `display: list-item` inline flow, if its layout
/// style asks for one: `(diameter, flow-relative left edge, vertical
/// center rise above the first baseline)`.
///
/// Measured against pinned Chromium (marker probes, 2026-07-28, two faces
/// × four sizes): diameter = ascent / 3 of the item's primary face (the
/// first face its family stack resolves for a Latin sample — the same
/// face Blink's marker uses), the disc's right edge sits Chromium's 7px
/// marker padding before the content edge, and its vertical center rides
/// half the x-height above the baseline. Only the plain filled disc is
/// modeled; other marker styles keep the documented plain-block
/// degradation.
fn list_marker_geometry(
    fonts: &mut FontContext,
    registered_families: &[String],
    tree: &FormattingTree,
    node: FormattingNodeId,
) -> Option<(f64, f64, f64)> {
    let styles = tree.styles()?;
    let layout_style = styles.layout.style(tree.node(node).style).ok()?;
    if !layout_style.display.is_list_item
        || layout_style.list_style_type != rito_style_contract::ListMarkerStyleV1::Disc
    {
        return None;
    }
    let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
        return None;
    };
    let style_id = match tree.strut_style(node) {
        Some(style) => style,
        None => match items.first() {
            Some(InlineItem::Text { style, .. })
            | Some(InlineItem::Image { style, .. })
            | Some(InlineItem::InlineBlock { style, .. }) => *style,
            None => return None,
        },
    };
    let style = styles.inline.style(style_id).ok()?;
    let size = f64::from(style.font.size.get());
    let (ascent, x_height) = resolved_marker_font_metrics(fonts, registered_families, style)
        .unwrap_or((size * 0.9, size * 0.5));
    let diameter = ascent / 3.0;
    // Pixel-measured: the disc's RIGHT edge sits one diameter plus the 7px
    // marker padding before the content edge (left = content − 7 − 2d).
    Some((diameter, -(7.0 + 2.0 * diameter), x_height / 2.0))
}

/// Ascent and x-height (CSS px at the style's size) of the first face the
/// style's family stack resolves for a Latin sample — the face a browser
/// marker inherits.
fn resolved_marker_font_metrics(
    fonts: &mut FontContext,
    registered_families: &[String],
    style: &InlineFormattingStyleV1,
) -> Option<(f64, f64)> {
    use parley::fontique::{FontStyle, FontWeight, FontWidth, SourceKind};
    use skrifa::MetadataProvider as _;
    let weight = FontWeight::new(style.font.weight.get());
    let size = style.font.size.get();
    let stack = style
        .font
        .families
        .as_slice()
        .iter()
        .filter_map(|family| match family {
            rito_style_contract::FontFamily::Named(name) => Some(name.as_str()),
            rito_style_contract::FontFamily::Generic(_) => None,
        });
    for name in stack.chain(registered_families.iter().map(String::as_str)) {
        let Some(family) = fonts.collection.family_by_name(name) else {
            continue;
        };
        let Some(font) = family.match_font(FontWidth::NORMAL, FontStyle::Normal, weight, true)
        else {
            continue;
        };
        let SourceKind::Memory(blob) = font.source().kind() else {
            continue;
        };
        let Ok(font_ref) = skrifa::FontRef::from_index(blob.as_ref(), font.index()) else {
            continue;
        };
        if font_ref.charmap().map('x').is_none() {
            continue;
        }
        let metrics = font_ref.metrics(
            skrifa::instance::Size::new(size),
            skrifa::instance::LocationRef::default(),
        );
        let x_height = metrics
            .x_height
            .map(f64::from)
            .unwrap_or(f64::from(size) * 0.5);
        return Some((f64::from(metrics.ascent), x_height));
    }
    None
}

fn resolved_font_halt(
    fonts: &mut FontContext,
    registered_families: &[String],
    halt_cache: &mut std::collections::HashMap<(u64, u32), bool>,
    style: &InlineFormattingStyleV1,
    character: char,
) -> Option<bool> {
    use parley::fontique::{FontStyle, FontWeight, FontWidth, SourceKind};
    use skrifa::MetadataProvider as _;
    let weight = FontWeight::new(style.font.weight.get());
    let stack = style
        .font
        .families
        .as_slice()
        .iter()
        .filter_map(|family| match family {
            rito_style_contract::FontFamily::Named(name) => Some(name.as_str()),
            rito_style_contract::FontFamily::Generic(_) => None,
        });
    for name in stack.chain(registered_families.iter().map(String::as_str)) {
        let Some(family) = fonts.collection.family_by_name(name) else {
            continue;
        };
        let Some(font) = family.match_font(FontWidth::NORMAL, FontStyle::Normal, weight, true)
        else {
            continue;
        };
        let SourceKind::Memory(blob) = font.source().kind() else {
            continue;
        };
        let Ok(font_ref) = skrifa::FontRef::from_index(blob.as_ref(), font.index()) else {
            continue;
        };
        if font_ref.charmap().map(character).is_none() {
            continue;
        }
        let key = (blob.id(), font.index());
        let has_halt = *halt_cache
            .entry(key)
            .or_insert_with(|| font_ref_has_halt(&font_ref));
        if !has_halt {
            return None;
        }
        return Some(font_halt_covers(&font_ref, character));
    }
    None
}

/// Whether any face the style's stack (or the registered fallback order)
/// resolves covers `character`. A character nothing covers shapes to a
/// face's `.notdef` advance, while the browser paints it with a system
/// fallback font the engine does not hold — the gate for the host
/// advance probe.
fn stack_covers_character(
    fonts: &mut FontContext,
    registered_families: &[String],
    style: &InlineFormattingStyleV1,
    character: char,
) -> bool {
    use parley::fontique::{FontStyle, FontWeight, FontWidth, SourceKind};
    use skrifa::MetadataProvider as _;
    let weight = FontWeight::new(style.font.weight.get());
    let stack = style
        .font
        .families
        .as_slice()
        .iter()
        .filter_map(|family| match family {
            rito_style_contract::FontFamily::Named(name) => Some(name.as_str()),
            rito_style_contract::FontFamily::Generic(_) => None,
        });
    for name in stack.chain(registered_families.iter().map(String::as_str)) {
        let Some(family) = fonts.collection.family_by_name(name) else {
            continue;
        };
        let Some(font) = family.match_font(FontWidth::NORMAL, FontStyle::Normal, weight, true)
        else {
            continue;
        };
        let SourceKind::Memory(blob) = font.source().kind() else {
            continue;
        };
        let Ok(font_ref) = skrifa::FontRef::from_index(blob.as_ref(), font.index()) else {
            continue;
        };
        if font_ref.charmap().map(character).is_some() {
            return true;
        }
    }
    false
}

/// The `.notdef` advance, in px at `size`, of the first face the style's
/// stack resolves — the advance shaping gives a character nothing covers
/// (measured: b12's U+2764 shaped to 1593/2048 em, the pinned latin
/// face's glyph 0).
fn stack_notdef_advance_px(
    fonts: &mut FontContext,
    registered_families: &[String],
    style: &InlineFormattingStyleV1,
    size: f32,
) -> Option<f64> {
    use parley::fontique::{FontStyle, FontWeight, FontWidth, SourceKind};
    use skrifa::MetadataProvider as _;
    let weight = FontWeight::new(style.font.weight.get());
    let stack = style
        .font
        .families
        .as_slice()
        .iter()
        .filter_map(|family| match family {
            rito_style_contract::FontFamily::Named(name) => Some(name.as_str()),
            rito_style_contract::FontFamily::Generic(_) => None,
        });
    for name in stack.chain(registered_families.iter().map(String::as_str)) {
        let Some(family) = fonts.collection.family_by_name(name) else {
            continue;
        };
        let Some(font) = family.match_font(FontWidth::NORMAL, FontStyle::Normal, weight, true)
        else {
            continue;
        };
        let SourceKind::Memory(blob) = font.source().kind() else {
            continue;
        };
        let Ok(font_ref) = skrifa::FontRef::from_index(blob.as_ref(), font.index()) else {
            continue;
        };
        let advance = font_ref
            .glyph_metrics(
                skrifa::instance::Size::new(size),
                skrifa::instance::LocationRef::default(),
            )
            .advance_width(skrifa::GlyphId::new(0));
        return advance.map(f64::from);
    }
    None
}

/// Whether a Parley cluster's resolved font carries the `halt` feature —
/// the same gate the pair trims apply: Blink's Han kerning (including the
/// conditional line-end close trim) only adjusts glyphs whose font
/// declares it. A latin face's curly quote must NOT extend the line
/// (measured: a Tinos closing quote got the half-width extension and
/// pulled `men.` plus the quote onto a line the browser broke earlier).
fn cluster_font_has_halt(cluster: &parley::layout::Cluster<'_, [u8; 4]>) -> bool {
    let run = cluster.run();
    let font = run.font();
    skrifa::FontRef::from_index(font.data.as_ref(), font.index)
        .map(|font_ref| font_ref_has_halt(&font_ref))
        .unwrap_or(false)
}

/// Whether the face declares the OpenType `halt` feature in GSUB or GPOS.
fn font_ref_has_halt(font: &skrifa::FontRef) -> bool {
    use skrifa::raw::TableProvider as _;
    let tag = skrifa::raw::types::Tag::new(b"halt");
    let gsub = font.gsub().ok().and_then(|table| table.feature_list().ok());
    let gpos = font.gpos().ok().and_then(|table| table.feature_list().ok());
    gsub.is_some_and(|list| {
        list.feature_records()
            .iter()
            .any(|record| record.feature_tag() == tag)
    }) || gpos.is_some_and(|list| {
        list.feature_records()
            .iter()
            .any(|record| record.feature_tag() == tag)
    })
}

/// Whether the face's `halt` feature actually REPOSITIONS `character` —
/// its GPOS `halt` lookups cover the mapped glyph. A face may declare
/// `halt` for a subset only (b12's BuMing covers 51 glyphs, the corner
/// bracket excluded): shaping such a glyph with the feature is a no-op,
/// and the browser SYNTHESIZES the half-width trim instead. Parse
/// failures report `true` so the shaped path stays the default.
fn font_halt_covers(font: &skrifa::FontRef, character: char) -> bool {
    use skrifa::raw::tables::gpos::PositionLookup;
    use skrifa::raw::TableProvider as _;
    use skrifa::MetadataProvider as _;
    let Some(glyph) = font.charmap().map(character) else {
        return true;
    };
    let tag = skrifa::raw::types::Tag::new(b"halt");
    let Ok(gpos) = font.gpos() else {
        return true;
    };
    let (Ok(features), Ok(lookups)) = (gpos.feature_list(), gpos.lookup_list()) else {
        return true;
    };
    let mut lookup_indices: Vec<u16> = Vec::new();
    for record in features.feature_records() {
        if record.feature_tag() != tag {
            continue;
        }
        let Ok(feature) = record.feature(features.offset_data()) else {
            return true;
        };
        lookup_indices.extend(feature.lookup_list_indices().iter().map(|i| i.get()));
    }
    if lookup_indices.is_empty() {
        return true;
    }
    let covers = |coverage: Result<skrifa::raw::tables::layout::CoverageTable, _>| {
        coverage.is_ok_and(|table| table.get(glyph).is_some())
    };
    for index in lookup_indices {
        let Ok(lookup) = lookups.lookups().get(index as usize) else {
            return true;
        };
        let single = match lookup {
            PositionLookup::Single(table) => table,
            _ => return true,
        };
        for subtable in single.subtables().iter() {
            let Ok(subtable) = subtable else {
                return true;
            };
            use skrifa::raw::tables::gpos::SinglePos;
            let covered = match subtable {
                SinglePos::Format1(t) => covers(t.coverage()),
                SinglePos::Format2(t) => covers(t.coverage()),
            };
            if covered {
                return true;
            }
        }
    }
    false
}

/// Layout-unit epsilon for line-fit comparisons, Chromium's `LayoutUnit`
/// quantum (1/64 px).
const LINE_FIT_EPS: f32 = 1.0 / 64.0;

/// How many glyphs past a soft break the candidate scan follows. The
/// dragged-down tail is whatever could not break before the closer — an
/// entire unbreakable Latin word included (measured: 有點melancholy。」,
/// where the closer is the 12th cluster past the break and Blink still
/// extends the line). Blink's ShapeLine has no small bound; this cap
/// only guards pathological input. Engine-forced breaks are excluded
/// from the scan separately — a forced line's tail is rewound content,
/// not a dragged closer.
const LINE_END_TRIM_SCAN: usize = 64;

/// The first character after `line_index`'s soft break that did not fit,
/// if extending the line by exactly that character with its blank right
/// half trimmed could keep it on the line.
///
/// This reconstructs Blink's `ShapingLineBreaker::ShapeLine` extension:
/// the candidate is the first character past the break that exceeds the
/// available advance (characters before it fit and were only dragged down
/// by break prohibitions), it must be an eligible closing glyph, and its
/// half-width advance must fit. The decision is a pre-filter only — the
/// caller re-lays the paragraph with the trim applied and keeps it only
/// if the line then breaks exactly after the trimmed closer, so parley's
/// own fitting (and its break rules) remain the authority.
/// Detects a rejected-extension rewind on `line_index`: the line-end trim
/// extension would fit the first overflowing closer (so a single-item
/// line would have extended), but the line crosses an element boundary,
/// which Blink answers by rewinding the WHOLE overflowing item to the
/// next line — measured on razor-fit note-box lines, where line one keeps
/// only the leading `①` span while greedy would split the text item.
/// Returns the cluster count the line must be forced to hold.
fn rewind_break_count(
    layout: &parley::Layout<[u8; 4]>,
    text: &str,
    line_index: usize,
    max_advance: f64,
    item_ranges: &[std::ops::Range<usize>],
) -> Option<u32> {
    let line = layout.get(line_index)?;
    let next = layout.get(line_index + 1)?;
    if line.break_reason() != parley::layout::BreakReason::Regular {
        return None;
    }
    // Only a line crossing an element boundary rewinds; a single-item
    // line extends instead (see `line_end_trim_candidate`).
    let mut line_item: Option<u32> = None;
    let mut crosses = false;
    for item in line.items() {
        let brush = match item {
            PositionedLayoutItem::GlyphRun(run) => u32::from_le_bytes(run.style().brush),
            PositionedLayoutItem::InlineBox(inline_box) => u32::MAX - inline_box.id as u32,
        };
        if *line_item.get_or_insert(brush) != brush {
            crosses = true;
            break;
        }
    }
    if !crosses {
        return None;
    }
    let metrics = line.metrics();
    let mut advance = f64::from(metrics.advance - metrics.trailing_whitespace);
    let next_range = next.text_range();
    let mut cluster = parley::layout::Cluster::from_byte_index(layout, next_range.start)?;
    for _ in 0..LINE_END_TRIM_SCAN {
        let byte = cluster.text_range().start;
        if byte >= next_range.end {
            return None;
        }
        let character = text[byte..].chars().next()?;
        let cluster_advance = f64::from(cluster.advance());
        if advance + cluster_advance <= max_advance + f64::from(LINE_FIT_EPS) {
            advance += cluster_advance;
            cluster = cluster.next_logical()?;
            continue;
        }
        if !cluster_font_has_halt(&cluster) {
            return None;
        }
        if !line_end_trim_eligible(character) {
            return None;
        }
        let trimmed = cluster_advance - 0.5 * f64::from(cluster.run().font_size());
        if advance + trimmed > max_advance + f64::from(LINE_FIT_EPS) {
            return None;
        }
        // Only a PARAGRAPH-FINAL candidate rewinds (measured: `……。）啊`
        // with content after the closer breaks greedily; the razor-fit
        // note line whose `）` ends the paragraph rewinds its whole item).
        let candidate_end = byte + character.len_utf8();
        if !text
            .get(candidate_end..)
            .is_some_and(|rest| rest.chars().all(char::is_whitespace))
        {
            return None;
        }
        // The extension would fit; the rewound item is the one holding
        // the candidate, and it must begin inside this line.
        let item_start = item_ranges
            .iter()
            .find(|range| range.contains(&byte))
            .map(|range| range.start)?;
        let line_start = line.text_range().start;
        if item_start <= line_start {
            return None;
        }
        let count = text.get(line_start..item_start)?.chars().count();
        return u32::try_from(count).ok().filter(|count| *count > 0);
    }
    None
}

fn line_end_trim_candidate(
    layout: &parley::Layout<[u8; 4]>,
    text: &str,
    line_index: usize,
    max_advance: f32,
    accepted: &[usize],
    rejected: &[usize],
) -> Option<usize> {
    let line = layout.get(line_index)?;
    let next = layout.get(line_index + 1)?;
    // Only a fit-driven soft break can be extended; a forced break is not
    // a fit decision.
    if line.break_reason() != parley::layout::BreakReason::Regular {
        return None;
    }
    // Blink skips the extension whenever the line crosses an element
    // boundary (measured 2026-07-28, note-box ablation: a leading
    // <span>① kills it at every size, alignment and vertical-align while
    // a font-fallback split inside one element does not; flip widths
    // 560.35 span vs 541.41 without). The line must be one inline item.
    let mut line_item: Option<u32> = None;
    for item in line.items() {
        match item {
            PositionedLayoutItem::GlyphRun(run) => {
                let brush = u32::from_le_bytes(run.style().brush);
                if *line_item.get_or_insert(brush) != brush {
                    return None;
                }
            }
            // An atomic inline is an element boundary by definition.
            PositionedLayoutItem::InlineBox(_) => return None,
        }
    }
    let metrics = line.metrics();
    // Hung trailing whitespace is not measured against the available
    // advance; content is.
    let mut advance = metrics.advance - metrics.trailing_whitespace;
    let next_range = next.text_range();
    let mut cluster = parley::layout::Cluster::from_byte_index(layout, next_range.start)?;
    for _ in 0..LINE_END_TRIM_SCAN {
        let byte = cluster.text_range().start;
        if byte >= next_range.end {
            return None;
        }
        let character = text[byte..].chars().next()?;
        let cluster_advance = cluster.advance();
        if advance + cluster_advance <= max_advance + LINE_FIT_EPS {
            // Fits, so it only moved down under a break prohibition; the
            // overflowing character is further along.
            advance += cluster_advance;
            cluster = cluster.next_logical()?;
            continue;
        }
        // The first character that does not fit is the only one Blink
        // considers for the line-end trim.
        if !line_end_trim_eligible(character) {
            return None;
        }
        if !cluster_font_has_halt(&cluster) {
            return None;
        }
        if accepted.contains(&byte) || rejected.contains(&byte) {
            return None;
        }
        let trimmed = cluster_advance - 0.5 * cluster.run().font_size();
        if advance + trimmed > max_advance + LINE_FIT_EPS {
            return None;
        }
        return Some(byte);
    }
    None
}

/// Whether a fullwidth closing glyph is eligible for the conditional
/// line-end trim.
///
/// Blink (`ShapingLineBreaker::ShapeLine`, gated by
/// `Character::MaybeHanKerningClose`) extends a line past its first
/// overflowing character only when that character has static
/// `HanKerningCharType` `kClose` — fullwidth closing punctuation, Unicode
/// `Pe` within the CJK block or East Asian Fullwidth — or `kCloseQuote`
/// (`’` `”`). The dots and commas `。、，．` are `kDot` and the colons
/// `：；` are `kColon`/`kSemicolon`; both classes are excluded from the
/// line-end path even though they pair-trim mid-line. css-text-4
/// `text-spacing-trim: normal` words the same conditionality: closing
/// punctuation is set half-width at the end of the line only "if it does
/// not otherwise fit prior to justification". (Re-affirmed 2026-08-05:
/// synthetic oracles at 16px — left, justify, zh-TW — all send a
/// trailing 法，pair down instead of trimming the comma; b20's real
/// `看法，` line stays open evidence, see the task archive.)
fn line_end_trim_eligible(character: char) -> bool {
    matches!(
        character,
        '」' | '』' | '）' | '】' | '〕' | '》' | '〉' | '〗' | '〙' | '〛' | '｝' | '］'
            | '｠' | '’' | '”'
    )
}

/// Applies accepted line-end trims as negative letter-spacing on the
/// closing glyph itself — the same mechanism as the pair trims, so the
/// trimmed character is isolated in its own glyph run and the paint stays
/// position-exact. The blank right half collapses; the ink does not move.
/// Re-fuses the text fragments a ruby spread's letter-spacing edit split
/// apart, so each spread base paints (and carries its annotation) as one
/// fragment per line. Only adjacent, byte- and geometry-contiguous
/// fragments inside a single spread item merge; everything else passes
/// through untouched.
fn merge_ruby_spread_fragments(
    children: &mut Vec<(Fragment, f64)>,
    item_ranges: &[std::ops::Range<usize>],
    ruby_spreads: &std::collections::HashMap<usize, f64>,
) {
    let mut merged: Vec<(Fragment, f64)> = Vec::with_capacity(children.len());
    for (fragment, shift) in children.drain(..) {
        let mergeable = match (&fragment, merged.last()) {
            (Fragment::Text(next), Some((Fragment::Text(previous), previous_shift))) => {
                next.text_start == previous.text_end
                    && *previous_shift == shift
                    && (next.rect.x - (previous.rect.x + previous.rect.width)).abs() < 0.5
                    && item_ranges.iter().enumerate().any(|(index, range)| {
                        ruby_spreads.contains_key(&index)
                            && range.start <= previous.text_start as usize
                            && next.text_end as usize <= range.end
                    })
            }
            _ => false,
        };
        if mergeable {
            if let (Fragment::Text(next), Some((Fragment::Text(previous), _))) =
                (&fragment, merged.last_mut())
            {
                previous.rect.width = next.rect.x + next.rect.width - previous.rect.x;
                previous.text_end = next.text_end;
            }
            continue;
        }
        merged.push((fragment, shift));
    }
    *children = merged;
}

fn push_line_end_trims(
    builder: &mut RangedBuilder<'_, [u8; 4]>,
    text: &str,
    runs: &[(std::ops::Range<usize>, &InlineFormattingStyleV1, usize)],
    end_trims: &[usize],
) {
    for &byte in end_trims {
        let Some(character) = text[byte..].chars().next() else {
            continue;
        };
        let Some(style) = runs
            .iter()
            .find(|(range, ..)| range.contains(&byte))
            .map(|(_, style, _)| *style)
        else {
            continue;
        };
        let author = match style.text_flow.letter_spacing {
            LengthPercentage::Length(px) => px.get(),
            _ => 0.0,
        };
        builder.push(
            StyleProperty::LetterSpacing(author - 0.5 * shaping_font_size(style.font.size.get())),
            byte..byte + character.len_utf8(),
        );
    }
}

/// The browser shapes at the computed font size truncated toward zero
/// onto the 1/100 px grid, and the product is an F32 MULTIPLY — the
/// browser's font cache key is saturated_cast<unsigned>(font_size *
/// 100.0f) on the f32 computed size. The f32 product's own rounding is
/// the whole rule: 15.2 * 100 rounds up to exactly 1520.0 and passes
/// through, while 18.72 * 100 lands at 1871.99988 and truncates to
/// 18.71 (Range-measured: a lone 18.72px ideograph advances 1197.4394
/// = 1/64ths of fixed-point 18.71, and 9.36 -> 9.35, 37.44 -> 37.43,
/// 18.8 -> 18.79; 15.9999/15.999/15.995 -> 15.99, 15.9375 -> 15.93,
/// 17.06667 -> 17.06, and 15.2/12.16/16.01 pass through unchanged). An
/// f64 product orders 18.72 the other way (1871.99993, within any
/// hand-tuned snap tolerance), so the multiply must stay in f32.
fn shaping_font_size(size: f32) -> f32 {
    let hundredths = size * 100.0_f32;
    hundredths.trunc() / 100.0_f32
}

fn push_item_styles(
    builder: &mut RangedBuilder<'_, [u8; 4]>,
    style: &InlineFormattingStyleV1,
    range: std::ops::Range<usize>,
) {
    let stack = family_stack_source(style);
    builder.push(
        StyleProperty::FontFamily(parley::FontFamily::Source(Cow::Owned(stack))),
        range.clone(),
    );
    builder.push(
        StyleProperty::FontSize(shaping_font_size(style.font.size.get())),
        range.clone(),
    );
    builder.push(
        StyleProperty::FontWeight(parley::FontWeight::new(style.font.weight.get())),
        range.clone(),
    );
    match style.font.slant {
        FontSlant::Normal => {}
        FontSlant::Italic => {
            builder.push(
                StyleProperty::FontStyle(parley::FontStyle::Italic),
                range.clone(),
            );
        }
        FontSlant::Oblique(angle) => {
            builder.push(
                StyleProperty::FontStyle(parley::FontStyle::Oblique(Some(angle.degrees()))),
                range.clone(),
            );
        }
    }
    match style.font.line_height {
        LineHeight::Normal => {}
        LineHeight::Number(number) => {
            builder.push(
                StyleProperty::LineHeight(parley::LineHeight::FontSizeRelative(number.get())),
                range.clone(),
            );
        }
        LineHeight::Length(px) => {
            builder.push(
                StyleProperty::LineHeight(parley::LineHeight::Absolute(px.get())),
                range.clone(),
            );
        }
    }
    if let LengthPercentage::Length(px) = style.text_flow.letter_spacing {
        if px.get() != 0.0 {
            builder.push(StyleProperty::LetterSpacing(px.get()), range.clone());
        }
    }
    if let LengthPercentage::Length(px) = style.text_flow.word_spacing {
        if px.get() != 0.0 {
            builder.push(StyleProperty::WordSpacing(px.get()), range.clone());
        }
    }
    match style.text_flow.word_break {
        rito_style_contract::WordBreak::Normal => {}
        rito_style_contract::WordBreak::BreakAll => {
            builder.push(
                StyleProperty::WordBreak(parley::WordBreak::BreakAll),
                range.clone(),
            );
        }
        rito_style_contract::WordBreak::KeepAll => {
            builder.push(
                StyleProperty::WordBreak(parley::WordBreak::KeepAll),
                range.clone(),
            );
        }
    }
    match style.text_flow.overflow_wrap {
        rito_style_contract::OverflowWrap::Normal => {}
        rito_style_contract::OverflowWrap::Anywhere => {
            builder.push(
                StyleProperty::OverflowWrap(parley::OverflowWrap::Anywhere),
                range.clone(),
            );
        }
        rito_style_contract::OverflowWrap::BreakWord => {
            builder.push(
                StyleProperty::OverflowWrap(parley::OverflowWrap::BreakWord),
                range.clone(),
            );
        }
    }
    match style.text_flow.text_wrap_mode {
        rito_style_contract::TextWrapMode::Wrap => {}
        rito_style_contract::TextWrapMode::NoWrap => {
            builder.push(
                StyleProperty::TextWrapMode(parley::TextWrapMode::NoWrap),
                range,
            );
        }
    }
}

fn family_stack_source(style: &InlineFormattingStyleV1) -> String {
    style
        .font
        .families
        .iter()
        .map(|family| match family {
            FontFamily::Named(name) => format!("\"{}\"", name.as_str()),
            FontFamily::Generic(generic) => generic_source(*generic).to_owned(),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn generic_source(generic: GenericFontFamily) -> &'static str {
    match generic {
        GenericFontFamily::Serif => "serif",
        GenericFontFamily::SansSerif => "sans-serif",
        GenericFontFamily::Monospace => "monospace",
        GenericFontFamily::Cursive => "cursive",
        GenericFontFamily::Fantasy => "fantasy",
        GenericFontFamily::SystemUi => "system-ui",
    }
}

/// Points every generic family and every script's fallback at the given
/// registered families, in order.
///
/// With the platform font database excluded, the collection starts with no
/// generic mappings and no fallback entries at all; a stack ending in
/// `serif`, or a run of text no stack family covers, would otherwise
/// resolve to nothing and silently drop its glyphs. Han gets its tracked
/// locale-specific entries too, so `ja`/`ko`/regional-Chinese content
/// falls back the same way default Chinese does.
fn install_universal_fallbacks(
    collection: &mut parley::fontique::Collection,
    families: &[parley::fontique::FamilyId],
) {
    use parley::fontique::{FallbackKey, GenericFamily, Script, ScriptExt as _};
    const GENERICS: &[GenericFamily] = &[
        GenericFamily::Serif,
        GenericFamily::SansSerif,
        GenericFamily::Monospace,
        GenericFamily::Cursive,
        GenericFamily::Fantasy,
        GenericFamily::SystemUi,
        GenericFamily::UiSerif,
        GenericFamily::UiSansSerif,
        GenericFamily::UiMonospace,
        GenericFamily::UiRounded,
        GenericFamily::Emoji,
        GenericFamily::Math,
        GenericFamily::FangSong,
    ];
    for generic in GENERICS {
        collection.set_generic_families(*generic, families.iter().copied());
    }
    for (script, _) in Script::all_samples() {
        collection.set_fallbacks(FallbackKey::new(*script, None), families.iter().copied());
    }
    let han = Script::from_str_unchecked("Hani");
    for locale in ["ja", "ko", "zh-TW", "zh-HK", "zh-MO", "zh-SG"] {
        collection.set_fallbacks((han, locale), families.iter().copied());
    }
}

/// A plain-text paragraph style: the given font stack and size, `normal`
/// line height and weight, no decoration, spacing, or transforms, and an
/// optional first-line indent. This is the style of an undecorated body
/// paragraph; harnesses and tests use it to isolate line breaking from the
/// rest of the inline contract.
pub fn plain_paragraph_style(
    families: rito_style_contract::FontFamilies,
    font_size_px: f32,
    first_line_indent_px: f32,
) -> InlineFormattingStyleV1 {
    use rito_style_contract::{
        AbsoluteColor, AbsoluteColorSpace, AlignmentBaseline, BaselineShift, BaselineSource,
        BorderEdge, BorderEdges, BorderRadii, BorderStyle, ColorNoneFlags, CornerRadius, CssPx,
        Direction, FontStyleV1, FontWeight, InlineBidiV1, InlineFragmentStyleV1,
        InlinePaintStyleV1, InlineTextFlowV1, LengthPercentageOrAuto, LineBreak, NonNegativeCssPx,
        NonNegativeLengthPercentage, OverflowWrap, PhysicalSides, RubyAlign, TextAlign,
        TextDecoration,
        TextDecorationLines, TextDecorationStyle, TextIndent, TextJustify, TextTransform,
        TextTransformCase, TextWrapMode, TransformListV1, UnicodeBidi, UnitInterval,
        WhiteSpaceCollapse, WordBreak, WritingMode,
    };
    use std::sync::Arc;

    let zero = CssPx::new(0.0).expect("zero length is finite");
    let zero_length = LengthPercentage::Length(zero);
    let black = AbsoluteColor::new(
        AbsoluteColorSpace::Srgb,
        [0.0, 0.0, 0.0],
        1.0,
        ColorNoneFlags::new(false, false, false, false),
    )
    .expect("black is finite");
    let border = BorderEdge {
        resolved_width: NonNegativeCssPx::new(0.0).expect("zero width"),
        style: BorderStyle::None,
        color: black.into(),
    };
    let radius = CornerRadius {
        horizontal: NonNegativeLengthPercentage::new(zero_length),
        vertical: NonNegativeLengthPercentage::new(zero_length),
    };
    fn sides<T: Copy>(value: T) -> PhysicalSides<T> {
        PhysicalSides {
            top: value,
            right: value,
            bottom: value,
            left: value,
        }
    }
    InlineFormattingStyleV1 {
        font: FontStyleV1 {
            families,
            is_system_font: false,
            is_initial: false,
            size: NonNegativeCssPx::new(font_size_px).expect("font size is non-negative"),
            weight: FontWeight::new(400.0).expect("normal weight is valid"),
            slant: FontSlant::Normal,
            line_height: LineHeight::Normal,
            line_height_is_declared: false,
        },
        text_flow: InlineTextFlowV1 {
            text_align: TextAlign::Start,
            text_justify: TextJustify::Auto,
            text_transform: TextTransform {
                case: TextTransformCase::None,
                full_width: false,
                full_size_kana: false,
            },
            white_space_collapse: WhiteSpaceCollapse::Collapse,
            text_wrap_mode: TextWrapMode::Wrap,
            word_break: WordBreak::Normal,
            line_break: LineBreak::Auto,
            overflow_wrap: OverflowWrap::Normal,
            letter_spacing: zero_length,
            word_spacing: zero_length,
            text_indent: TextIndent {
                value: LengthPercentage::Length(
                    CssPx::new(first_line_indent_px).expect("indent is finite"),
                ),
                hanging: false,
                each_line: false,
            },
            ruby_align: RubyAlign::SpaceAround,
            language: None,
        },
        bidi: InlineBidiV1 {
            direction: Direction::LeftToRight,
            unicode_bidi: UnicodeBidi::Normal,
            writing_mode: WritingMode::HorizontalTopToBottom,
        },
        fragment: InlineFragmentStyleV1 {
            margin: sides(LengthPercentageOrAuto::Value(zero_length)),
            padding: sides(NonNegativeLengthPercentage::new(zero_length)),
            border: BorderEdges {
                top: border,
                right: border,
                bottom: border,
                left: border,
            },
            border_radii: BorderRadii {
                top_left: radius,
                top_right: radius,
                bottom_right: radius,
                bottom_left: radius,
            },
            alignment_baseline: AlignmentBaseline::Baseline,
            baseline_source: BaselineSource::Auto,
            baseline_shift: BaselineShift::Offset(zero_length),
        },
        paint: InlinePaintStyleV1 {
            foreground: black,
            opacity: UnitInterval::new(1.0).expect("opacity is bounded"),
            background: black.into(),
            background_image: None,
            transform: TransformListV1::none(),
            text_decoration: TextDecoration {
                lines: TextDecorationLines::new(false, false, false, false),
                style: TextDecorationStyle::Solid,
                color: black.into(),
            },
            text_shadows: Arc::from(Vec::new()),
            box_shadows: Arc::from(Vec::new()),
        },
    }
}

/// The paragraph's CSS strut height: its specified line-height in px, or
/// `None` for `normal` (where the content envelope wins). Inherited, so
/// the first item's style carries the paragraph value.
/// Maps the computed `text-align` onto Parley's line alignment. The
/// Servo-internal `-moz-*` values behave as their physical counterparts.
/// One cluster's advance in the browser's 16.16 fixed-point pen domain:
/// scale = round(size * 65536), px = trunc(units * scale / upem) / 65536,
/// with author letter-spacing added OUTSIDE the fixed-point round trip
/// (it was folded into the cluster advance after shaping).
fn hb_fixed_cluster_advance<B: parley::style::Brush>(
    current: &parley::layout::Cluster<'_, B>,
    run_letter_spacing: f64,
) -> f64 {
    use skrifa::raw::TableProvider as _;
    let advance = f64::from(current.advance());
    let run = current.run();
    let font = run.font();
    let Ok(font_ref) = skrifa::FontRef::from_index(font.data.as_ref(), font.index) else {
        return advance;
    };
    let Ok(head) = font_ref.head() else {
        return advance;
    };
    let upem = i64::from(head.units_per_em());
    let size = f64::from(run.font_size());
    if upem <= 0 || size <= 0.0 {
        return advance;
    }
    let scale = (size * 65536.0).round() as i64;
    let bare = advance - run_letter_spacing;
    let units = (bare * upem as f64 / size).round() as i64;
    (units * scale / upem) as f64 / 65536.0 + run_letter_spacing
}

fn paragraph_alignment(value: TextAlign) -> parley::Alignment {
    match value {
        TextAlign::Start => parley::Alignment::Start,
        TextAlign::End => parley::Alignment::End,
        TextAlign::Left | TextAlign::MozLeft => parley::Alignment::Left,
        TextAlign::Right | TextAlign::MozRight => parley::Alignment::Right,
        TextAlign::Center | TextAlign::MozCenter => parley::Alignment::Center,
        TextAlign::Justify => parley::Alignment::Justify,
    }
}

/// How a percentage-sized replaced element behaves in a sizing pass with
/// no percentage basis, i.e. intrinsic (min/max-content) sizing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PercentageImageSizing {
    /// Contributes its intrinsic size (the max-content contribution, and
    /// the only sensible behavior once a real basis exists).
    Intrinsic,
    /// Contributes nothing: the element can shrink to any size, which is
    /// its min-content contribution.
    Shrunk,
}

/// Resolves an image's display size from its intrinsic dimensions and the
/// CSS sizing fields of its layout style.
///
/// The supported slice: `auto` sizes use the intrinsic dimension (scaled by
/// ratio when the other axis is fixed), fixed lengths are used as written,
/// and a `max-width` length or percentage caps the result preserving the
/// ratio. Percentages resolve against `available_inline_size`; in intrinsic
/// (min/max-content) sizing there is none, and percentage-based fields are
/// treated as their auto/none behavior per CSS. Everything else fails
/// closed.
fn image_display_size(
    intrinsic_width: f64,
    intrinsic_height: f64,
    layout_style: &LayoutFormattingStyleV1,
    available_inline_size: Option<f64>,
    available_block_size: Option<f64>,
    containing_block_size: Option<f64>,
    percentage_images: PercentageImageSizing,
    viewport: Option<(f64, f64)>,
) -> Result<(f32, f32), LayoutError> {
    // A percentage with no basis appears only in intrinsic (min/max-
    // content) sizing, where resolving it would be circular. CSS makes
    // such a replaced element contribute nothing to its container's
    // intrinsic size, which is how a percentage-sized image lets a table
    // cell keep its own specified width instead of being forced to the
    // image's natural width.
    let percentage_without_basis = std::cell::Cell::new(false);
    let resolve = |value: LengthPercentage| -> Option<f64> {
        match value {
            LengthPercentage::Length(px) => Some(f64::from(px.get())),
            LengthPercentage::Percentage(ratio) => match available_inline_size {
                Some(basis) => Some(f64::from(ratio.ratio()) * basis),
                None => {
                    percentage_without_basis.set(true);
                    None
                }
            },
            LengthPercentage::Linear { length, percentage } => match available_inline_size {
                Some(basis) => {
                    Some(f64::from(length.get()) + f64::from(percentage.ratio()) * basis)
                }
                None => {
                    percentage_without_basis.set(true);
                    None
                }
            },
        }
    };
    // A percentage height resolves against the containing block's height,
    // not its width, and computes to `auto` when that height is indefinite
    // (CSS 2.1 §10.5) — which is the usual case in a continuous flow. Only
    // a length is definite here.
    // The containing block's height is INDEFINITE in a continuous flow,
    // so a percentage height computes to auto (CSS 2.1 §10.5) — the
    // `available_block_size` here is the reader's page CLAMP, not a
    // definite containing height (measured on b77's svg-wrapped plates:
    // height=100% resolved against the 850 clamp blew every plate to
    // full page, where the browser lays 627.219 × width·viewBox-ratio).
    // When the containing block resolved a FIXED height, that content
    // height is definite and percentages resolve against it (measured on
    // b2's plates: `height: 90vh` on the wrapper makes the img's
    // `max-height: 100%` bite at 765px where the indefinite-flow rule
    // left it at the 850px page clamp — one blank page per plate).
    let resolve_block = |value: LengthPercentage| -> Option<f64> {
        match value {
            LengthPercentage::Length(px) => Some(f64::from(px.get())),
            LengthPercentage::Percentage(ratio) => {
                containing_block_size.map(|basis| f64::from(ratio.ratio()) * basis)
            }
            LengthPercentage::Linear { length, percentage } => containing_block_size
                .map(|basis| f64::from(length.get()) + f64::from(percentage.ratio()) * basis),
        }
    };
    let preferred = |value: PreferredSizeV1,
                     axis: &str,
                     block: bool|
     -> Result<Option<f64>, LayoutError> {
        match value {
            PreferredSizeV1::Auto => Ok(None),
            PreferredSizeV1::Value(value) => Ok(if block {
                resolve_block(value.value())
            } else {
                resolve(value.value())
            }),
            other => Err(LayoutError::Invalid(format!(
                "image {axis} sizing {other:?} is not representable yet"
            ))),
        }
    };
    // The ELEMENT box of an svg-folded image sizes by the svg's own
    // viewBox ratio, not the inner raster's (they differ on covers:
    // viewBox 1434x2048 vs raster 1119x1600); the raster then
    // contain-fits inside via `fit_contain` at paint time.
    let ratio = if let Some((viewport_width, viewport_height)) = viewport {
        if viewport_width > 0.0 && viewport_height > 0.0 {
            viewport_height / viewport_width
        } else {
            1.0
        }
    } else if intrinsic_width > 0.0 && intrinsic_height > 0.0 {
        intrinsic_height / intrinsic_width
    } else {
        1.0
    };
    let preferred_width = preferred(layout_style.width, "width", false)?;
    let preferred_height = preferred(layout_style.height, "height", true)?;
    // A percentage `max-width` makes the element just as shrinkable as a
    // percentage `width` does, so it collapses the same way when there is
    // no basis to resolve against.
    if let MaximumSizeV1::Value(cap) = layout_style.max_width {
        let _ = resolve(cap.value());
    }
    let width_percentage_without_basis = percentage_without_basis.get();
    // With BOTH axes author-specified the aspect ratio is out of the
    // picture: max-width/max-height constrain each axis independently,
    // distortion included (measured: a 723x1 strip declared 538395x1430
    // stretches full-page in the browser, not ratio-preserving). The
    // reader PAGE clamp below is different: it scales the authored box
    // uniformly, keeping whatever ratio the author resolved.
    let (mut width, mut height) = match (preferred_width, preferred_height) {
        (Some(width), Some(height)) => (width, height),
        // The ratio-derived cross axis truncates onto the 1/64 grid:
        // Blink resolves a width-authored image's auto height as a
        // LayoutUnit (measured: width 43.78125 x ratio 249/248 shows
        // 43.953125 = trunc64(43.9578) in the DOM rect).
        (Some(width), None) => (width, (width * ratio * 64.0).floor() / 64.0),
        (None, Some(height)) => (height / ratio.max(f64::EPSILON), height),
        (None, None) => (intrinsic_width, intrinsic_height),
    };
    if percentage_images == PercentageImageSizing::Shrunk {
        // Every image is width-capped at its container by the reader's
        // display policy (the truth side mirrors it as max-width: 100%),
        // and a percentage-capped replaced element is fully shrinkable in
        // the min-content pass — a table column holding a fixed-width
        // portrait shrinks to its TEXT minimum, not the image (measured:
        // a 5-column 8em/2.5em grid under a 25.5em table distributes
        // 59.2/19.4/72.3 where image-hard minimums pinned every column).
        let _ = width_percentage_without_basis;
        return Ok((0.0, 0.0));
    }
    if let MaximumSizeV1::Value(cap) = layout_style.max_width {
        if let Some(cap) = resolve(cap.value()) {
            if width > cap && width > 0.0 {
                let scale = cap / width;
                width = cap;
                // A clamp rescales only the AUTO cross axis: an
                // author-specified axis holds and the image distorts,
                // exactly as the browser resolves CSS 2.1 §10.4 (measured:
                // a width:100% manga plate under the page-height clamp
                // keeps its 640px width — the ratio-preserving shrink to
                // 598px shifted every halftone dot on the page).
                if preferred_height.is_none() {
                    height *= scale;
                }
            }
        }
    }
    // `max-height` mirrors `max-width`: a length always binds; a
    // percentage binds only against a definite containing height. The
    // clamp rescales only the AUTO cross axis, like the max-width arm.
    let max_height_cap = match layout_style.max_height {
        rito_style_contract::MaximumHeightV1::None => None,
        rito_style_contract::MaximumHeightV1::Length(px) => Some(f64::from(px.get())),
        rito_style_contract::MaximumHeightV1::Percentage(ratio) => {
            containing_block_size.map(|basis| f64::from(ratio.ratio()) * basis)
        }
    };
    if let Some(cap) = max_height_cap {
        if height > cap && height > 0.0 {
            let scale = cap / height;
            height = cap;
            if preferred_width.is_none() {
                width *= scale;
            }
        }
    }
    // Reader UA policy, declared rather than implicit: a replaced element
    // never exceeds one page, and the page clamp scales the AUTHORED box
    // uniformly — both axes by one factor — so the clamp never distorts
    // (b52's 705x1000 cover under `img{width:100%}` squashed 640x907.8
    // into 640x850 when the axes clamped independently; the reader is the
    // product surface and a stretched cover is a defect, whatever a
    // browser under an injected max-height would do). A box the author
    // deliberately distorted keeps its authored ratio while shrinking.
    // The truth harness mirrors this exact policy per element.
    {
        let mut scale = 1.0_f64;
        if let Some(page_height) = available_block_size {
            if height > page_height && height > 0.0 && page_height > 0.0 {
                scale = scale.min(page_height / height);
            }
        }
        // The width cap binds on its own: inside a table cell there is
        // no block-size budget, but the container cap still holds (the
        // truth side's max-width: 100% shrinks a 6.5em portrait into its
        // 57.2px column; gating the width cap on the page height left it
        // at its authored size).
        if let Some(basis_width) = available_inline_size {
            if width > basis_width && width > 0.0 && basis_width > 0.0 {
                scale = scale.min(basis_width / width);
            }
        }
        if scale < 1.0 {
            width *= scale;
            height *= scale;
        }
    }
    // Blink stores used lengths as LayoutUnits: the resolved size floors
    // to the 1/64 grid (measured: `height: 1.2em` at a 12px font is
    // 14.390625 used, not 14.4 — the un-floored height left a footnote
    // marker's line 0.009px tall and flipped its baseline rounding).
    let layout_unit_floor = |value: f64| (value * 64.0).floor() / 64.0;
    Ok((
        layout_unit_floor(width) as f32,
        layout_unit_floor(height) as f32,
    ))
}

/// The first-line indent this style asks for, in CSS px. Percentages need a
/// containing-block basis the inline context does not have; they fail to
/// zero here and must be resolved by the block container before reaching
/// this provider. Negative values pass through: a hanging indent
/// (`text-indent: -1em; padding-left: 1em`) out-dents the first line
/// into the padding and widens its advance by the same amount, exactly
/// parley's linear indent math (measured on b19's `.po` footnotes:
/// first line one em left of the continuation lines).
/// The used first-line indent on Blink's LayoutUnit grid, TRUNCATED
/// toward zero exactly like the padding path (LayoutUnit's float
/// constructor truncates): a 2em indent at 15.2px is 30.4 in CSS
/// arithmetic but 30.390625 in every Blink line position (measured on
/// b20 p018: truth glyph x 39.8125 = base 9.421875 + 30.390625, while
/// the engine's float 30.4 started 0.009375 right — every glyph's
/// subpixel phase shifted and the whole line lit up as AA diff).
fn resolved_text_indent(style: &InlineFormattingStyleV1) -> f32 {
    match style.text_flow.text_indent.value {
        LengthPercentage::Length(px) => {
            ((f64::from(px.get()) * 64.0).trunc() / 64.0) as f32
        }
        _ => 0.0,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use rito_fragment::{BreakToken, BreakTokenStage, FormattingNode, FragmentCache};
    use rito_style_contract::{
        AbsoluteColor, AbsoluteColorSpace, AlignmentBaseline, BaselineShift, BaselineSource,
        BorderEdge, BorderEdges, BorderRadii, BorderStyle, ColorNoneFlags, CornerRadius, CssPx,
        FontFamilies, FontFamilyName, FontStyleV1, FontWeight, InlineBidiV1, InlineFragmentStyleV1,
        InlinePaintStyleV1, InlineStyleTableV1, InlineTextFlowV1, LayoutStyleTableV1,
        LengthPercentageOrAuto, NonNegativeCssPx, NonNegativeLengthPercentage, PhysicalSides,
        RubyAlign, TextAlign, TextDecoration, TextDecorationLines, TextDecorationStyle,
        TextIndent, TextJustify, TextTransform, TextTransformCase, TextWrapMode, TransformListV1, UnitInterval,
        WhiteSpaceCollapse, WordBreak,
    };
    use rito_style_contract::{Direction, LineBreak, OverflowWrap, UnicodeBidi, WritingMode};
    use std::sync::Arc;

    const FONT_SIZE: f32 = 16.0;

    fn tinos_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
        );
        std::fs::read(path).expect("pinned Tinos test font reads")
    }

    fn px(value: f32) -> NonNegativeCssPx {
        NonNegativeCssPx::new(value).expect("test length is non-negative")
    }

    fn transparent() -> AbsoluteColor {
        AbsoluteColor::new(
            AbsoluteColorSpace::Srgb,
            [0.0, 0.0, 0.0],
            1.0,
            ColorNoneFlags::new(false, false, false, false),
        )
        .expect("test color is finite")
    }

    fn sides<T: Copy>(value: T) -> PhysicalSides<T> {
        PhysicalSides {
            top: value,
            right: value,
            bottom: value,
            left: value,
        }
    }

    fn tinos_style(indent_px: f32) -> InlineFormattingStyleV1 {
        let border = BorderEdge {
            resolved_width: px(0.0),
            style: BorderStyle::None,
            color: transparent().into(),
        };
        let radius = CornerRadius {
            horizontal: NonNegativeLengthPercentage::new(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero radius"),
            )),
            vertical: NonNegativeLengthPercentage::new(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero radius"),
            )),
        };
        InlineFormattingStyleV1 {
            font: FontStyleV1 {
                families: FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
                    .expect("family list is non-empty"),
                is_system_font: false,
                is_initial: false,
                size: px(FONT_SIZE),
                weight: FontWeight::new(400.0).expect("valid weight"),
                slant: FontSlant::Normal,
                line_height: LineHeight::Normal,
                line_height_is_declared: false,
            },
            text_flow: InlineTextFlowV1 {
                text_align: TextAlign::Start,
                text_justify: TextJustify::Auto,
                text_transform: TextTransform {
                    case: TextTransformCase::None,
                    full_width: false,
                    full_size_kana: false,
                },
                white_space_collapse: WhiteSpaceCollapse::Collapse,
                text_wrap_mode: TextWrapMode::Wrap,
                word_break: WordBreak::Normal,
                line_break: LineBreak::Auto,
                overflow_wrap: OverflowWrap::Normal,
                letter_spacing: LengthPercentage::Length(CssPx::new(0.0).expect("zero spacing")),
                word_spacing: LengthPercentage::Length(CssPx::new(0.0).expect("zero spacing")),
                text_indent: TextIndent {
                    value: LengthPercentage::Length(CssPx::new(indent_px).expect("finite indent")),
                    hanging: false,
                    each_line: false,
                },
                ruby_align: RubyAlign::SpaceAround,
                language: None,
            },
            bidi: InlineBidiV1 {
                direction: Direction::LeftToRight,
                unicode_bidi: UnicodeBidi::Normal,
                writing_mode: WritingMode::HorizontalTopToBottom,
            },
            fragment: InlineFragmentStyleV1 {
                margin: sides(LengthPercentageOrAuto::Value(LengthPercentage::Length(
                    CssPx::new(0.0).expect("zero margin"),
                ))),
                padding: sides(NonNegativeLengthPercentage::new(LengthPercentage::Length(
                    CssPx::new(0.0).expect("zero padding"),
                ))),
                border: BorderEdges {
                    top: border,
                    right: border,
                    bottom: border,
                    left: border,
                },
                border_radii: BorderRadii {
                    top_left: radius,
                    top_right: radius,
                    bottom_right: radius,
                    bottom_left: radius,
                },
                alignment_baseline: AlignmentBaseline::Baseline,
                baseline_source: BaselineSource::Auto,
                baseline_shift: BaselineShift::Offset(LengthPercentage::Length(
                    CssPx::new(0.0).expect("zero shift"),
                )),
            },
            paint: InlinePaintStyleV1 {
                foreground: transparent(),
                opacity: UnitInterval::new(1.0).expect("opacity is bounded"),
                background: transparent().into(),
                background_image: None,
                transform: TransformListV1::none(),
                text_decoration: TextDecoration {
                    lines: TextDecorationLines::new(false, false, false, false),
                    style: TextDecorationStyle::Solid,
                    color: transparent().into(),
                },
                text_shadows: Arc::from(Vec::new()),
                box_shadows: Arc::from(Vec::new()),
            },
        }
    }

    fn paragraph_tree(text: &str, indent_px: f32) -> (FormattingTree, String) {
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(0, tinos_style(indent_px))
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        (tree, text.to_owned())
    }

    fn line_texts(outcome: &LayoutOutcome, text: &str) -> Vec<String> {
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("inline outcome root is a box fragment");
        };
        root.children
            .iter()
            .map(|line| {
                let Fragment::Line(line) = line else {
                    panic!("inline children are line fragments");
                };
                let mut cursor: Option<u32> = None;
                let mut start = u32::MAX;
                let mut end = 0_u32;
                for run in &line.children {
                    let Fragment::Text(run) = run else {
                        panic!("line children are text fragments");
                    };
                    if let Some(previous_end) = cursor {
                        assert_eq!(
                            previous_end, run.text_start,
                            "run text ranges must tile the line without gaps"
                        );
                    }
                    cursor = Some(run.text_end);
                    start = start.min(run.text_start);
                    end = end.max(run.text_end);
                }
                assert!(start <= end, "lines carry at least one text fragment");
                text[start as usize..end as usize].to_owned()
            })
            .collect()
    }

    const SAMPLE: &str = "The quick brown fox jumps over the lazy dog and keeps \
running through the quiet forest until the morning light returns.";

    #[test]
    fn narrow_advance_breaks_into_multiple_reassemblable_lines() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, text) = paragraph_tree(SAMPLE, 0.0);
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(160.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let lines = line_texts(&outcome, &text);
        assert!(lines.len() > 2, "expected multiple lines, got {lines:?}");
        assert_eq!(lines.concat(), text);
        assert!(outcome.continuation.is_none());
    }

    /// `word-break: break-all` splits the CJK novel dash pair ──
    /// (U+2500) across the line boundary like Blink (b93 truth: the
    /// first ─ closes the line, the second opens the next). The latin
    /// and prolonged-sound cases pin Parley's own break-all relaxation
    /// so a parley upgrade that regresses them is caught here.
    #[test]
    fn break_all_splits_the_dash_pair_and_keeps_parley_relaxations() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        for text in ["中中──中中", "中中ab中中", "中中ずー中中"] {
            let mut style = plain_paragraph_style(
                rito_style_contract::FontFamilies::new(vec![FontFamily::Named(
                    FontFamilyName::new("NoSuchFace"),
                )])
                .expect("family list"),
                16.0,
                0.0,
            );
            style.text_flow.word_break = rito_style_contract::WordBreak::BreakAll;
            let mut inline = InlineStyleTableV1::new(1);
            let style_id = inline.intern_for_node(0, style).expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let natural = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("natural layout succeeds");
            let Fragment::Box(root) = &natural.fragments.root else {
                panic!("root is a box");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            let full_width: f64 = line.children.iter().map(|child| child.rect().width).sum();
            let outcome = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(full_width * 3.0 / 6.0 + 0.5),
                    None,
                    &CancelFlag::new(),
                )
                .expect("narrow layout succeeds");
            let lines = line_texts(&outcome, text);
            match text {
                "中中──中中" => assert_eq!(
                    lines,
                    vec!["中中─".to_owned(), "─中中".to_owned()],
                    "break-all must split the dash pair"
                ),
                "中中ab中中" => assert_eq!(lines.first().map(String::as_str), Some("中中a")),
                _ => assert_eq!(lines.first().map(String::as_str), Some("中中ず")),
            }
        }
    }

    /// The reader page clamp scales the authored box UNIFORMLY: a
    /// 705x1000 cover under `img { width: 100% }` resolves 640x907.8 and
    /// shrinks to 599.25x850 — never the axis-independent squash to
    /// 640x850 that stretched b52's cover in the reader.
    /// A trailing U+3000 run HANGS at the line end: excluded from
    /// centered/right alignment (while shrink-to-fit boxes keep it —
    /// u3000-hang oracle, b52 Next-2-w: the table box spans 的+3 U+3000
    /// wide, yet Blink inks 的 dead-centre; parley only excludes its own
    /// ASCII whitespace class, which the control rows pin).
    #[test]
    fn a_trailing_ideographic_space_run_hangs_out_of_alignment() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let line_x = |text: &str, align: TextAlign| -> f64 {
            let mut style = plain_paragraph_style(
                rito_style_contract::FontFamilies::new(vec![FontFamily::Named(
                    FontFamilyName::new("NoSuchFace"),
                )])
                .expect("family list"),
                40.0,
                0.0,
            );
            style.text_flow.text_align = align;
            let mut inline = InlineStyleTableV1::new(1);
            let style_id = inline.intern_for_node(0, style).expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(640.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("root is a box");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            let Some(Fragment::Text(run)) = line.children.first() else {
                panic!("line has a text run");
            };
            // The NET paint position (line + child) is the observable —
            // the first landing shifted the line box while the children
            // compensated against it, cancelling to a pixel-null.
            line.rect.x + run.rect.x
        };
        let bare = line_x("\u{7684}", TextAlign::Center);
        // Three trailing U+3000 leave the centering: the glyph inks where
        // the bare control does. Before the law the line centered at
        // (640-160)/2 = 240, sixty pixels left of the truth.
        let hung = line_x("\u{7684}\u{3000}\u{3000}\u{3000}", TextAlign::Center);
        assert!(
            (hung - bare).abs() < 1e-3,
            "centered line must ignore the hung tail: bare {bare}, hung {hung}"
        );
        // Parley already drops trailing ASCII spaces — the shift must not
        // double-count them.
        let ascii = line_x("\u{7684}   ", TextAlign::Center);
        assert!(
            (ascii - bare).abs() < 1e-3,
            "ascii trailing spaces stay parley's own: bare {bare}, ascii {ascii}"
        );
        // Right alignment hangs the tail past the edge: 的 stays flush.
        let right_bare = line_x("\u{7684}", TextAlign::Right);
        let right_hung = line_x("\u{7684}\u{3000}", TextAlign::Right);
        assert!(
            (right_hung - right_bare).abs() < 1e-3,
            "right-aligned line must hang the tail: bare {right_bare}, hung {right_hung}"
        );
    }

    #[test]
    fn the_b52_title_cell_centers_its_ink_with_the_tail_hung() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(4);
        let families = || rito_style_contract::FontFamilies::new(vec![FontFamily::Named(
            FontFamilyName::new("NoSuchFace"),
        )]).expect("family list");
        let mut items = Vec::new();
        for (index, (text, size)) in [("为", 40.0), ("美", 48.0), ("好", 48.0), ("的\u{3000}\u{3000}\u{3000}", 40.0)].into_iter().enumerate() {
            let mut style = plain_paragraph_style(families(), size, 0.0);
            style.text_flow.text_align = TextAlign::Center;
            let style_id = inline.intern_for_node(index, style).expect("style interns");
            items.push(InlineItem::Text {
                text: text.to_owned(),
                style: style_id,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            });
        }
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(&tree, tree.root(), &ConstraintSpace::continuous(319.055), None, &CancelFlag::new())
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else { panic!() };
        let Fragment::Line(line) = &root.children[0] else { panic!() };
        let Some(Fragment::Text(first)) = line.children.first() else {
            panic!("line has runs");
        };
        // Cell width 319.055 (parley fit epsilon rides the container),
        // content 296 with a 120px hung tail: the visible ink centers at
        // (319.055 - (296 - 120)) / 2 = 71.5 — the b52 truth puts 为 at
        // page 282 = table 210.47 + 71.5.
        let net = line.rect.x + first.rect.x;
        assert!(
            (net - 71.535).abs() < 0.02,
            "为 must ink at the hang-centered offset, got {net}"
        );
    }

    /// Observation (b74 title writer cards): four adjacent bordered spans
    /// (`border: 1px; margin-right: 3px`, one 25px CJK glyph each) raster
    /// in Blink as 27px boxes at a 30px pitch. The pixel walk measured the
    /// engine's NON-FINAL cards 4px narrow (dark 21 vs 25) at a 26px
    /// pitch, the final card exact — this prints the run rects to locate
    /// where the 4px goes missing.
    #[test]
    fn observe_adjacent_bordered_span_run_boxes() {
        use rito_style_contract::{BorderEdge, BorderStyle, NonNegativeCssPx};
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(4);
        let families = || {
            rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
                "NoSuchFace",
            ))])
            .expect("family list")
        };
        let mut items = Vec::new();
        for (index, text) in ["瑞", "智", "士", "记"].into_iter().enumerate() {
            let mut style = plain_paragraph_style(families(), 25.0, 0.0);
            style.text_flow.text_align = TextAlign::Right;
            let edge = BorderEdge {
                resolved_width: NonNegativeCssPx::new(1.0).expect("one px"),
                style: BorderStyle::Solid,
                color: style.paint.foreground.into(),
            };
            style.fragment.border = rito_style_contract::BorderEdges {
                top: edge,
                right: edge,
                bottom: edge,
                left: edge,
            };
            style.fragment.margin.right = rito_style_contract::LengthPercentageOrAuto::Value(
                LengthPercentage::Length(rito_style_contract::CssPx::new(3.0).expect("finite")),
            );
            let style_id = inline.intern_for_node(index, style).expect("style interns");
            items.push(InlineItem::Text {
                text: text.to_owned(),
                style: style_id,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            });
        }
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(600.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!()
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!()
        };
        let mut runs: Vec<(f64, f64)> = Vec::new();
        for child in &line.children {
            if let Fragment::Text(run) = child {
                eprintln!(
                    "[cards] run x={:.3} w={:.3} net_x={:.3}",
                    run.rect.x,
                    run.rect.width,
                    line.rect.x + run.rect.x
                );
                runs.push((line.rect.x + run.rect.x, run.rect.width));
            }
        }
        assert_eq!(runs.len(), 4, "four card runs");
        // Blink: each card's painted box is glyph 25 + 2×1 border = 27,
        // pitch 30 (27 + 3 margin). The run rect is the CONTENT box (25
        // wide); the pen grows it by the border for paint. Every card —
        // not just the last — keeps its full 25px content width.
        for (index, (_, width)) in runs.iter().enumerate() {
            assert!(
                (width - 25.0).abs() < 0.05,
                "card {index} content box must be 25 wide, got {width}"
            );
        }
        let pitch0 = runs[1].0 - runs[0].0;
        assert!(
            (pitch0 - 30.0).abs() < 0.05,
            "card pitch must be 30 (27 box + 3 margin), got {pitch0}"
        );
    }

    #[test]
    fn observe_symbol_fallback_advances() {
        let tinos = tinos_bytes();
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![tinos, source_han]).expect("context builds");
        let text = "解决○∠五世代";
        let style = plain_paragraph_style(
            rito_style_contract::FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new(
                "NoSuchFace",
            ))])
            .expect("family list"),
            16.0,
            0.0,
        );
        let mut inline = InlineStyleTableV1::new(1);
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style: style_id,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(&tree, tree.root(), &ConstraintSpace::continuous(640.0), None, &CancelFlag::new())
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else { panic!() };
        let Fragment::Line(line) = &root.children[0] else { panic!() };
        for child in &line.children {
            if let Fragment::Text(run) = child {
                eprintln!("[sym] '{}' x={:.4} w={:.4}",
                    &text[run.text_start as usize..run.text_end as usize], run.rect.x, run.rect.width);
            }
        }
    }

    /// An inline horizontal margin displaces the inline box —
    /// and a span opening a forced-break line indents its OWN line by
    /// the lead (inline-margin oracle: margin-left 30% in a 100px block
    /// puts the box at x=30 on the span's line, the previous line
    /// untouched; the engine previously either rejected the style outright
    /// or would have widened the line above).
    #[test]
    fn an_inline_margin_indents_its_forced_break_line() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(2);
        let families = || rito_style_contract::FontFamilies::new(vec![FontFamily::Named(
            FontFamilyName::new("NoSuchFace"),
        )]).expect("family list");
        let plain = inline
            .intern_for_node(0, plain_paragraph_style(families(), 32.0, 0.0))
            .expect("style interns");
        let mut badge_style = plain_paragraph_style(families(), 22.4, 0.0);
        badge_style.fragment.margin.left = rito_style_contract::LengthPercentageOrAuto::Value(
            LengthPercentage::Percentage(
                rito_style_contract::Percentage::from_ratio(0.3).expect("finite ratio"),
            ),
        );
        let badge = inline.intern_for_node(1, badge_style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "王\n".to_owned(),
                        style: plain,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Text {
                        text: "的".to_owned(),
                        style: badge,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(&tree, tree.root(), &ConstraintSpace::continuous(100.0), None, &CancelFlag::new())
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let line_net = |line: &Fragment| -> f64 {
            let Fragment::Line(line) = line else {
                panic!("line fragment");
            };
            let Some(Fragment::Text(run)) = line.children.first() else {
                panic!("line has a run");
            };
            line.rect.x + run.rect.x
        };
        assert!(
            line_net(&root.children[0]).abs() < 1e-3,
            "the line above stays flush, got {}",
            line_net(&root.children[0])
        );
        assert!(
            (line_net(&root.children[1]) - 30.0).abs() < 1e-3,
            "the badge line indents by 30% of the container, got {}",
            line_net(&root.children[1])
        );
    }

    #[test]
    fn the_page_clamp_scales_the_authored_image_box_uniformly() {
        use rito_style_contract::{
            AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
            LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1,
            LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
            MinimumHeightV1, OverflowV1, PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let auto = LengthPercentageOrAuto::Auto;
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero"),
        ));
        let style = LayoutFormattingStyleV1 {
            display: LayoutDisplayV1 {
                outside: LayoutDisplayOutsideV1::Inline,
                inside: LayoutDisplayInsideV1::Flow,
                is_list_item: false,
            },
            margin: PhysicalSides {
                top: auto,
                right: auto,
                bottom: auto,
                left: auto,
            },
            padding: PhysicalSides {
                top: zero_padding,
                right: zero_padding,
                bottom: zero_padding,
                left: zero_padding,
            },
            box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
            justify_content: JustifyContentV1::Normal,
            align_items: AlignItemsV1::Normal,
            break_before: PageBreakV1::Auto,
            break_after: PageBreakV1::Auto,
            width: PreferredSizeV1::Value(NonNegativeLengthPercentage::new(
                LengthPercentage::Percentage(
                    rito_style_contract::Percentage::from_ratio(1.0).expect("finite"),
                ),
            )),
            height: PreferredSizeV1::Auto,
            max_width: MaximumSizeV1::None,
            min_height: MinimumHeightV1::Auto,
            max_height: MaximumHeightV1::None,
            clear: ClearV1::None,
            float: FloatV1::None,
            overflow: OverflowV1::Visible,
            list_style_type: ListMarkerStyleV1::None,
            position: PositionV1::Static,
            inset: PhysicalSides {
                top: auto,
                right: auto,
                bottom: auto,
                left: auto,
            },
            vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
            border_spacing: (
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            ),
            border_collapse: false,
        };
        let (width, height) = image_display_size(
            705.0,
            1000.0,
            &style,
            Some(640.0),
            Some(850.0),
            None,
            PercentageImageSizing::Intrinsic,
            None,
        )
        .expect("cover sizes");
        assert_eq!(height, 850.0, "the clamp pins the tall axis to the page");
        assert!(
            (f64::from(width) - 599.25).abs() < 0.02,
            "the width shrinks by the same factor (authored ratio kept), got {width}"
        );
    }

    /// Blink's default line-break lets the UAX-14 CJ class (small kana,
    /// prolonged sound mark) START a line — measured across zh-CN/ja/en
    /// × auto/normal/loose; only `line-break: strict` keeps the NS
    /// prohibition and retreats the pair (b39 truth: あず|ーる splits).
    #[test]
    fn a_cj_starter_may_open_a_line_unless_strict() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let layout_lines = |line_break: rito_style_contract::LineBreak| {
            let text = "中中中ずー中";
            let mut style = plain_paragraph_style(
                rito_style_contract::FontFamilies::new(vec![FontFamily::Named(
                    FontFamilyName::new("NoSuchFace"),
                )])
                .expect("family list"),
                16.0,
                0.0,
            );
            style.text_flow.line_break = line_break;
            let mut inline = InlineStyleTableV1::new(1);
            let style_id = inline.intern_for_node(0, style).expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let natural = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("natural layout succeeds");
            let Fragment::Box(root) = &natural.fragments.root else {
                panic!("root is a box");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            let full_width: f64 = line.children.iter().map(|child| child.rect().width).sum();
            let outcome = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(full_width * 4.0 / 6.0 + 0.5),
                    None,
                    &CancelFlag::new(),
                )
                .expect("narrow layout succeeds");
            line_texts(&outcome, text)
        };
        assert_eq!(
            layout_lines(rito_style_contract::LineBreak::Auto),
            vec!["中中中ず".to_owned(), "ー中".to_owned()],
            "default strictness lets the prolonged sound mark open a line"
        );
        assert_eq!(
            layout_lines(rito_style_contract::LineBreak::Strict),
            vec!["中中中".to_owned(), "ずー中".to_owned()],
            "strict keeps the NS prohibition and retreats the pair"
        );
    }

    /// A registered named font must win over the pinned fallback when the
    /// style names it: the two faces have different advances for the same
    /// glyphs, so the line width tells which one shaped.
    #[test]
    fn named_publication_fonts_shape_instead_of_the_pinned_fallback() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let mut context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        // Tinos under a publication name: its Latin advances differ from
        // Source Han's, so a hit is measurable.
        context
            .register_named_font("PubFace", tinos_bytes())
            .expect("named font registers");

        let shape_width = |families: Vec<FontFamily>| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(families).expect("family list"),
                        32.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "Wilhelm".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("root is a box");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .map(|child| child.rect().width)
                .sum::<f64>()
        };

        let named = shape_width(vec![FontFamily::Named(FontFamilyName::new("PubFace"))]);
        let fallback = shape_width(vec![FontFamily::Named(FontFamilyName::new("NoSuchFace"))]);
        assert!(
            (named - fallback).abs() > 1.0,
            "the named face must shape differently from the fallback: named {named}, fallback {fallback}"
        );
    }

    /// An opener's pair trim rides the OPENER (`halt` on 『), never the
    /// left character's spacing — a left-side credit leaks into the
    /// previous line's fit at a break boundary (measured on b20: the
    /// compressed ，squeezed onto the prior line, straddled the pair,
    /// and the one-way suppression killed the trim; Blink's full-width
    /// ，breaks 製|作 and 作，『 stays together with 『 at half width).
    /// Twenty 永 at 16px = 320; with 336 available the comma must NOT
    /// borrow the opener's half to squeeze in — the line breaks before
    /// 作 and the next line keeps 作，『 with the trimmed opener.
    #[test]
    fn an_opener_pair_trim_never_lends_width_to_the_previous_line() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let lay = |text: &str, width: f64| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        16.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(width),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds")
        };
        // 20 永 + 作 + full-width ，= 352; at 344 the OLD left-side
        // credit made the comma 8px and squeezed 作，onto the line
        // (splitting the pair from its opener and killing the trim);
        // the opener-side halt keeps the comma full so 作，『 travels
        // together, Blink's exact break shape.
        let text = format!("{}作，『給讀者的挑戰』", "永".repeat(20));
        let outcome = lay(&text, 344.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(
            lines[0],
            "永".repeat(20),
            "the full-width comma cannot borrow the opener's half"
        );
        assert!(
            lines[1].starts_with("作，『"),
            "the pair opens the continuation line with its opener: {:?}",
            lines[1]
        );
    }

    /// TEMP probe.
    #[test]
    fn line_natural_probe() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let shape_width = |text: &str| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        15.2,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("inline outcome root is a box fragment");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .map(|child| child.rect().width)
                .sum::<f64>()
        };
        let full = "「要注意的是『尚』字的唸法。尚子的尚是唸作ショウ，可是名片哥的名字就不一定";
        eprintln!("PROBE full = {}", shape_width(full));
        eprintln!("PROBE open = {}", shape_width("「要注意"));
        eprintln!("PROBE dot  = {}", shape_width("法。尚"));
        eprintln!("PROBE cma  = {}", shape_width("ウ，可"));
        eprintln!("PROBE q    = {}", shape_width("是『尚』字"));
    }

    /// The used line-box height quantizes by the DECLARATION TYPE, not
    /// uniformly: a number floors its product onto the 1/64 grid while a
    /// length (px/em/%) rounds — measured on pinned Chromium with both
    /// pin faces agreeing (metrics never enter). The discriminating pair
    /// is the b20 note strut: `line-height: 1.35` at 12.16px lays lines
    /// 16.40625 apart, while the SAME 16.416px declared as a length lays
    /// 16.421875 — the old uniform round drifted every paragraph below
    /// the note by 1/32 and flipped .5-tie lines a whole raster row.
    #[test]
    fn a_number_line_height_floors_and_a_length_rounds() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let line_step = |line_height: LineHeight| {
            let mut style = plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(
                    rito_style_contract::GenericFontFamily::Serif,
                )])
                .expect("family list"),
                12.16,
                0.0,
            );
            style.font.line_height = line_height;
            style.font.line_height_is_declared = true;
            let mut inline = InlineStyleTableV1::new(1);
            let interned = inline.intern_for_node(0, style).expect("style interns");
            let tree = FormattingTree::with_styles(
                vec![FormattingNode {
                    style: rito_style_contract::LayoutStyleId::from_raw(0),
                    content: FormattingNodeContent::InlineFlow {
                        items: vec![InlineItem::Text {
                            text: "永".repeat(24),
                            style: interned,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        }],
                    },
                    children: Vec::new(),
                }],
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(200.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("inline outcome root is a box fragment");
            };
            let lines: Vec<f64> = root
                .children
                .iter()
                .filter_map(|child| match child {
                    Fragment::Line(line) => Some(line.rect.y),
                    _ => None,
                })
                .collect();
            assert!(lines.len() >= 2, "fixture wraps to at least two lines");
            lines[1] - lines[0]
        };
        let number = line_step(LineHeight::Number(
            rito_style_contract::NonNegativeNumber::new(1.35).expect("finite"),
        ));
        assert!(
            (number - 16.40625).abs() < 1e-9,
            "number 1.35 × 12.16 floors to 16.40625: {number}"
        );
        let length = line_step(LineHeight::Length(
            rito_style_contract::NonNegativeCssPx::new(16.416).expect("finite"),
        ));
        assert!(
            (length - 16.421875).abs() < 1e-9,
            "length 16.416px rounds to 16.421875: {length}"
        );
    }

    /// The browser's justify classes admit geometric shapes and the
    /// star pair as CJK symbols (measured on a 20-symbol matrix: each of
    /// the shapes opens one share after itself; math operators, the em
    /// dash, the ellipsis, and Greek letters open none — a dialogue line
    /// with a circled-symbol grade drifted 0.022px per glyph because the
    /// missing share inflated every other share on the line).
    #[test]
    fn geometric_shapes_open_a_justify_share_and_math_operators_do_not() {
        assert!(justify_expands_after('\u{25CB}'), "circle expands after");
        assert!(justify_expands_after('\u{25A0}'), "square expands after");
        assert!(justify_expands_after('\u{2605}'), "star expands after");
        assert!(!justify_expands_after('\u{2220}'), "angle stays non-expansive");
        assert!(!justify_expands_after('\u{2014}'), "em dash stays non-expansive");
        assert!(!justify_expands_after('\u{03B1}'), "Greek alpha stays non-expansive");
    }

    /// A kern pair straddling a line break does not apply: the browser
    /// re-measures the broken line, so the line-final cluster keeps its
    /// base advance in the justified natural width (measured: SourceHan
    /// ン+ス kern -29/1000; with the paragraph-shaped kerned ン the
    /// slack inflated 0.416px and the kana run painted 0.36px right of
    /// the truth mid-line — share 0.0967 vs the oracle's 0.0766).
    #[test]
    fn a_line_break_severs_the_trailing_kern_pair() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context =
            ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            14.4,
            0.0,
        );
        style.text_flow.text_align = TextAlign::Justify;
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let text = "担任原画师的作品有《晓之护卫》、《レミニセンス》等。近期热衷于芳香疗法。";
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(304.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first child is a line");
        };
        let kana = line
            .children
            .iter()
            .find_map(|child| match child {
                Fragment::Text(run)
                    if text[run.text_start as usize..].starts_with('レ') =>
                {
                    Some(run)
                }
                _ => None,
            })
            .expect("the kana run lays out on the first line");
        // Oracle (pinned Chromium, the b126 Author paragraph at 14.4px
        // in a 304px measure): レ starts 231.6875 from the line start
        // and the share is 1.6/21 = 0.0762. The kerned-ン slack put it
        // at 232.044.
        assert!(
            (kana.rect.x - 231.6875).abs() < 0.05,
            "the kana run anchors at the truth position: {}",
            kana.rect.x
        );
        assert!(
            (kana.justify_px - 0.0766).abs() < 0.002,
            "the share follows the unkerned slack: {}",
            kana.justify_px
        );
    }

    /// A space PRECEDED by a latin letter shapes inside the latin run,
    /// so the word's trailing GPOS kern pair still applies (Tinos
    /// A+space = -113/2048 em; the browser's per-character stack walk
    /// puts the space on the head face and kerns it with the word). A
    /// CJK-preceded space still breaks out to resolve on the stack head.
    #[test]
    fn a_latin_preceded_space_keeps_the_words_trailing_kern() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context =
            ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let style_id = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Generic(
                        rito_style_contract::GenericFontFamily::Serif,
                    )])
                    .expect("family list"),
                    16.0,
                    0.0,
                ),
            )
            .expect("style interns");
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "上A 班".to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(10_000.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first child is a line");
        };
        // 上 16 + A (1479 - 113 kern)/2048*16 + space 512/2048*16 + 班 16
        let expected = 16.0 + 10.671875 + 4.0 + 16.0;
        assert!(
            (line.rect.width - expected).abs() < 0.01,
            "the kerned natural width holds: {} vs {expected}",
            line.rect.width
        );
    }

    /// A fullwidth comma keeps its following opening quote: the browser
    /// breaks BEFORE the ideograph that precedes the comma, carrying
    /// 说，'Caster' to the next line as one block (pinned-Chromium b112
    /// chapter3 line at 640: …这点来 | 说，'C…). Breaking after the
    /// comma sheds the quote and re-breaks the rest of the paragraph.
    #[test]
    fn a_fullwidth_comma_keeps_its_following_opening_quote() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context =
            ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            16.0,
            32.0,
        );
        style.text_flow.text_align = TextAlign::Justify;
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let text = "可关键是怎样有效使用这个最强战斗力的问题。说实话如果单从容易操纵这点来说，\u{2018}Caster\u{2019}和\u{2018}Assassin\u{2019}倒是更符合我的性格。\u{201D}";
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(640.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else { panic!("box"); };
        let mut lines = Vec::new();
        for child in &root.children {
            if let Fragment::Line(line) = child {
                let mut first = String::new();
                for c in &line.children {
                    if let Fragment::Text(run) = c {
                        first = text[run.text_start as usize..].chars().take(3).collect();
                        break;
                    }
                }
                lines.push(first);
            }
        }
        assert_eq!(lines.len(), 2, "the paragraph wraps once at 640");
        assert_eq!(
            lines[1], "\u{8bf4}\u{ff0c}\u{2018}",
            "the comma-quote block opens the second line: {lines:?}"
        );
    }

    /// A closing curly quote breaks before an em-dash pair: the quote
    /// closes its line and the dashes open the next (pinned-Chromium
    /// b112 line at 640: 怕” | ——可见). Treating quote-then-dash as
    /// unbreakable dragged the quote down with the pair.
    #[test]
    fn a_closing_quote_breaks_before_a_dash_pair() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context =
            ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            16.0,
            32.0,
        );
        style.text_flow.text_align = TextAlign::Justify;
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let text = "这就是Master绮礼的指示。就连战斗能力最为低下的Assassin与其交锋时都\u{201C}不必惧怕\u{201D}\u{2014}\u{2014}可见时臣召唤出来的Archer的英灵，一定是非常令绮礼失望的吧。";
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(640.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else { panic!("box"); };
        let mut lines = Vec::new();
        for child in &root.children {
            if let Fragment::Line(line) = child {
                let mut first = String::new();
                for c in &line.children {
                    if let Fragment::Text(run) = c {
                        first = text[run.text_start as usize..].chars().take(4).collect();
                        break;
                    }
                }
                lines.push(first);
            }
        }
        assert_eq!(lines.len(), 2, "the paragraph wraps once at 640");
        assert_eq!(
            lines[1], "\u{2014}\u{2014}\u{53ef}\u{89c1}",
            "the dash pair opens the second line, the quote stays up"
        );
    }

    /// Justify shares around an inline atom: the boundary INTO the atom
    /// carries one share which moves the atom itself (to ceil64 of the
    /// shifted sum), the boundary out of it carries none — the following
    /// glyph hugs the atom's right edge and its own deferred share lands
    /// one boundary later as a double (Range-measured micro line, slack
    /// 10 over 19 opportunities). Feeding the atom's share into the text
    /// counts too let the next run consume it twice, opening a full
    /// share of daylight after every inline image on a justified line.
    #[test]
    #[ignore = "two truth probes disagree on the atom-following share: the \
b20 badge comma rides one share right of its natural position while the \
micro line's ideograph hugs the image edge — the unified rule (likely by \
the follower's punctuation class) is still unmeasured"]
    fn an_atom_boundary_share_moves_the_atom_not_the_next_run() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context =
            ParleyInlineContext::new(vec![tinos_bytes(), source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(2);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            16.0,
            0.0,
        );
        style.text_flow.text_align = TextAlign::Justify;
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let image_style = inline
            .intern_for_node(1, plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(
                    rito_style_contract::GenericFontFamily::Serif,
                )])
                .expect("family list"),
                16.0,
                0.0,
            ))
            .expect("image style interns");
        let mut layout = LayoutStyleTableV1::new(1);
        let image_layout = layout
            .intern_for_node(0, jgap_image_layout_style())
            .expect("layout style interns");
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: image_layout,
                content: FormattingNodeContent::InlineFlow {
                    items: vec![
                        InlineItem::Text {
                            text: "甲乙丙".to_owned(),
                            style: style_id,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        },
                        InlineItem::Image {
                            src: "sq.png".to_owned(),
                            source: 0,
                            intrinsic_width: 16.0,
                            intrinsic_height: 16.0,
                            style: image_style,
                            layout_style: image_layout,
                            fit_contain: false,
                            viewport: None,
                            align_top: false,
                            baseline_shift_px: 0.0,
                        },
                        InlineItem::Text {
                            text: "丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥甲乙丙丁戊己庚辛".to_owned(),
                            style: style_id,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        },
                    ],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout,
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(330.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else { panic!("box"); };
        let Fragment::Line(line) = &root.children[0] else { panic!("line"); };
        let mut image_x = None;
        let mut after_atom_x = None;
        let mut saw_image = false;
        for c in &line.children {
            match c {
                Fragment::Image(img) => {
                    image_x = Some(img.rect.x);
                    saw_image = true;
                }
                Fragment::Text(run) if saw_image && after_atom_x.is_none() => {
                    after_atom_x = Some(run.rect.x);
                }
                _ => {}
            }
        }
        let image_x = image_x.expect("the atom lays out");
        let after_atom_x = after_atom_x.expect("a run follows the atom");
        assert!(
            (image_x - 49.59375).abs() < 1e-6,
            "the atom lands on ceil64 of its shifted sum: {image_x}"
        );
        assert!(
            (after_atom_x - (image_x + 16.0)).abs() < 0.02,
            "the following glyph hugs the atom's right edge: {after_atom_x} vs {}",
            image_x + 16.0
        );
    }

    fn jgap_image_layout_style() -> rito_style_contract::LayoutFormattingStyleV1 {
        use rito_style_contract::{
            AlignItemsV1, BoxSizingV1, CellVerticalAlignV1, ClearV1, FloatV1, JustifyContentV1,
            LayoutDisplayInsideV1, LayoutDisplayOutsideV1, LayoutDisplayV1,
            LayoutFormattingStyleV1, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
            MinimumHeightV1, NonNegativeCssPx, OverflowV1, PageBreakV1, PositionV1,
            PreferredSizeV1,
        };
        let auto = LengthPercentageOrAuto::Auto;
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero"),
        ));
        LayoutFormattingStyleV1 {
            display: LayoutDisplayV1 {
                outside: LayoutDisplayOutsideV1::Inline,
                inside: LayoutDisplayInsideV1::Flow,
                is_list_item: false,
            },
            margin: PhysicalSides { top: auto, right: auto, bottom: auto, left: auto },
            padding: PhysicalSides {
                top: zero_padding,
                right: zero_padding,
                bottom: zero_padding,
                left: zero_padding,
            },
            box_sizing: BoxSizingV1::ContentBox,
            justify_content: JustifyContentV1::Normal,
            align_items: AlignItemsV1::Normal,
            break_before: PageBreakV1::Auto,
            break_after: PageBreakV1::Auto,
            width: PreferredSizeV1::Auto,
            height: PreferredSizeV1::Auto,
            max_width: MaximumSizeV1::None,
            min_height: MinimumHeightV1::Auto,
            max_height: MaximumHeightV1::None,
            clear: ClearV1::None,
            float: FloatV1::None,
            overflow: OverflowV1::Visible,
            list_style_type: ListMarkerStyleV1::None,
            position: PositionV1::Static,
            inset: PhysicalSides { top: auto, right: auto, bottom: auto, left: auto },
            vertical_align: CellVerticalAlignV1::Baseline,
            border_spacing: (
                NonNegativeCssPx::new(0.0).expect("zero"),
                NonNegativeCssPx::new(0.0).expect("zero"),
            ),
            border_collapse: false,
        }
    }

    /// The shaping size truncates the F32 product size*100 onto the
    /// 1/100 grid: the f32 product's own rounding decides the cell
    /// (15.2*100 = exactly 1520.0 passes through; 18.72*100 =
    /// 1871.99988 truncates to 18.71). An f64 product would round
    /// 18.72's hundredths within any snap tolerance and miss the
    /// browser's cell (Range-measured on a pinned face).
    #[test]
    fn the_shaping_size_truncates_the_f32_hundredths_product() {
        for (size, want) in [
            (18.72_f32, 18.71_f32),
            (9.36, 9.35),
            (37.44, 37.43),
            (18.8, 18.79),
            (15.2, 15.2),
            (12.16, 12.16),
            (14.4, 14.4),
            (16.01, 16.01),
            (15.9999, 15.99),
            (15.9375, 15.93),
            (17.06667, 17.06),
            (9.52, 9.52),
        ] {
            let got = shaping_font_size(size);
            assert!(
                (got - want).abs() < 1e-4,
                "{size} shapes at {got}, browser uses {want}"
            );
        }
    }

    /// Author letter-spacing rides OUTSIDE the fixed-point glyph advance:
    /// a 16px ideograph spaced 1.3333334px steps 16.000000 + 1.3333334,
    /// never round-tripped through font units as one folded sum
    /// (round(17.333 * 1000 / 16) = 1083 units re-scales to 17.32799 —
    /// 0.0053px short per cluster, one device column per ~12 glyphs
    /// across a spaced book).
    #[test]
    fn letter_spacing_stays_outside_the_fixed_point_round_trip() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            16.0,
            0.0,
        );
        style.text_flow.letter_spacing =
            LengthPercentage::Length(CssPx::new(1.333_333_4).expect("finite spacing"));
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "开始自我介绍".to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(10_000.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first child is a line");
        };
        let mut runs = line.children.iter().filter_map(|child| match child {
            Fragment::Text(run) => Some(run),
            _ => None,
        });
        let first = runs.next().expect("the line has text runs");
        let second = runs.next().expect("the spaced advance splits the run");
        let step = second.rect.x - first.rect.x;
        assert!(
            (step - 17.333_333_4).abs() < 1e-5,
            "the spaced step keeps the raw spacing outside the grid: {step}"
        );
    }

    /// The per-glyph grid-pen splits ride the 16.16 fixed-point scale
    /// the browser hands its shaper: a 19.2px 1000-unit ideograph
    /// advances trunc(1000 * round(19.2 * 65536) / 1000) / 65536 =
    /// 19.199997px, not the raw f32 product 19.200001px. The raw sum
    /// crosses 1/64 cells one cluster early, so every glyph after the
    /// crossing painted one device column right of the browser's
    /// (Range-measured on a pinned-Chromium 19.2px contents line).
    #[test]
    fn grid_pen_splits_ride_the_fixed_point_shaper_scale() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let style_id = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    FontFamilies::new(vec![FontFamily::Generic(
                        rito_style_contract::GenericFontFamily::Serif,
                    )])
                    .expect("family list"),
                    19.2,
                    0.0,
                ),
            )
            .expect("style interns");
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "掷骰子问题掷骰子问题".to_owned(),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(10_000.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first child is a line");
        };
        let advance = 1_258_291.0_f64 / 65_536.0;
        let mut runs = line.children.iter().filter_map(|child| match child {
            Fragment::Text(run) => Some(run),
            _ => None,
        });
        let first = runs.next().expect("the line has text runs");
        assert!(
            first.rect.x.abs() < 1e-6,
            "the run anchors at the line start: {}",
            first.rect.x
        );
        let second = runs.next().expect("the off-grid advance splits the run");
        assert!(
            (second.rect.x - advance).abs() < 1e-5 && second.rect.x < 19.2,
            "the second glyph starts one fixed-point advance in: {} vs {advance}",
            second.rect.x
        );
    }

    /// A justified line's paint cuts land AROUND a repeated-dash pair,
    /// never between the dashes: the canvas shapes each call on its own,
    /// and fonts join —— through contextual substitution, so a cut inside
    /// the pair rasters two isolated dash glyphs whose bar sits off the
    /// joined form (measured 2px on an embedded face). The share pattern
    /// 了|— (one share) then —|— (zero) used to flip the uniform tracker
    /// exactly between the dashes.
    #[test]
    fn a_justified_dash_pair_stays_in_one_paint_fragment() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            16.0,
            0.0,
        );
        style.text_flow.text_align = TextAlign::Justify;
        let mut inline = InlineStyleTableV1::new(1);
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let text = "「原本打算自己吃的饼干，现在换成马剃同学吃了——知道这意味着什么吗？来，小鞠回答！」";
        let pair = text.find('\u{2014}').expect("text has the dash pair");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style: style_id,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(500.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let mut carrier: Option<(usize, usize)> = None;
        for child in &root.children {
            let Fragment::Line(line) = child else { continue };
            for run in &line.children {
                let Fragment::Text(run) = run else { continue };
                let (start, end) = (run.text_start as usize, run.text_end as usize);
                if start <= pair && pair < end {
                    carrier = Some((start, end));
                }
            }
        }
        let (start, end) = carrier.expect("a paint fragment carries the first dash");
        assert!(
            end - pair >= "\u{2014}\u{2014}".len(),
            "the dash pair must not be severed across paint fragments: \
             fragment {start}..{end} cuts the pair at byte {pair}"
        );
    }

    /// A number line-height multiplies the GRID-ROUNDED font size, then
    /// floors the product (measured in Chromium across 14 sizes,
    /// content-independent). Off-grid sizes discriminate in both
    /// directions from a plain floored product: 24.32 lands SHORTER
    /// (32.8125, not 32.828125) and 30.4 lands TALLER (41.046875, not
    /// 41.03125); on-grid sizes are unchanged. A real book's 1.6em
    /// divider paragraph in a 0.95em article was one 64th tall, pushing
    /// a mid-page line onto the wrong device row.
    #[test]
    fn a_number_line_height_multiplies_the_grid_rounded_font_size() {
        let number = LineHeight::Number(
            rito_style_contract::NonNegativeNumber::new(1.35).expect("finite"),
        );
        let used = |font_size: f32| {
            used_declared_line_height(number, f64::from(font_size)).expect("declared")
        };
        assert_eq!(used(24.32), 32.8125, "24.32 rounds down to 24.3125 first");
        assert_eq!(used(30.4), 41.046875, "30.4 rounds up to 30.40625 first");
        assert_eq!(used(17.1), 23.0625, "17.1 rounds down to 17.09375 first");
        assert_eq!(used(15.2), 20.515625, "15.203125 keeps the historic value");
        assert_eq!(used(16.0), 21.59375, "an on-grid size is a plain product");
    }

    /// A `<ruby>` edge is a shaping boundary: the base shapes alone, so
    /// a kern pair straddling the edge never applies. Measured on the
    /// pinned SourceHan at 15.2px: plain (and `<span>`-split) ウ，可
    /// closes to 44.39 through the ウ，kern pair, while
    /// `<ruby>ウ</ruby>，可 spans the full 45.61 — Blink shapes the ruby
    /// base independently. The b20 Shou line's slack grew 1.216px (and
    /// its justify share 0.83 vs Blink's 0.80) through exactly this
    /// leaked pair.
    #[test]
    fn a_ruby_edge_is_a_shaping_boundary() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let lay = |items_of: &dyn Fn(rito_style_contract::StyleId) -> Vec<InlineItem>| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        15.2,
                        0.0,
                    ),
                )
                .expect("style interns");
            let tree = FormattingTree::with_styles(
                vec![FormattingNode {
                    style: rito_style_contract::LayoutStyleId::from_raw(0),
                    content: FormattingNodeContent::InlineFlow {
                        items: items_of(style),
                    },
                    children: Vec::new(),
                }],
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("inline outcome root is a box fragment");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .map(|child| child.rect().width)
                .sum::<f64>()
        };
        let text_item =
            |text: &str, annotation: Option<&str>, style| InlineItem::Text {
                text: text.to_owned(),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: annotation.map(|note| rito_fragment::RubyAnnotation {
                    text: note.to_owned(),
                    size_ratio: 0.5,
                    align: rito_style_contract::RubyAlign::SpaceAround
                }),
            };
        let merged = lay(&|style| vec![text_item("ウ，可", None, style)]);
        assert!(
            (merged - 44.384).abs() < 0.05,
            "one shaped run applies the ウ，kern: {merged}"
        );
        // Same characters, but ウ is a ruby base: the pair must NOT kern.
        let split = lay(&|style| {
            vec![
                text_item("ウ", Some("u"), style),
                text_item("，可", None, style),
            ]
        });
        assert!(
            (split - 45.6).abs() < 0.05,
            "a ruby edge breaks the kern pair: {split}"
        );
        // Two directly adjacent mono-ruby bases stay separate runs too.
        let adjacent = lay(&|style| {
            vec![
                text_item("ウ", Some("u"), style),
                text_item("，", Some("x"), style),
                text_item("可", None, style),
            ]
        });
        assert!(
            (adjacent - 45.6).abs() < 0.05,
            "adjacent ruby bases each shape alone: {adjacent}"
        );
    }

    /// A top-aligned image inside a super-shifted chain aligns to the
    /// line box top from its UNSHIFTED metrics and is then displaced by
    /// the ancestor's baseline shift — its ink overflows ABOVE the line
    /// box (measured on a 16px paragraph's footnote badge in <sup>:
    /// image top = line top − (trunc64(16/3) + 1) = −6.328125,
    /// line-height independent; with no shift chain the top-aligned
    /// image hugs the line top exactly).
    #[test]
    fn a_top_aligned_image_in_a_super_chain_overflows_the_line_top() {
        use rito_style_contract::{
            AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
            LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleTableV1,
            LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
            MinimumHeightV1, OverflowV1, PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let image_y = |shift_px: f64| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        16.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let mut layout = LayoutStyleTableV1::new(1);
            let auto = LengthPercentageOrAuto::Auto;
            let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero"),
            ));
            let image_layout = layout
                .intern_for_node(
                    0,
                    LayoutFormattingStyleV1 {
                        display: LayoutDisplayV1 {
                            outside: LayoutDisplayOutsideV1::Inline,
                            inside: LayoutDisplayInsideV1::Flow,
                            is_list_item: false,
                        },
                        margin: PhysicalSides {
                            top: auto,
                            right: auto,
                            bottom: auto,
                            left: auto,
                        },
                        padding: PhysicalSides {
                            top: zero_padding,
                            right: zero_padding,
                            bottom: zero_padding,
                            left: zero_padding,
                        },
                        box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
                        justify_content: JustifyContentV1::Normal,
                        align_items: AlignItemsV1::Normal,
                        break_before: PageBreakV1::Auto,
                        break_after: PageBreakV1::Auto,
                        width: PreferredSizeV1::Auto,
                        height: PreferredSizeV1::Auto,
                        max_width: MaximumSizeV1::None,
                        min_height: MinimumHeightV1::Auto,
                        max_height: MaximumHeightV1::None,
                        clear: ClearV1::None,
                        float: FloatV1::None,
                        overflow: OverflowV1::Visible,
                        list_style_type: ListMarkerStyleV1::None,
                        position: PositionV1::Static,
                        inset: PhysicalSides {
                            top: auto,
                            right: auto,
                            bottom: auto,
                            left: auto,
                        },
                        vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
                        border_spacing: (
                            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                        ),
            border_collapse: false,
                    },
                )
                .expect("layout style interns");
            let items = vec![
                InlineItem::Text {
                    text: "彭彭彭".to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
                InlineItem::Image {
                    source: 0,
                    src: "images/note.png".to_owned(),
                    intrinsic_width: 14.390625,
                    intrinsic_height: 14.390625,
                    style,
                    layout_style: image_layout,
                    fit_contain: false,
                    viewport: None,
                    baseline_shift_px: shift_px,
                    align_top: true,
                },
                InlineItem::Text {
                    text: "的彭彭".to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                },
            ];
            let tree = FormattingTree::with_styles(
                vec![FormattingNode {
                    style: rito_style_contract::LayoutStyleId::from_raw(0),
                    content: FormattingNodeContent::InlineFlow { items },
                    children: Vec::new(),
                }],
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles { layout, inline },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("inline outcome root is a box fragment");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .find_map(|child| match child {
                    Fragment::Image(image) => Some(image.rect.y),
                    _ => None,
                })
                .expect("line carries the image")
        };
        let unshifted = image_y(0.0);
        assert!(
            unshifted.abs() < 1e-6,
            "with no shift chain the top-aligned image hugs the line top: {unshifted}"
        );
        let raised = image_y(6.328125);
        assert!(
            (raised - (-6.328125)).abs() < 1e-6,
            "the super chain displaces the top-aligned image above the line: {raised}"
        );
    }

    /// An inline image between two fullwidth punctuation glyphs keeps
    /// them both at full width: the pair 的。<img>』 never trims, while
    /// the same characters with no box between them trim the 。 to half
    /// (measured on b20 p143's note badge: Blink paints 的。 full, then
    /// the badge, then 』 — the engine's flow text carries no
    /// placeholder for the image, so a text-only adjacency scan saw
    /// 。』 and halved the 。).
    #[test]
    fn an_inline_image_separates_a_punctuation_pair() {
        use rito_style_contract::{
            AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
            LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleTableV1,
            LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
            MinimumHeightV1, OverflowV1, PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let lay_text_width = |with_image: bool| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        15.2,
                        0.0,
                    ),
                )
                .expect("style interns");
            let mut layout = LayoutStyleTableV1::new(1);
            let auto = LengthPercentageOrAuto::Auto;
            let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
                CssPx::new(0.0).expect("zero"),
            ));
            let image_layout = layout
                .intern_for_node(
                    0,
                    LayoutFormattingStyleV1 {
                        display: LayoutDisplayV1 {
                            outside: LayoutDisplayOutsideV1::Inline,
                            inside: LayoutDisplayInsideV1::Flow,
                            is_list_item: false,
                        },
                        margin: PhysicalSides {
                            top: auto,
                            right: auto,
                            bottom: auto,
                            left: auto,
                        },
                        padding: PhysicalSides {
                            top: zero_padding,
                            right: zero_padding,
                            bottom: zero_padding,
                            left: zero_padding,
                        },
                        box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
                        justify_content: JustifyContentV1::Normal,
                        align_items: AlignItemsV1::Normal,
                        break_before: PageBreakV1::Auto,
                        break_after: PageBreakV1::Auto,
                        width: PreferredSizeV1::Auto,
                        height: PreferredSizeV1::Auto,
                        max_width: MaximumSizeV1::None,
                        min_height: MinimumHeightV1::Auto,
                        max_height: MaximumHeightV1::None,
                        clear: ClearV1::None,
                        float: FloatV1::None,
                        overflow: OverflowV1::Visible,
                        list_style_type: ListMarkerStyleV1::None,
                        position: PositionV1::Static,
                        inset: PhysicalSides {
                            top: auto,
                            right: auto,
                            bottom: auto,
                            left: auto,
                        },
                        vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
                        border_spacing: (
                            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                        ),
            border_collapse: false,
                    },
                )
                .expect("layout style interns");
            let mut items = vec![InlineItem::Text {
                text: "的。".to_owned(),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            }];
            if with_image {
                items.push(InlineItem::Image {
                    source: 0,
                    src: "images/note.png".to_owned(),
                    intrinsic_width: 14.0,
                    intrinsic_height: 14.0,
                    style,
                    layout_style: image_layout,
                    fit_contain: false,
                    viewport: None,
                    baseline_shift_px: 0.0,
                    align_top: false,
                });
            }
            items.push(InlineItem::Text {
                text: "』可".to_owned(),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            });
            let tree = FormattingTree::with_styles(
                vec![FormattingNode {
                    style: rito_style_contract::LayoutStyleId::from_raw(0),
                    content: FormattingNodeContent::InlineFlow { items },
                    children: Vec::new(),
                }],
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles { layout, inline },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("inline outcome root is a box fragment");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .filter_map(|child| match child {
                    Fragment::Text(run) => Some(run.rect.width),
                    _ => None,
                })
                .sum::<f64>()
        };
        let trimmed = lay_text_width(false);
        assert!(
            (trimmed - 53.2).abs() < 0.05,
            "with no box between them 。』 trims the 。 to half: {trimmed}"
        );
        let separated = lay_text_width(true);
        assert!(
            (separated - 60.8).abs() < 0.05,
            "an image between 。 and 』 keeps both full: {separated}"
        );
    }

    /// The b20 ruby-line pitch replica (chapter3 dialog, fs 15.2,
    /// rt 0.7em latin, line-height 130% = 19.765625 declared). Truth
    /// (Chromium replicas of the exact host probe DOM + a 3-line
    /// paragraph, 2026-08-13): E000@0.7 = {29, 24}, E001@0.7 = {48, 43},
    /// 中@normal = {21, 16}, and the mid-paragraph ruby line's pitch is
    /// 27.0 (line tops 1 / 28 / 47.75). With those host answers injected,
    /// the engine's composition must land the same 27 — hand-checked:
    /// required 24 − strut baseline 14 − prev_gap (5.765625 − reuse 3)
    /// = growth 7.234375; 19.765625 + 7.234375 = 27.
    #[test]
    fn the_b20_ruby_line_pitch_matches_truth_with_injected_host_metrics() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            15.2,
            0.0,
        );
        style.font.line_height = LineHeight::Length(
            rito_style_contract::NonNegativeCssPx::new(19.765625).expect("finite line height"),
        );
        style.font.line_height_is_declared = true;
        let family = host_family_key(&style);
        // The TRUE host values (pins VERIFIED loaded — a setContent page
        // silently drops file:// faces and an earlier round measured the
        // system fallback: 中 16 vs the real 17, E000 24 vs 25). The
        // composition lands the same pitch either way because the errors
        // cancelled, but the anchors must carry the real numbers.
        for (sample, height, baseline) in [
            ("", 18.0, 14.0),
            ("中", 21.0, 17.0),
            ("\u{E000}0.7000:Shouichi", 29.0, 25.0),
            ("\u{E001}0.7000:Shouichi", 48.0, 44.0),
        ] {
            context.set_host_line_metric(
                &family,
                15.2,
                sample,
                HostNormalLineMetric {
                    height,
                    baseline,
                    grid: Some((14.0, 3.0)),
                    advance: None,
                },
            );
        }
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let items = vec![
            InlineItem::Text {
                text: "中文排版測試字符排版".to_owned(),
                style: style_id,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            },
            InlineItem::Text {
                text: "ショウイチ".to_owned(),
                style: style_id,
                baseline_shift_px: 0.0,
                ruby_annotation: Some(rito_fragment::RubyAnnotation {
                    text: "Shouichi".to_owned(),
                    size_ratio: 0.7,
                    align: rito_style_contract::RubyAlign::SpaceAround
                }),
            },
            InlineItem::Text {
                text: "後續文字排版測試字符文字".to_owned(),
                style: style_id,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            },
        ];
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow { items },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(180.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!()
        };
        let tops: Vec<f64> = root
            .children
            .iter()
            .filter_map(|child| match child {
                Fragment::Line(line) => Some(line.rect.y),
                _ => None,
            })
            .collect();
        for (index, child) in root.children.iter().enumerate() {
            if let Fragment::Line(line) = child {
                eprintln!(
                    "[rubyline] line {index} top {:.6} h {:.6}",
                    line.rect.y, line.rect.height
                );
            }
        }
        assert!(tops.len() >= 3, "three lines lay out");
        // Truth measured CHAR tops (Range), not line-box tops: the
        // engine keeps the ruby line's box top natural and moves the
        // TEXT inside down by the growth, so the comparable quantity is
        // the first text fragment's net y per line.
        let char_tops: Vec<f64> = root
            .children
            .iter()
            .filter_map(|child| match child {
                Fragment::Line(line) => line.children.iter().find_map(|inner| match inner {
                    Fragment::Text(run) => Some(line.rect.y + run.rect.y),
                    _ => None,
                }),
                _ => None,
            })
            .collect();
        for (index, top) in char_tops.iter().enumerate() {
            eprintln!("[rubyline] char top {index}: {top:.6}");
        }
        let pitch = char_tops[1] - char_tops[0];
        assert!(
            (pitch - 27.0).abs() < 0.01,
            "the ruby line's char pitch must be 27 like Blink, got {pitch}"
        );
        let after = char_tops[2] - char_tops[1];
        assert!(
            (after - 19.765625).abs() < 0.01,
            "the line after the ruby returns to the strut pitch, got {after}"
        );
        // The opener arm: a first-line ruby pushes down by the
        // whole-pixel ceil of its baseline deficit (Chromium at this config:
        // ceil(25 − 15.3828) = 10; measured 10/9/8/6 across four
        // line-heights). Lay the same flow with the ruby item first.
        let mut inline2 = InlineStyleTableV1::new(1);
        let mut style2 = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            15.2,
            0.0,
        );
        style2.font.line_height = LineHeight::Length(
            rito_style_contract::NonNegativeCssPx::new(19.765625).expect("finite line height"),
        );
        style2.font.line_height_is_declared = true;
        let family2 = host_family_key(&style2);
        for (sample, height, baseline) in [
            ("", 18.0, 14.0),
            ("中", 21.0, 17.0),
            ("\u{E000}0.7000:Shouko", 29.0, 25.0),
            ("\u{E001}0.7000:Shouko", 48.0, 44.0),
        ] {
            context.set_host_line_metric(
                &family2,
                15.2,
                sample,
                HostNormalLineMetric {
                    height,
                    baseline,
                    grid: Some((14.0, 3.0)),
                    advance: None,
                },
            );
        }
        let style2_id = inline2.intern_for_node(0, style2).expect("style interns");
        let tree2 = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![
                        InlineItem::Text {
                            text: "ショウコ".to_owned(),
                            style: style2_id,
                            baseline_shift_px: 0.0,
                            ruby_annotation: Some(rito_fragment::RubyAnnotation {
                                text: "Shouko".to_owned(),
                                size_ratio: 0.7,
                                align: rito_style_contract::RubyAlign::SpaceAround
                            }),
                        },
                        InlineItem::Text {
                            text: "的名字是寫作尚子吧後續文字排版測試".to_owned(),
                            style: style2_id,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        },
                    ],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline: inline2,
            },
        )
        .expect("inline tree builds");
        let outcome2 = context
            .layout(
                &tree2,
                tree2.root(),
                &ConstraintSpace::continuous(180.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root2) = &outcome2.fragments.root else {
            panic!()
        };
        let opener_tops: Vec<f64> = root2
            .children
            .iter()
            .filter_map(|child| match child {
                Fragment::Line(line) => line.children.iter().find_map(|inner| match inner {
                    Fragment::Text(run) => Some(line.rect.y + run.rect.y),
                    _ => None,
                }),
                _ => None,
            })
            .collect();
        // The control flow (no annotation) puts its first char top at some
        // V; the opener-ruby flow must sit at V + 10 exactly. V itself is
        // model-internal, so assert via the SECOND line instead: it sits
        // one natural pitch below the pushed first line, so
        // opener_line2 − opener_line1 = 19.765625 while the push shows in
        // the first line's absolute top being 10 above-baseline-shifted —
        // captured by comparing against the interior flow's line-0 top
        // plus the ceil'd deficit.
        let interior_line0 = char_tops[0];
        let push = opener_tops[0] - interior_line0;
        eprintln!("[rubyline] opener push = {push:.6}");
        assert!(
            (push - 10.0).abs() < 0.01,
            "the opener ruby line pushes down by ceil(25 − 15.3828) = 10, got {push}"
        );
    }

    /// The b20 DOUBLE-RUBY paragraph replica at the REAL chapter3 config
    /// (p { line-height: 1.35 } NUMBER → floors to 20.515625; fs 15.2;
    /// live host values). Truth (real-chapter Range, walk pins,
    /// 2026-08-13): opener push 10.0, INTERIOR ruby-line pitch 27.0 =
    /// 20.515625 + 6.484375 — equal to the engine's own analytic growth
    /// (required 25 − baseline 15 − prev_gap 3.515625), yet the engine
    /// PAINTED pitch 26.0 on p144 — the −1 lives in the growth→paint
    /// translation on consecutive ruby lines.
    #[test]
    fn the_b20_double_ruby_paragraph_interior_pitch_matches_truth() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            15.2,
            0.0,
        );
        style.font.line_height = LineHeight::Number(
            rito_style_contract::NonNegativeNumber::new(1.35).expect("finite multiplier"),
        );
        style.font.line_height_is_declared = true;
        let family = host_family_key(&style);
        for (sample, height, baseline) in [
            ("", 18.0, 14.0),
            ("中", 21.0, 17.0),
            ("\u{E000}0.7000:Shou", 29.0, 25.0),
            ("\u{E001}0.7000:Shou", 48.0, 44.0),
            ("\u{E000}0.7000:Shouichi", 29.0, 25.0),
            ("\u{E001}0.7000:Shouichi", 48.0, 44.0),
            ("\u{E000}0.7000:Naokazu", 29.0, 25.0),
            ("\u{E001}0.7000:Naokazu", 48.0, 44.0),
        ] {
            context.set_host_line_metric(
                &family,
                15.2,
                sample,
                HostNormalLineMetric {
                    height,
                    baseline,
                    grid: Some((14.0, 3.0)),
                    advance: None,
                },
            );
        }
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let ruby = |base: &str, ann: &str| InlineItem::Text {
            text: base.to_owned(),
            style: style_id,
            baseline_shift_px: 0.0,
            ruby_annotation: Some(rito_fragment::RubyAnnotation {
                text: ann.to_owned(),
                size_ratio: 0.7,
                align: rito_style_contract::RubyAlign::SpaceAround
            }),
        };
        let text = |t: &str| InlineItem::Text {
            text: t.to_owned(),
            style: style_id,
            baseline_shift_px: 0.0,
            ruby_annotation: None,
        };
        let items = vec![
            text("「要注意的是『尚』字的唸法。尚子的尚是唸作"),
            ruby("ショウ", "Shou"),
            text("，可是名片哥的名字就不一定了。如果是『尚一』，笑話的方向也會隨『"),
            ruby("ショウイチ", "Shouichi"),
            text("』或『"),
            ruby("ナオカズ", "Naokazu"),
            text("』改變呢。」"),
        ];
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow { items },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(590.78125),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!()
        };
        let char_tops: Vec<f64> = root
            .children
            .iter()
            .filter_map(|child| match child {
                Fragment::Line(line) => line.children.iter().find_map(|inner| match inner {
                    Fragment::Text(run) => Some(line.rect.y + run.rect.y),
                    _ => None,
                }),
                _ => None,
            })
            .collect();
        for (index, top) in char_tops.iter().enumerate() {
            eprintln!("[dblruby] char top {index}: {top:.6}");
        }
        for (index, child) in root.children.iter().enumerate() {
            if let Fragment::Line(line) = child {
                let inner = line.children.iter().find_map(|c| match c {
                    Fragment::Text(run) => Some((run.rect.y, run.rect.height)),
                    _ => None,
                });
                eprintln!(
                    "[dblruby] line {index} box y {:.6} h {:.6} inner {:?}",
                    line.rect.y, line.rect.height, inner
                );
            }
        }
        assert!(char_tops.len() >= 2, "two lines lay out");
        let pitch = char_tops[1] - char_tops[0];
        assert!(
            (pitch - 27.0).abs() < 0.01,
            "the interior ruby line's char pitch must be 27 like the real chapter, got {pitch}"
        );
    }

    /// #71 advance-sum autopsy: the b20 badge line replica. Truth
    /// (b20-line.json, Range per-char): 14 chars 居然能一人給一套這麼合適的振袖
    /// + note badge (w 13.671875) + ，有錢人果然猛。… on a justified
    /// 15.2px line of width 590.78125; the ， inks at 247.640625 from
    /// the line start (= floor64 of the float cumulative). If the
    /// engine's float basis (advances + share + atom accounting)
    /// matches Blink's, its un-floored ， x must sit in [truth,
    /// truth + 1/64).
    #[test]
    fn the_badge_line_replica_matches_the_truth_comma_position() {
        use rito_style_contract::{
            AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
            LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleTableV1,
            LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
            MinimumHeightV1, OverflowV1, PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(
                rito_style_contract::GenericFontFamily::Serif,
            )])
            .expect("family list"),
            15.2,
            0.0,
        );
        style.text_flow.text_align = TextAlign::Justify;
        let style_id = inline.intern_for_node(0, style).expect("style interns");
        let mut layout = LayoutStyleTableV1::new(1);
        let auto = LengthPercentageOrAuto::Auto;
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero"),
        ));
        let image_layout = layout
            .intern_for_node(
                0,
                LayoutFormattingStyleV1 {
                    display: LayoutDisplayV1 {
                        outside: LayoutDisplayOutsideV1::Inline,
                        inside: LayoutDisplayInsideV1::Flow,
                        is_list_item: false,
                    },
                    margin: PhysicalSides {
                        top: auto,
                        right: auto,
                        bottom: auto,
                        left: auto,
                    },
                    padding: PhysicalSides {
                        top: zero_padding,
                        right: zero_padding,
                        bottom: zero_padding,
                        left: zero_padding,
                    },
                    box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
                    justify_content: JustifyContentV1::Normal,
                    align_items: AlignItemsV1::Normal,
                    break_before: PageBreakV1::Auto,
                    break_after: PageBreakV1::Auto,
                    width: PreferredSizeV1::Auto,
                    height: PreferredSizeV1::Auto,
                    max_width: MaximumSizeV1::None,
                    min_height: MinimumHeightV1::Auto,
                    max_height: MaximumHeightV1::None,
                    clear: ClearV1::None,
                    float: FloatV1::None,
                    overflow: OverflowV1::Visible,
                    list_style_type: ListMarkerStyleV1::None,
                    position: PositionV1::Static,
                    inset: PhysicalSides {
                        top: auto,
                        right: auto,
                        bottom: auto,
                        left: auto,
                    },
                    vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
                    border_spacing: (
                        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                    ),
            border_collapse: false,
                },
            )
            .expect("layout style interns");
        let items = vec![
            InlineItem::Text {
                text: "居然能一人給一套這麼合適的振袖".to_owned(),
                style: style_id,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            },
            InlineItem::Image {
                source: 0,
                src: "images/note.png".to_owned(),
                intrinsic_width: 13.671875,
                intrinsic_height: 13.671875,
                style: style_id,
                layout_style: image_layout,
                viewport: None,
                baseline_shift_px: 0.0,
                align_top: false,
                fit_contain: false,
            },
            InlineItem::Text {
                text: "，有錢人果然猛。不過鶴屋學姊不管做出什麼事好中中中中中".to_owned(),
                style: style_id,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            },
        ];
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow { items },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles { layout, inline },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                FormattingNodeId(0),
                &ConstraintSpace::continuous(590.78125),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root box");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first line");
        };
        let mut comma_x = None;
        for child in &line.children {
            match child {
                Fragment::Text(run) => {
                    eprintln!(
                        "[badge] run x={:.6} w={:.6} justify={:.6} bytes {}..{}",
                        run.rect.x, run.rect.width, run.justify_px, run.text_start, run.text_end
                    );
                    if run.text_start == 42 + 3 * 5 {
                        // byte offset of ，: 14 CJK chars × 3 bytes = 42?
                        // (computed below instead)
                    }
                }
                Fragment::Image(image) => {
                    eprintln!("[badge] atom x={:.6} w={:.6}", image.rect.x, image.rect.width);
                }
                _ => {}
            }
        }
        // The ， is the first char of the third item: flow-text byte 45
        // (15 chars × 3 bytes; the atom adds no text bytes). Its fragment
        // x is the PAINT position — the justify pen shifts a deferred char's
        // ink one share right of its advance box — while the truth
        // (Range) measured the LAYOUT box, so the comparison subtracts
        // one share.
        let mut share = None;
        for child in &line.children {
            if let Fragment::Text(run) = child {
                if run.text_start == 0 {
                    share = Some(run.justify_px);
                }
                if run.text_start == 45 {
                    comma_x = Some(line.rect.x + run.rect.x);
                }
            }
        }
        let comma_x = comma_x.expect("， starts a run at byte 45");
        let share = share.expect("the first run carries the uniform share");
        let layout_x = comma_x - share;
        eprintln!(
            "[badge] comma ink x = {comma_x:.6}, layout x = {layout_x:.6} (truth 247.640625)"
        );
        assert!(
            (layout_x - 247.640625).abs() < 0.02,
            "the ，'s advance-box position must match the truth Range x, got {layout_x}"
        );
    }

    /// Adjacent fullwidth punctuation loses the blank half at the
    /// boundary, exactly as pinned Chromium's default
    /// `text-spacing-trim: normal` measures: each trimming pair shortens
    /// the line by half an em, and non-trimming neighbours stay full.
    #[test]
    fn cjk_punctuation_pairs_trim_half_an_em() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let shape_width = |text: &str| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        16.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("inline outcome root is a box fragment");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .map(|child| child.rect().width)
                .sum::<f64>()
        };
        let plain = shape_width("春日春日春日");
        assert!(
            (plain - 96.0).abs() < 0.1,
            "six ideographs at 16px: {plain}"
        );
        // close + open: the open's blank left half collapses.
        let close_open = shape_width("春日。「春日");
        assert!(
            (close_open - (plain - 8.0)).abs() < 0.1,
            "close+open trims half an em: {close_open}"
        );
        // close + close: the first close's blank right half collapses.
        let close_close = shape_width("春日」。春日");
        assert!(
            (close_close - (plain - 8.0)).abs() < 0.1,
            "close+close trims half an em: {close_close}"
        );
        // A close against an ideograph keeps its full advance.
        let close_ideo = shape_width("春日。春日日");
        assert!(
            (close_ideo - plain).abs() < 0.1,
            "close+ideograph must not trim: {close_ideo}"
        );
        // A middle dot never trims itself.
        let middle = shape_width("春日・」春日");
        assert!(
            (middle - plain).abs() < 0.1,
            "middle dot before a close must not trim: {middle}"
        );
    }

    /// Consecutive forced breaks keep their empty line: Blink lays
    /// `甲<br/><br/>乙` — and `甲<br/> <br/>乙`, whose interior space the
    /// line-start collapse removes — as THREE lines, the middle one an
    /// empty strut-height line (measured 2026-08-05: paragraph height 60
    /// at line-height 20 for both shapes; the b39 calibre idiom).
    #[test]
    fn consecutive_forced_breaks_keep_an_empty_strut_line() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let lay = |text: &str| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        16.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(200.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds")
        };
        // The bridge canonicalizes `<br/> <br/>` to "\n\n" (the pending
        // space drops before the second break lands), so adjacent
        // newlines are the reachable stream.
        let outcome = lay("甲\n\n乙");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let heights: Vec<f64> = root
            .children
            .iter()
            .map(|line| line.rect().height)
            .collect();
        assert_eq!(
            heights.len(),
            3,
            "consecutive forced breaks lay three lines (middle empty), got {heights:?}"
        );
        assert!(
            (heights[1] - heights[0]).abs() < 0.5,
            "the empty middle line keeps the strut height: {heights:?}"
        );
    }

    /// Line-end conditional trim, the Blink `ShapeLine` extension: a
    /// fullwidth closing bracket that is the first glyph past a soft break
    /// to overflow stays on the line with its blank right half trimmed —
    /// but only when the trimmed advance fits, only for the closing-bracket
    /// and closing-quote classes, and only when a break is allowed after
    /// it. css-text-4 `text-spacing-trim: normal`: closing punctuation is
    /// set half-width at the end of the line "if it does not otherwise fit
    /// prior to justification".
    #[test]
    fn line_end_closing_punctuation_trims_only_when_the_half_width_fits() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let lay_indent = |text: &str, width: f64, indent: f32| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(vec![FontFamily::Generic(
                            rito_style_contract::GenericFontFamily::Serif,
                        )])
                        .expect("family list"),
                        16.0,
                        indent,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: text.to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            context
                .layout(
                    &tree,
                    FormattingNodeId(0),
                    &ConstraintSpace::continuous(width),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds")
        };
        let lay = |text: &str, width: f64| lay_indent(text, width, 0.0);
        let ten = "永".repeat(10);

        // Ten ideographs fill 160px; the closer needs 176 full, 168
        // trimmed. At 170 the trimmed closer fits: the line keeps it.
        let text = format!("{ten}」永永永永永永");
        let outcome = lay(&text, 170.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(lines[0], format!("{ten}」"), "trimmed closer stays");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(first) = &root.children[0] else {
            panic!("first child is a line");
        };
        let first_width: f64 = first
            .children
            .iter()
            .map(|child| child.rect().width)
            .sum();
        assert!(
            (first_width - 168.0).abs() < 0.1,
            "the kept closer advances half an em: {first_width}"
        );

        // At 167 even the trimmed closer overflows: the line must break
        // early, dragging the kinsoku-chained ideograph down with it.
        let outcome = lay(&text, 167.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(lines[0], "永".repeat(9), "no trim when the half does not fit");

        // At 176 the full-width closer fits: nothing is trimmed.
        let outcome = lay(&text, 176.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(lines[0], format!("{ten}」"));
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(first) = &root.children[0] else {
            panic!("first child is a line");
        };
        let first_width: f64 = first
            .children
            .iter()
            .map(|child| child.rect().width)
            .sum();
        assert!(
            (first_width - 176.0).abs() < 0.1,
            "a closer that fits keeps its full advance: {first_width}"
        );

        // The ideographic full stop is HanKerningCharType kDot, which
        // Blink's line-end gate excludes: no trim, the line breaks early.
        let text = format!("{ten}。永永永永永永");
        let outcome = lay(&text, 170.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(lines[0], "永".repeat(9), "kDot must not line-end trim");

        // A second closer forbids the break after the first: the extension
        // is rejected and the whole chain wraps.
        let text = format!("{ten}」」永永永永");
        let outcome = lay(&text, 170.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(
            lines[0],
            "永".repeat(9),
            "no extension without a break opportunity after the closer"
        );

        // With a text-indent (the long-paragraph shape that motivated
        // this), the first line's available advance shrinks by the indent
        // and the trim still applies within what remains.
        let text = format!("{ten}」永永永永永永");
        let outcome = lay_indent(&text, 202.0, 32.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(
            lines[0],
            format!("{ten}」"),
            "indent narrows the first line before the trim decision"
        );

        // A mixed-script dialogue line (real corpus paragraph): the Latin
        // run splits the shaping, the sentence ends in a pair-trimmed 。
        // followed by the line-end closing quote. Chromium holds this in
        // one line at 490px with a 32px indent; the trimmed ” must too.
        let text = "\u{201C}那是切嗣的本来面目的话．那我似乎惹得Master相当不快呢。\u{201D}";
        let outcome = lay_indent(text, 490.0, 32.0);
        let lines = line_texts(&outcome, text);
        assert_eq!(
            lines.len(),
            1,
            "mixed-script line with a trailing pair holds one line: {lines:?}"
        );

        // A whole unbreakable Latin word dragged down by its trailing
        // closer still extends: the candidate 」 sits TWELVE clusters
        // past the soft break (ten letters, the pair-trimmed 。, then
        // itself), far beyond the old 8-cluster scan cap (measured:
        // b20's 有點melancholy。」 packs onto the line with 。 at half
        // width and 」's blank half overflowing invisibly).
        let text = format!("{}melancholy。」", "永".repeat(20));
        let outcome = lay(&text, 430.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(
            lines.len(),
            1,
            "the trailing-punctuation extension reaches past a whole word: {lines:?}"
        );

        // A NEGATIVE indent (the hanging-indent idiom `text-indent: -1em;
        // padding-left: 1em`) out-dents the first line and widens its
        // advance by the same amount: at 160px with indent -16, the first
        // line holds eleven 16px ideographs starting at x = -16, the
        // continuation lines ten (measured on b19's `.po` footnotes:
        // first line one em left of the continuation lines).
        let text = "永".repeat(25);
        let outcome = lay_indent(&text, 160.0, -16.0);
        let lines = line_texts(&outcome, &text);
        assert_eq!(
            lines[0],
            "永".repeat(11),
            "the widened first line holds one extra ideograph"
        );
        assert_eq!(lines[1], "永".repeat(10), "continuation lines are unwidened");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(first_line) = &root.children[0] else {
            panic!("first child is a line");
        };
        assert!(
            (first_line.rect.x - (-16.0)).abs() < 0.1,
            "the first line box out-dents into the padding: x={}",
            first_line.rect.x
        );
    }

    /// The same must hold for CJK text: a named face whose ideograph
    /// advance differs from the pinned fallback's has to win shaping when
    /// the style names it. This is the exact 86 body-text shape.
    #[test]
    fn named_cjk_publication_fonts_shape_instead_of_the_pinned_fallback() {
        let kai = std::env::var("RITO_TEST_CJK_FONT")
            .ok()
            .and_then(|path| std::fs::read(path).ok());
        let Some(kai) = kai else {
            eprintln!("RITO_TEST_CJK_FONT not set; skipping");
            return;
        };
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let mut context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        context
            .register_named_font("FZWBKS", kai)
            .expect("named font registers");
        let shape_width = |families: Vec<FontFamily>| {
            let mut inline = InlineStyleTableV1::new(1);
            let style = inline
                .intern_for_node(
                    0,
                    plain_paragraph_style(
                        FontFamilies::new(families).expect("family list"),
                        16.0,
                        0.0,
                    ),
                )
                .expect("style interns");
            let nodes = vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: "在那座战场上没有任何阵亡者".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    }],
                },
                children: Vec::new(),
            }];
            let tree = FormattingTree::with_styles(
                nodes,
                FormattingNodeId(0),
                rito_fragment::FormattingTreeStyles {
                    layout: LayoutStyleTableV1::new(0),
                    inline,
                },
            )
            .expect("inline tree builds");
            let outcome = context
                .layout(
                    &tree,
                    tree.root(),
                    &ConstraintSpace::continuous(10_000.0),
                    None,
                    &CancelFlag::new(),
                )
                .expect("layout succeeds");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("root is a box");
            };
            let Fragment::Line(line) = &root.children[0] else {
                panic!("first child is a line");
            };
            line.children
                .iter()
                .map(|child| child.rect().width)
                .sum::<f64>()
        };
        let named = shape_width(vec![FontFamily::Named(FontFamilyName::new("FZWBKS"))]);
        let fallback = shape_width(vec![FontFamily::Named(FontFamilyName::new("NoSuchFace"))]);
        eprintln!("named {named} fallback {fallback}");
        assert!(
            (named - fallback).abs() > 0.5,
            "the named CJK face must shape differently: named {named}, fallback {fallback}"
        );
    }

    #[test]
    fn layout_is_deterministic_and_cache_replayable() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let space = ConstraintSpace::continuous(200.0);
        let cancel = CancelFlag::new();
        let first = context
            .layout(&tree, tree.root(), &space, None, &cancel)
            .expect("first layout");
        let second = context
            .layout(&tree, tree.root(), &space, None, &cancel)
            .expect("second layout");
        assert_eq!(first, second);

        let mut cache = FragmentCache::new(1 << 20);
        let computed = cache
            .layout(&context, &tree, tree.root(), &space, None, &cancel)
            .expect("cache fill");
        assert!(!computed.from_cache);
        let replayed = cache
            .layout(&context, &tree, tree.root(), &space, None, &cancel)
            .expect("cache replay");
        assert!(replayed.from_cache);
        assert_eq!(replayed.outcome, first);
    }

    #[test]
    fn line_geometry_is_positive_and_stacked() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        assert!(root.rect.height > 0.0);
        let mut previous_top = f64::NEG_INFINITY;
        for line in &root.children {
            let Fragment::Line(line) = line else {
                panic!("children are lines");
            };
            assert!(line.rect.height > 0.0);
            assert!(line.rect.width > 0.0);
            assert!(line.baseline > 0.0 && line.baseline <= line.rect.height);
            assert!(line.rect.y > previous_top);
            previous_top = line.rect.y;
        }
    }

    #[test]
    fn first_line_indent_narrows_only_the_first_line() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (plain_tree, text) = paragraph_tree(SAMPLE, 0.0);
        let (indented_tree, _) = paragraph_tree(SAMPLE, 32.0);
        let space = ConstraintSpace::continuous(200.0);
        let cancel = CancelFlag::new();
        let plain = context
            .layout(&plain_tree, plain_tree.root(), &space, None, &cancel)
            .expect("plain layout");
        let indented = context
            .layout(&indented_tree, indented_tree.root(), &space, None, &cancel)
            .expect("indented layout");
        let plain_lines = line_texts(&plain, &text);
        let indented_lines = line_texts(&indented, &text);
        assert_eq!(indented_lines.concat(), text);
        assert!(
            indented_lines[0].len() < plain_lines[0].len(),
            "indent must shorten the first line: {:?} vs {:?}",
            indented_lines[0],
            plain_lines[0]
        );
    }

    #[test]
    fn fragmented_space_and_break_tokens_fail_closed() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let cancel = CancelFlag::new();
        assert!(matches!(
            context.layout(
                &tree,
                tree.root(),
                &ConstraintSpace::fragmented(200.0, 400.0),
                None,
                &cancel
            ),
            Err(LayoutError::Invalid(_))
        ));
        let token = BreakToken {
            resume_path: vec![FormattingNodeId(0)],
            stage: BreakTokenStage::Before,
            pending_floats: Vec::new(),
        };
        assert!(matches!(
            context.layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(200.0),
                Some(&token),
                &cancel
            ),
            Err(LayoutError::Invalid(_))
        ));
    }

    #[test]
    fn cancellation_and_non_inline_roots_fail_closed() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let cancelled = CancelFlag::new();
        cancelled.cancel();
        assert_eq!(
            context.layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &cancelled
            ),
            Err(LayoutError::Cancelled)
        );

        let block_tree = FormattingTree::new(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::BlockContainer,
                children: Vec::new(),
            }],
            FormattingNodeId(0),
        )
        .expect("block tree builds");
        assert!(matches!(
            context.layout(
                &block_tree,
                block_tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new()
            ),
            Err(LayoutError::Invalid(_))
        ));
    }

    #[test]
    fn intrinsic_sizes_are_ordered_and_positive() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 0.0);
        let sizes = context
            .intrinsic_inline_sizes(&tree, FormattingNodeId(0))
            .expect("intrinsic sizes");
        assert!(sizes.min_content > 0.0);
        assert!(sizes.max_content >= sizes.min_content);
        let wide = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(sizes.max_content + 1.0),
                None,
                &CancelFlag::new(),
            )
            .expect("unconstrained layout");
        let Fragment::Box(root) = &wide.fragments.root else {
            panic!("root is a box");
        };
        assert_eq!(root.children.len(), 1, "max-content width fits one line");
    }

    #[test]
    fn text_indent_joins_intrinsic_widths() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (plain_tree, _) = paragraph_tree(SAMPLE, 0.0);
        let plain = context
            .intrinsic_inline_sizes(&plain_tree, FormattingNodeId(0))
            .expect("plain sizes");
        let (indented_tree, _) = paragraph_tree(SAMPLE, 32.0);
        let indented = context
            .intrinsic_inline_sizes(&indented_tree, FormattingNodeId(0))
            .expect("indented sizes");
        assert!(
            (indented.max_content - plain.max_content - 32.0).abs() < 0.01,
            "max-content grows by the indent: {} vs {}",
            indented.max_content,
            plain.max_content
        );
        assert!(
            (indented.min_content - plain.min_content - 32.0).abs() < 0.01,
            "min-content grows by the indent: {} vs {}",
            indented.min_content,
            plain.min_content
        );
    }

    /// A trailing U+00A0 stays in max-content while a trailing SPACE
    /// leaves it (measured on Chromium float shrink-to-fit boxes: the
    /// nbsp-tailed chat bubble keeps its nbsp's width, the space-tailed
    /// control drops it).
    #[test]
    fn a_trailing_nbsp_stays_in_max_content_and_a_space_leaves() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (bare_tree, _) = paragraph_tree("WWWW\nii", 0.0);
        let bare = context
            .intrinsic_inline_sizes(&bare_tree, FormattingNodeId(0))
            .expect("bare sizes");
        let (space_tree, _) = paragraph_tree("WWWW \nii", 0.0);
        let spaced = context
            .intrinsic_inline_sizes(&space_tree, FormattingNodeId(0))
            .expect("space sizes");
        let (nbsp_tree, _) = paragraph_tree("WWWW\u{a0}\nii", 0.0);
        let nbsp = context
            .intrinsic_inline_sizes(&nbsp_tree, FormattingNodeId(0))
            .expect("nbsp sizes");
        // The trimmed space's kern against the preceding letter stays
        // (the shaped W narrowed by the W+space pair), so the spaced
        // control can sit a fraction UNDER the bare one — never above.
        assert!(
            spaced.max_content <= bare.max_content + 0.01,
            "a trailing space leaves max-content: {} vs {}",
            spaced.max_content,
            bare.max_content
        );
        assert!(
            nbsp.max_content > bare.max_content + 3.0,
            "a trailing nbsp stays in max-content: {} vs {}",
            nbsp.max_content,
            bare.max_content
        );
    }

    #[test]
    fn empty_font_registration_fails_closed() {
        assert!(ParleyInlineContext::new(vec![vec![0_u8; 4]]).is_err());
    }

    #[test]
    fn an_atomic_inline_expands_before_but_defers_after() {
        // Measured against a Chromium badge-line justify map (2026-08-13):
        // the [text|atom] boundary expands (the badge sits at the END of
        // the preceding run's EXPANDED advance), but the atom is
        // NON-expansive on its trailing side — [atom|，] carries ZERO and
        // the comma's deferred before-share lands one boundary late
        // (，|next carries TWO). The total stays 4, so the share value is
        // unchanged; only the comma's own x shifts one share left.
        let text = "中中，中";
        let atoms = vec![6usize];
        let plan =
            line_justify_plan(text, 0..text.len(), 5.0, &[], &atoms).expect("plan builds");
        assert_eq!(plan.share, 1.25, "4 opportunities: deferral keeps the total");
        assert_eq!(plan.count_at(3), 1);
        assert_eq!(
            plan.count_at(6),
            1,
            "only the [text|atom] boundary at the comma's key; [atom|，] defers"
        );
        assert_eq!(plan.count_at(9), 2, "the deferred share lands after the comma");
        assert_eq!(
            plan.atom_shares_at(6, 0),
            Some(2),
            "one share before the atom plus its own left boundary"
        );
        let control =
            line_justify_plan(text, 0..text.len(), 5.0, &[], &[]).expect("control plan builds");
        assert_eq!(control.share, 5.0 / 3.0, "without the atom: 3 opportunities");
    }

    #[test]
    fn a_super_shifted_span_uses_the_host_measured_line_envelope() {
        // Blink quantizes a raised span's above-baseline line
        // contribution onto whole pixels through interplay no font table
        // exposes (a 64-configuration oracle matrix refused every closed
        // form — a real book's 0.8em bold ① marker line measures 26.125 with the
        // baseline at 21.328125 where the computed fallback gives
        // 28.125). The engine records a U+E00C probe keyed by the span's
        // size ratio and the strut's used line-height; once the host
        // answers, the measured envelope replaces the computed one.
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(2);
        let mut main_style = tinos_style(0.0);
        main_style.font.line_height = LineHeight::Length(
            rito_style_contract::NonNegativeCssPx::new(20.796875).expect("finite line height"),
        );
        main_style.font.line_height_is_declared = true;
        let main = inline
            .intern_for_node(0, main_style.clone())
            .expect("style interns");
        let mut span_style = main_style.clone();
        span_style.font.size = px(12.8);
        // The span INHERITS the paragraph's line-height (value carried,
        // declared flag off) — the probe models exactly this idiom; a
        // span declaring its own line-height keeps the fixed-box path.
        span_style.font.line_height_is_declared = false;
        let span = inline
            .intern_for_node(1, span_style)
            .expect("style interns");
        context.set_host_line_metric(
            &host_family_key(&main_style),
            16.0,
            "",
            HostNormalLineMetric {
                height: 23.0,
                baseline: 18.0,
                grid: Some((18.0, 5.0)),
                advance: None,
            },
        );
        let items = vec![
            InlineItem::Text {
                text: "ab ".to_owned(),
                style: main,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            },
            InlineItem::Text {
                text: "1".to_owned(),
                style: span,
                baseline_shift_px: 6.328125,
                ruby_annotation: None,
            },
            InlineItem::Text {
                text: " ab".to_owned(),
                style: main,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            },
        ];
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: rito_style_contract::LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow { items },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let constraint = ConstraintSpace::continuous(10_000.0);
        let sup_key = "\u{E00C}0.8000:20.796875";
        let _ = context
            .layout(&tree, FormattingNodeId(0), &constraint, None, &CancelFlag::new())
            .expect("first layout succeeds");
        let requests = context.take_host_metric_requests();
        assert!(
            requests
                .iter()
                .any(|(_, size, sample)| *size == 16.0 && sample == sup_key),
            "the sup probe is requested at the strut size: {requests:?}"
        );
        context.set_host_line_metric(
            &host_family_key(&main_style),
            16.0,
            sup_key,
            HostNormalLineMetric {
                height: 26.125,
                baseline: 21.328125,
                grid: None,
                advance: None,
            },
        );
        let outcome = context
            .layout(&tree, FormattingNodeId(0), &constraint, None, &CancelFlag::new())
            .expect("measured layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Fragment::Line(line) = &root.children[0] else {
            panic!("first child is a line");
        };
        assert_eq!(
            line.rect.height, 26.125,
            "the host-measured sup envelope sizes the line"
        );
    }

    #[test]
    fn a_super_shifted_marker_image_grows_the_line_with_a_consistent_baseline() {
        // The duokan footnote-marker construct (book 4, Section001 p11):
        // fixed 19.2px strut over a host metric (asc 18, desc 5), one
        // image 14.390625px tall raised 6.328125px (the sup rule at a
        // 16px parent). The expectations are the CSS 2.1 §10.8
        // contributions model over exactly these injected metrics; the
        // pixel oracle validates the same model end-to-end against Blink
        // with the production metric set (the page diffs to zero).
        use rito_style_contract::{
            AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
            LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleTableV1,
            LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
            MinimumHeightV1, OverflowV1, PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(2);
        let mut style_1922 = tinos_style(0.0);
        style_1922.font.line_height = LineHeight::Length(
            rito_style_contract::NonNegativeCssPx::new(19.2).expect("finite line height"),
        );
        let text_style = inline
            .intern_for_node(0, style_1922.clone())
            .expect("style interns");
        // The marker image inherits the sup's 12px font; its strut is the
        // sup box's strut (CSS 2.1 §10.8) and rides the same raise.
        let mut sup_style = style_1922.clone();
        sup_style.font.size = rito_style_contract::NonNegativeCssPx::new(12.0).expect("finite");
        let image_inline_style = inline
            .intern_for_node(1, sup_style.clone())
            .expect("style interns");
        context.set_host_line_metric(
            &host_family_key(&style_1922),
            16.0,
            "",
            HostNormalLineMetric {
                height: 23.0,
                baseline: 18.0,
                grid: None,
                advance: None,
            },
        );
        context.set_host_line_metric(
            &host_family_key(&sup_style),
            12.0,
            "",
            HostNormalLineMetric {
                height: 18.0,
                baseline: 14.0,
                grid: None,
                advance: None,
            },
        );
        let mut layout = LayoutStyleTableV1::new(1);
        let auto = LengthPercentageOrAuto::Auto;
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero"),
        ));
        let image_layout = layout
            .intern_for_node(
                0,
                LayoutFormattingStyleV1 {
                    display: LayoutDisplayV1 {
                        outside: LayoutDisplayOutsideV1::Inline,
                        inside: LayoutDisplayInsideV1::Flow,
                        is_list_item: false,
                    },
                    margin: PhysicalSides {
                        top: auto,
                        right: auto,
                        bottom: auto,
                        left: auto,
                    },
                    padding: PhysicalSides {
                        top: zero_padding,
                        right: zero_padding,
                        bottom: zero_padding,
                        left: zero_padding,
                    },
                    box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
                    justify_content: JustifyContentV1::Normal,
                    align_items: AlignItemsV1::Normal,
                    break_before: PageBreakV1::Auto,
                    break_after: PageBreakV1::Auto,
                    width: PreferredSizeV1::Auto,
                    height: PreferredSizeV1::Value(NonNegativeLengthPercentage::new(
                        LengthPercentage::Length(CssPx::new(14.390625).expect("finite")),
                    )),
                    max_width: MaximumSizeV1::None,
                    min_height: MinimumHeightV1::Auto,
                    max_height: MaximumHeightV1::None,
                    clear: ClearV1::None,
                    float: FloatV1::None,
                    overflow: OverflowV1::Visible,
                    list_style_type: ListMarkerStyleV1::None,
                    position: PositionV1::Static,
                    inset: PhysicalSides {
                        top: auto,
                        right: auto,
                        bottom: auto,
                        left: auto,
                    },
                    vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
                    border_spacing: (
                        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                    ),
            border_collapse: false,
                },
            )
            .expect("layout style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "巴沙巴沙".to_owned(),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Image {
                    source: 0,
                        src: "images/note.png".to_owned(),
                        intrinsic_width: 500.0,
                        intrinsic_height: 500.0,
                        style: image_inline_style,
                        layout_style: image_layout,
                        fit_contain: false,
                        viewport: None,
                        baseline_shift_px: 6.328125,
                        align_top: false,
                    },
                    InlineItem::Text {
                        text: "，甘夏老师".to_owned(),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(600.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let Some(Fragment::Line(line)) = root.children.first() else {
            panic!("first child is a line");
        };
        // Contributions over the injected metrics: the sup strut (fixed
        // 19.203125 at 12px, baseline 15) raised 6.328125 wins over the
        // image box (14.390625 + 6.328125): A = 21.328125, height =
        // A + strut descent 3.203125 = 24.53125.
        assert!(
            (line.rect.height - 24.53125).abs() < 1e-9,
            "line height matches pinned Blink, got {}",
            line.rect.height
        );
        assert!(
            (line.baseline - 21.328125).abs() < 1e-9,
            "baseline == above (pinned Blink 21.328125), got {}",
            line.baseline
        );
    }

    #[test]
    fn images_lay_out_as_atomic_inlines_with_display_geometry() {
        use rito_style_contract::{
            AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
            LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleTableV1,
            LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1,
            MinimumHeightV1, OverflowV1, PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let text_style = inline
            .intern_for_node(0, tinos_style(0.0))
            .expect("style interns");
        let mut layout = LayoutStyleTableV1::new(1);
        let auto = LengthPercentageOrAuto::Auto;
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero"),
        ));
        let image_layout = layout
            .intern_for_node(
                0,
                LayoutFormattingStyleV1 {
                    display: LayoutDisplayV1 {
                        outside: LayoutDisplayOutsideV1::Inline,
                        inside: LayoutDisplayInsideV1::Flow,
                        is_list_item: false,
                    },
                    margin: PhysicalSides {
                        top: auto,
                        right: auto,
                        bottom: auto,
                        left: auto,
                    },
                    padding: PhysicalSides {
                        top: zero_padding,
                        right: zero_padding,
                        bottom: zero_padding,
                        left: zero_padding,
                    },
                    box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
                    justify_content: JustifyContentV1::Normal,
                    align_items: AlignItemsV1::Normal,
                    break_before: PageBreakV1::Auto,
                    break_after: PageBreakV1::Auto,
                    width: PreferredSizeV1::Auto,
                    height: PreferredSizeV1::Auto,
                    max_width: MaximumSizeV1::None,
                    min_height: MinimumHeightV1::Auto,
                    max_height: MaximumHeightV1::None,
                    clear: ClearV1::None,
                    float: FloatV1::None,
                    overflow: OverflowV1::Visible,
                    list_style_type: ListMarkerStyleV1::None,
                    position: PositionV1::Static,
                    inset: PhysicalSides {
                        top: auto,
                        right: auto,
                        bottom: auto,
                        left: auto,
                    },
                    vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
                    border_spacing: (
                        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                        rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                    ),
            border_collapse: false,
                },
            )
            .expect("layout style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "Before ".to_owned(),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Image {
                    source: 0,
                        src: "images/figure.png".to_owned(),
                        intrinsic_width: 40.0,
                        intrinsic_height: 30.0,
                        style: text_style,
                        layout_style: image_layout,
                        fit_contain: false,
                        viewport: None,
                        baseline_shift_px: 0.0,
                        align_top: false,
                    },
                    InlineItem::Text {
                        text: " after the picture.".to_owned(),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(400.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let mut images = Vec::new();
        for line in &root.children {
            let Fragment::Line(line) = line else {
                panic!("children are lines");
            };
            for child in &line.children {
                if let Fragment::Image(image) = child {
                    images.push(image.clone());
                }
            }
            assert!(line.rect.height >= 30.0, "the image sets the line height");
        }
        assert_eq!(images.len(), 1);
        let image = &images[0];
        assert_eq!(image.item_index, 1);
        assert!((image.rect.width - 40.0).abs() < 0.01);
        assert!((image.rect.height - 30.0).abs() < 0.01);
        assert!(image.rect.x > 0.0, "the image sits after the leading text");

        let replay = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(400.0),
                None,
                &CancelFlag::new(),
            )
            .expect("replay succeeds");
        assert_eq!(outcome, replay);
    }

    #[test]
    fn glyph_runs_split_at_item_boundaries_even_with_identical_measure_styles() {
        // Two items sharing one interned style differ in nothing Parley
        // measures — exactly the shape of a pure paint change (a colored
        // span). The per-item brush must still keep their runs apart so a
        // paint consumer can map each run to its item by byte range.
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(0, tinos_style(0.0))
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "ab".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Text {
                        text: "cd".to_owned(),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(400.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        let mut ranges = Vec::new();
        for line in &root.children {
            let Fragment::Line(line) = line else {
                panic!("children are lines");
            };
            for child in &line.children {
                if let Fragment::Text(run) = child {
                    ranges.push((run.text_start, run.text_end));
                }
            }
        }
        assert_eq!(ranges, vec![(0, 2), (2, 4)]);
    }

    #[test]
    fn glyph_runs_carry_monotonic_geometry_and_indent_offsets_the_first_run() {
        let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
        let (tree, _) = paragraph_tree(SAMPLE, 32.0);
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(200.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root is a box");
        };
        for (line_index, line) in root.children.iter().enumerate() {
            let Fragment::Line(line) = line else {
                panic!("children are lines");
            };
            assert!(line.trailing_whitespace >= 0.0);
            assert!(line.trailing_whitespace < line.rect.width);
            let mut previous_end = f64::NEG_INFINITY;
            for run in &line.children {
                let Fragment::Text(run) = run else {
                    panic!("line children are text fragments");
                };
                assert!(run.rect.width > 0.0);
                assert!(
                    run.rect.x >= previous_end - 0.01,
                    "runs must advance monotonically"
                );
                previous_end = run.rect.x + run.rect.width;
            }
            let Some(Fragment::Text(first_run)) = line.children.first() else {
                panic!("lines carry text fragments");
            };
            // The indent is a start-edge margin on the line box, so it
            // lands on the line's own x; run positions stay relative to
            // the line they sit on.
            assert!(
                first_run.rect.x.abs() < 0.01,
                "runs are positioned inside their line, got x = {}",
                first_run.rect.x
            );
            if line_index == 0 {
                assert!(
                    (line.rect.x - 32.0).abs() < 0.01,
                    "first line starts after the indent, got x = {}",
                    line.rect.x
                );
            } else {
                assert!(
                    line.rect.x.abs() < 0.01,
                    "continuation lines start at zero, got x = {}",
                    line.rect.x
                );
            }
        }
    }

    /// A ruby base splits across lines like plain CJK text (measured:
    /// 黄金妖精/Leprechaun wraps as 黄金妖|精 — every base character
    /// boundary is an ordinary break point; the annotation itself rides
    /// only the first segment, which the paint layer enforces).
    #[test]
    fn a_ruby_base_breaks_across_lines_like_plain_text() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            32.0,
            0.0,
        );
        let mut inline = InlineStyleTableV1::new(1);
        let interned = inline
            .intern_for_node(0, style)
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "中中中中".to_owned(),
                        style: interned,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Text {
                        text: "中文".to_owned(),
                        style: interned,
                        baseline_shift_px: 0.0,
                        ruby_annotation: Some(rito_fragment::RubyAnnotation {
                            text: "an".to_owned(),
                            size_ratio: 0.5,
                            align: rito_style_contract::RubyAlign::SpaceAround
                        }),
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        // 165px: four 32px lead glyphs plus the first base glyph fit
        // (160), so the base splits after its first character exactly as
        // plain text would.
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(165.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let lines = line_texts(&outcome, "中中中中中文");
        assert_eq!(
            lines,
            vec!["中中中中中".to_owned(), "文".to_owned()],
            "the annotated base breaks at an ordinary character boundary"
        );
    }

    /// A split whose first segment cannot carry the whole annotation is
    /// illegal: the segment widens to at least the annotation's advance,
    /// and when that overflows the line the ruby moves down intact
    /// (measured: 异/Talent went down where plain-text fit had room;
    /// 黄金妖/Leprechaun stayed split because the segment covers it).
    #[test]
    fn a_ruby_split_whose_annotation_overflows_rewinds_to_the_item_start() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            32.0,
            0.0,
        );
        let mut inline = InlineStyleTableV1::new(1);
        let interned = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "中中中".to_owned(),
                        style: interned,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                    InlineItem::Text {
                        text: "中文中".to_owned(),
                        style: interned,
                        baseline_shift_px: 0.0,
                        ruby_annotation: Some(rito_fragment::RubyAnnotation {
                            // A single word: its character midpoint (0.5)
                            // sits inside the two-of-three-character
                            // first segment, so the whole annotation
                            // rides it — at ~81px it overflows the 64px
                            // segment (yet stays narrower than the 96px
                            // base, so no space-around spread joins in).
                            text: "wwwwww".to_owned(),
                            size_ratio: 0.5,
                            align: rito_style_contract::RubyAlign::SpaceAround
                        }),
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        // 165px: three lead glyphs plus two base glyphs fit as plain
        // text (160), the split point sits two-thirds into the base, and
        // the single word's midpoint (0.5) rides that first segment —
        // which cannot carry the ~81px annotation.
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(165.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let lines = line_texts(&outcome, "中中中中文中");
        assert_eq!(
            lines,
            vec!["中中中".to_owned(), "中文中".to_owned()],
            "the overflowing split rewinds the whole base to the next line"
        );
    }

    /// `ruby-align: space-around`: an annotation wider than its base
    /// opens the excess as interior gaps between the base clusters (all
    /// but one share; the rest overhangs), so the base run widens by
    /// exactly (n−1) gaps and carries the gap as justify spacing.
    #[test]
    fn zero_line_height_paragraph_still_emits_its_line() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let mut style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            16.0,
            0.0,
        );
        style.font.line_height = rito_style_contract::LineHeight::Length(
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero line height"),
        );
        let mut inline = InlineStyleTableV1::new(1);
        let interned = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "零高行文本".to_owned(),
                    style: interned,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(500.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("inline outcome root is a box fragment");
        };
        let lines: Vec<_> = root
            .children
            .iter()
            .filter(|child| matches!(child, Fragment::Line(_)))
            .collect();
        assert_eq!(lines.len(), 1, "the zero-line-height paragraph keeps its line");
        let Fragment::Line(line) = lines[0] else { unreachable!() };
        assert!(
            line.children
                .iter()
                .any(|child| matches!(child, Fragment::Text(_))),
            "the line keeps its text run"
        );
    }

    #[test]
    fn a_wide_ruby_annotation_spreads_its_base_with_interior_gaps() {
        let source_han = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        ))
        .expect("pinned serif reads");
        let context = ParleyInlineContext::new(vec![source_han]).expect("context builds");
        let style = plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                .expect("family list"),
            32.0,
            0.0,
        );
        let ratio = 0.5_f32;
        let annotation_advance =
            context.measure_styled_advance(&style, Some(32.0 * ratio), "annotation");
        let base_advance = context.measure_styled_advance(&style, None, "中文");
        assert!(
            annotation_advance > base_advance + 1.0,
            "fixture must need a spread: annotation {annotation_advance} vs base {base_advance}"
        );
        let gap = (annotation_advance - base_advance) / 2.0;

        let mut inline = InlineStyleTableV1::new(1);
        let interned = inline
            .intern_for_node(0, style.clone())
            .expect("style interns");
        let nodes = vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    InlineItem::Text {
                        text: "中文".to_owned(),
                        style: interned,
                        baseline_shift_px: 0.0,
                        ruby_annotation: Some(rito_fragment::RubyAnnotation {
                            text: "annotation".to_owned(),
                            size_ratio: ratio,
                            align: rito_style_contract::RubyAlign::SpaceAround
                        }),
                    },
                    InlineItem::Text {
                        text: "中文".to_owned(),
                        style: interned,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    },
                ],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            rito_fragment::FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("inline tree builds");
        let outcome = context
            .layout(
                &tree,
                tree.root(),
                &ConstraintSpace::continuous(500.0),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("inline outcome root is a box fragment");
        };
        let Some(Fragment::Line(line)) = root.children.first() else {
            panic!("outcome has a first line");
        };
        let runs: Vec<&TextFragment> = line
            .children
            .iter()
            .filter_map(|child| match child {
                Fragment::Text(run) => Some(run),
                _ => None,
            })
            .collect();
        assert_eq!(runs.len(), 2, "one run per item");
        let (ruby_run, plain_run) = (runs[0], runs[1]);
        assert!(
            (ruby_run.ruby_gap_px - gap).abs() < 0.1,
            "ruby run carries the interior gap: {} vs {gap}",
            ruby_run.ruby_gap_px
        );
        assert_eq!(plain_run.ruby_gap_px, 0.0);
        // The ruby sits at the paragraph start: the left edge share
        // cannot overhang the flow edge and is absorbed into the column;
        // the right edge share overhangs the plain neighbour paint-only.
        let absorbed_left = (annotation_advance - base_advance) / 4.0;
        assert!(
            (ruby_run.rect.width - (base_advance + gap + absorbed_left)).abs() < 0.1,
            "base spreads by one interior gap plus the absorbed flow-edge share (n = 2): width {} vs {}",
            ruby_run.rect.width,
            base_advance + gap + absorbed_left
        );
        assert!(
            (plain_run.rect.width - base_advance).abs() < 0.1,
            "the plain neighbour stays at its natural advance"
        );
        assert!(
            (plain_run.rect.x - (ruby_run.rect.x + ruby_run.rect.width)).abs() < 0.1,
            "the neighbour starts right after the spread base"
        );
    }

}
