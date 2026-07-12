use std::collections::BTreeMap;

use super::super::{
    face_supports_character, fixture_character_width, font_aware_fallback_character_width,
    measure_text, shaped_run_width, TextMeasurementCache, TextMeasurementFontFace,
    TextMeasurementFonts, TextMeasurementInput, TextMeasurementPolicy, TextMeasurementStyle,
};
use super::{
    assert_width, font_metric_sample, read_demo_epub_font, read_epub_font,
    supported_character_after,
};
#[test]
fn font_aware_policy_uses_matching_font_advances() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let (character, expected_width) = font_metric_sample(&bytes, 20.0);
    let text = character.to_string();
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "illus5".to_owned(),
        None,
        None,
        &bytes,
    )]);
    let style = TextMeasurementStyle {
        font_size: 20.0,
        font_family: Some("\"illus5\", serif".to_owned()),
        ..TextMeasurementStyle::default()
    };

    let font_aware = measure_text(TextMeasurementInput {
        text: &text,
        style: style.clone(),
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });
    let fixture = measure_text(TextMeasurementInput {
        text: &text,
        style,
        policy: TextMeasurementPolicy::FixtureCompatible,
        fonts: &fonts,
    });

    assert_width(font_aware.width, expected_width);
    assert_width(fixture.width, fixture_character_width(character, 20.0));
}

#[test]
fn font_aware_policy_preserves_fixture_fallback_bits_without_matching_faces() {
    let text = "一".repeat(64);
    let style = TextMeasurementStyle {
        font_size: 16.0,
        word_spacing: 0.25,
        letter_spacing: 0.125,
        ..TextMeasurementStyle::default()
    };
    let fonts = TextMeasurementFonts::empty();

    let font_aware = measure_text(TextMeasurementInput {
        text: &text,
        style: style.clone(),
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });
    let fixture = measure_text(TextMeasurementInput {
        text: &text,
        style,
        policy: TextMeasurementPolicy::FixtureCompatible,
        fonts: &fonts,
    });

    assert_eq!(font_aware.width.to_bits(), fixture.width.to_bits());
}

