//! The face each piece of a run paints with. Shaping recorded the face
//! every cluster was drawn from; a run paints once per face, naming the
//! face by the alias the host registered its bytes under, so the pen
//! draws every cluster with exactly the face that measured it and never
//! matches a family list of its own. Also the colour conversion and the
//! fail-closed error every unpaintable property reports through.

use std::ops::Range;

use rito_fragment::FontFaceId;
use rito_style_contract::{AbsoluteColor, InlineFormattingStyle};

use crate::epub::{EpubError, EpubResult};
use crate::render::contract::ReaderColor;
use crate::render::{display_rect, DisplayTextCommand, RunPaint, TextCluster};
use crate::style::{paint_color, serialize_font_families};

/// The family a piece drawn from `face` paints with: the face's alias, or
/// — for a tree painted without a face table (no document engine) — the
/// computed family list as-is.
pub(super) fn face_family(
    style: &InlineFormattingStyle,
    faces: Option<&[std::sync::Arc<str>]>,
    face: FontFaceId,
) -> EpubResult<std::sync::Arc<str>> {
    match faces {
        Some(aliases) => aliases.get(face.0 as usize).cloned().ok_or_else(|| {
            EpubError::new(format!(
                "a run names face {} the engine never registered",
                face.0
            ))
        }),
        None => serialize_font_families(&style.font)
            .map(std::sync::Arc::from)
            .map_err(|error| not_paintable(&format!("font family list: {error:?}"))),
    }
}

/// The runs of consecutive clusters drawn from one face, in order. A run
/// without clusters is one piece of the default face.
pub(super) fn face_pieces(faces: &[FontFaceId]) -> Vec<(Range<usize>, FontFaceId)> {
    let mut pieces: Vec<(Range<usize>, FontFaceId)> = Vec::new();
    for (index, face) in faces.iter().enumerate() {
        match pieces.last_mut() {
            Some((range, last)) if last == face => range.end = index + 1,
            _ => pieces.push((index..index + 1, *face)),
        }
    }
    if pieces.is_empty() {
        pieces.push((0..0, FontFaceId::default()));
    }
    pieces
}

/// Splits a horizontal text command into one command per face piece: each
/// takes its clusters' text and spans from its first cluster to the next
/// piece's (the first from the command's own left edge, the last to its
/// right edge). `paint` gives the piece's paint from its face and whether
/// it opens and closes the command.
pub(super) fn split_by_face(
    command: DisplayTextCommand,
    faces: &[FontFaceId],
    mut paint: impl FnMut(FontFaceId, bool, bool) -> EpubResult<RunPaint>,
) -> EpubResult<Vec<DisplayTextCommand>> {
    let pieces = face_pieces(faces);
    if pieces.len() == 1 {
        let paint = paint(pieces[0].1, true, true)?;
        return Ok(vec![DisplayTextCommand { paint, ..command }]);
    }
    let rect = command.rect;
    let mut split = Vec::with_capacity(pieces.len());
    for (index, (range, face)) in pieces.iter().enumerate() {
        let first = index == 0;
        let last = index + 1 == pieces.len();
        let next = pieces
            .get(index + 1)
            .and_then(|(next, _)| command.clusters.get(next.start));
        let byte_start = command.clusters[range.start].byte;
        let byte_end = next.map_or(command.text.len() as u32, |cluster| cluster.byte);
        let left = if first {
            rect.x
        } else {
            command.clusters[range.start].x
        };
        let right = next.map_or(rect.x + rect.width, |cluster| cluster.x);
        split.push(DisplayTextCommand {
            text: command.text.sub(byte_start as usize..byte_end as usize),
            rect: display_rect(left, rect.y, right - left, rect.height),
            paint: paint(*face, first, last)?,
            line_height_px: command.line_height_px,
            href: command.href.clone(),
            source_text: None,
            source_text_offset: None,
            clusters: command.clusters[range.clone()]
                .iter()
                .map(|cluster| TextCluster {
                    byte: cluster.byte - byte_start,
                    ..*cluster
                })
                .collect(),
        });
    }
    Ok(split)
}

pub(super) fn css_color(color: AbsoluteColor) -> EpubResult<ReaderColor> {
    paint_color(color).map_err(|error| not_paintable(&format!("color: {error:?}")))
}

fn not_paintable(what: &str) -> EpubError {
    EpubError::new(format!("{what} is not paintable yet"))
}
