//! The paint-parity instrument's lowering step (tools/paint-parity): every
//! semantic fixture (the browser pen's command JSON) lowered at the
//! requested ratio and written as a `RITODL1` format-2 list for both
//! renderers to decode and blit. Skips itself when the instrument's
//! variables are absent so the ordinary test run never touches the
//! filesystem.

use std::{env, fs, path::Path};

use serde_json::{json, Value};

use super::super::{lower_display_commands, ImageSize};
use crate::layout::RunPaint;
use crate::render::{
    commands::encode_reader_primitive_list_v1, DisplayCommand, DisplayTextCommandInput,
};
use rito_inline::{plain_paragraph_style, ParleyInlineContext};
use rito_style_contract::{
    CssPx, FontFamilies, FontFamily, FontFamilyName, FontSlant, FontWeight, GenericFontFamily,
    LengthPercentage, RubyAlign,
};

/// The synthetic image sources both renderers generate for the corpus
/// (harness/entry.ts and parity_fixture_loader.dart keep them
/// byte-identical); the lowering only needs their sizes.
fn synthetic_image_size(href: &str) -> Option<ImageSize> {
    let side = match href {
        "synthetic:checker16" => 16,
        "synthetic:gradient32" => 32,
        "synthetic:dot8" => 8,
        _ => return None,
    };
    Some(ImageSize {
        width: side,
        height: side,
    })
}

#[test]
fn lower_paint_parity_fixtures() {
    let (Some(fixtures), Some(out)) = (
        env::var_os("RITO_PAINT_PARITY_FIXTURES"),
        env::var_os("RITO_PAINT_PARITY_OUT"),
    ) else {
        eprintln!("RITO_PAINT_PARITY_OUT not set; parity lowering skipped.");
        return;
    };
    let ratio: f64 = env::var("RITO_PAINT_PARITY_RATIO")
        .ok()
        .map(|value| value.parse().expect("RITO_PAINT_PARITY_RATIO is a number"))
        .unwrap_or(1.0);
    let lowered_dir = Path::new(&out).join("lowered");
    fs::create_dir_all(&lowered_dir).expect("create the lowered directory");
    let mut paths: Vec<_> = fs::read_dir(&fixtures)
        .expect("read the fixture directory")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no fixtures in {}", fixtures.display());
    let shaper = fixture_shaper();

    for path in paths {
        let fixture: Value =
            serde_json::from_str(&fs::read_to_string(&path).expect("read fixture"))
                .expect("fixture is JSON");
        let name = fixture["name"].as_str().expect("fixture name").to_owned();
        let commands: Vec<DisplayCommand> = fixture["commands"]
            .as_array()
            .expect("fixture commands")
            .iter()
            .map(|command| {
                parse_command(&shaper, ratio, command)
                    .unwrap_or_else(|| panic!("{name}: command not expressible: {command}"))
            })
            .collect();
        let lowered = lower_display_commands(&commands, ratio, &synthetic_image_size)
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        let encoded = encode_reader_primitive_list_v1(&lowered)
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        fs::write(lowered_dir.join(format!("{name}.ritodl")), &encoded.bytes)
            .expect("write the lowered list");
        let mut meta = json!({
            "name": name,
            "width": fixture["width"],
            "height": fixture["height"],
            "ratio": ratio,
            "primitiveCount": lowered.commands.len(),
        });
        for key in ["background", "theme"] {
            if let Some(value) = fixture.get(key) {
                meta[key] = value.clone();
            }
        }
        fs::write(
            lowered_dir.join(format!("{name}.json")),
            serde_json::to_string_pretty(&meta).expect("metadata is JSON"),
        )
        .expect("write the lowered metadata");
        eprintln!("lowered {name}: {} primitives", lowered.commands.len());
    }
}

/// The pinned faces both parity harnesses load, so the engine shapes a
/// fixture's text with the glyph advances the pens raster.
fn fixture_shaper() -> ParleyInlineContext {
    let read = |path: &str| {
        std::fs::read(format!("{}/../../{path}", env!("CARGO_MANIFEST_DIR")))
            .unwrap_or_else(|error| panic!("{path}: {error}"))
    };
    ParleyInlineContext::new(vec![
        read("apps/reader/src/assets/fonts/Tinos-Regular.ttf"),
        read("apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"),
    ])
    .expect("fixture faces register")
}

