use std::{ops::Deref, sync::Arc};

use super::commands::contract::{ReaderFontPaint, ReaderRunPaint};

/// A text run's paint, shared by reference between the runs of one
/// inline box: the typed run paint behind an `Arc`, cloned on write.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunPaint {
    data: Arc<ReaderRunPaint>,
}

impl Deref for RunPaint {
    type Target = ReaderRunPaint;

    fn deref(&self) -> &ReaderRunPaint {
        &self.data
    }
}

impl RunPaint {
    pub(crate) fn new(data: ReaderRunPaint) -> Self {
        Self {
            data: Arc::new(data),
        }
    }

    /// Whether the run paints an inline box at all: a background band,
    /// padding or a border edge.
    pub(crate) fn has_box_paint(&self) -> bool {
        self.data.background_color.is_some()
            || self.data.padding.is_some()
            || self.data.border.is_some()
    }

    /// Records the engine-computed inline box extents relative to the
    /// run rect top.
    pub(crate) fn set_box_offsets(&mut self, top: f64, bottom: f64) {
        let data = Arc::make_mut(&mut self.data);
        data.box_offsets = Some((top, bottom));
    }

    /// The glyph paint alone — font, colour, spacing, text shadows — with
    /// the inline box and the decoration line dropped. An outside list
    /// marker borrows its item's style for the glyphs, but its box sits
    /// outside the item's border box: the item's background, padding,
    /// border and decoration never reach it.
    pub(crate) fn glyphs_only(&self) -> Self {
        if !self.has_box_paint() && self.data.decoration.is_none() {
            return self.clone();
        }
        let mut data = (*self.data).clone();
        data.background_color = None;
        data.background_radius = None;
        data.decoration = None;
        data.padding = None;
        data.border = None;
        data.box_offsets = None;
        data.box_start = false;
        data.box_end = false;
        Self::new(data)
    }

    /// Moves the decoration line by `delta` along the run rect's y.
    pub(crate) fn shift_decoration(&mut self, delta: f64) {
        if delta == 0.0 || self.data.decoration.is_none() {
            return;
        }
        let data = Arc::make_mut(&mut self.data);
        if let Some(decoration) = &mut data.decoration {
            decoration.y += delta;
        }
    }

    /// The annotation paint over this base: the base's font at the
    /// annotation size and its colour, nothing else.
    pub(crate) fn for_ruby(&self, font_size: f64) -> Self {
        let font = &self.data.font;
        Self::new(ReaderRunPaint {
            font: ReaderFontPaint {
                family: font.family.clone(),
                size_px: font_size,
                weight: font.weight,
                style: font.style,
            },
            color: self.data.color,
            ..ReaderRunPaint::default()
        })
    }

    #[cfg(test)]
    pub(crate) fn add_letter_spacing(&mut self, delta: f64) {
        if delta != 0.0 {
            let data = Arc::make_mut(&mut self.data);
            data.letter_spacing_px = Some(data.letter_spacing_px.unwrap_or(0.0) + delta);
        }
    }

    #[cfg(test)]
    pub(crate) fn shares_storage_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.data, &other.data)
    }
}

impl Default for RunPaint {
    fn default() -> Self {
        Self::new(ReaderRunPaint::default())
    }
}

#[cfg(test)]
mod tests;
