use std::collections::BTreeSet;

use serde_json::{json, Map, Number, Value};

use super::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun},
    page::RuntimePage,
    spread::{build_spread_slots, SpreadSlot},
    summary_json::hash_text,
};
use crate::{
    layout::{LayoutConfig, SpreadMode},
    render::{DisplayCommand, DisplayTextCommandInput},
};

type DisplayListPage = RuntimePage<RuntimeBlock<LineBox>>;

#[derive(Debug, Clone, Copy)]
pub(crate) enum DisplayListTextMode {
    Summary,
    RenderCommandHash,
    RuntimeCommand,
}

#[derive(Debug, Clone)]
pub(crate) struct DisplayListFrameCommands {
    pub(crate) spread_index: usize,
    pub(crate) page_indexes: Vec<usize>,
    pub(crate) commands: Vec<DisplayCommand>,
}

pub(crate) fn build_display_list_frame_commands(
    pages: &[DisplayListPage],
    chapter_start_pages: &BTreeSet<usize>,
    layout_config: &LayoutConfig,
    spread_index: usize,
) -> Option<DisplayListFrameCommands> {
    let spreads = build_spread_slots(pages.len(), chapter_start_pages, layout_config);
    let spread = spreads.get(spread_index)?;
    Some(DisplayListFrameCommands {
        spread_index: spread.index,
        page_indexes: spread_page_indexes(spread),
        commands: build_display_list_commands(
            spread,
            pages,
            layout_config,
            DisplayListTextMode::RuntimeCommand,
        ),
    })
}

pub(crate) fn build_display_list_commands(
    spread: &SpreadSlot,
    pages: &[DisplayListPage],
    layout_config: &LayoutConfig,
    text_mode: DisplayListTextMode,
) -> Vec<DisplayCommand> {
    let mut commands = Vec::new();
    append_viewport_paint(&mut commands, layout_config, Some("#ffffff"));
    let body_background = spread_body_background(spread, pages, layout_config);
    append_viewport_paint(&mut commands, layout_config, body_background.as_deref());
    let spread_has_body_background = body_background.is_some();
    append_page(
        &mut commands,
        &pages[spread.left_page_index],
        layout_config,
        0.0,
        spread_has_body_background,
        text_mode,
    );
    if layout_config.spread_mode == SpreadMode::Double {
        if let Some(right) = spread.right_page_index {
            append_page(
                &mut commands,
                &pages[right],
                layout_config,
                layout_config.page_width + layout_config.spread_gap,
                spread_has_body_background,
                text_mode,
            );
        }
    }
    commands
}

fn spread_page_indexes(spread: &SpreadSlot) -> Vec<usize> {
    let mut indexes = vec![spread.left_page_index];
    if let Some(right) = spread.right_page_index {
        indexes.push(right);
    }
    indexes
}

fn append_viewport_paint(
    commands: &mut Vec<DisplayCommand>,
    layout_config: &LayoutConfig,
    background_color: Option<&str>,
) {
    let Some(background_color) = background_color else {
        return;
    };
    commands.push(paint_page_command(
        0.0,
        0.0,
        layout_config.viewport_width,
        layout_config.viewport_height,
        background_color,
    ));
}

fn spread_body_background(
    spread: &SpreadSlot,
    pages: &[DisplayListPage],
    layout_config: &LayoutConfig,
) -> Option<String> {
    let left = page_background_color(&pages[spread.left_page_index]);
    if layout_config.spread_mode != SpreadMode::Double {
        return left.map(str::to_owned);
    }
    let right = spread
        .right_page_index
        .and_then(|index| page_background_color(&pages[index]));
    match (left, right) {
        (Some(left), Some(right)) if left != right => None,
        (Some(left), _) => Some(left.to_owned()),
        (_, Some(right)) => Some(right.to_owned()),
        (None, None) => None,
    }
}

fn page_background_color(page: &DisplayListPage) -> Option<&str> {
    page.paint
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|paint| paint.get("backgroundColor"))
        .and_then(Value::as_str)
}