/// A fixture run written without origins gets them from the engine, the
/// way a painted run does: a text run's clusters step by the shaped
/// advances with the paint's spacing folded in (floored onto the 1/64
/// grid for an all-CJK run at a fractional size) from the rect's start,
/// their baseline 0.8 em below its top rounded onto the device grid the
/// way the painter rounds every glyph baseline; an annotation shapes
/// packed and spreads over the rect by the initial `ruby-align`,
/// anchored at its top.
fn shape_fixture_clusters(
    shaper: &ParleyInlineContext,
    ratio: f64,
    kind: &str,
    value: &Value,
) -> Option<Vec<(u32, f64, f64)>> {
    let text = value.get("text")?.as_str()?;
    let rect = value.get("rect")?;
    let (x, y, width) = (
        rect.get("x")?.as_f64()?,
        rect.get("y")?.as_f64()?,
        rect.get("width")?.as_f64()?,
    );
    let paint = value.get("paint")?;
    let font = paint.get("font")?;
    let size = font.get("sizePx")?.as_f64()? as f32;
    let number = |key: &str| paint.get(key).and_then(Value::as_f64).unwrap_or(0.0) as f32;
    let families = font
        .get("family")?
        .as_str()?
        .split(',')
        .map(|name| match name.trim().trim_matches('"') {
            "serif" => FontFamily::Generic(GenericFontFamily::Serif),
            "sans-serif" => FontFamily::Generic(GenericFontFamily::SansSerif),
            "monospace" => FontFamily::Generic(GenericFontFamily::Monospace),
            name => FontFamily::Named(FontFamilyName::new(name)),
        })
        .collect();
    let mut style = plain_paragraph_style(FontFamilies::new(families).ok()?, size, 0.0);
    style.font.weight =
        FontWeight::new(font.get("weight").and_then(Value::as_f64).unwrap_or(400.0) as f32).ok()?;
    if font.get("style").and_then(Value::as_str) == Some("italic") {
        style.font.slant = FontSlant::Italic;
    }
    style.text_flow.letter_spacing =
        LengthPercentage::Length(CssPx::new(number("letterSpacingPx")).ok()?);
    style.text_flow.word_spacing =
        LengthPercentage::Length(CssPx::new(number("wordSpacingPx")).ok()?);
    if kind == "paintRuby" {
        // A fixture's ruby rect starts at the annotation's em-box top;
        // its clusters paint at the alphabetic baseline below it, on the
        // device row the browser's pen snaps to.
        let measured = shaper.measure_ruby_annotation(&style, size, "", text);
        let run = measured.run;
        let baseline = ((y + measured.em_ascent) * ratio).round() / ratio;
        let origins = rito_fragment::distribute_ruby_annotation(
            text,
            &run.clusters,
            run.advance,
            x,
            width,
            RubyAlign::SpaceAround,
            f64::from(size),
        );
        return Some(
            run.clusters
                .iter()
                .zip(origins)
                .map(|(cluster, origin)| (cluster.byte, origin, baseline))
                .collect(),
        );
    }
    let run = shaper.measure_run(&style, text);
    let baseline = ((y + 0.8 * f64::from(size)) * ratio).round() / ratio;
    Some(
        run.clusters
            .iter()
            .map(|cluster| {
                let origin = x + cluster.x;
                let origin = if run.grid {
                    (origin * 64.0).floor() / 64.0
                } else {
                    origin
                };
                (cluster.byte, origin, baseline)
            })
            .collect(),
    )
}

/// The browser pen's command JSON is the engine's own display-command
/// shape, so every field passes through to the JSON-shaped provider; a
/// shape this cannot express fails the fixture instead of dropping it.
/// A text or ruby run written without cluster origins is shaped by the
/// engine on the way in.
fn parse_command(
    shaper: &ParleyInlineContext,
    ratio: f64,
    value: &Value,
) -> Option<DisplayCommand> {
    let kind = value.get("kind")?.as_str()?;
    let field = |key: &str| value.get(key).cloned();
    let string = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
    Some(match kind {
        "pushState" => DisplayCommand::push_state(),
        "popState" => DisplayCommand::pop_state(),
        "translate" => DisplayCommand::translate(field("dx")?, field("dy")?),
        "opacity" => DisplayCommand::opacity(value.get("value")?.as_f64()?),
        "transform" => {
            DisplayCommand::transform(field("origin")?, field("box")?, field("transforms")?)
        }
        "clipRect" => DisplayCommand::clip_rect(field("rect")?, field("radius")),
        "paintPage" => DisplayCommand::paint_page(field("rect")?, field("paint")?),
        "paintBlock" => {
            DisplayCommand::paint_block(field("rect")?, field("paint")?, field("borderBox"))
        }
        "paintText" | "paintRuby" => {
            let input = DisplayTextCommandInput {
                text: field("text")?,
                rect: field("rect")?,
                paint: RunPaint::from_test_wire_value(field("paint")?),
                line_height_px: field("lineHeightPx"),
                href: string("href"),
                source_text: field("sourceText"),
                source_text_offset: value
                    .get("sourceTextOffset")
                    .and_then(Value::as_u64)
                    .map(|offset| offset as usize),
                clusters: match value.get("clusters") {
                    None => shape_fixture_clusters(shaper, ratio, kind, value)?,
                    Some(clusters) => clusters
                        .as_array()?
                        .iter()
                        .map(|cluster| {
                            let pair = cluster.as_array()?;
                            Some((
                                pair.first()?.as_u64()? as u32,
                                pair.get(1)?.as_f64()?,
                                pair.get(2)?.as_f64()?,
                            ))
                        })
                        .collect::<Option<Vec<_>>>()?,
                },
            };
            if kind == "paintText" {
                DisplayCommand::paint_text(input)
            } else {
                DisplayCommand::paint_ruby(input)
            }
        }
        "paintImage" => {
            let src = string("src")?;
            match field("sourceRect") {
                Some(source_rect) => {
                    DisplayCommand::paint_image_slice(src, field("rect")?, source_rect)
                }
                None => {
                    DisplayCommand::paint_image(src, field("rect")?, string("alt"), string("href"))
                }
            }
        }
        "paintHorizontalRule" => {
            DisplayCommand::paint_horizontal_rule(field("rect")?, field("paint")?)
        }
        _ => return None,
    })
}