#[test]
fn font_aware_policy_matches_quoted_font_family_with_comma() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let (character, expected_width) = font_metric_sample(&bytes, 20.0);
    let text = character.to_string();
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "Fixture, Serif".to_owned(),
        None,
        None,
        &bytes,
    )]);

    let measured = measure_text(TextMeasurementInput {
        text: &text,
        style: TextMeasurementStyle {
            font_size: 20.0,
            font_family: Some("\"Fixture, Serif\", serif".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert_width(measured.width, expected_width);
}

#[test]
fn font_aware_policy_shapes_contiguous_font_runs() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let (first, _) = font_metric_sample(&bytes, 20.0);
    let second = supported_character_after(&bytes, first).expect("fixture font has two glyphs");
    let text = format!("{first}{second}");
    let font_face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
    let expected = shaped_run_width(&text, &font_face, 20.0).expect("fixture text shapes");
    let fonts = TextMeasurementFonts::new(vec![font_face]);

    let measured = measure_text(TextMeasurementInput {
        text: &text,
        style: TextMeasurementStyle {
            font_size: 20.0,
            font_family: Some("illus5".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert_width(measured.width, expected);
}

#[test]
fn font_face_does_not_treat_notdef_cmap_mapping_as_character_support() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let shape_face = rustybuzz::Face::from_slice(&bytes, 0).expect("demo title font parses");
    let mut buffer = rustybuzz::UnicodeBuffer::new();
    buffer.push_str(" ");
    let shaped = rustybuzz::shape(&shape_face, &[], buffer);
    assert_eq!(
        shaped.glyph_infos()[0].glyph_id,
        0,
        "fixture shapes space as the .notdef glyph"
    );

    let face = TextMeasurementFontFace::new("title".to_owned(), None, None, &bytes);
    assert!(!face_supports_character(&face, ' '));
}

#[test]
fn font_aware_policy_falls_back_for_space_mapped_to_notdef() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let text = "She is the neighbor Angel, I am spoilt by her.";
    let font_size = 14.4;
    let face = TextMeasurementFontFace::new("title".to_owned(), None, None, &bytes);
    let shaped_words = text
        .split(' ')
        .map(|word| shaped_run_width(word, &face, font_size).expect("title word shapes"))
        .sum::<f64>();
    let expected = shaped_words
        + text.matches(' ').count() as f64
            * font_aware_fallback_character_width(' ', font_size, false);
    let fonts = TextMeasurementFonts::new(vec![face]);

    let measured = measure_text(TextMeasurementInput {
        text,
        style: TextMeasurementStyle {
            font_size,
            font_family: Some("title".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert_width(expected, 189.646_875);
    assert_width(measured.width, expected);
}

#[test]
fn font_aware_policy_uses_full_em_width_for_generic_cjk_text() {
    let measured = measure_text(TextMeasurementInput {
        text: "轻之国度：",
        style: TextMeasurementStyle {
            font_size: 16.0,
            font_family: Some("serif".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &TextMeasurementFonts::font_aware_empty(),
    });

    assert_width(measured.width, 80.0);
}

#[test]
fn font_aware_policy_combines_wide_latin_and_zero_advance_text() {
    let measured = measure_text(TextMeasurementInput {
        text: "a中b\u{0301}",
        style: TextMeasurementStyle {
            font_size: 10.0,
            font_family: Some("serif".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &TextMeasurementFonts::font_aware_empty(),
    });

    assert_width(measured.width, 19.438_476_562_5);
}

#[test]
fn font_aware_policy_matches_chromium_generic_serif_for_ascii_url() {
    let measured = measure_text(TextMeasurementInput {
        text: "http://www.lightnovel.cn",
        style: TextMeasurementStyle {
            font_size: 16.0,
            font_family: Some("serif".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &TextMeasurementFonts::font_aware_empty(),
    });

    assert_width(measured.width, 159.835_937_5);
}

#[test]
fn font_aware_policy_matches_chromium_generic_serif_for_demo_symbols() {
    let fonts = TextMeasurementFonts::font_aware_empty();
    let style = TextMeasurementStyle {
        font_size: 16.0,
        font_family: Some("serif".to_owned()),
        ..TextMeasurementStyle::default()
    };

    for (text, expected_width) in [("──", 22.671_875), ("×", 9.023_437_5)] {
        let measured = measure_text(TextMeasurementInput {
            text,
            style: style.clone(),
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });

        assert_width(measured.width, expected_width);
    }
}

#[test]
fn font_aware_policy_uses_host_generic_serif_advances_without_cache_aliasing() {
    let cache = TextMeasurementCache::default();
    let chromium = TextMeasurementFonts::new_with_cache(
        Vec::new(),
        cache.clone(),
        BTreeMap::from([('─', 0.708_496_093_75)]),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
    );
    let edge = TextMeasurementFonts::new_with_cache(
        Vec::new(),
        cache,
        BTreeMap::from([('─', 1.0)]),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
    );
    let style = TextMeasurementStyle {
        font_size: 16.0,
        font_family: Some("serif".to_owned()),
        ..TextMeasurementStyle::default()
    };

    let chromium_width = measure_text(TextMeasurementInput {
        text: "──",
        style: style.clone(),
        policy: TextMeasurementPolicy::FontAware,
        fonts: &chromium,
    });
    let edge_width = measure_text(TextMeasurementInput {
        text: "──",
        style,
        policy: TextMeasurementPolicy::FontAware,
        fonts: &edge,
    });

    assert_width(chromium_width.width, 22.671_875);
    assert_width(edge_width.width, 32.0);
}

#[test]
fn font_aware_policy_uses_host_pair_adjustments_without_cache_aliasing() {
    let cache = TextMeasurementCache::default();
    let unadjusted = TextMeasurementFonts::new_with_cache(
        Vec::new(),
        cache.clone(),
        BTreeMap::from([('：', 1.0), ('「', 1.0)]),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
    );
    let edge = TextMeasurementFonts::new_with_cache(
        Vec::new(),
        cache,
        BTreeMap::from([('：', 1.0), ('「', 1.0)]),
        BTreeMap::new(),
        BTreeMap::from([(('：', '「'), -0.5)]),
        BTreeMap::new(),
    );
    let style = TextMeasurementStyle {
        font_size: 16.0,
        font_family: Some("serif".to_owned()),
        ..TextMeasurementStyle::default()
    };

    let unadjusted_width = measure_text(TextMeasurementInput {
        text: "：「",
        style: style.clone(),
        policy: TextMeasurementPolicy::FontAware,
        fonts: &unadjusted,
    });
    let edge_width = measure_text(TextMeasurementInput {
        text: "：「",
        style,
        policy: TextMeasurementPolicy::FontAware,
        fonts: &edge,
    });

    assert_width(unadjusted_width.width, 32.0);
    assert_width(edge_width.width, 24.0);
}

#[test]
fn host_covered_pair_without_adjustment_does_not_use_builtin_kerning() {
    let fonts = TextMeasurementFonts::new_with_cache(
        Vec::new(),
        TextMeasurementCache::default(),
        BTreeMap::from([('A', 1.0), ('V', 1.0)]),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
    );

    let measured = measure_text(TextMeasurementInput {
        text: "AV",
        style: TextMeasurementStyle {
            font_size: 16.0,
            font_family: Some("serif".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert_width(measured.width, 32.0);
}

#[test]
fn font_aware_policy_prefers_family_pairs_without_cache_aliasing() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
    let left = '\u{1f600}';
    let right = '\u{1f601}';
    assert!(!face_supports_character(&face, left));
    assert!(!face_supports_character(&face, right));
    let cache = TextMeasurementCache::default();
    let family_advances = BTreeMap::from([(
        "illus5".to_owned(),
        BTreeMap::from([(left, 1.0), (right, 1.0)]),
    )]);
    let chromium = TextMeasurementFonts::new_with_cache(
        vec![face.clone()],
        cache.clone(),
        BTreeMap::new(),
        family_advances.clone(),
        BTreeMap::from([((left, right), -0.5)]),
        BTreeMap::from([(
            "illus5".to_owned(),
            BTreeMap::from([((left, right), -0.25)]),
        )]),
    );
    let edge = TextMeasurementFonts::new_with_cache(
        vec![face],
        cache,
        BTreeMap::new(),
        family_advances,
        BTreeMap::from([((left, right), -0.5)]),
        BTreeMap::from([("illus5".to_owned(), BTreeMap::from([((left, right), -0.5)]))]),
    );
    let text = format!("{left}{right}");
    let style = TextMeasurementStyle {
        font_size: 16.0,
        font_family: Some("illus5".to_owned()),
        ..TextMeasurementStyle::default()
    };
    let chromium_width = measure_text(TextMeasurementInput {
        text: &text,
        style: style.clone(),
        policy: TextMeasurementPolicy::FontAware,
        fonts: &chromium,
    });
    let edge_width = measure_text(TextMeasurementInput {
        text: &text,
        style,
        policy: TextMeasurementPolicy::FontAware,
        fonts: &edge,
    });

    assert_width(chromium_width.width, 28.0);
    assert_width(edge_width.width, 24.0);
}

#[test]
fn font_aware_policy_does_not_apply_fallback_pairs_to_shaped_runs() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let (left, _) = font_metric_sample(&bytes, 20.0);
    let right = supported_character_after(&bytes, left).expect("fixture font has two glyphs");
    let text = format!("{left}{right}");
    let face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
    let expected = shaped_run_width(&text, &face, 20.0).expect("fixture text shapes");
    let fonts = TextMeasurementFonts::new_with_cache(
        vec![face],
        TextMeasurementCache::default(),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::from([((left, right), -0.5)]),
        BTreeMap::from([(
            "illus5".to_owned(),
            BTreeMap::from([((left, right), -0.25)]),
        )]),
    );

    let measured = measure_text(TextMeasurementInput {
        text: &text,
        style: TextMeasurementStyle {
            font_size: 20.0,
            font_family: Some("illus5".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert_width(measured.width, expected);
}

#[test]
fn font_aware_policy_preserves_demo_narrow_mixed_text_boundary() {
    let fonts = TextMeasurementFonts::font_aware_empty();
    let style = TextMeasurementStyle {
        font_size: 16.0,
        font_family: Some("serif".to_owned()),
        ..TextMeasurementStyle::default()
    };
    let fitting = measure_text(TextMeasurementInput {
        text: "下载后请在24小时内删除，LK与TSDM不",
        style: style.clone(),
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });
    let overflowing = measure_text(TextMeasurementInput {
        text: "下载后请在24小时内删除，LK与TSDM不负",
        style,
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert_width(fitting.width, 289.781_25);
    assert_width(overflowing.width, 305.781_25);
    assert!(fitting.width <= 304.0);
    assert!(overflowing.width > 304.0);
}

#[test]
fn font_aware_policy_preserves_demo_wide_ellipsis_line_boundaries() {
    let fonts = TextMeasurementFonts::font_aware_empty();
    let style = TextMeasurementStyle {
        font_size: 16.0,
        font_family: Some("serif".to_owned()),
        ..TextMeasurementStyle::default()
    };
    let cases = [
        (
            "「嗯～是可以跟你去啦？……话说啊～我好想吃点甜的喔～车站前的可丽饼店正限时推出超好吃的可丽饼",
            "「嗯～是可以跟你去啦？……话说啊～我好想吃点甜的喔～车站前的可丽饼店正限时推出超好吃的可丽饼呢",
        ),
        (
            "周有些迟疑，不晓得要不要坐到真昼旁边去……可是顾虑太多也不是办法，于是他提起放在一旁的纸袋，",
            "周有些迟疑，不晓得要不要坐到真昼旁边去……可是顾虑太多也不是办法，于是他提起放在一旁的纸袋，坐",
        ),
    ];

    for (fitting_text, overflowing_text) in cases {
        let fitting = measure_text(TextMeasurementInput {
            text: fitting_text,
            style: style.clone(),
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });
        let overflowing = measure_text(TextMeasurementInput {
            text: overflowing_text,
            style: style.clone(),
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });

        assert_width(fitting.width, 736.0);
        assert_width(overflowing.width, 752.0);
        assert!(fitting.width <= 740.0);
        assert!(overflowing.width > 740.0);
    }
}

#[test]
fn font_aware_policy_preserves_generic_monospace_ascii_advance() {
    let measured = measure_text(TextMeasurementInput {
        text: "http://www.lightnovel.cn",
        style: TextMeasurementStyle {
            font_size: 16.0,
            font_family: Some("monospace".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &TextMeasurementFonts::font_aware_empty(),
    });

    assert_width(measured.width, 230.4);
}

#[test]
fn font_aware_policy_falls_back_per_missing_glyph() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let (character, _) = font_metric_sample(&bytes, 20.0);
    let fallback = '\u{20000}';
    let text = format!("{character}{fallback}{character}");
    let font_face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
    assert!(!face_supports_character(&font_face, fallback));
    let shaped = shaped_run_width(&character.to_string(), &font_face, 20.0)
        .expect("fixture character shapes");
    let fonts = TextMeasurementFonts::new(vec![font_face]);

    let measured = measure_text(TextMeasurementInput {
        text: &text,
        style: TextMeasurementStyle {
            font_size: 20.0,
            font_family: Some("illus5".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert_width(
        measured.width,
        shaped * 2.0 + font_aware_fallback_character_width(fallback, 20.0, false),
    );
}

#[test]
fn font_aware_policy_counts_leading_consecutive_missing_glyphs() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let (character, _) = font_metric_sample(&bytes, 20.0);
    let first_missing = '\u{1f600}';
    let second_missing = '\u{1f601}';
    let text = format!("{first_missing}{second_missing}{character}");
    let font_face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
    assert!(!face_supports_character(&font_face, first_missing));
    assert!(!face_supports_character(&font_face, second_missing));
    let shaped = shaped_run_width(&character.to_string(), &font_face, 20.0)
        .expect("fixture character shapes");
    let fonts = TextMeasurementFonts::new(vec![font_face]);

    let measured = measure_text(TextMeasurementInput {
        text: &text,
        style: TextMeasurementStyle {
            font_size: 20.0,
            font_family: Some("illus5".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert_width(
        measured.width,
        shaped
            + font_aware_fallback_character_width(first_missing, 20.0, false)
            + font_aware_fallback_character_width(second_missing, 20.0, false),
    );
}