fn append_page(
    commands: &mut Vec<DisplayCommand>,
    page: &DisplayListPage,
    layout_config: &LayoutConfig,
    offset_x: f64,
    spread_has_body_background: bool,
    text_mode: DisplayListTextMode,
) {
    commands.push(DisplayCommand::push_state());
    commands.push(DisplayCommand::translate(
        number_value(offset_x),
        number_value(0.0),
    ));
    if !spread_has_body_background {
        commands.push(paint_page_command(
            0.0,
            0.0,
            page.width,
            page.height,
            page_background_color(page).unwrap_or("#ffffff"),
        ));
    }
    commands.push(DisplayCommand::push_state());
    commands.push(DisplayCommand::clip_rect(
        rect_value(0.0, 0.0, page.width, page.height),
        None,
    ));
    for block in &page.content {
        append_block(
            commands,
            block,
            layout_config.margin_left,
            layout_config.margin_top,
            text_mode,
        );
    }
    commands.push(DisplayCommand::pop_state());
    commands.push(DisplayCommand::pop_state());
}

fn append_block(
    commands: &mut Vec<DisplayCommand>,
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    text_mode: DisplayListTextMode,
) {
    let effects = append_block_effects(commands, block, offset_x, offset_y);
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    append_block_paint(commands, block, block_x, block_y);
    let clipped = append_block_clip(commands, block, block_x, block_y);
    for child in &block.children {
        append_child(commands, child, block_x, block_y, text_mode);
    }
    if clipped {
        commands.push(DisplayCommand::pop_state());
    }
    for _ in 0..effects {
        commands.push(DisplayCommand::pop_state());
    }
}

fn append_block_effects(
    commands: &mut Vec<DisplayCommand>,
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
) -> usize {
    let mut pushes = 0usize;
    let Some(paint) = block.paint.as_ref().and_then(Value::as_object) else {
        return pushes;
    };
    if let Some(visual_offset) = paint.get("visualOffset").and_then(Value::as_object) {
        commands.push(DisplayCommand::push_state());
        commands.push(DisplayCommand::translate(
            visual_offset
                .get("dx")
                .cloned()
                .unwrap_or_else(|| number_value(0.0)),
            visual_offset
                .get("dy")
                .cloned()
                .unwrap_or_else(|| number_value(0.0)),
        ));
        pushes += 1;
    }
    if let Some(transforms) = non_empty_array_field(paint, "transform") {
        commands.push(DisplayCommand::push_state());
        commands.push(DisplayCommand::transform(
            json!({
                "x": number_value(offset_x + block.x + block.width / 2.0),
                "y": number_value(offset_y + block.y + block.height / 2.0),
            }),
            json!({
                "width": number_value(block.width),
                "height": number_value(block.height),
            }),
            transforms,
        ));
        pushes += 1;
    }
    if let Some(opacity) = paint.get("opacity").and_then(Value::as_f64) {
        if opacity < 1.0 {
            commands.push(DisplayCommand::push_state());
            commands.push(DisplayCommand::opacity(opacity));
            pushes += 1;
        }
    }
    pushes
}

fn append_block_paint(
    commands: &mut Vec<DisplayCommand>,
    block: &RuntimeBlock<LineBox>,
    block_x: f64,
    block_y: f64,
) {
    let Some(paint) = block_decoration_paint(block.paint.as_ref()) else {
        return;
    };
    commands.push(DisplayCommand::paint_block(
        rect_value(block_x, block_y, block.width, block.height),
        paint,
        block.border_box.clone(),
    ));
}

