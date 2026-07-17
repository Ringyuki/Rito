use std::collections::BTreeMap;

use crate::layout::LayoutConfig;

pub(super) fn font_family_pair_adjustments(
    layout_config: &LayoutConfig,
) -> BTreeMap<String, BTreeMap<(char, char), f64>> {
    layout_config
        .font_family_pair_adjustments
        .iter()
        .map(|(family, adjustments)| {
            (
                family.trim().to_ascii_lowercase(),
                adjustments
                    .iter()
                    .filter_map(|(text, adjustment)| valid_pair_adjustment(text, *adjustment))
                    .collect(),
            )
        })
        .filter(
            |(family, adjustments): &(String, BTreeMap<(char, char), f64>)| {
                !family.is_empty() && !adjustments.is_empty()
            },
        )
        .collect()
}

pub(super) fn generic_serif_pair_adjustments(
    layout_config: &LayoutConfig,
) -> BTreeMap<(char, char), f64> {
    layout_config
        .generic_serif_pair_adjustments
        .iter()
        .filter_map(|(text, adjustment)| valid_pair_adjustment(text, *adjustment))
        .collect()
}

pub(super) fn font_family_advances(
    layout_config: &LayoutConfig,
) -> BTreeMap<String, BTreeMap<char, f64>> {
    layout_config
        .font_family_advances
        .iter()
        .map(|(family, advances)| {
            (
                family.trim().to_ascii_lowercase(),
                advances
                    .iter()
                    .filter_map(|(text, advance)| valid_character_advance(text, *advance))
                    .collect(),
            )
        })
        .filter(|(family, advances): &(String, BTreeMap<char, f64>)| {
            !family.is_empty() && !advances.is_empty()
        })
        .collect()
}

pub(super) fn generic_serif_advances(layout_config: &LayoutConfig) -> BTreeMap<char, f64> {
    layout_config
        .generic_serif_advances
        .iter()
        .filter_map(|(text, advance)| valid_character_advance(text, *advance))
        .collect()
}

fn valid_pair_adjustment(text: &str, adjustment: f64) -> Option<((char, char), f64)> {
    let mut characters = text.chars();
    let left = characters.next()?;
    let right = characters.next()?;
    (characters.next().is_none() && adjustment.is_finite()).then_some(((left, right), adjustment))
}

fn valid_character_advance(text: &str, advance: f64) -> Option<(char, f64)> {
    let mut characters = text.chars();
    let character = characters.next()?;
    (characters.next().is_none() && advance.is_finite() && advance > 0.0)
        .then_some((character, advance))
}

#[cfg(test)]
mod tests {
    use super::valid_pair_adjustment;

    #[test]
    fn validates_host_pair_adjustment_keys_and_values() {
        assert_eq!(
            valid_pair_adjustment("：「", -0.5),
            Some((('：', '「'), -0.5))
        );
        assert_eq!(valid_pair_adjustment("：", -0.5), None);
        assert_eq!(valid_pair_adjustment("：「」", -0.5), None);
        assert_eq!(valid_pair_adjustment("：「", f64::NAN), None);
    }
}
