use std::{borrow::Cow, fmt, marker::PhantomData, pin::Pin, rc::Rc, sync::Arc as StdArc};

use cssparser::{Parser, ParserInput};
use rito_source::{SourceArena, SourceError};
use rito_style_contract::{LayoutStyleTableError, StyleTableError};

use style::{
    animation::DocumentAnimationSet,
    context::QuirksMode,
    media_queries::MediaList,
    parser::{Parse, ParserContext},
    selector_parser::SnapshotMap,
    servo_arc::Arc,
    shared_lock::SharedRwLock,
    stylesheets::{
        AllowImportRules, CssRuleType, DocumentStyleSheet, Origin, Stylesheet, UrlExtraData,
    },
    stylist::Stylist,
    values::specified::font::FontFamily as SpecifiedFontFamily,
};
use style_traits::{ParsingMode, ToCss};

use crate::{
    break_properties::{rewrite_stylesheet, REGISTRATION_STYLESHEET},
    config::initialize_global_preferences,
    device::make_device,
    dom::DomStorage,
    projection::{
        self, InlineStyleProjectionV1, ProductionStyleProjectionV1, ResolvedStylesV0,
        ResolvedStylesV1, ResolvedStylesV2,
    },
    traversal,
    ua::EPUB_UA_STYLESHEET,
};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ColorScheme {
    #[default]
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Viewport {
    pub width: f32,
    pub height: f32,
    pub device_pixel_ratio: f32,
    pub color_scheme: ColorScheme,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            width: 1_280.0,
            height: 720.0,
            device_pixel_ratio: 1.0,
            color_scheme: ColorScheme::Light,
        }
    }
}