fn append_block_clip(
    commands: &mut Vec<DisplayCommand>,
    block: &RuntimeBlock<LineBox>,
    block_x: f64,
    block_y: f64,
) -> bool {
    let clip = block
        .paint
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|paint| paint.get("clipToBounds"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !clip {
        return false;
    }
    let radius = block_resolved_radius(block);
    commands.push(DisplayCommand::push_state());
    commands.push(DisplayCommand::clip_rect(
        rect_value(block_x, block_y, block.width, block.height),
        radius,
    ));
    true
}

fn append_child(
    commands: &mut Vec<DisplayCommand>,
    child: &RuntimeChild<LineBox>,
    offset_x: f64,
    offset_y: f64,
    text_mode: DisplayListTextMode,
) {
    match child {
        RuntimeChild::Block(block) => {
            append_block(commands, block, offset_x, offset_y, text_mode);
        }
        RuntimeChild::Line(line) => append_line(commands, line, offset_x, offset_y, text_mode),
        RuntimeChild::Image(image) => commands.push(image_command(
            &image.src,
            (image.x, image.y, image.width, image.height),
            offset_x,
            offset_y,
            image.alt.as_deref(),
            image.href.as_deref(),
        )),
        RuntimeChild::Hr(hr) => commands.push(DisplayCommand::paint_horizontal_rule(
            absolute_rect_value(hr.x, hr.y, hr.width, hr.height, offset_x, offset_y),
            json!({
                "color": hr.color,
                "style": hr.style,
            }),
        )),
    }
}

fn append_line(
    commands: &mut Vec<DisplayCommand>,
    line: &LineBox,
    offset_x: f64,
    offset_y: f64,
    text_mode: DisplayListTextMode,
) {
    let line_x = offset_x + line.x;
    let line_y = offset_y + line.y;
    for run in &line.runs {
        match run {
            LineRun::Text(run) => commands.push(text_command(TextCommandInput {
                kind: TextCommandKind::PaintText,
                text: &run.text,
                rect: (run.x, run.y, run.width, run.height),
                offset_x: line_x,
                offset_y: line_y,
                paint: &run.paint,
                line_height_px: run.line_height_px,
                href: run.href.as_deref(),
                source_text: run.source_text.as_deref(),
                source_text_offset: run.source_text_offset,
                text_mode,
            })),
            LineRun::Ruby(run) => commands.push(text_command(TextCommandInput {
                kind: TextCommandKind::PaintRuby,
                text: &run.text,
                rect: (run.x, run.y, run.width, run.height),
                offset_x: line_x,
                offset_y: line_y,
                paint: &run.paint,
                line_height_px: None,
                href: None,
                source_text: None,
                source_text_offset: None,
                text_mode,
            })),
            LineRun::Atom(run) => {
                if let Some(src) = &run.image_src {
                    commands.push(image_command(
                        src,
                        (run.x, run.y, run.width, run.height),
                        line_x,
                        line_y,
                        run.alt.as_deref(),
                        run.href.as_deref(),
                    ));
                }
            }
        }
    }
}

fn paint_page_command(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    background_color: &str,
) -> DisplayCommand {
    DisplayCommand::paint_page(
        rect_value(x, y, width, height),
        json!({ "backgroundColor": background_color }),
    )
}

#[derive(Debug, Clone, Copy)]
enum TextCommandKind {
    PaintText,
    PaintRuby,
}

struct TextCommandInput<'a> {
    kind: TextCommandKind,
    text: &'a str,
    rect: (f64, f64, f64, f64),
    offset_x: f64,
    offset_y: f64,
    paint: &'a Value,
    line_height_px: Option<f64>,
    href: Option<&'a str>,
    source_text: Option<&'a str>,
    source_text_offset: Option<usize>,
    text_mode: DisplayListTextMode,
}

fn text_command(input: TextCommandInput<'_>) -> DisplayCommand {
    let command = DisplayTextCommandInput {
        paint: input.paint.clone(),
        rect: absolute_rect_value(
            input.rect.0,
            input.rect.1,
            input.rect.2,
            input.rect.3,
            input.offset_x,
            input.offset_y,
        ),
        text: text_command_value(input.text, input.text_mode),
        line_height_px: input.line_height_px.map(number_value),
        href: input.href.map(str::to_owned),
        source_text: input
            .source_text
            .map(|source_text| source_text_command_value(source_text, input.text_mode)),
        source_text_offset: input.source_text_offset,
    };
    match input.kind {
        TextCommandKind::PaintText => DisplayCommand::paint_text(command),
        TextCommandKind::PaintRuby => DisplayCommand::paint_ruby(command),
    }
}

