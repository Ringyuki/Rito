//! Construction and font registration.

use crate::*;

impl ParleyInlineContext {
    /// Creates a context that resolves families against exactly these font
    /// blobs. Fails closed if a blob registers no usable font face.
    ///
    /// The blobs are the resolution universe: they serve every generic
    /// family and every script's fallback, in construction order. Nothing
    /// else exists — the platform font database is explicitly excluded, so
    /// a family the blobs cannot serve resolves the same way on native and
    /// wasm hosts instead of silently borrowing a platform font.
    pub fn new(font_blobs: Vec<Vec<u8>>) -> Result<Self, String> {
        use parley::fontique::{Collection, CollectionOptions, SourceCache, SourceCacheOptions};
        let mut collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        });
        let mut registered_families = Vec::new();
        let mut fallback_ids = Vec::new();
        for (index, bytes) in font_blobs.into_iter().enumerate() {
            let registered = collection.register_fonts(bytes.into(), None);
            if registered.is_empty() {
                return Err(format!("font blob {index} registered no font face"));
            }
            for (family_id, _) in registered {
                if !fallback_ids.contains(&family_id) {
                    fallback_ids.push(family_id);
                }
                if let Some(name) = collection.family_name(family_id) {
                    let name = name.to_string();
                    if !registered_families.contains(&name) {
                        registered_families.push(name);
                    }
                }
            }
        }
        install_universal_fallbacks(&mut collection, &fallback_ids);
        let fonts = FontContext {
            collection,
            source_cache: SourceCache::new(SourceCacheOptions::default()),
        };
        Ok(Self {
            fonts: RefCell::new(fonts),
            layouts: RefCell::new(LayoutContext::new()),
            registered_families,
            line_metrics: RefCell::new(std::collections::HashMap::new()),
            run_samples: RefCell::new(std::collections::HashMap::new()),
            halt_feature_cache: RefCell::new(std::collections::HashMap::new()),
        })
    }

    /// The character a text run's line metric is sampled with: the first
    /// character seen for the face the run resolved to, so runs sharing a
    /// face share one entry.
    pub(crate) fn run_sample(
        &self,
        style: &InlineFormattingStyle,
        font: &parley::FontData,
        first_char: char,
    ) -> char {
        let key = (
            family_key(style),
            f64::from(style.font.size.get()).to_bits(),
            font.data.id(),
            font.index,
        );
        *self
            .run_samples
            .borrow_mut()
            .entry(key)
            .or_insert(first_char)
    }

    /// Family names the constructor registered, in first-seen order.
    pub fn registered_families(&self) -> &[String] {
        &self.registered_families
    }

    /// Registers one font blob under an explicit family name, the way a
    /// stylesheet's `@font-face` binds a declared family to font bytes.
    /// Styles resolve the declared name regardless of the font's own
    /// internal family name.
    pub fn register_named_font(&mut self, family_name: &str, bytes: Vec<u8>) -> Result<(), String> {
        let fonts = self.fonts.get_mut();
        let registered = fonts.collection.register_fonts(
            bytes.into(),
            Some(parley::fontique::FontInfoOverride {
                family_name: Some(family_name),
                width: None,
                style: None,
                weight: None,
                axes: None,
            }),
        );
        if registered.is_empty() {
            return Err(format!(
                "font blob for family {family_name} registered no font face"
            ));
        }
        if !self
            .registered_families
            .iter()
            .any(|name| name == family_name)
        {
            self.registered_families.push(family_name.to_owned());
        }
        // A new face can change what a family list resolves to.
        self.line_metrics.get_mut().clear();
        self.run_samples.get_mut().clear();
        Ok(())
    }
}
