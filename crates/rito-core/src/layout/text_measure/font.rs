use super::{
    font_aware_fallback_character_width, font_aware_fallback_pair_adjustment, TextMeasurementCache,
    TextMeasurementCacheKey, TextMeasurementStyle,
};
use crate::layout::{FontVerticalMetricDemand, FontVerticalMetricSample};
use std::{
    collections::{hash_map::DefaultHasher, BTreeMap},
    hash::{Hash, Hasher},
};

mod cluster_safety;
mod mac_roman;
mod matching;
mod measurement;
mod monotonic;
mod runs;
mod shaping;

pub(crate) use matching::parse_font_family_list;
pub(super) use measurement::{font_aware_measurement, font_aware_shape};
pub(crate) use monotonic::PendingMonotonicPrefixWidthCheck;
#[cfg(test)]
pub(super) use runs::{font_runs, FontMeasurementRun};
pub(crate) use shaping::TextMeasurementFontFace;
#[cfg(test)]
pub(super) use shaping::{
    face_supports_character, reset_shape_run_call_count, shape_run, shape_run_call_count,
    shaped_run_width,
};

// Frozen TS fixtures intentionally use a uniform 0.6em mock. Production font-aware
// layouts select the Unicode-aware fallback even when the EPUB declares no faces.
#[derive(Debug, Clone, Copy, Default)]
enum FallbackMeasurementMode {
    #[default]
    FixtureCompatible,
    FontAware,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct FontVerticalMetricKey {
    font_family: String,
    font_style: String,
    font_weight: u16,
    font_size_bits: u64,
}

impl From<&FontVerticalMetricDemand> for FontVerticalMetricKey {
    fn from(demand: &FontVerticalMetricDemand) -> Self {
        Self {
            font_family: demand.font_family.clone(),
            font_style: demand.font_style.clone(),
            font_weight: demand.font_weight,
            font_size_bits: demand.font_size_px.to_bits(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct TextMeasurementFonts<'a> {
    faces: Vec<TextMeasurementFontFace<'a>>,
    cache: TextMeasurementCache,
    fallback_mode: FallbackMeasurementMode,
    generic_serif_advances: BTreeMap<char, f64>,
    font_family_advances: BTreeMap<String, BTreeMap<char, f64>>,
    generic_serif_pair_adjustments: BTreeMap<(char, char), f64>,
    font_family_pair_adjustments: BTreeMap<String, BTreeMap<(char, char), f64>>,
    font_vertical_metrics: BTreeMap<FontVerticalMetricKey, FontVerticalMetricSample>,
    layout_profile_id: u64,
}

impl<'a> Default for TextMeasurementFonts<'a> {
    fn default() -> Self {
        Self::empty()
    }
}

impl<'a> TextMeasurementFonts<'a> {
    pub(crate) fn empty() -> Self {
        Self {
            faces: Vec::new(),
            cache: TextMeasurementCache::default(),
            fallback_mode: FallbackMeasurementMode::FixtureCompatible,
            generic_serif_advances: BTreeMap::new(),
            font_family_advances: BTreeMap::new(),
            generic_serif_pair_adjustments: BTreeMap::new(),
            font_family_pair_adjustments: BTreeMap::new(),
            font_vertical_metrics: BTreeMap::new(),
            layout_profile_id: compute_layout_profile_id(
                FallbackMeasurementMode::FixtureCompatible,
                0,
                &[],
            ),
        }
    }

    #[cfg(test)]
    pub(crate) fn font_aware_empty() -> Self {
        Self {
            faces: Vec::new(),
            cache: TextMeasurementCache::default(),
            fallback_mode: FallbackMeasurementMode::FontAware,
            generic_serif_advances: BTreeMap::new(),
            font_family_advances: BTreeMap::new(),
            generic_serif_pair_adjustments: BTreeMap::new(),
            font_family_pair_adjustments: BTreeMap::new(),
            font_vertical_metrics: BTreeMap::new(),
            layout_profile_id: compute_layout_profile_id(
                FallbackMeasurementMode::FontAware,
                0,
                &[],
            ),
        }
    }

    #[cfg(test)]
    pub(crate) fn new(faces: Vec<TextMeasurementFontFace<'a>>) -> Self {
        let layout_profile_id =
            compute_layout_profile_id(FallbackMeasurementMode::FontAware, 0, &faces);
        Self {
            faces,
            cache: TextMeasurementCache::default(),
            fallback_mode: FallbackMeasurementMode::FontAware,
            generic_serif_advances: BTreeMap::new(),
            font_family_advances: BTreeMap::new(),
            generic_serif_pair_adjustments: BTreeMap::new(),
            font_family_pair_adjustments: BTreeMap::new(),
            font_vertical_metrics: BTreeMap::new(),
            layout_profile_id,
        }
    }

    #[cfg(test)]
    pub(crate) fn new_with_cache(
        faces: Vec<TextMeasurementFontFace<'a>>,
        cache: TextMeasurementCache,
        generic_serif_advances: BTreeMap<char, f64>,
        font_family_advances: BTreeMap<String, BTreeMap<char, f64>>,
        generic_serif_pair_adjustments: BTreeMap<(char, char), f64>,
        font_family_pair_adjustments: BTreeMap<String, BTreeMap<(char, char), f64>>,
    ) -> Self {
        Self::new_with_cache_and_vertical_metrics(
            faces,
            cache,
            generic_serif_advances,
            font_family_advances,
            generic_serif_pair_adjustments,
            font_family_pair_adjustments,
            Vec::new(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new_with_cache_and_vertical_metrics(
        faces: Vec<TextMeasurementFontFace<'a>>,
        cache: TextMeasurementCache,
        generic_serif_advances: BTreeMap<char, f64>,
        font_family_advances: BTreeMap<String, BTreeMap<char, f64>>,
        generic_serif_pair_adjustments: BTreeMap<(char, char), f64>,
        font_family_pair_adjustments: BTreeMap<String, BTreeMap<(char, char), f64>>,
        font_vertical_metrics: Vec<FontVerticalMetricSample>,
    ) -> Self {
        let font_vertical_metrics = font_vertical_metrics
            .into_iter()
            .filter_map(|sample| {
                let sample = sample.normalized()?;
                let demand = FontVerticalMetricDemand {
                    font_family: sample.font_family.clone(),
                    font_style: sample.font_style.clone(),
                    font_weight: sample.font_weight,
                    font_size_px: sample.font_size_px,
                };
                Some((FontVerticalMetricKey::from(&demand), sample))
            })
            .collect();
        let fallback_profile_id = fallback_profile_id(
            &generic_serif_advances,
            &font_family_advances,
            &generic_serif_pair_adjustments,
            &font_family_pair_adjustments,
        );
        let layout_profile_id = compute_layout_profile_id(
            FallbackMeasurementMode::FontAware,
            fallback_profile_id,
            &faces,
        );
        Self {
            faces,
            cache,
            fallback_mode: FallbackMeasurementMode::FontAware,
            generic_serif_advances,
            font_family_advances,
            generic_serif_pair_adjustments,
            font_family_pair_adjustments,
            font_vertical_metrics,
            layout_profile_id,
        }
    }

    pub(crate) fn vertical_metrics_for_style(
        &self,
        style: &TextMeasurementStyle,
    ) -> Option<&FontVerticalMetricSample> {
        let demand = FontVerticalMetricDemand::normalized(
            style.font_family.as_deref(),
            style.font_style.as_deref(),
            style.font_weight.map(f64::from),
            style.font_size,
        )?;
        self.font_vertical_metrics
            .get(&FontVerticalMetricKey::from(&demand))
    }

    pub(super) fn matching_faces<'b>(
        &'b self,
        style: &TextMeasurementStyle,
    ) -> Vec<&'b TextMeasurementFontFace<'a>> {
        let families = style
            .font_family
            .as_deref()
            .map(parse_font_family_list)
            .unwrap_or_default();
        let mut matches = Vec::new();
        for family in families {
            let best_score = self
                .faces
                .iter()
                .filter(|face| face.ttf_face.is_some() && family.eq_ignore_ascii_case(&face.family))
                .map(|face| face.match_score(style))
                .min();
            let Some(best_score) = best_score else {
                continue;
            };
            matches.extend(self.faces.iter().rev().filter(|face| {
                face.ttf_face.is_some()
                    && family.eq_ignore_ascii_case(&face.family)
                    && face.match_score(style) == best_score
            }));
        }
        matches
    }

    fn cached_width(&self, key: &TextMeasurementCacheKey) -> Option<f64> {
        self.cache.widths.borrow().get(key).copied()
    }

    fn cache_width(&self, key: TextMeasurementCacheKey, width: f64) {
        self.cache.widths.borrow_mut().insert(key, width);
    }

    /// Process-local identity for every font input that can affect layout.
    ///
    /// This token intentionally excludes measurement-cache instance and state;
    /// it is not a persistent or cross-version wire format.
    pub(crate) fn layout_profile_id(&self) -> u64 {
        self.layout_profile_id
    }

    pub(super) fn uses_fixture_compatible_fallback(&self) -> bool {
        matches!(
            self.fallback_mode,
            FallbackMeasurementMode::FixtureCompatible
        )
    }

    pub(crate) fn has_monotonic_prefix_widths(
        &self,
        text: &str,
        style: &TextMeasurementStyle,
    ) -> bool {
        if !nonnegative(style.font_size)
            || !nonnegative(style.letter_spacing)
            || !nonnegative(style.word_spacing)
            || !self.matching_faces(style).is_empty()
        {
            return false;
        }
        let monospace = style
            .font_family
            .as_deref()
            .map(parse_font_family_list)
            .unwrap_or_default()
            .iter()
            .any(|family| family.eq_ignore_ascii_case("monospace"));
        let mut previous = None;
        text.chars().all(|character| {
            let character_width =
                self.fallback_character_width(character, style.font_size, monospace, None);
            let pair_adjustment = previous
                .map(|left| {
                    self.fallback_pair_adjustment(left, character, style.font_size, monospace, None)
                })
                .unwrap_or(0.0);
            previous = Some(character);
            // Measurement sums glyph advances and pair adjustments first, then
            // adds spacing totals. The glyph subtotal must therefore be
            // monotonic on its own; positive spacing cannot repair it safely.
            let glyph_increment = character_width + pair_adjustment;
            nonnegative(character_width) && nonnegative(glyph_increment)
        })
    }

    fn fallback_character_width(
        &self,
        character: char,
        font_size: f64,
        monospace: bool,
        font_family: Option<&str>,
    ) -> f64 {
        match self.fallback_mode {
            FallbackMeasurementMode::FixtureCompatible => {
                super::fixture_character_width(character, font_size)
            }
            FallbackMeasurementMode::FontAware => {
                if !monospace {
                    if let Some(advance_em) = font_family
                        .and_then(|family| self.font_family_advances.get(&normalize_family(family)))
                        .and_then(|advances| advances.get(&character))
                    {
                        return advance_em * font_size;
                    }
                    if let Some(advance_em) = self.generic_serif_advances.get(&character) {
                        return advance_em * font_size;
                    }
                }
                font_aware_fallback_character_width(character, font_size, monospace)
            }
        }
    }

    fn fallback_pair_adjustment(
        &self,
        left: char,
        right: char,
        font_size: f64,
        monospace: bool,
        font_family: Option<&str>,
    ) -> f64 {
        match self.fallback_mode {
            FallbackMeasurementMode::FixtureCompatible => 0.0,
            FallbackMeasurementMode::FontAware => {
                if !monospace {
                    let pair = (left, right);
                    let normalized_family = font_family.map(normalize_family);
                    if let Some(adjustment_em) = host_pair_adjustment(
                        normalized_family
                            .as_ref()
                            .and_then(|family| self.font_family_advances.get(family)),
                        normalized_family
                            .as_ref()
                            .and_then(|family| self.font_family_pair_adjustments.get(family)),
                        pair,
                    ) {
                        return adjustment_em * font_size;
                    }
                    if let Some(adjustment_em) = host_pair_adjustment(
                        Some(&self.generic_serif_advances),
                        Some(&self.generic_serif_pair_adjustments),
                        pair,
                    ) {
                        return adjustment_em * font_size;
                    }
                }
                font_aware_fallback_pair_adjustment(left, right, font_size, monospace)
            }
        }
    }
}

fn nonnegative(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}

fn host_pair_adjustment(
    advances: Option<&BTreeMap<char, f64>>,
    adjustments: Option<&BTreeMap<(char, char), f64>>,
    pair: (char, char),
) -> Option<f64> {
    let advances = advances?;
    (advances.contains_key(&pair.0) && advances.contains_key(&pair.1)).then(|| {
        adjustments
            .and_then(|adjustments| adjustments.get(&pair))
            .copied()
            .unwrap_or(0.0)
    })
}

fn fallback_profile_id(
    generic_advances: &BTreeMap<char, f64>,
    family_advances: &BTreeMap<String, BTreeMap<char, f64>>,
    generic_pair_adjustments: &BTreeMap<(char, char), f64>,
    family_pair_adjustments: &BTreeMap<String, BTreeMap<(char, char), f64>>,
) -> u64 {
    if generic_advances.is_empty()
        && family_advances.is_empty()
        && generic_pair_adjustments.is_empty()
        && family_pair_adjustments.is_empty()
    {
        return 0;
    }
    let mut hasher = DefaultHasher::new();
    0_u8.hash(&mut hasher);
    for (character, advance) in generic_advances {
        character.hash(&mut hasher);
        advance.to_bits().hash(&mut hasher);
    }
    1_u8.hash(&mut hasher);
    for (family, advances) in family_advances {
        family.hash(&mut hasher);
        for (character, advance) in advances {
            character.hash(&mut hasher);
            advance.to_bits().hash(&mut hasher);
        }
    }
    2_u8.hash(&mut hasher);
    for ((left, right), adjustment) in generic_pair_adjustments {
        left.hash(&mut hasher);
        right.hash(&mut hasher);
        adjustment.to_bits().hash(&mut hasher);
    }
    3_u8.hash(&mut hasher);
    for (family, adjustments) in family_pair_adjustments {
        family.hash(&mut hasher);
        for ((left, right), adjustment) in adjustments {
            left.hash(&mut hasher);
            right.hash(&mut hasher);
            adjustment.to_bits().hash(&mut hasher);
        }
    }
    hasher.finish()
}

fn compute_layout_profile_id(
    fallback_mode: FallbackMeasurementMode,
    fallback_profile_id: u64,
    faces: &[TextMeasurementFontFace<'_>],
) -> u64 {
    let mut hasher = DefaultHasher::new();
    "rito-text-layout-profile-v1".hash(&mut hasher);
    match fallback_mode {
        FallbackMeasurementMode::FixtureCompatible => 0_u8,
        FallbackMeasurementMode::FontAware => 1_u8,
    }
    .hash(&mut hasher);
    fallback_profile_id.hash(&mut hasher);
    faces.len().hash(&mut hasher);
    for face in faces {
        face.family.hash(&mut hasher);
        face.style.hash(&mut hasher);
        face.weight.hash(&mut hasher);
        face.fingerprint().hash(&mut hasher);
    }
    hasher.finish()
}

fn normalize_family(family: &str) -> String {
    family.trim().to_ascii_lowercase()
}