fn text_command_value(text: &str, mode: DisplayListTextMode) -> Value {
    match mode {
        DisplayListTextMode::RuntimeCommand => Value::String(text.to_owned()),
        DisplayListTextMode::Summary | DisplayListTextMode::RenderCommandHash => {
            text_summary_value(text)
        }
    }
}

fn source_text_command_value(source_text: &str, mode: DisplayListTextMode) -> Value {
    match mode {
        DisplayListTextMode::Summary => text_summary_value(source_text),
        DisplayListTextMode::RenderCommandHash | DisplayListTextMode::RuntimeCommand => {
            Value::String(source_text.to_owned())
        }
    }
}

fn text_summary_value(text: &str) -> Value {
    json!({
        "hash": hash_display_list_text(text),
        "length": utf16_len(text),
    })
}

fn image_command(
    src: &str,
    rect: (f64, f64, f64, f64),
    offset_x: f64,
    offset_y: f64,
    alt: Option<&str>,
    href: Option<&str>,
) -> DisplayCommand {
    DisplayCommand::paint_image(
        src.to_owned(),
        absolute_rect_value(rect.0, rect.1, rect.2, rect.3, offset_x, offset_y),
        alt.map(str::to_owned),
        href.map(str::to_owned),
    )
}

fn block_decoration_paint(paint: Option<&Value>) -> Option<Value> {
    let paint = paint?.as_object()?;
    let has_decoration = paint.get("background").is_some()
        || paint.get("border").is_some()
        || non_empty_array_field(paint, "boxShadow").is_some();
    if !has_decoration {
        return None;
    }
    let mut decoration = Map::new();
    if let Some(background) = paint.get("background") {
        decoration.insert("background".to_owned(), background.clone());
    }
    if let Some(border) = paint.get("border") {
        decoration.insert("border".to_owned(), border.clone());
    }
    if let Some(radius) = paint.get("radius") {
        decoration.insert("radius".to_owned(), radius.clone());
    }
    if let Some(box_shadow) = non_empty_array_field(paint, "boxShadow") {
        decoration.insert("boxShadow".to_owned(), box_shadow);
    }
    if decoration.is_empty() {
        None
    } else {
        Some(Value::Object(decoration))
    }
}

fn block_resolved_radius(block: &RuntimeBlock<LineBox>) -> Option<Value> {
    let Some(radius) = block
        .paint
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|paint| paint.get("radius"))
        .and_then(Value::as_object)
    else {
        return Some(json!({ "rx": number_value(0.0), "ry": number_value(0.0) }));
    };
    if let Some(px) = radius.get("px").and_then(Value::as_f64) {
        return Some(json!({ "rx": number_value(px), "ry": number_value(px) }));
    }
    if let Some(pct) = radius.get("pct").and_then(Value::as_f64) {
        return Some(json!({
            "rx": number_value(block.width * pct / 100.0),
            "ry": number_value(block.height * pct / 100.0),
        }));
    }
    None
}

fn non_empty_array_field(object: &Map<String, Value>, key: &str) -> Option<Value> {
    let value = object.get(key)?;
    if value.as_array().is_some_and(Vec::is_empty) {
        None
    } else {
        Some(value.clone())
    }
}

fn absolute_rect_value(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    offset_x: f64,
    offset_y: f64,
) -> Value {
    rect_value(offset_x + x, offset_y + y, width, height)
}

fn rect_value(x: f64, y: f64, width: f64, height: f64) -> Value {
    json!({
        "x": number_value(x),
        "y": number_value(y),
        "width": number_value(width),
        "height": number_value(height),
    })
}

