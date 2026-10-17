//! What a resolved chapter's styles read of the viewport, and so whether
//! they still hold at another one. A browser asks the same two questions
//! of a resize before it restyles anything: did a computed value read the
//! viewport size, and does any media query answer differently now.

use std::fmt;

use style::{
    context::QuirksMode,
    device::Device,
    media_queries::MediaList,
    servo_arc::Arc,
    shared_lock::{Locked, SharedRwLock},
    stylesheets::{
        AllRules, CssRule, CustomMediaEvaluator, CustomMediaMap, DocumentStyleSheet,
        StylesheetInDocument,
    },
};

use crate::{device::make_device, session::Viewport};

/// What one resolved chapter's styles read of the viewport.
pub struct ViewportDependence {
    /// Set when a computed value read the viewport size (a `vw`, `vh`,
    /// `vmin` or `vmax` length, or a dynamic viewport unit): the styles
    /// hold under that exact viewport only.
    exact: Option<Viewport>,
    /// Every `@media` rule's query list in cascade order, with whether it
    /// matched. The device is the viewport here, so `device-width` and
    /// `device-height` follow it too: every list is kept, not only the
    /// ones Stylo marks as depending on the viewport.
    media: Vec<(Arc<Locked<MediaList>>, bool)>,
    /// The initial font size `em` lengths in media queries resolve against.
    root_font_size: f32,
    lock: SharedRwLock,
}

impl ViewportDependence {
    /// Records what resolving under `viewport` read: called once the
    /// cascade has run on `device`, over the sheets it cascaded.
    pub(crate) fn capture(
        device: &Device,
        viewport: Viewport,
        root_font_size: f32,
        sheets: &[DocumentStyleSheet],
        lock: &SharedRwLock,
    ) -> Self {
        let exact = (device.used_viewport_size() || device.used_dynamic_viewport_size())
            .then_some(viewport);
        let guard = lock.read();
        let custom_media = CustomMediaMap::default();
        let mut media = Vec::new();
        for sheet in sheets {
            let contents = sheet.contents(&guard);
            for rule in contents.iter_rules::<AllRules, _>(device, &custom_media, &guard) {
                if let CssRule::Media(rule) = rule {
                    let matched = rule.media_queries.read_with(&guard).evaluate(
                        device,
                        QuirksMode::NoQuirks,
                        &mut CustomMediaEvaluator::none(),
                    );
                    media.push((rule.media_queries.clone(), matched));
                }
            }
        }
        Self {
            exact,
            media,
            root_font_size,
            lock: lock.clone(),
        }
    }

    /// Whether resolving the same sources at `viewport` would compute the
    /// same styles: no computed value read the viewport, and every media
    /// query answers as it did.
    pub fn holds_at(&self, viewport: Viewport) -> bool {
        if let Some(exact) = self.exact {
            return exact == viewport;
        }
        if self.media.is_empty() {
            return true;
        }
        let device = make_device(viewport, self.root_font_size);
        let guard = self.lock.read();
        self.media.iter().all(|(list, matched)| {
            list.read_with(&guard).evaluate(
                &device,
                QuirksMode::NoQuirks,
                &mut CustomMediaEvaluator::none(),
            ) == *matched
        })
    }
}

impl fmt::Debug for ViewportDependence {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ViewportDependence")
            .field("exact", &self.exact)
            .field(
                "media",
                &self
                    .media
                    .iter()
                    .map(|(_, matched)| *matched)
                    .collect::<Vec<_>>(),
            )
            .field("root_font_size", &self.root_font_size)
            .finish()
    }
}
