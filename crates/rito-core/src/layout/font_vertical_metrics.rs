use std::collections::BTreeMap;

use super::{FontVerticalMetricDemand, FontVerticalMetricSample};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct FontVerticalMetricKey {
    family: String,
    style: String,
    weight: u16,
    size_bits: u64,
}

impl From<&FontVerticalMetricDemand> for FontVerticalMetricKey {
    fn from(demand: &FontVerticalMetricDemand) -> Self {
        Self {
            family: demand.font_family.clone(),
            style: demand.font_style.clone(),
            weight: demand.font_weight,
            size_bits: demand.font_size_px.to_bits(),
        }
    }
}

pub(crate) fn normalize_font_vertical_metric_samples(
    samples: &[FontVerticalMetricSample],
) -> Option<Vec<FontVerticalMetricSample>> {
    let mut normalized = BTreeMap::new();
    for sample in samples {
        let sample = sample.normalized()?;
        let demand = sample_demand(&sample);
        normalized.insert(FontVerticalMetricKey::from(&demand), sample);
    }
    Some(normalized.into_values().collect())
}

pub(crate) fn merge_font_vertical_metric_samples(
    target: &mut Vec<FontVerticalMetricSample>,
    additions: &[FontVerticalMetricSample],
) {
    let mut merged = target
        .iter()
        .filter_map(FontVerticalMetricSample::normalized)
        .map(|sample| (FontVerticalMetricKey::from(&sample_demand(&sample)), sample))
        .collect::<BTreeMap<_, _>>();
    for sample in additions {
        merged.insert(
            FontVerticalMetricKey::from(&sample_demand(sample)),
            sample.clone(),
        );
    }
    *target = merged.into_values().collect();
}

fn sample_demand(sample: &FontVerticalMetricSample) -> FontVerticalMetricDemand {
    FontVerticalMetricDemand {
        font_family: sample.font_family.clone(),
        font_style: sample.font_style.clone(),
        font_weight: sample.font_weight,
        font_size_px: sample.font_size_px,
    }
}
