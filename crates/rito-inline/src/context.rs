//! Construction and font registration.

use crate::*;

impl ParleyInlineContext {
    /// Creates a context over bare font blobs, each a language-neutral
    /// serif face: every family list resolves to them in order. Fails
    /// closed if a blob registers no usable font face.
    pub fn new(font_blobs: Vec<Vec<u8>>) -> Result<Self, String> {
        Self::with_faces(
            font_blobs
                .into_iter()
                .enumerate()
                .map(|(index, bytes)| HostFontFace {
                    family: font_family_name(&bytes).unwrap_or_default(),
                    bytes,
                    role: HostFontRole::Serif,
                    language: None,
                    alias: format!("face{index}"),
                })
                .collect(),
        )
    }

    /// Creates a context that resolves families against exactly these host
    /// faces (see [`crate::fonts`] for how a family list resolves). Fails
    /// closed if a face registers no usable font.
    ///
    /// The faces are the resolution universe — the platform font database
    /// is explicitly excluded, so a family the faces cannot serve resolves
    /// the same way on native and wasm hosts instead of silently borrowing
    /// a platform font.
    pub fn with_faces(faces: Vec<HostFontFace>) -> Result<Self, String> {
        use parley::fontique::{Collection, CollectionOptions, SourceCache, SourceCacheOptions};
        let mut collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        });
        let mut catalog = FontCatalog::default();
        for (index, face) in faces.into_iter().enumerate() {
            catalog
                .register_host(&mut collection, face)
                .map_err(|error| format!("host face {index}: {error}"))?;
        }
        install_universal_fallbacks(&mut collection, &catalog.fallback_families());
        let fonts = FontContext {
            collection,
            source_cache: SourceCache::new(SourceCacheOptions::default()),
        };
        Ok(Self {
            fonts: RefCell::new(fonts),
            layouts: RefCell::new(LayoutContext::new()),
            catalog,
            line_metrics: RefCell::default(),
            run_samples: RefCell::default(),
            halt_feature_cache: RefCell::default(),
            shaped: RefCell::default(),
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
            self.family_key(style),
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

    /// The name paint draws each face by — the alias the host registered
    /// the face's bytes under — indexed by face id.
    pub fn face_aliases(&self) -> &[String] {
        self.catalog.aliases()
    }

    /// The family names (lowercase) some resolved style named that no face
    /// in the catalog answers to.
    pub fn unknown_families(&self) -> Vec<String> {
        self.catalog.unknown_families()
    }

    /// Registers one publication `@font-face` binding: its declared family
    /// resolves to these bytes with the declared weight and style, ahead of
    /// any host family of the same name.
    pub fn register_publication_face(&mut self, face: PublicationFontFace) -> Result<(), String> {
        let fonts = self.fonts.get_mut();
        self.catalog
            .register_publication(&mut fonts.collection, face)?;
        install_universal_fallbacks(&mut fonts.collection, &self.catalog.fallback_families());
        // A new face can change what a family list resolves to.
        self.line_metrics.get_mut().clear();
        self.run_samples.get_mut().clear();
        self.shaped.get_mut().clear();
        Ok(())
    }
}
