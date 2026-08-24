use std::collections::BTreeMap;

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox, TextRunInteractionGeometry},
    FontVerticalMetricDemand, FontVerticalMetricSample, LayoutRuntimePage,
};

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

pub(crate) fn calibrate_layout_font_vertical_metrics(
    pages: &mut [LayoutRuntimePage],
    samples: &[FontVerticalMetricSample],
) -> usize {
    let samples = samples
        .iter()
        .map(|sample| (FontVerticalMetricKey::from(&sample_demand(sample)), sample))
        .collect::<BTreeMap<_, _>>();
    pages
        .iter_mut()
        .map(|page| {
            page.content
                .iter_mut()
                .map(|block| calibrate_block(block, &samples))
                .sum::<usize>()
        })
        .sum()
}

fn calibrate_block(
    block: &mut RuntimeBlock<LineBox>,
    samples: &BTreeMap<FontVerticalMetricKey, &FontVerticalMetricSample>,
) -> usize {
    block
        .children
        .iter_mut()
        .map(|child| match child {
            RuntimeChild::Block(block) => calibrate_block(block, samples),
            RuntimeChild::Line(line) => calibrate_line(line, samples),
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => 0,
        })
        .sum()
}

fn calibrate_line(
    line: &mut LineBox,
    samples: &BTreeMap<FontVerticalMetricKey, &FontVerticalMetricSample>,
) -> usize {
    line.runs
        .iter_mut()
        .filter_map(|run| match run {
            LineRun::Text(run) => calibrate_run(run, samples),
            LineRun::Atom(_) | LineRun::Ruby(_) => None,
        })
        .count()
}

fn calibrate_run(
    run: &mut TextRunBox,
    samples: &BTreeMap<FontVerticalMetricKey, &FontVerticalMetricSample>,
) -> Option<()> {
    let demand = run_demand(run)?;
    let sample = samples.get(&FontVerticalMetricKey::from(&demand))?;
    let geometry = TextRunInteractionGeometry::from_font_metrics(sample, run.height)?;
    if run.interaction_geometry.as_ref() == Some(&geometry) {
        return None;
    }
    run.interaction_geometry = Some(geometry);
    Some(())
}

fn run_demand(run: &TextRunBox) -> Option<FontVerticalMetricDemand> {
    let font = &run.paint.measure().font;
    FontVerticalMetricDemand::normalized(
        Some(&font.family),
        Some(font.style.as_str()),
        Some(font.weight),
        run.font_size,
    )
}

fn sample_demand(sample: &FontVerticalMetricSample) -> FontVerticalMetricDemand {
    FontVerticalMetricDemand {
        font_family: sample.font_family.clone(),
        font_style: sample.font_style.clone(),
        font_weight: sample.font_weight,
        font_size_px: sample.font_size_px,
    }
}
