use std::collections::BTreeSet;

use super::DisplayCommand;

/// The images a display list references: every reference in paint order
/// and the sorted set of distinct hrefs the frame's resource table lists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DisplayListResourceRefs {
    pub image_refs: usize,
    pub images: Vec<String>,
}

pub(crate) fn summarize_display_list_resource_refs<'a>(
    commands: impl IntoIterator<Item = &'a DisplayCommand>,
) -> DisplayListResourceRefs {
    let mut image_refs = Vec::new();
    for command in commands {
        match command {
            DisplayCommand::PaintImage { src, .. } => image_refs.push(src.clone()),
            DisplayCommand::PaintBlock { paint, .. } => {
                if let Some(src) = paint
                    .background
                    .as_ref()
                    .and_then(|background| background.image.as_ref())
                {
                    image_refs.push(src.clone());
                }
            }
            _ => {}
        }
    }
    let images = image_refs
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    DisplayListResourceRefs {
        image_refs: image_refs.len(),
        images,
    }
}
