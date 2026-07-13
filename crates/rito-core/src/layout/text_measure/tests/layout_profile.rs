use std::collections::BTreeMap;

use super::{read_epub_font, TextMeasurementFontFace, TextMeasurementFonts};
use crate::layout::{
    text_measure::{
        measure_text, TextMeasurementCache, TextMeasurementInput, TextMeasurementPolicy,
        TextMeasurementStyle,
    },
    text_work_trace::{capture_text_work_trace, MeasurementCacheOutcome, MeasurementCacheSource},
};

#[test]
fn clone_and_independent_rebuild_keep_the_same_profile() {
    let first_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
    let second_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let build = || {
        TextMeasurementFonts::new_with_cache(
            vec![
                face("Title", Some("italic"), Some(500), &first_bytes),
                face("Body", None, Some(400), &second_bytes),
            ],
            TextMeasurementCache::default(),
            BTreeMap::from([('界', 1.0)]),
            BTreeMap::new(),
            BTreeMap::new(),
            BTreeMap::new(),
        )
    };
    let original = build();
    let cloned = original.clone();
    let independently_rebuilt = build();

    assert_eq!(original.layout_profile_id(), cloned.layout_profile_id());
    assert_eq!(
        original.layout_profile_id(),
        independently_rebuilt.layout_profile_id()
    );
}

#[test]
fn ordered_faces_are_part_of_the_profile() {
    let first_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
    let second_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let first = face("First", None, Some(400), &first_bytes);
    let second = face("Second", None, Some(400), &second_bytes);
    let source_order = TextMeasurementFonts::new(vec![first.clone(), second.clone()]);
    let reversed = TextMeasurementFonts::new(vec![second, first]);

    assert_ne!(
        source_order.layout_profile_id(),
        reversed.layout_profile_id()
    );
}

#[test]
fn face_bytes_and_precomputed_fingerprint_are_part_of_the_profile() {
    let first_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
    let second_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let first_bytes_profile =
        TextMeasurementFonts::new(vec![face("Book", None, Some(400), &first_bytes)]);
    let second_bytes_profile =
        TextMeasurementFonts::new(vec![face("Book", None, Some(400), &second_bytes)]);
    assert_ne!(
        first_bytes_profile.layout_profile_id(),
        second_bytes_profile.layout_profile_id()
    );

    let first_fingerprint =
        TextMeasurementFonts::new(vec![TextMeasurementFontFace::new_with_fingerprint(
            "Book".to_owned(),
            None,
            Some(400),
            &first_bytes,
            [1; 8],
        )]);
    let second_fingerprint =
        TextMeasurementFonts::new(vec![TextMeasurementFontFace::new_with_fingerprint(
            "Book".to_owned(),
            None,
            Some(400),
            &first_bytes,
            [2; 8],
        )]);
    assert_ne!(
        first_fingerprint.layout_profile_id(),
        second_fingerprint.layout_profile_id()
    );
}

#[test]
fn every_face_descriptor_field_is_part_of_the_profile() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let baseline = TextMeasurementFonts::new(vec![face("Book", Some("normal"), Some(400), &bytes)]);
    let changed_family =
        TextMeasurementFonts::new(vec![face("Novel", Some("normal"), Some(400), &bytes)]);
    let changed_style =
        TextMeasurementFonts::new(vec![face("Book", Some("italic"), Some(400), &bytes)]);
    let changed_weight =
        TextMeasurementFonts::new(vec![face("Book", Some("normal"), Some(700), &bytes)]);

    for changed in [changed_family, changed_style, changed_weight] {
        assert_ne!(baseline.layout_profile_id(), changed.layout_profile_id());
    }
}

