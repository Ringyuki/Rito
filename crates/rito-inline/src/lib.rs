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

/// The half-leaded baseline offset inside a fixed-height line box, the way
/// Blink places it: the strut font's integer ascent plus half the leading,
/// rounded to a whole pixel (measured: Tinos 14/4 under 19.2px lands the
/// baseline at 15 — round(14.6) — and SourceHan 18/5 at 16 — round(16.1)).
fn fixed_line_baseline(height: f64, ascent: f64, descent: f64) -> f64 {
    (ascent + (height - (ascent + descent)) / 2.0).round()
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

    /// Host normal-line metric for a style and sample, recording a
    /// measurement request on a miss so the host can fill it in. An empty
    /// sample is the inline box's own strut; a one-character sample is a
    /// text run, measured through the host's own font fallback.
    fn host_normal_line(
        &self,
        style: &InlineFormattingStyleV1,
        sample: &str,
    ) -> Option<HostNormalLineMetric> {
        let family = host_family_key(style);
        let size = f64::from(style.font.size.get());
        let key = (family, host_size_key(size), sample.to_owned());
        if let Some(metric) = self.host_line_metrics.borrow().get(&key) {
            return Some(*metric);
        }
        self.host_metric_requests.borrow_mut().insert(key);
        None
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
                Some(InlineItem::Text { style, .. }) | Some(InlineItem::Image { style, .. }) => {
                    *style
                }
                None => return Ok(None),
            },
        };
        let style = styles
            .inline
            .style(style_id)
            .map_err(|error| LayoutError::Invalid(error.to_string()))?;
        Ok(Some(match style.font.line_height {
            LineHeight::Number(number) => {
                f64::from(number.get()) * f64::from(style.font.size.get())
            }
            LineHeight::Length(px) => f64::from(px.get()),
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

    fn build_layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        available_inline_size: Option<f64>,
        available_block_size: Option<f64>,
        percentage_images: PercentageImageSizing,
        end_trims: &[usize],
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
        // Blink consults its pair-preference table only under
        // `word-break: normal`; `break-all`/`keep-all` change the break
        // opportunities the table would otherwise veto.
        let mut chromium_tailoring = true;
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
                    runs.push((start..text.len(), style, item_index));
                }
                InlineItem::Image {
                    intrinsic_width,
                    intrinsic_height,
                    layout_style,
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
                        percentage_images,
                    )?;
                    image_boxes.push(InlineBox {
                        id: item_index as u64,
                        kind: InlineBoxKind::InFlow,
                        index: text.len(),
                        width,
                        height,
                    });
                }
            }
        }

        let mut fonts = self.fonts.borrow_mut();
        // Computed before the builder takes the font borrow: the trim
        // gate resolves each trimmed character's font to check `halt`.
        let punctuation_trims = compute_cjk_punctuation_trims(
            &mut fonts,
            &self.registered_families,
            &mut self.halt_feature_cache.borrow_mut(),
            &text,
            &runs,
        );
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = layouts.ranged_builder(&mut fonts, &text, 1.0, true);
        // The pinned-browser baseline: Chromium's ASCII break tailoring plus
        // its CJK-context treatment of ambiguous curly quotes.
        if chromium_tailoring {
            builder.set_line_break_override(Some(&cjk_aware_chromium_break_override));
        }
        // `text-indent` is the block container's own inherited property and
        // indents its first line whatever sits on it — a line holding only
        // an image included. Reading it off whichever text run happens to
        // start at byte zero would skip every image-only first line.
        let first_line_indent = tree
            .strut_style(node)
            .or_else(|| {
                items.first().and_then(|item| match item {
                    InlineItem::Text { style, .. } | InlineItem::Image { style, .. } => Some(*style),
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
        }
        for (range, spacing) in punctuation_trims {
            builder.push(StyleProperty::LetterSpacing(spacing), range);
        }
        push_line_end_trims(&mut builder, &text, &runs, end_trims);
        for image_box in image_boxes {
            builder.push_inline_box(image_box);
        }
        if cancel.is_cancelled() {
            return Err(LayoutError::Cancelled);
        }
        // text-align inherits, so the first item's style carries the
        // paragraph's alignment (an empty flow never reaches layout).
        let alignment = items
            .first()
            .map(|item| {
                let style_id = match item {
                    InlineItem::Text { style, .. } | InlineItem::Image { style, .. } => *style,
                };
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
        let break_lines = |layout: &mut parley::Layout<[u8; 4]>| match band {
            None => layout.break_all_lines(Some(space.inline_size as f32)),
            Some(band) => {
                let band_inline_size =
                    (space.inline_size - band.left_inset - band.right_inset).max(0.0);
                let mut breaker = layout.break_lines();
                breaker
                    .state_mut()
                    .set_layout_max_advance(space.inline_size as f32);
                loop {
                    let inside = f64::from(breaker.committed_y() as f32) < band.bottom;
                    let (advance, offset) = if inside {
                        (band_inline_size, band.left_inset)
                    } else {
                        (space.inline_size, 0.0)
                    };
                    let state = breaker.state_mut();
                    state.set_line_max_advance(advance as f32);
                    state.set_line_x(offset as f32);
                    if breaker.break_next().is_none() {
                        break;
                    }
                }
                breaker.finish();
            }
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
        let mut end_trims: Vec<usize> = Vec::new();
        let mut rejected_trims: Vec<usize> = Vec::new();
        let mut pending_trim: Option<usize> = None;
        let (layout, alignment, shifted_ranges) = loop {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            let ParagraphLayout {
                mut layout,
                alignment,
                shifted_ranges,
                text,
                first_line_indent,
            } = self.build_layout(
                tree,
                root,
                Some(space.inline_size),
                space.fragmentainer_size,
                PercentageImageSizing::Intrinsic,
                &end_trims,
                cancel,
            )?;
            break_lines(&mut layout);
            if let Some(byte) = pending_trim.take() {
                let trimmed_end = byte + text[byte..].chars().next().map_or(1, char::len_utf8);
                let confirmed = layout.lines().any(|line| line.text_range().end == trimmed_end);
                if !confirmed {
                    end_trims.retain(|&trim| trim != byte);
                    rejected_trims.push(byte);
                    continue;
                }
            }
            let mut line_top = 0.0_f64;
            let candidate = (0..layout.len().saturating_sub(1)).find_map(|index| {
                // The text-indent margin narrows the first line's
                // available advance exactly as it narrowed Parley's fit.
                let indent = if index == 0 { first_line_indent } else { 0.0 };
                let max_advance = line_max_advance(line_top) - indent;
                line_top += layout
                    .get(index)
                    .map_or(0.0, |line| f64::from(line.metrics().line_height));
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
                }
                None => break (layout, alignment, shifted_ranges),
            }
        };
        let mut layout = layout;
        // Always align, `Start` included: alignment is where Parley applies
        // the first-line indent's start-edge offset, so skipping it for the
        // default alignment would leave indented lines flush.
        layout.align(alignment, parley::AlignmentOptions::default());
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
                    } => *baseline_shift_px,
                })
                .collect(),
            _ => Vec::new(),
        };
        // Byte range each item occupies in the flow text (images occupy
        // none). Parley reports a glyph run's range at shaping-run
        // granularity, and one shaping run can span several items when
        // their measure styles are identical; intersecting with the run's
        // brushed item recovers the exact per-item range.
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
                        InlineItem::Image { .. } => cursor..cursor,
                    })
                    .collect()
            }
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
                    InlineItem::Image { .. } => "",
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
                            declared: match resolved.font.line_height {
                                LineHeight::Number(number) => Some(layout_unit(
                                    f64::from(number.get()) * f64::from(resolved.font.size.get()),
                                )),
                                LineHeight::Length(px) => Some(layout_unit(f64::from(px.get()))),
                                LineHeight::Normal => None,
                            },
                        })
                    }
                    // An image carries its own style so a line holding
                    // only images can still find the host metrics that
                    // size the space around it.
                    InlineItem::Image { style, .. } => Some(ItemLineHeight {
                        style: *style,
                        declared: None,
                    }),
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

        let mut lines = Vec::new();
        // Line boxes stack by their CSS line height: the box model the
        // browser's per-character range rects expose. Parley's block
        // min/max coordinates track ink extents, which drift from the
        // line-height stack by rounding and leading distribution, so the
        // block position comes from accumulation instead.
        let mut running_top = 0.0_f64;
        for line in layout.lines() {
            let metrics = line.metrics();
            let line_top = running_top;
            let has_inline_box = line
                .items()
                .any(|item| matches!(&item, PositionedLayoutItem::InlineBox(_)));
            // Env-gated line forensics for the native probe binary (wasm
            // has no env; the flag simply never sets there).
            let line_debug = std::env::var_os("RITO_LINE_DEBUG").is_some();
            let mut debug_misses: Vec<String> = Vec::new();
            let ink_top = f64::from(metrics.block_min_coord);
            let line_x = f64::from(metrics.offset);
            // Collect the line's content first, remembering each child's
            // baseline shift, so the line box can grow by however far
            // shifted content rises above the strut before positions are
            // finalized (a browser's line box contains its risen content).
            let mut children: Vec<(Fragment, f64)> = Vec::new();
            let mut max_rise = 0.0_f64;
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
                            for character in flow_text
                                .get(run_range.clone())
                                .unwrap_or_default()
                                .chars()
                                .filter(|c| !c.is_whitespace())
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
                        children.push((
                            Fragment::Text(TextFragment {
                                source: root,
                                rect: FragmentRect {
                                    x: f64::from(glyph_run.offset()) - line_x,
                                    y: 0.0,
                                    width: f64::from(glyph_run.advance()),
                                    height: 0.0,
                                },
                                text_start: run_range.start as u32,
                                text_end: run_range.end as u32,
                            }),
                            shift,
                        ));
                    }
                    PositionedLayoutItem::InlineBox(inline_box) => {
                        // Every inline box is an atomic image item. Its
                        // vertical position is measured in Parley's ink
                        // coordinates, so it maps into the line box through
                        // the ink top.
                        let shift = item_shifts
                            .get(inline_box.id as usize)
                            .copied()
                            .unwrap_or(0.0);
                        max_rise = max_rise.max(shift);
                        children.push((
                            Fragment::Image(rito_fragment::ImageFragment {
                                source: root,
                                rect: FragmentRect {
                                    x: f64::from(inline_box.x) - line_x,
                                    y: f64::from(inline_box.y) - ink_top,
                                    width: f64::from(inline_box.width),
                                    height: f64::from(inline_box.height),
                                },
                                item_index: inline_box.id as u32,
                            }),
                            shift,
                        ));
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
                let on_line = line_image_items.contains(&index)
                    || line_text_range.is_some_and(|(start, end)| {
                        range.start < end && start < range.end
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
                let mut entries: Vec<(&InlineFormattingStyleV1, &str, f64)> = Vec::new();
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
                        Some(resolved) => entries.push((resolved, "", 0.0)),
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
                for (index, range) in item_text_ranges.iter().enumerate() {
                    let on_line = line_text_range
                        .is_some_and(|(start, end)| range.start < end && start < range.end);
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
                    entries.push((resolved, "", shift));
                    if matches!(resolved.font.line_height, LineHeight::Normal) {
                        for (run_item, sample) in &line_run_samples {
                            if *run_item == index {
                                entries.push((resolved, sample.as_str(), shift));
                            }
                        }
                    }
                }
                let mut above = 0.0_f64;
                let mut below = 0.0_f64;
                for (resolved, sample, shift) in entries {
                    let Some(metric) = self.host_normal_line(resolved, sample) else {
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
                    let (item_above, item_below) = match resolved.font.line_height {
                        LineHeight::Normal => (asc, desc),
                        LineHeight::Number(number) => {
                            let height = layout_unit(
                                f64::from(number.get()) * f64::from(resolved.font.size.get()),
                            );
                            let a = metric.fixed_baseline(height);
                            (a, height - a)
                        }
                        LineHeight::Length(px) => {
                            let height = layout_unit(f64::from(px.get()));
                            let a = metric.fixed_baseline(height);
                            (a, height - a)
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
                for (fragment, shift) in &children {
                    if let Fragment::Image(image) = fragment {
                        above = above.max(image.rect.height + shift);
                        below = below.max(-shift);
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
                        let (item_above, item_below) = match resolved.font.line_height {
                            LineHeight::Normal => (asc, desc),
                            LineHeight::Number(number) => {
                                let height = layout_unit(
                                    f64::from(number.get()) * f64::from(resolved.font.size.get()),
                                );
                                let a = metric.fixed_baseline(height);
                                (a, height - a)
                            }
                            LineHeight::Length(px) => {
                                let height = layout_unit(f64::from(px.get()));
                                let a = metric.fixed_baseline(height);
                                (a, height - a)
                            }
                        };
                        above = above.max(item_above + shift);
                        below = below.max(item_below - shift);
                    }
                }
                (complete && above + below > 0.0).then_some((above, below))
            } else {
                None
            };
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
            } else if let Some((host, _)) = host_line {
                host.max(strut_height.unwrap_or(0.0))
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
                Some((content_height, ascent)) => {
                    max_rise + ((base_height - content_height) / 2.0).floor() + ascent
                }
                None => {
                    let half_leading = (base_height
                        - f64::from(metrics.ascent)
                        - f64::from(metrics.descent))
                        / 2.0;
                    max_rise + half_leading + f64::from(metrics.ascent)
                }
                }
            };
            if line_debug && has_inline_box {
                eprintln!(
                    "[line-debug] contributions={contributions:?} host_line={host_line:?} \
                     baseline={baseline} height={line_height} max_rise={max_rise} \
                     misses={debug_misses:?}"
                );
            }
            let children: Vec<Fragment> = children
                .into_iter()
                .map(|(mut fragment, shift)| {
                    let adjust = max_rise - shift;
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
                            image.rect.y = baseline - shift - image.rect.height;
                        }
                        _ => {}
                    }
                    fragment
                })
                .collect();
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
            PercentageImageSizing::Shrunk,
            &[],
            &CancelFlag::new(),
        )?;
        let intrinsic = self.build_layout(
            tree,
            node,
            None,
            None,
            PercentageImageSizing::Intrinsic,
            &[],
            &CancelFlag::new(),
        )?;
        Ok(IntrinsicInlineSizes {
            min_content: f64::from(shrunk.layout.calculate_content_widths().min),
            max_content: f64::from(intrinsic.layout.calculate_content_widths().max),
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
fn cjk_aware_chromium_break_override(context: parley::LineBreakContext) -> Option<bool> {
    const OPEN_QUOTES: [char; 2] = ['\u{2018}', '\u{201C}'];
    const CLOSE_QUOTES: [char; 2] = ['\u{2019}', '\u{201D}'];
    if OPEN_QUOTES.contains(&context.after)
        && is_cjk_context(context.before)
        && fullwidth_punctuation_class(context.before) != PunctuationClass::Open
        && !OPEN_QUOTES.contains(&context.before)
    {
        return Some(true);
    }
    if CLOSE_QUOTES.contains(&context.before)
        && is_cjk_context(context.after)
        && fullwidth_punctuation_class(context.after) != PunctuationClass::CloseOrStop
        && !CLOSE_QUOTES.contains(&context.after)
        && !OPEN_QUOTES.contains(&context.after)
    {
        return Some(true);
    }
    (parley::CHROMIUM_LINE_BREAK_OVERRIDE)(context)
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
        '・' => PunctuationClass::Middle,
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
fn compute_cjk_punctuation_trims(
    fonts: &mut FontContext,
    registered_families: &[String],
    halt_cache: &mut std::collections::HashMap<(u64, u32), bool>,
    text: &str,
    runs: &[(std::ops::Range<usize>, &InlineFormattingStyleV1, usize)],
) -> Vec<(std::ops::Range<usize>, f32)> {
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
            if let Some(trimmed) = cjk_punctuation_trim(left, character) {
                let left_style = style_at(&mut cursor, runs, left_byte);
                let (trimmed_style, trimmed_char) = match trimmed {
                    TrimmedGlyph::Left => (left_style, left),
                    TrimmedGlyph::Right => (style_at(&mut cursor, runs, byte), character),
                };
                if let (Some(left_style), Some(trimmed_style)) = (left_style, trimmed_style) {
                    if !resolved_font_has_halt(
                        fonts,
                        registered_families,
                        halt_cache,
                        trimmed_style,
                        trimmed_char,
                    ) {
                        previous = Some((byte, character));
                        continue;
                    }
                    let author = match left_style.text_flow.letter_spacing {
                        LengthPercentage::Length(px) => px.get(),
                        _ => 0.0,
                    };
                    trims.push((
                        left_byte..byte,
                        author - 0.5 * trimmed_style.font.size.get(),
                    ));
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
fn resolved_font_has_halt(
    fonts: &mut FontContext,
    registered_families: &[String],
    halt_cache: &mut std::collections::HashMap<(u64, u32), bool>,
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
        if font_ref.charmap().map(character).is_none() {
            continue;
        }
        let key = (blob.id(), font.index());
        return *halt_cache
            .entry(key)
            .or_insert_with(|| font_ref_has_halt(&font_ref));
    }
    false
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

/// Layout-unit epsilon for line-fit comparisons, Chromium's `LayoutUnit`
/// quantum (1/64 px).
const LINE_FIT_EPS: f32 = 1.0 / 64.0;

/// How many glyphs past a soft break the candidate scan follows. Break
/// prohibitions drag at most a couple of characters down with an
/// overflowing closer; anything longer is not the pattern this models.
const LINE_END_TRIM_SCAN: usize = 8;

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
/// not otherwise fit prior to justification".
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
            StyleProperty::LetterSpacing(author - 0.5 * style.font.size.get()),
            byte..byte + character.len_utf8(),
        );
    }
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
        StyleProperty::FontSize(style.font.size.get()),
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
        NonNegativeLengthPercentage, OverflowWrap, PhysicalSides, TextAlign, TextDecoration,
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
    percentage_images: PercentageImageSizing,
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
    let resolve_block = |value: LengthPercentage| -> Option<f64> {
        match value {
            LengthPercentage::Length(px) => Some(f64::from(px.get())),
            LengthPercentage::Percentage(ratio) => {
                available_block_size.map(|basis| f64::from(ratio.ratio()) * basis)
            }
            LengthPercentage::Linear { length, percentage } => available_block_size
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
    let ratio = if intrinsic_width > 0.0 && intrinsic_height > 0.0 {
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
    let (mut width, mut height) = match (preferred_width, preferred_height) {
        (Some(width), Some(height)) => (width, height),
        (Some(width), None) => (width, width * ratio),
        (None, Some(height)) => (height / ratio.max(f64::EPSILON), height),
        (None, None) => (intrinsic_width, intrinsic_height),
    };
    if width_percentage_without_basis && percentage_images == PercentageImageSizing::Shrunk {
        return Ok((0.0, 0.0));
    }
    if let MaximumSizeV1::Value(cap) = layout_style.max_width {
        if let Some(cap) = resolve(cap.value()) {
            if width > cap && width > 0.0 {
                let scale = cap / width;
                width = cap;
                height *= scale;
            }
        }
    }
    // Reader UA policy, declared rather than implicit: a replaced element
    // never exceeds one page. Every paginated reader applies some form of
    // it (epub.js injects `max-width`/`max-height: 100%`), because a
    // browser's own answer — paint at CSS size and let the viewport clip —
    // loses content the reader can never scroll to. The browser baseline
    // is measured with the same rule injected, so the comparison stays
    // like for like.
    if let Some(page_height) = available_block_size {
        if height > page_height && height > 0.0 && page_height > 0.0 {
            let scale = page_height / height;
            height = page_height;
            width *= scale;
        }
        if let Some(page_width) = available_inline_size {
            if width > page_width && width > 0.0 && page_width > 0.0 {
                let scale = page_width / width;
                width = page_width;
                height *= scale;
            }
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
/// this provider.
fn resolved_text_indent(style: &InlineFormattingStyleV1) -> f32 {
    match style.text_flow.text_indent.value {
        LengthPercentage::Length(px) => px.get().max(0.0),
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
        TextAlign, TextDecoration, TextDecorationLines, TextDecorationStyle, TextIndent,
        TextJustify, TextTransform, TextTransformCase, TextWrapMode, TransformListV1, UnitInterval,
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
    fn empty_font_registration_fails_closed() {
        assert!(ParleyInlineContext::new(vec![vec![0_u8; 4]]).is_err());
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
                        src: "images/note.png".to_owned(),
                        intrinsic_width: 500.0,
                        intrinsic_height: 500.0,
                        style: image_inline_style,
                        layout_style: image_layout,
                        fit_contain: false,
                        viewport: None,
                        baseline_shift_px: 6.328125,
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
                        src: "images/figure.png".to_owned(),
                        intrinsic_width: 40.0,
                        intrinsic_height: 30.0,
                        style: text_style,
                        layout_style: image_layout,
                        fit_contain: false,
                        viewport: None,
                        baseline_shift_px: 0.0,
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
}
