use std::{
    borrow::Cow, cell::RefCell, collections::HashMap, fmt, marker::PhantomData, pin::Pin, rc::Rc,
    sync::Arc as StdArc,
};

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
    projection::{self, ProductionStyleProjection},
    traversal,
    viewport_dependence::ViewportDependence,
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

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum StyleOrigin {
    UserAgent,
    User,
    Author,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
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

/// A retained, sequential Stylo document over one parsed chapter.
///
/// Only Rito-owned input and projection types cross this boundary. The `Rc`
/// marker keeps the session on one thread: its DOM sidecar relies on
/// exclusive sequential traversal.
pub struct StyleDocument {
    stylist: Stylist,
    /// The sheets the cascade reads, in order, and what they were read
    /// under: what [`StyleDocument::viewport_dependence`] reports on.
    sheets: Vec<DocumentStyleSheet>,
    viewport: Viewport,
    root_font_size: f32,
    lock: SharedRwLock,
    animations: DocumentAnimationSet,
    snapshots: SnapshotMap,
    _not_send_or_sync: PhantomData<Rc<()>>,
    // Keep the pinned DOM last so state containing opaque node identities is
    // destroyed before the address-owning arena.
    dom: Pin<Box<DomStorage>>,
}

impl StyleDocument {
    /// Creates a style session over a parsed chapter.
    ///
    /// `root_font_size` is the CSS initial font size configured by the
    /// embedding reader; it replaces Stylo's fixed 16px default so `rem`
    /// values and the root element's own `em` values follow the reader
    /// setting. Stylesheets cascade in the given order under their declared
    /// origins; the caller supplies the user-agent sheet
    /// ([`crate::epub_ua_stylesheet`]) like any other input.
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
        let lock = thread_shared_lock();
        let dom = DomStorage::new(source, lock.clone(), &document_url_data)?;
        let mut stylist = Stylist::new(make_device(viewport, root_font_size), QuirksMode::NoQuirks);

        let registration = StylesheetInput::new(
            REGISTRATION_STYLESHEET,
            document_url_string,
            StyleOrigin::UserAgent,
        );
        let mut sheets = Vec::with_capacity(stylesheets.len() + 1);
        for input in std::iter::once(&registration).chain(stylesheets) {
            let sheet = parsed_stylesheet(input, &lock)?;
            stylist.append_stylesheet(sheet.clone(), &lock.read());
            sheets.push(sheet);
        }

        Ok(Self {
            stylist,
            sheets,
            viewport,
            root_font_size,
            lock,
            animations: DocumentAnimationSet::default(),
            snapshots: SnapshotMap::new(),
            _not_send_or_sync: PhantomData,
            dom,
        })
    }

    /// Runs the cascade once and projects both production style tables from
    /// the retained computed styles.
    pub fn resolve_production_slice(&mut self) -> Result<ProductionStyleProjection, StyleError> {
        traversal::resolve(
            &self.dom,
            &mut self.stylist,
            &self.animations,
            &mut self.snapshots,
        );
        let mut inline = projection::project_inline(&self.dom)?;
        let mut layout = projection::project_layout(&self.dom)?;
        let generated =
            projection::project_generated(&self.dom, inline.table_mut(), layout.table_mut());
        Ok(ProductionStyleProjection::new(inline, layout, generated))
    }

    /// What the cascade read of the viewport: once styles are resolved,
    /// whether they would come out the same at another viewport.
    pub fn viewport_dependence(&self) -> ViewportDependence {
        ViewportDependence::capture(
            self.stylist.device(),
            self.viewport,
            self.root_font_size,
            &self.sheets,
            &self.lock,
        )
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

thread_local! {
    // Every style document on a thread shares one lock, so a stylesheet
    // parsed for one chapter or one layout appends unchanged to the next:
    // a publication's sheets are parsed once, not once per chapter per
    // layout. The parsed sheets are immutable once built.
    static SHARED_LOCK: SharedRwLock = SharedRwLock::new();
    static PARSED_SHEETS: RefCell<HashMap<StylesheetInput, DocumentStyleSheet>> =
        RefCell::new(HashMap::new());
}

/// Sheets kept per thread before the cache starts over: enough for any
/// publication's sheets plus the UA ones, bounded across publications.
const MAX_PARSED_SHEETS: usize = 64;

fn thread_shared_lock() -> SharedRwLock {
    SHARED_LOCK.with(Clone::clone)
}

fn parsed_stylesheet(
    input: &StylesheetInput,
    lock: &SharedRwLock,
) -> Result<DocumentStyleSheet, StyleError> {
    if let Some(sheet) = PARSED_SHEETS.with(|sheets| sheets.borrow().get(input).cloned()) {
        return Ok(sheet);
    }
    let sheet = parse_stylesheet(input, lock)?;
    PARSED_SHEETS.with(|sheets| {
        let mut sheets = sheets.borrow_mut();
        if sheets.len() >= MAX_PARSED_SHEETS {
            sheets.clear();
        }
        sheets.insert(input.clone(), sheet.clone());
    });
    Ok(sheet)
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
    use rito_style_contract::{
        AbsoluteColorSpace, InlineFormattingStyle, LayoutDisplayInside, LayoutDisplayOutside,
        LayoutFormattingStyle, LineHeight,
    };

    use super::{canonicalize_font_family_value, StyleDocument, StylesheetInput, Viewport};

    const URL: &str = "https://example.test/book/chapter.xhtml";

    static_assertions::assert_not_impl_any!(StyleDocument: Send, Sync);

    fn source(xhtml: &str) -> Arc<SourceArena> {
        Arc::new(SourceArena::from_xhtml(xhtml).unwrap())
    }

    /// Resolves the document through the production path and returns the
    /// projected styles of the element with `id="target"`.
    fn target_styles(
        source: &Arc<SourceArena>,
        root_font_size: f32,
        css: &str,
    ) -> (InlineFormattingStyle, LayoutFormattingStyle) {
        let target = source.find_element_by_id("target").unwrap();
        let mut document = StyleDocument::from_source_with_root_font_size(
            Arc::clone(source),
            URL,
            Viewport::default(),
            root_font_size,
            &[StylesheetInput::author(css, URL)],
        )
        .unwrap();
        let (inline, layout) = document.resolve_production_slice().unwrap().into_parts();
        let inline_style = inline
            .table()
            .style_for_node(target.index())
            .unwrap()
            .clone();
        let layout_style = *layout.table().style_for_node(target.index()).unwrap();
        (inline_style, layout_style)
    }

    #[test]
    fn resolves_author_and_inline_style_declarations() {
        let source = source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target" style="font-size: 27px">text</p></body></html>"#,
        );
        let (inline, layout) =
            target_styles(&source, 16.0, "p { display: block; font-size: 21px }");
        assert_eq!(layout.display.outside, LayoutDisplayOutside::Block);
        assert_eq!(layout.display.inside, LayoutDisplayInside::Flow);
        assert_eq!(inline.font.size.get(), 27.0);
    }

    #[test]
    fn a_stylesheet_parsed_once_serves_every_later_document() {
        let css = "#target { font-size: 1.5rem }";
        let input = StylesheetInput::author(css, URL);
        let first = super::parsed_stylesheet(&input, &super::thread_shared_lock()).unwrap();
        let again = super::parsed_stylesheet(&input, &super::thread_shared_lock()).unwrap();
        assert!(style::servo_arc::Arc::ptr_eq(&first.0, &again.0));

        // Two layouts at different root sizes share the sheet and still
        // cascade each against its own root size.
        let source = source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
        );
        assert_eq!(target_styles(&source, 16.0, css).0.font.size.get(), 24.0);
        assert_eq!(target_styles(&source, 20.0, css).0.font.size.get(), 30.0);
    }

    #[test]
    fn configured_root_font_size_drives_root_relative_cascade() {
        let source = source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
        );
        let (inline, _) = target_styles(
            &source,
            22.0,
            "html { font-size: 2em } #target { font-size: 1rem }",
        );
        assert_eq!(inline.font.size.get(), 44.0);
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
    fn projection_preserves_computed_field_distinctions() {
        let source = source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">text</p></body></html>"#,
        );
        let (inline, layout) = target_styles(
            &source,
            16.0,
            "#target { display: inline-block; font-size: 24px; font-weight: 650; line-height: 1.5; color: rgba(255, 0, 128, .25) }",
        );
        assert_eq!(inline.font.size.get(), 24.0);
        assert_eq!(inline.font.weight.get(), 650.0);
        assert!(matches!(
            inline.font.line_height,
            LineHeight::Number(value) if value.get() == 1.5
        ));
        assert_eq!(layout.display.outside, LayoutDisplayOutside::Inline);
        assert_eq!(layout.display.inside, LayoutDisplayInside::FlowRoot);
        assert!(!layout.display.is_list_item);
        let color = inline.paint.foreground;
        assert_eq!(color.space(), AbsoluteColorSpace::Srgb);
        let [red, green, blue] = color.components();
        assert!((red.get() - 1.0).abs() < 0.0001);
        assert!((green.get() - 0.0).abs() < 0.0001);
        assert!((blue.get() - 128.0 / 255.0).abs() < 0.0001);
        assert!((color.alpha().get() - 0.25).abs() < 0.0001);
    }

    #[test]
    fn resolves_namespace_attribute_and_language_selectors() {
        let source = source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body xml:lang="ja-JP"><p id="target" epub:type="note">text</p></body></html>"#,
        );
        let (inline, _) = target_styles(
            &source,
            16.0,
            r#"@namespace epub "http://www.idpf.org/2007/ops"; [epub|type="note"]:lang(ja) { font-size: 31px }"#,
        );
        assert_eq!(inline.font.size.get(), 31.0);
    }

    #[test]
    fn generates_before_and_after_boxes_with_their_styles_and_content() {
        use rito_style_contract::{GeneratedContentItem, Position, PseudoElementKind};
        let source = source(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="a" class="tail">x</p><p id="b" title="T">y</p><p id="c">z</p></body></html>"#,
        );
        let mut document = StyleDocument::from_source_with_root_font_size(
            Arc::clone(&source),
            URL,
            Viewport::default(),
            16.0,
            &[StylesheetInput::author(
                ".tail { position: relative } \
                 .tail::before { content: \"\"; position: absolute; right: 100%; top: 0; \
                   border-right: 0.8em solid green; border-bottom: 1em solid transparent } \
                 #b::after { content: \"<\" attr(title) \">\" } \
                 #c::before { content: counter(n) } #c::after { content: \"q\"; display: none }",
                URL,
            )],
        )
        .unwrap();
        let (inline, layout, generated) =
            document.resolve_production_slice().unwrap().into_tables();
        let index = |id: &str| source.find_element_by_id(id).unwrap().index();

        let tail = generated
            .get(index("a"), PseudoElementKind::Before)
            .unwrap();
        assert_eq!(
            tail.content,
            vec![GeneratedContentItem::Text(String::new())]
        );
        assert_eq!(
            layout.style(tail.layout).unwrap().position,
            Position::Absolute
        );
        let right = inline.style(tail.inline).unwrap().fragment.border.right;
        // 0.8em at 16px: border widths compute to whole device pixels.
        assert_eq!(right.resolved_width.get(), 12.0);
        assert!(generated
            .get(index("a"), PseudoElementKind::After)
            .is_none());

        let quoted = generated.get(index("b"), PseudoElementKind::After).unwrap();
        assert_eq!(
            quoted.content,
            ["<", "T", ">"]
                .map(|text| GeneratedContentItem::Text(text.to_owned()))
                .to_vec()
        );
        let counter = generated
            .get(index("c"), PseudoElementKind::Before)
            .unwrap();
        assert_eq!(
            counter.content,
            vec![GeneratedContentItem::Unsupported("counter()")]
        );
        // `display: none` generates nothing.
        assert!(generated
            .get(index("c"), PseudoElementKind::After)
            .is_none());
    }
}
