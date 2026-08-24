use super::super::{
    font_runs, FontMeasurementRun, TextMeasurementFontFace, TextMeasurementFonts,
    TextMeasurementStyle,
};
use super::{
    character_supported_only_by, font_metric_sample, ordered_face_weights, read_epub_font,
};

#[test]
fn font_aware_face_selection_honors_family_declaration_order() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new("Second".to_owned(), None, None, &bytes),
        TextMeasurementFontFace::new("First".to_owned(), None, None, &bytes),
    ]);
    let style = TextMeasurementStyle {
        font_family: Some("First, Second".to_owned()),
        ..TextMeasurementStyle::default()
    };

    let faces = fonts.matching_faces(&style);

    assert_eq!(
        faces
            .iter()
            .map(|face| face.family.as_str())
            .collect::<Vec<_>>(),
        vec!["First", "Second"]
    );
}

#[test]
fn font_aware_face_selection_treats_missing_descriptors_as_normal_400() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new("Book".to_owned(), None, None, &bytes),
        TextMeasurementFontFace::new(
            "Book".to_owned(),
            Some("italic".to_owned()),
            Some(700),
            &bytes,
        ),
    ]);
    let italic_bold = TextMeasurementStyle {
        font_family: Some("Book".to_owned()),
        font_style: Some("italic".to_owned()),
        font_weight: Some(700),
        ..TextMeasurementStyle::default()
    };

    let italic_faces = fonts.matching_faces(&italic_bold);
    let regular_faces = fonts.matching_faces(&TextMeasurementStyle {
        font_family: Some("Book".to_owned()),
        ..TextMeasurementStyle::default()
    });

    assert_eq!(italic_faces[0].style.as_deref(), Some("italic"));
    assert_eq!(italic_faces[0].weight, Some(700));
    assert_eq!(regular_faces[0].style, None);
    assert_eq!(regular_faces[0].weight, None);
}

#[test]
fn font_aware_face_selection_honors_css_weight_search_direction() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    assert_eq!(ordered_face_weights(400, &[300, 500], &bytes), vec![500]);
    assert_eq!(ordered_face_weights(500, &[600, 400], &bytes), vec![400]);
    assert_eq!(ordered_face_weights(300, &[400, 200], &bytes), vec![200]);
    assert_eq!(ordered_face_weights(600, &[500, 700], &bytes), vec![700]);
}

#[test]
fn font_aware_face_selection_keeps_best_composite_in_reverse_source_order() {
    let source_first = read_epub_font("OEBPS/Fonts/illus1.ttf");
    let source_second = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new(
            "Book".to_owned(),
            Some("italic".to_owned()),
            Some(700),
            &source_first,
        ),
        TextMeasurementFontFace::new(
            "Book".to_owned(),
            Some("italic".to_owned()),
            Some(700),
            &source_second,
        ),
        TextMeasurementFontFace::new(
            "Book".to_owned(),
            Some("normal".to_owned()),
            Some(600),
            &source_first,
        ),
    ]);
    let style = TextMeasurementStyle {
        font_family: Some("Book".to_owned()),
        font_style: Some("italic".to_owned()),
        font_weight: Some(600),
        ..TextMeasurementStyle::default()
    };

    let faces = fonts.matching_faces(&style);

    assert_eq!(faces.len(), 2);
    assert_eq!(faces[0].bytes, source_second.as_slice());
    assert_eq!(faces[1].bytes, source_first.as_slice());
}

#[test]
fn font_aware_face_selection_prefers_closest_face_before_next_family() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let (character, _) = font_metric_sample(&bytes, 20.0);
    let text = character.to_string();
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new(
            "Fallback".to_owned(),
            Some("italic".to_owned()),
            Some(700),
            &bytes,
        ),
        TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &bytes),
    ]);
    let style = TextMeasurementStyle {
        font_family: Some("Preferred, Fallback".to_owned()),
        font_style: Some("italic".to_owned()),
        font_weight: Some(700),
        ..TextMeasurementStyle::default()
    };

    let faces = fonts.matching_faces(&style);
    let runs = font_runs(&text, &faces);

    let FontMeasurementRun::Shaped { face, .. } = &runs[0] else {
        panic!("supported character must produce a shaped run");
    };
    assert_eq!(face.family, "Preferred");
}

#[test]
fn font_aware_face_selection_falls_back_by_glyph_across_families() {
    let preferred_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
    let fallback_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let character = character_supported_only_by(&preferred_bytes, &fallback_bytes);
    let text = character.to_string();
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &preferred_bytes),
        TextMeasurementFontFace::new("Fallback".to_owned(), None, None, &fallback_bytes),
    ]);
    let style = TextMeasurementStyle {
        font_family: Some("Preferred, Fallback".to_owned()),
        ..TextMeasurementStyle::default()
    };

    let faces = fonts.matching_faces(&style);
    let runs = font_runs(&text, &faces);

    let FontMeasurementRun::Shaped { face, .. } = &runs[0] else {
        panic!("fallback character must produce a shaped run");
    };
    assert_eq!(face.family, "Fallback");
}

#[test]
fn font_aware_face_selection_ignores_invalid_exact_face() {
    let valid_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let invalid_bytes = [1];
    let (character, _) = font_metric_sample(&valid_bytes, 20.0);
    let text = character.to_string();
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &valid_bytes),
        TextMeasurementFontFace::new(
            "Fallback".to_owned(),
            Some("italic".to_owned()),
            Some(700),
            &valid_bytes,
        ),
        TextMeasurementFontFace::new(
            "Preferred".to_owned(),
            Some("italic".to_owned()),
            Some(700),
            &invalid_bytes,
        ),
    ]);
    let style = TextMeasurementStyle {
        font_family: Some("Preferred, Fallback".to_owned()),
        font_style: Some("italic".to_owned()),
        font_weight: Some(700),
        ..TextMeasurementStyle::default()
    };

    let faces = fonts.matching_faces(&style);
    let runs = font_runs(&text, &faces);

    assert_eq!(
        faces
            .iter()
            .map(|face| face.family.as_str())
            .collect::<Vec<_>>(),
        vec!["Preferred", "Fallback"]
    );
    let FontMeasurementRun::Shaped { face, .. } = &runs[0] else {
        panic!("valid same-family face must provide the supported glyph");
    };
    assert_eq!(face.family, "Preferred");
}

#[test]
fn font_aware_face_selection_does_not_use_descriptor_runner_up_for_missing_glyph() {
    let exact_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
    let runner_up_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let character = character_supported_only_by(&exact_bytes, &runner_up_bytes);
    let text = character.to_string();
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &runner_up_bytes),
        TextMeasurementFontFace::new(
            "Fallback".to_owned(),
            Some("italic".to_owned()),
            Some(700),
            &runner_up_bytes,
        ),
        TextMeasurementFontFace::new(
            "Preferred".to_owned(),
            Some("italic".to_owned()),
            Some(700),
            &exact_bytes,
        ),
    ]);
    let style = TextMeasurementStyle {
        font_family: Some("Preferred, Fallback".to_owned()),
        font_style: Some("italic".to_owned()),
        font_weight: Some(700),
        ..TextMeasurementStyle::default()
    };

    let faces = fonts.matching_faces(&style);
    let runs = font_runs(&text, &faces);

    assert_eq!(
        faces
            .iter()
            .map(|face| face.family.as_str())
            .collect::<Vec<_>>(),
        vec!["Preferred", "Fallback"]
    );
    let FontMeasurementRun::Shaped { face, .. } = &runs[0] else {
        panic!("next family exact face must provide the glyph");
    };
    assert_eq!(face.family, "Fallback");
}
