use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{stable_json::hash_json, DisplayCommand};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayListResourceRefs {
    pub image_refs: usize,
    pub unique_images: usize,
    pub image_hash: String,
    pub images: Vec<String>,
}

pub(crate) fn summarize_display_list_resource_refs(
    commands: &[DisplayCommand],
) -> DisplayListResourceRefs {
    let mut image_refs = Vec::new();
    for command in commands {
        collect_command_image_refs(command, &mut image_refs);
    }
    let images = image_refs
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    DisplayListResourceRefs {
        image_refs: image_refs.len(),
        unique_images: images.len(),
        image_hash: hash_json(&Value::Array(
            images.iter().cloned().map(Value::String).collect(),
        )),
        images,
    }
}

pub(crate) fn summarize_display_list_font_families(commands: &[DisplayCommand]) -> Vec<String> {
    let mut families = BTreeSet::new();
    for command in commands {
        collect_command_font_family(command, &mut families);
    }
    families.into_iter().collect()
}

fn collect_command_image_refs(command: &DisplayCommand, image_refs: &mut Vec<String>) {
    match command {
        DisplayCommand::PaintImage { src, .. } => {
            image_refs.push(src.clone());
        }
        DisplayCommand::PaintBlock { .. } => {
            collect_block_background_image_ref(command, image_refs)
        }
        _ => {}
    }
}

fn collect_command_font_family(command: &DisplayCommand, families: &mut BTreeSet<String>) {
    match command {
        DisplayCommand::PaintText(input) | DisplayCommand::PaintRuby(input) => {
            collect_paint_font_family(&input.paint, families)
        }
        _ => {}
    }
}

fn collect_paint_font_family(paint: &Value, families: &mut BTreeSet<String>) {
    if let Some(family) = paint
        .as_object()
        .and_then(|paint| paint.get("font"))
        .and_then(Value::as_object)
        .and_then(|font| font.get("family"))
        .and_then(Value::as_str)
        .filter(|family| !family.is_empty())
    {
        families.insert(family.to_owned());
    }
}

fn collect_block_background_image_ref(command: &DisplayCommand, image_refs: &mut Vec<String>) {
    if let Some(src) = command
        .paint()
        .and_then(Value::as_object)
        .and_then(|paint| paint.get("background"))
        .and_then(Value::as_object)
        .and_then(|background| background.get("image"))
        .and_then(Value::as_str)
    {
        image_refs.push(src.to_owned());
    }
}