#[test]
fn fallback_mode_and_each_fallback_table_are_part_of_the_profile() {
    assert_ne!(
        TextMeasurementFonts::empty().layout_profile_id(),
        TextMeasurementFonts::font_aware_empty().layout_profile_id()
    );

    let changed_profiles = [
        (
            fallback_fonts(
                BTreeMap::from([('界', 1.0)]),
                BTreeMap::new(),
                BTreeMap::new(),
                BTreeMap::new(),
            ),
            fallback_fonts(
                BTreeMap::from([('界', 0.9)]),
                BTreeMap::new(),
                BTreeMap::new(),
                BTreeMap::new(),
            ),
        ),
        (
            fallback_fonts(
                BTreeMap::new(),
                family_advances(1.0, 1.0),
                BTreeMap::new(),
                BTreeMap::new(),
            ),
            fallback_fonts(
                BTreeMap::new(),
                family_advances(0.9, 1.0),
                BTreeMap::new(),
                BTreeMap::new(),
            ),
        ),
        (
            fallback_fonts(
                BTreeMap::from([('A', 1.0), ('V', 1.0)]),
                BTreeMap::new(),
                BTreeMap::from([(('A', 'V'), -0.1)]),
                BTreeMap::new(),
            ),
            fallback_fonts(
                BTreeMap::from([('A', 1.0), ('V', 1.0)]),
                BTreeMap::new(),
                BTreeMap::from([(('A', 'V'), -0.2)]),
                BTreeMap::new(),
            ),
        ),
        (
            fallback_fonts(
                BTreeMap::new(),
                family_advances(1.0, 1.0),
                BTreeMap::new(),
                family_pair_adjustments(-0.1),
            ),
            fallback_fonts(
                BTreeMap::new(),
                family_advances(1.0, 1.0),
                BTreeMap::new(),
                family_pair_adjustments(-0.2),
            ),
        ),
    ];

    for (baseline, changed) in changed_profiles {
        assert_ne!(baseline.layout_profile_id(), changed.layout_profile_id());
    }
}

#[test]
fn shared_width_cache_is_isolated_by_the_complete_face_profile() {
    let first_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
    let second_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let cache = TextMeasurementCache::default();
    let first = TextMeasurementFonts::new_with_cache(
        vec![face("Book", None, Some(400), &first_bytes)],
        cache.clone(),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
    );
    let second = TextMeasurementFonts::new_with_cache(
        vec![face("Book", None, Some(400), &second_bytes)],
        cache,
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
    );
    let style = TextMeasurementStyle {
        font_family: Some("Book".to_owned()),
        ..TextMeasurementStyle::default()
    };
    let measure = |fonts: &TextMeasurementFonts<'_>| {
        measure_text(TextMeasurementInput {
            text: "A",
            style: style.clone(),
            policy: TextMeasurementPolicy::FontAware,
            fonts,
        })
    };

    measure(&first);
    let (_, trace) = capture_text_work_trace(|| {
        measure(&second);
        measure(&second);
    });

    assert_eq!(
        trace
            .measurement_cache
            .iter()
            .map(|lookup| (lookup.source, lookup.outcome))
            .collect::<Vec<_>>(),
        vec![
            (
                MeasurementCacheSource::MeasureWidth,
                MeasurementCacheOutcome::Miss,
            ),
            (
                MeasurementCacheSource::MeasureWidth,
                MeasurementCacheOutcome::Hit,
            ),
        ]
    );
}

fn face<'a>(
    family: &str,
    style: Option<&str>,
    weight: Option<u16>,
    bytes: &'a [u8],
) -> TextMeasurementFontFace<'a> {
    TextMeasurementFontFace::new(family.to_owned(), style.map(str::to_owned), weight, bytes)
}

fn fallback_fonts(
    generic_advances: BTreeMap<char, f64>,
    family_advances: BTreeMap<String, BTreeMap<char, f64>>,
    generic_pair_adjustments: BTreeMap<(char, char), f64>,
    family_pair_adjustments: BTreeMap<String, BTreeMap<(char, char), f64>>,
) -> TextMeasurementFonts<'static> {
    TextMeasurementFonts::new_with_cache(
        Vec::new(),
        TextMeasurementCache::default(),
        generic_advances,
        family_advances,
        generic_pair_adjustments,
        family_pair_adjustments,
    )
}

fn family_advances(left: f64, right: f64) -> BTreeMap<String, BTreeMap<char, f64>> {
    BTreeMap::from([(
        "book".to_owned(),
        BTreeMap::from([('A', left), ('V', right)]),
    )])
}

fn family_pair_adjustments(adjustment: f64) -> BTreeMap<String, BTreeMap<(char, char), f64>> {
    BTreeMap::from([(
        "book".to_owned(),
        BTreeMap::from([(('A', 'V'), adjustment)]),
    )])
}