impl Viewport {
    fn validate(self) -> Result<Self, StyleError> {
        validate_positive_finite("viewport width", self.width)?;
        validate_positive_finite("viewport height", self.height)?;
        validate_positive_finite("device pixel ratio", self.device_pixel_ratio)?;
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StyleOrigin {
    UserAgent,
    User,
    Author,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StylesheetInput {
    pub css: String,
    pub base_url: String,
    pub origin: StyleOrigin,
}

impl StylesheetInput {
    pub fn new(css: impl Into<String>, base_url: impl Into<String>, origin: StyleOrigin) -> Self {
        Self {
            css: css.into(),
            base_url: base_url.into(),
            origin,
        }
    }

    pub fn author(css: impl Into<String>, base_url: impl Into<String>) -> Self {
        Self::new(css, base_url, StyleOrigin::Author)
    }
}

/// A retained, sequential Stylo document.
///
/// The facade intentionally exposes only Rito-owned input and projection
/// types. The `Rc` marker prevents callers from moving this session across
/// threads while its DOM sidecar relies on exclusive sequential traversal.
pub struct StyleDocument {
    stylist: Stylist,
    animations: DocumentAnimationSet,
    snapshots: SnapshotMap,
    last_animation_time_seconds: Option<f64>,
    _not_send_or_sync: PhantomData<Rc<()>>,
    // Keep the pinned DOM last so state containing opaque node identities is
    // destroyed before the address-owning arena.
    dom: Pin<Box<DomStorage>>,
}

impl StyleDocument {
    /// Creates a style session with Rito's EPUB user-agent policy prepended.
    ///
    /// The policy is an ordinary UA-origin stylesheet over `SourceArena`; it
    /// does not require a browser DOM and author/user sheets retain their
    /// normal cascade precedence.
    pub fn from_epub_source(
        source: StdArc<SourceArena>,
        document_url: &str,
        viewport: Viewport,
        stylesheets: &[StylesheetInput],
    ) -> Result<Self, StyleError> {
        let mut inputs = Vec::with_capacity(stylesheets.len() + 1);
        inputs.push(StylesheetInput::new(
            EPUB_UA_STYLESHEET,
            document_url,
            StyleOrigin::UserAgent,
        ));
        inputs.extend_from_slice(stylesheets);
        Self::from_source(source, document_url, viewport, &inputs)
    }

    pub fn from_source(
        source: StdArc<SourceArena>,
        document_url: &str,
        viewport: Viewport,
        stylesheets: &[StylesheetInput],
    ) -> Result<Self, StyleError> {
        Self::from_source_with_root_font_size(source, document_url, viewport, 16.0, stylesheets)
    }

    /// Creates a style session whose CSS initial/root font-size is supplied
    /// by the embedding reader rather than Stylo's fixed 16px default.
    pub fn from_source_with_root_font_size(
        source: StdArc<SourceArena>,
        document_url: &str,
        viewport: Viewport,
        root_font_size: f32,
        stylesheets: &[StylesheetInput],
    ) -> Result<Self, StyleError> {
        initialize_global_preferences();
        let viewport = viewport.validate()?;
        validate_positive_finite("root font size", root_font_size)?;
        let document_url = parse_url("document", document_url)?;
        let document_url_string = document_url.as_str().to_owned();
        let document_url_data = UrlExtraData::from(document_url);
        let lock = SharedRwLock::new();
        let dom = DomStorage::new(source, lock.clone(), &document_url_data)?;
        let mut stylist = Stylist::new(make_device(viewport, root_font_size), QuirksMode::NoQuirks);

        let registration = StylesheetInput::new(
            REGISTRATION_STYLESHEET,
            document_url_string,
            StyleOrigin::UserAgent,
        );
        let sheet = parse_stylesheet(&registration, &lock)?;
        stylist.append_stylesheet(sheet, &lock.read());

        for input in stylesheets {
            let sheet = parse_stylesheet(input, &lock)?;
            stylist.append_stylesheet(sheet, &lock.read());
        }

        Ok(Self {
            stylist,
            animations: DocumentAnimationSet::default(),
            snapshots: SnapshotMap::new(),
            last_animation_time_seconds: None,
            _not_send_or_sync: PhantomData,
            dom,
        })
    }

    pub fn resolve(&mut self) -> Result<ResolvedStylesV0, StyleError> {
        self.resolve_at(self.last_animation_time_seconds.unwrap_or(0.0))
    }

    pub fn resolve_v1(&mut self) -> Result<ResolvedStylesV1, StyleError> {
        self.resolve_v1_at(self.last_animation_time_seconds.unwrap_or(0.0))
    }

    pub fn resolve_v2(&mut self) -> Result<ResolvedStylesV2, StyleError> {
        self.resolve_v2_at(self.last_animation_time_seconds.unwrap_or(0.0))
    }

    /// Resolves and projects the engine-neutral inline-formatting V1 slice.
    pub fn resolve_inline_styles_v1(&mut self) -> Result<InlineStyleProjectionV1, StyleError> {
        self.resolve_inline_styles_v1_at(self.last_animation_time_seconds.unwrap_or(0.0))
    }

    /// Resolves Stylo once and projects both production migration slices.
    pub fn resolve_production_slice_v1(
        &mut self,
    ) -> Result<ProductionStyleProjectionV1, StyleError> {
        self.resolve_production_slice_v1_at(self.last_animation_time_seconds.unwrap_or(0.0))
    }

    pub fn resolve_at(
        &mut self,
        animation_time_seconds: f64,
    ) -> Result<ResolvedStylesV0, StyleError> {
        self.resolve_style_data(animation_time_seconds)?;
        Ok(projection::project(&self.dom))
    }

    pub fn resolve_v1_at(
        &mut self,
        animation_time_seconds: f64,
    ) -> Result<ResolvedStylesV1, StyleError> {
        self.resolve_style_data(animation_time_seconds)?;
        Ok(projection::project_v1(&self.dom))
    }

    pub fn resolve_v2_at(
        &mut self,
        animation_time_seconds: f64,
    ) -> Result<ResolvedStylesV2, StyleError> {
        self.resolve_style_data(animation_time_seconds)?;
        Ok(projection::project_v2(&self.dom))
    }

    /// Resolves the V1 contract slice at a monotonic animation timeline time.
    pub fn resolve_inline_styles_v1_at(
        &mut self,
        animation_time_seconds: f64,
    ) -> Result<InlineStyleProjectionV1, StyleError> {
        self.resolve_style_data(animation_time_seconds)?;
        projection::project_inline_v1(&self.dom).map_err(StyleError::from)
    }

    /// Resolves both V1 slices at one monotonic animation timeline time.
    ///
    /// The cascade traversal runs exactly once. The two owned, engine-neutral
    /// tables are then projected from the retained computed-style slots.
    pub fn resolve_production_slice_v1_at(
        &mut self,
        animation_time_seconds: f64,
    ) -> Result<ProductionStyleProjectionV1, StyleError> {
        self.resolve_style_data(animation_time_seconds)?;
        let inline = projection::project_inline_v1(&self.dom)?;
        let layout = projection::project_layout_v1(&self.dom)?;
        Ok(ProductionStyleProjectionV1::new(inline, layout))
    }

    fn resolve_style_data(&mut self, animation_time_seconds: f64) -> Result<(), StyleError> {
        if !animation_time_seconds.is_finite() || animation_time_seconds < 0.0 {
            return Err(StyleError::InvalidAnimationTime);
        }
        if self
            .last_animation_time_seconds
            .is_some_and(|previous| animation_time_seconds < previous)
        {
            return Err(StyleError::NonMonotonicAnimationTime);
        }
        traversal::resolve(
            &self.dom,
            &mut self.stylist,
            &self.animations,
            &mut self.snapshots,
            animation_time_seconds,
        );
        self.last_animation_time_seconds = Some(animation_time_seconds);
        Ok(())
    }

    pub fn has_active_animations(&self) -> bool {
        self.animations
            .sets
            .read()
            .values()
            .any(|set| set.needs_animation_ticks())
    }

    /// Forces the next resolve to recascade the complete document tree.
    /// This is primarily used by isolated benchmark and differential-test
    /// harnesses; retained production sessions should use targeted invalidation.
    pub fn force_full_restyle(&mut self) {
        self.dom.mark_full_restyle();
    }
}

/// Parses and serializes a reader-provided `font-family` value with Stylo's
/// own property grammar. Returning canonical CSS makes it safe to embed in an
/// internal stylesheet without treating a complete fallback list as one name.
pub fn canonicalize_font_family_value(value: &str) -> Option<String> {
    let url_data = UrlExtraData::from(url::Url::parse("about:blank").ok()?);
    let context = ParserContext::new(
        Origin::User,
        &url_data,
        Some(CssRuleType::Style),
        ParsingMode::DEFAULT,
        QuirksMode::NoQuirks,
        Cow::default(),
        None,
        None,
        Default::default(),
    );
    let mut input = ParserInput::new(value);
    let family = Parser::new(&mut input)
        .parse_entirely(|parser| SpecifiedFontFamily::parse(&context, parser))
        .ok()?;
    Some(family.to_css_string())
}

fn parse_stylesheet(
    input: &StylesheetInput,
    lock: &SharedRwLock,
) -> Result<DocumentStyleSheet, StyleError> {
    let base_url = parse_url("stylesheet", &input.base_url)?;
    let css = rewrite_stylesheet(&input.css);
    let stylesheet = Stylesheet::from_str(
        &css,
        UrlExtraData::from(base_url),
        input.origin.into(),
        Arc::new(lock.wrap(MediaList::empty())),
        lock.clone(),
        None,
        None,
        QuirksMode::NoQuirks,
        // EPUB imports are expanded by the publication loader. This adapter
        // does not silently accept @import without a real stylesheet loader.
        AllowImportRules::No,
    );
    Ok(DocumentStyleSheet(Arc::new(stylesheet)))
}

fn parse_url(kind: &'static str, value: &str) -> Result<url::Url, StyleError> {
    url::Url::parse(value).map_err(|error| StyleError::InvalidUrl {
        kind,
        value: value.to_owned(),
        reason: error.to_string(),
    })
}

fn validate_positive_finite(name: &'static str, value: f32) -> Result<(), StyleError> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(StyleError::InvalidViewport(name))
    }
}

impl From<StyleOrigin> for Origin {
    fn from(value: StyleOrigin) -> Self {
        match value {
            StyleOrigin::UserAgent => Self::UserAgent,
            StyleOrigin::User => Self::User,
            StyleOrigin::Author => Self::Author,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StyleError {
    Source(SourceError),
    StyleTable(StyleTableError),
    LayoutStyleTable(LayoutStyleTableError),
    InvalidAnimationTime,
    NonMonotonicAnimationTime,
    InvalidUrl {
        kind: &'static str,
        value: String,
        reason: String,
    },
    UnsupportedPresentationalHint {
        source_index: usize,
        name: &'static str,
        value: String,
    },
    InvalidViewport(&'static str),
}

impl fmt::Display for StyleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Source(error) => error.fmt(formatter),
            Self::StyleTable(error) => error.fmt(formatter),
            Self::LayoutStyleTable(error) => error.fmt(formatter),
            Self::InvalidAnimationTime => {
                formatter.write_str("animation time must be finite and non-negative")
            }
            Self::NonMonotonicAnimationTime => {
                formatter.write_str("animation time must not move backwards")
            }
            Self::InvalidUrl {
                kind,
                value,
                reason,
            } => write!(formatter, "invalid {kind} URL {value:?}: {reason}"),
            Self::UnsupportedPresentationalHint {
                source_index,
                name,
                value,
            } => write!(
                formatter,
                "source node {source_index} has unsupported presentational hint {name}={value:?}"
            ),
            Self::InvalidViewport(name) => {
                write!(formatter, "{name} must be finite and greater than zero")
            }
        }
    }
}

impl std::error::Error for StyleError {}

impl From<SourceError> for StyleError {
    fn from(value: SourceError) -> Self {
        Self::Source(value)
    }
}

impl From<StyleTableError> for StyleError {
    fn from(value: StyleTableError) -> Self {
        Self::StyleTable(value)
    }
}

impl From<LayoutStyleTableError> for StyleError {
    fn from(value: LayoutStyleTableError) -> Self {
        Self::LayoutStyleTable(value)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use rito_source::SourceArena;

    use super::{
        canonicalize_font_family_value, StyleDocument, StyleError, StylesheetInput, Viewport,
    };
    use crate::{
        ComputedDisplayV1, ComputedLineHeightV1, DisplayCategory, DisplayInsideV1, DisplayOutsideV1,
    };

    const URL: &str = "https://example.test/book/chapter.xhtml";

    static_assertions::assert_not_impl_any!(StyleDocument: Send, Sync);

    fn source(xhtml: &str) -> Arc<SourceArena> {
        Arc::new(SourceArena::from_xhtml(xhtml).unwrap())
    }

    #[test]
    fn resolves_author_and_inline_style_without_blitz_dom() {
        let mut document = StyleDocument::from_source(
            source(
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target" style="font-size: 27px">text</p></body></html>"#,
            ),
            URL,
            Viewport::default(),
            &[StylesheetInput::author(
                "p { display: block; font-size: 21px }",
                URL,
            )],
        )
        .unwrap();

        let resolved = document.resolve().unwrap();
        let target = resolved.element_by_id("target").unwrap();
        assert_eq!(target.display, DisplayCategory::Block);
        assert_eq!(target.font_size_px, 27.0);
    }

    #[test]
    fn configured_root_font_size_drives_root_relative_cascade() {
        let mut document = StyleDocument::from_source_with_root_font_size(
            source(
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
            ),
            URL,
            Viewport::default(),
            22.0,
            &[StylesheetInput::author(
                "html { font-size: 2em } #target { font-size: 1rem }",
                URL,
            )],
        )
        .unwrap();

        let resolved = document.resolve().unwrap();
        assert_eq!(resolved.element_by_id("target").unwrap().font_size_px, 44.0);
    }

    #[test]
    fn reader_font_family_uses_stylo_grammar_and_rejects_injection() {
        assert_eq!(
            canonicalize_font_family_value("Georgia, serif").as_deref(),
            Some("Georgia, serif")
        );
        assert!(canonicalize_font_family_value(r#""Book Face", sans-serif"#).is_some());
        assert!(canonicalize_font_family_value("Georgia; color: red").is_none());
        assert!(canonicalize_font_family_value("Georgia !important").is_none());
        assert!(canonicalize_font_family_value("Georgia } body { color: red").is_none());
    }

    #[test]
    fn v1_projection_preserves_computed_field_distinctions() {
        let mut document = StyleDocument::from_source(
            source(
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
            ),
            URL,
            Viewport::default(),
            &[StylesheetInput::author(
                "#target { display: inline-block; font-size: 24px; font-weight: 650; line-height: 1.5; color: rgba(255, 0, 128, .25) }",
                URL,
            )],
        )
        .unwrap();

        let resolved = document.resolve_v1().unwrap();
        let target = resolved.element_by_id("target").unwrap();
        assert_eq!(target.font_size_px, 24.0);
        assert_eq!(target.font_weight, 650.0);
        assert_eq!(target.line_height, ComputedLineHeightV1::Number(1.5));
        assert_eq!(
            target.display,
            ComputedDisplayV1 {
                outside: DisplayOutsideV1::Inline,
                inside: DisplayInsideV1::FlowRoot,
                is_list_item: false,
            }
        );
        assert!((target.color.red - 1.0).abs() < 0.0001);
        assert!((target.color.green - 0.0).abs() < 0.0001);
        assert!((target.color.blue - 128.0 / 255.0).abs() < 0.0001);
        assert!((target.color.alpha - 0.25).abs() < 0.0001);
    }

    #[test]
    fn resolves_namespace_attribute_and_language_selectors() {
        let mut document = StyleDocument::from_source(
            source(
                r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body xml:lang="ja-JP"><p id="target" epub:type="note">text</p></body></html>"#,
            ),
            URL,
            Viewport::default(),
            &[StylesheetInput::author(
                r#"@namespace epub "http://www.idpf.org/2007/ops"; [epub|type="note"]:lang(ja) { font-size: 31px }"#,
                URL,
            )],
        )
        .unwrap();

        let target = document
            .resolve()
            .unwrap()
            .element_by_id("target")
            .unwrap()
            .clone();
        assert_eq!(target.font_size_px, 31.0);
    }

    #[test]
    fn retains_and_ticks_css_animations() {
        let mut document = StyleDocument::from_source(
            source(
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
            ),
            URL,
            Viewport::default(),
            &[StylesheetInput::author(
                "@keyframes grow { from { font-size: 10px } to { font-size: 30px } } #target { font-size: 10px; animation: grow 10s linear both }",
                URL,
            )],
        )
        .unwrap();

        document.resolve_at(0.0).unwrap();
        assert!(document.has_active_animations());
        let resolved = document.resolve_at(5.0).unwrap();
        let font_size = resolved.element_by_id("target").unwrap().font_size_px;
        assert!((font_size - 20.0).abs() < 0.01, "got {font_size}px");
    }

    #[test]
    fn advances_multiple_animation_iterations_and_rejects_time_reversal() {
        let mut document = StyleDocument::from_source(
            source(
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
            ),
            URL,
            Viewport::default(),
            &[StylesheetInput::author(
                "@keyframes pulse { from { font-size: 10px } to { font-size: 30px } } #target { font-size: 10px; animation: pulse 1s linear 4 alternate both }",
                URL,
            )],
        )
        .unwrap();

        document.resolve_at(0.0).unwrap();
        let resolved = document.resolve_at(2.25).unwrap();
        let font_size = resolved.element_by_id("target").unwrap().font_size_px;
        assert!((font_size - 15.0).abs() < 0.01, "got {font_size}px");
        assert_eq!(
            document.resolve_at(2.0).unwrap_err(),
            StyleError::NonMonotonicAnimationTime
        );
        let same_time = document.resolve().unwrap();
        assert!((same_time.element_by_id("target").unwrap().font_size_px - 15.0).abs() < 0.01);
    }

    #[test]
    fn repeated_exclusive_restyle_keeps_sidecar_borrows_non_overlapping() {
        let mut document = StyleDocument::from_source(
            source(
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
            ),
            URL,
            Viewport::default(),
            &[StylesheetInput::author(
                "#target { font-size: 20px; animation: none }",
                URL,
            )],
        )
        .unwrap();

        for step in 0..1_000 {
            document.force_full_restyle();
            let resolved = document.resolve_at(f64::from(step) / 1_000.0).unwrap();
            assert_eq!(resolved.element_by_id("target").unwrap().font_size_px, 20.0);
        }
    }
}
