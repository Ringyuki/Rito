//! The paint-parity instrument's lowering step (tools/paint-parity): every
//! semantic fixture (the browser pen's command JSON) lowered at the
//! requested ratio and written as a `RITODL1` format-2 list for both
//! renderers to decode and blit. Skips itself when the instrument's
//! variables are absent so the ordinary test run never touches the
//! filesystem.

use std::{env, fs, path::Path};

use serde_json::{json, Value};

use super::super::{
    commands::encode_reader_primitive_list_v1, DisplayCommand, DisplayTextCommandInput,
    RubyAlignPaint,
};
use super::lower_display_commands;
use crate::layout::RunPaint;

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
                parse_command(command)
                    .unwrap_or_else(|| panic!("{name}: command not expressible: {command}"))
            })
            .collect();
        let lowered = lower_display_commands(&commands, ratio)
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
            "passthroughBlocks": lowered.passthrough_block_count(),
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
        eprintln!(
            "lowered {name}: {} primitives, {} blocks passed through",
            lowered.commands.len(),
            lowered.passthrough_block_count()
        );
    }
}

/// The browser pen's command JSON is the engine's own display-command
/// shape, so every field passes through to the JSON-shaped provider; a
/// shape this cannot express fails the fixture instead of dropping it.
fn parse_command(value: &Value) -> Option<DisplayCommand> {
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
            let ruby_align = match value.get("rubyAlign").and_then(Value::as_str) {
                None => None,
                Some("start") => Some(RubyAlignPaint::START),
                Some("center") => Some(RubyAlignPaint::CENTER),
                Some("space-between") => Some(RubyAlignPaint::SPACE_BETWEEN),
                Some(_) => return None,
            };
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
                ruby_align,
                align_right: value
                    .get("alignRight")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                vertical: value
                    .get("vertical")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
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