fn number_value(value: f64) -> Value {
    if value.is_finite()
        && value.fract() == 0.0
        && value >= i64::MIN as f64
        && value < i64::MAX as f64
    {
        return Value::Number(Number::from(value as i64));
    }
    Value::Number(Number::from_f64(value).unwrap_or_else(|| Number::from(0)))
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn hash_display_list_text(text: &str) -> String {
    let json_string = Value::String(text.to_owned()).to_string();
    hash_text(&format!("{json_string}\n"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{build_display_list_commands, number_value, DisplayListTextMode};
    use crate::{
        layout::{
            content::{RuntimeBlock, RuntimeChild, RuntimeImage},
            line::{LineBox, LineRun, RubyRunBox, TextRunBox},
            page::RuntimePage,
            spread::SpreadSlot,
            LayoutConfig, PaginationPolicy, SpreadMode, TextMeasurementMode,
        },
        render::{count_display_commands, display_command_values},
    };

    #[test]
    fn builds_text_and_image_commands_from_typed_page_content() {
        let page = RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: Some(json!({ "backgroundColor": "#fafafa" })),
            content: vec![RuntimeBlock {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 120.0,
                semantic_tag: Some("p".to_owned()),
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![
                    RuntimeChild::Line(LineBox {
                        x: 0.0,
                        y: 0.0,
                        width: 300.0,
                        height: 20.0,
                        runs: vec![LineRun::Text(TextRunBox {
                            text: "Hello".to_owned(),
                            x: 0.0,
                            y: 0.0,
                            width: 48.0,
                            height: 20.0,
                            font_size: 16.0,
                            paint: json!({ "color": "#000000" }),
                            line_height_px: Some(20.0),
                            href: None,
                            source_path: None,
                            source_text: Some("Hello".to_owned()),
                            source_text_offset: Some(0),
                            inline_margin_right: None,
                            ruby_annotation: None,
                        })],
                    }),
                    RuntimeChild::Image(RuntimeImage {
                        x: 0.0,
                        y: 32.0,
                        width: 100.0,
                        height: 80.0,
                        src: "Images/a.png".to_owned(),
                        alt: Some("a".to_owned()),
                        href: Some("#img".to_owned()),
                    }),
                ],
            }],
        };
        let layout = layout_config();
        let commands = build_display_list_commands(
            &SpreadSlot {
                index: 0,
                left_page_index: 0,
                right_page_index: None,
            },
            &[page],
            &layout,
            DisplayListTextMode::Summary,
        );

        let counts = count_display_commands(&commands);
        assert_eq!(counts.get("paintText"), Some(&1));
        assert_eq!(counts.get("paintImage"), Some(&1));

        let values = display_command_values(&commands);
        assert!(values
            .iter()
            .any(|value| value["kind"] == json!("paintPage")));
        assert!(values
            .iter()
            .any(|value| value["src"] == json!("Images/a.png")));
    }

    #[test]
    fn runtime_image_commands_preserve_sub_millipixel_geometry() {
        let image_x = 0.262_694_651_320_26;
        let image_y = 1.123_456_789_012_3;
        let image_width = 287.474_610_697_359_5;
        let image_height = 227.573_300_062_383_03;
        let page = page_with_image(RuntimeImage {
            x: image_x,
            y: image_y,
            width: image_width,
            height: image_height,
            src: "Images/precise.jpg".to_owned(),
            alt: Some("precise".to_owned()),
            href: None,
        });
        let mut layout = layout_config();
        layout.margin_left = 0.0;
        layout.margin_top = 0.0;
        let commands = build_display_list_commands(
            &SpreadSlot {
                index: 0,
                left_page_index: 0,
                right_page_index: None,
            },
            &[page],
            &layout,
            DisplayListTextMode::RuntimeCommand,
        );

        let values = display_command_values(&commands);
        let image = values
            .iter()
            .find(|value| value["kind"] == json!("paintImage"))
            .expect("image command is emitted");
        assert_eq!(image["rect"]["x"].as_f64(), Some(image_x));
        assert_eq!(image["rect"]["y"].as_f64(), Some(image_y));
        assert_eq!(image["rect"]["width"].as_f64(), Some(image_width));
        assert_eq!(image["rect"]["height"].as_f64(), Some(image_height));
        assert_ne!(image["rect"]["x"], json!(0.263));
        assert_ne!(image["rect"]["height"], json!(227.573));
    }

    #[test]
    fn runtime_number_values_do_not_collapse_tiny_or_out_of_range_floats() {
        let tiny = f64::EPSILON / 2.0;
        let i64_upper_exclusive = i64::MAX as f64;

        assert_eq!(number_value(tiny).as_f64(), Some(tiny));
        assert_ne!(number_value(tiny), json!(0));
        assert_eq!(
            number_value(i64_upper_exclusive).as_f64(),
            Some(i64_upper_exclusive)
        );
        assert!(number_value(i64_upper_exclusive).as_i64().is_none());
    }

    #[test]
    fn emits_text_and_ruby_command_metadata() {
        let page = RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 24.0,
                semantic_tag: Some("p".to_owned()),
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![RuntimeChild::Line(LineBox {
                    x: 2.0,
                    y: 3.0,
                    width: 300.0,
                    height: 20.0,
                    runs: vec![
                        LineRun::Text(TextRunBox {
                            text: "Base".to_owned(),
                            x: 4.0,
                            y: 5.0,
                            width: 40.0,
                            height: 16.0,
                            font_size: 16.0,
                            paint: json!({ "color": "#111111" }),
                            line_height_px: Some(20.0),
                            href: Some("chapter.xhtml#target".to_owned()),
                            source_path: None,
                            source_text: Some("Base source".to_owned()),
                            source_text_offset: Some(7),
                            inline_margin_right: None,
                            ruby_annotation: None,
                        }),
                        LineRun::Ruby(RubyRunBox {
                            text: "ruby".to_owned(),
                            x: 4.0,
                            y: -6.0,
                            width: 24.0,
                            height: 8.0,
                            paint: json!({ "color": "#222222" }),
                        }),
                    ],
                })],
            }],
        };
        let layout = layout_config();
        let commands = build_display_list_commands(
            &SpreadSlot {
                index: 0,
                left_page_index: 0,
                right_page_index: None,
            },
            &[page],
            &layout,
            DisplayListTextMode::RuntimeCommand,
        );

        let values = display_command_values(&commands);
        let text = values
            .iter()
            .find(|value| value["kind"] == json!("paintText"))
            .expect("text command is emitted");
        assert_eq!(
            text["rect"],
            json!({ "x": 22, "y": 24, "width": 40, "height": 16 })
        );
        assert_eq!(text["lineHeightPx"], json!(20));
        assert_eq!(text["href"], json!("chapter.xhtml#target"));
        assert_eq!(text["text"], json!("Base"));
        assert_eq!(text["sourceText"], json!("Base source"));
        assert_eq!(text["sourceTextOffset"], json!(7));

        let ruby = values
            .iter()
            .find(|value| value["kind"] == json!("paintRuby"))
            .expect("ruby command is emitted");
        assert_eq!(ruby["text"], json!("ruby"));
        assert_eq!(
            ruby["rect"],
            json!({ "x": 22, "y": 13, "width": 24, "height": 8 })
        );
        assert_eq!(ruby["paint"]["color"], json!("#222222"));
    }

    #[test]
    fn emits_block_effects_decoration_and_clip_commands() {
        let page = RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 50.0,
                semantic_tag: Some("div".to_owned()),
                anchor_id: None,
                paint: Some(json!({
                    "background": {
                        "color": "#eeeeee",
                        "image": "Images/bg.png",
                        "size": "cover",
                        "repeat": "no-repeat",
                    },
                    "radius": { "px": 8 },
                    "visualOffset": { "dx": 5, "dy": -2 },
                    "transform": [{ "kind": "scale", "sx": 1.2, "sy": 1.2 }],
                    "opacity": 0.2525,
                    "clipToBounds": true,
                })),
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: Vec::new(),
            }],
        };
        let layout = layout_config();

        let commands = build_display_list_commands(
            &SpreadSlot {
                index: 0,
                left_page_index: 0,
                right_page_index: None,
            },
            &[page],
            &layout,
            DisplayListTextMode::Summary,
        );

        let counts = count_display_commands(&commands);
        assert_eq!(counts.get("transform"), Some(&1));
        assert_eq!(counts.get("translate"), Some(&2));
        assert_eq!(counts.get("opacity"), Some(&1));
        assert_eq!(counts.get("paintBlock"), Some(&1));
        assert_eq!(counts.get("clipRect"), Some(&2));

        let values = display_command_values(&commands);
        let opacity = values
            .iter()
            .find(|value| value["kind"] == json!("opacity"))
            .expect("block opacity command is emitted");
        assert_eq!(opacity["value"], json!(0.2525));
        let transform = values
            .iter()
            .find(|value| value["kind"] == json!("transform"))
            .expect("block transform command is emitted");
        assert_eq!(transform["origin"], json!({ "x": 76, "y": 61 }));
        assert_eq!(transform["box"], json!({ "width": 100, "height": 50 }));

        let visual_offset = values
            .iter()
            .find(|value| {
                value["kind"] == json!("translate")
                    && value["dx"] == json!(5)
                    && value["dy"] == json!(-2)
            })
            .expect("relative visual offset command is emitted");
        assert_eq!(visual_offset["kind"], json!("translate"));

        let block = values
            .iter()
            .find(|value| value["kind"] == json!("paintBlock"))
            .expect("block paint command is emitted");
        assert_eq!(
            block["paint"]["background"]["image"],
            json!("Images/bg.png")
        );
        assert_eq!(block["paint"]["radius"], json!({ "px": 8 }));

        let block_clip = values
            .iter()
            .rfind(|value| value["kind"] == json!("clipRect"))
            .expect("block clip command is emitted");
        assert_eq!(block_clip["radius"], json!({ "rx": 8, "ry": 8 }));
    }

    #[test]
    fn emits_zero_clip_radius_when_block_has_no_radius() {
        let page = RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 50.0,
                semantic_tag: Some("div".to_owned()),
                anchor_id: None,
                paint: Some(json!({ "clipToBounds": true })),
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: Vec::new(),
            }],
        };
        let commands = build_display_list_commands(
            &SpreadSlot {
                index: 0,
                left_page_index: 0,
                right_page_index: None,
            },
            &[page],
            &layout_config(),
            DisplayListTextMode::Summary,
        );
        let values = display_command_values(&commands);
        let block_clip = values
            .iter()
            .rfind(|value| value["kind"] == json!("clipRect"))
            .expect("block clip command is emitted");

        assert_eq!(block_clip["radius"], json!({ "rx": 0, "ry": 0 }));
    }

    fn page_with_image(image: RuntimeImage) -> RuntimePage<RuntimeBlock<LineBox>> {
        RuntimePage {
            index: 0,
            width: 400.0,
            height: 600.0,
            paint: None,
            content: vec![RuntimeBlock {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 300.0,
                semantic_tag: None,
                anchor_id: None,
                paint: None,
                border_box: None,
                page_break_before: false,
                page_break_after: false,
                orphans: None,
                widows: None,
                children: vec![RuntimeChild::Image(image)],
            }],
        }
    }

    fn layout_config() -> LayoutConfig {
        LayoutConfig {
            viewport_width: 400.0,
            viewport_height: 600.0,
            page_width: 400.0,
            page_height: 600.0,
            margin_top: 16.0,
            margin_right: 16.0,
            margin_bottom: 16.0,
            margin_left: 16.0,
            spread_mode: SpreadMode::Single,
            first_page_alone: false,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: None,
            font_family_override: None,
            font_family_force: None,
            pagination_policy: None::<PaginationPolicy>,
            text_measurement: TextMeasurementMode::FixtureCompatible,
            generic_serif_advances: Default::default(),
            font_family_advances: Default::default(),
            generic_serif_pair_adjustments: Default::default(),
            font_family_pair_adjustments: Default::default(),
        }
    }
}
