use std::sync::Arc;

use rito_style_contract::{
    Clear, ComputedColor, Float, InlineFormattingStyle, LayoutFormattingStyle, LengthPercentage,
    LineHeight, MaximumHeight, MaximumSize, MinimumHeight, Overflow, PageBreak, TransformOperation,
};

use crate::{
    epub::{
        LoadedChapter, LoadedEpubDocument, LoadedTextResource, PackageDocument, PackageMetadata,
    },
    style::{
        paint_color, resolve_prepared_chapter_style, serialize_font_families,
        style_backend_metrics, ChapterStyleOptions, CssViewport, PreparedStyleChapterInput,
        StyleBackendError,
    },
    xhtml::DocumentNode,
};

use super::{
    parse_loaded_chapter_source, prepare_loaded_document_base, ParsedLoadedChapterSource,
    StylesheetSourceLedger,
};

#[test]
fn prepared_base_keeps_the_raw_stylesheet_sources() {
    let document = document_with_stylesheet("styles/main.css", "p { color: red; }");
    let base = prepare_loaded_document_base(&document);

    assert_eq!(base.stylesheet_ledger.sources().len(), 1);
    assert_eq!(
        base.stylesheet_ledger.sources()[0].href(),
        "styles/main.css"
    );
    assert_eq!(
        base.stylesheet_ledger.sources()[0].text(),
        "p { color: red; }"
    );
}

#[test]
fn prepared_chapter_retains_the_canonical_arena_across_clones() {
    let chapter = chapter("<html><body><p id='target'>shared</p></body></html>");
    let prepared = parse_loaded_chapter_source(&chapter);
    let arena = prepared.source_arena.as_ref().expect("canonical arena");
    let paragraph_id = arena
        .find_element_by_id("target")
        .expect("paragraph source id");
    let DocumentNode::Block(paragraph) = &prepared.parsed.nodes[0] else {
        panic!("expected paragraph");
    };
    assert_eq!(paragraph.source_ref.source_node_id, Some(paragraph_id));

    let cloned = prepared.clone();
    assert!(Arc::ptr_eq(
        arena,
        cloned.source_arena.as_ref().expect("cloned arena")
    ));
}

#[test]
fn undeclared_entity_chapter_parses_with_the_reference_rendered_literally() {
    let prepared = parse_loaded_chapter_source(&chapter(
        "<html><body><p>&not-a-declared-entity;</p></body></html>",
    ));

    assert!(prepared.source_arena.is_some());
    assert!(!prepared.parsed.nodes.is_empty());
    assert!(prepared.parsed.warnings.is_empty());
}

#[test]
fn unparseable_chapter_still_degrades_to_the_warning_fallback() {
    // An unterminated tag (no closing `>`) is beyond both
    // character-level repair and the tag-pairing recovery (unclosed
    // ELEMENTS now close implicitly, the way a browser recovers).
    let prepared =
        parse_loaded_chapter_source(&chapter("<html><body><p>a <b broken</p></body></html>"));

    assert!(prepared.source_arena.is_none());
    assert!(prepared.parsed.nodes.is_empty());
    assert_eq!(prepared.parsed.warnings.len(), 1);
}

#[test]
fn the_publication_stylesheet_resolves_into_typed_tables() {
    let before = style_backend_metrics();
    let document = document_with_stylesheet(
        "styles/main.css",
        "@page { margin: 0; } p { color: red; border: currentColor inset 1px; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>styled</p></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let paragraph = resolved.inline_for_tag(&chapter, "p");
    assert_eq!(color(paragraph.paint.foreground), "#ff0000");
    assert!(is_transparent(paragraph.paint.background, paragraph));
    let top = paragraph.fragment.border.top;
    assert_eq!(top.resolved_width.get(), 1.0);
    assert_eq!(top.color, ComputedColor::CurrentColor);
    assert!(style_backend_metrics().stylo_successes > before.stylo_successes);
}

#[test]
fn stylo_medium_border_keeps_the_browser_compatible_three_pixel_width() {
    let document = document_with_stylesheet(
        "styles/main.css",
        ".cutline { border-top: medium double black; border-bottom: medium double black; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><div class="cutline">content</div></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let cutline = resolved.inline_for_tag(&chapter, "div");
    assert_eq!(cutline.fragment.border.top.resolved_width.get(), 3.0);
    assert_eq!(cutline.fragment.border.bottom.resolved_width.get(), 3.0);
}

#[test]
fn unrepresentable_declarations_leave_the_representable_ones_intact() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "p { color: navy; background: #cceead; background-attachment: fixed; \
             border-collapse: collapse; border-spacing: 0; duokan-bleed: leftright; \
             duokan-text-indent: -2em; -webkit-transform: rotate(5deg); \
             text-emphasis: circle #000; page-break-inside: avoid; } \
         ol { list-style: none; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>text</p><ol><li>item</li></ol></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let paragraph = resolved.inline_for_tag(&chapter, "p");
    assert_eq!(color(paragraph.paint.foreground), "#000080");
    assert_eq!(
        color(
            paragraph
                .paint
                .background
                .resolve(paragraph.paint.foreground)
        ),
        "#cceead"
    );
    let list = resolved.layout_for_tag(&chapter, "ol");
    assert_eq!(
        list.list_style_type,
        rito_style_contract::ListMarkerStyle::None
    );
}

#[test]
fn clear_and_max_width_project_into_the_typed_layout_style() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "p { clear: both; max-width: 80%; color: green; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>text</p></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let paragraph = resolved.layout_for_tag(&chapter, "p");
    assert_eq!(paragraph.clear, Clear::Both);
    let MaximumSize::Value(max_width) = paragraph.max_width else {
        panic!("max-width projects a value: {:?}", paragraph.max_width);
    };
    let LengthPercentage::Percentage(percentage) = max_width.value() else {
        panic!("max-width keeps its percentage: {:?}", max_width.value());
    };
    assert_eq!(percentage.percent(), 80.0);
}

#[test]
fn height_float_and_overflow_project_into_the_typed_layout_style() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "p { min-height: 12px; max-height: 100%; float: right; overflow: hidden; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>text</p></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let paragraph = resolved.layout_for_tag(&chapter, "p");
    let MinimumHeight::Length(min_height) = paragraph.min_height else {
        panic!("min-height keeps its length: {:?}", paragraph.min_height);
    };
    assert_eq!(min_height.get(), 12.0);
    let MaximumHeight::Percentage(max_height) = paragraph.max_height else {
        panic!(
            "max-height keeps its percentage: {:?}",
            paragraph.max_height
        );
    };
    assert_eq!(max_height.percent(), 100.0);
    assert_eq!(paragraph.float, Float::Right);
    assert_eq!(paragraph.overflow, Overflow::Hidden);
}

#[test]
fn only_column_breaks_force_a_break_in_the_reader_column_context() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "#standard { break-before: column; page-break-after: always; } \
         #legacy { page-break-before: always; break-after: column; } \
         #inline { break-before: auto; break-after: auto; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body>
            <p id="standard">standard</p><p id="legacy">legacy</p>
            <p id="inline" style="break-before: column; break-after: column">inline</p>
        </body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    // Only the `column` keyword forces a break in the reader's column
    // context; page/always aliases are ignored like Chromium's
    // continuous multicol ignores them.
    let standard = resolved.layout_for_id(&chapter, "standard");
    assert_eq!(standard.break_before, PageBreak::Always);
    assert_eq!(standard.break_after, PageBreak::Auto);
    let legacy = resolved.layout_for_id(&chapter, "legacy");
    assert_eq!(legacy.break_before, PageBreak::Auto);
    assert_eq!(legacy.break_after, PageBreak::Always);
    let inline = resolved.layout_for_id(&chapter, "inline");
    assert_eq!(inline.break_before, PageBreak::Always);
    assert_eq!(inline.break_after, PageBreak::Always);
}

#[test]
fn background_url_cluster_resolves_against_the_stylesheet_base() {
    let document = document_with_stylesheet(
        "Styles/main.css",
        ".card { background-image: url(../Images/paper.png); \
         background-repeat: no-repeat; background-position: top center; \
         background-size: cover; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "Text/chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="../Styles/main.css" /></head><body><div class="card">text</div></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let card = resolved.inline_for_tag(&chapter, "div");
    let image = card
        .paint
        .background_image
        .as_ref()
        .expect("the card keeps its background image");
    assert_eq!(
        crate::style::background_publication_href(image.url.as_str()),
        Ok("Images/paper.png")
    );
    assert_eq!(
        crate::style::background_repeat(image.repeat),
        crate::render::contract::ReaderBackgroundRepeat::NoRepeat
    );
    assert_eq!(
        crate::style::background_size(image.size),
        crate::render::contract::ReaderBackgroundSize::Cover
    );
    let LengthPercentage::Percentage(x) = image.position.x else {
        panic!("`center` keeps its percentage: {:?}", image.position.x);
    };
    let LengthPercentage::Percentage(y) = image.position.y else {
        panic!("`top` keeps its percentage: {:?}", image.position.y);
    };
    assert_eq!((x.percent(), y.percent()), (50.0, 0.0));
}

#[test]
fn rotate_transforms_project_as_exact_radians() {
    let document =
        document_with_stylesheet("styles/main.css", ".badge { transform: rotate(-8deg); }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><span class="badge">text</span></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let badge = resolved.inline_for_tag(&chapter, "span");
    let [TransformOperation::Rotate { radians }] = badge.paint.transform.as_slice() else {
        panic!("one rotation projects: {:?}", badge.paint.transform);
    };
    assert!((f64::from(radians.get()) - (-8.0_f64).to_radians()).abs() < 1.0e-6);
}

#[test]
fn unsupported_background_values_drop_the_background_image() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "p { background-image: linear-gradient(red, blue); }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>fallback</p></body></html>"#,
    ));

    // Gradients have no paint slot: the projection leaves the paragraph
    // without an inline style of its own (the bridge inherits for it)
    // instead of refusing the chapter.
    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let paragraph = node_index_for_tag(&chapter, "p");
    assert!(matches!(
        resolved.inline.style_for_node(paragraph),
        Err(rito_style_contract::StyleTableError::MissingNodeStyle { .. })
    ));
}

#[test]
fn body_background_resolves_into_the_typed_body_style() {
    let document = document_with_stylesheet(
        "Styles/main.css",
        "body { background-color: #123456; background-image: url(../Images/page.png); \
         background-repeat: no-repeat; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "Text/chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="../Styles/main.css" /></head><body><p>page background</p></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let body = resolved.inline_for_tag(&chapter, "body");
    assert_eq!(
        color(body.paint.background.resolve(body.paint.foreground)),
        "#123456"
    );
    let image = body
        .paint
        .background_image
        .as_ref()
        .expect("the body keeps its background image");
    assert_eq!(
        crate::style::background_publication_href(image.url.as_str()),
        Ok("Images/page.png")
    );
}

#[test]
fn body_bgcolor_applies_as_a_presentational_hint() {
    let document = document_with_stylesheet("styles/main.css", "p { color: navy; }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r##"<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="styles/main.css" /></head><body bgcolor="#fff"><p>page background</p></body></html>"##,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let body = resolved.inline_for_tag(&chapter, "body");
    assert_eq!(
        color(body.paint.background.resolve(body.paint.foreground)),
        "#ffffff"
    );
}

#[test]
fn opacity_projects_into_the_typed_paint_style() {
    let document = document_with_stylesheet("styles/main.css", "p { opacity: 0.25; }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p>quarter opacity</p></body></html>"#,
    ));

    let resolved = resolve(&base.stylesheet_ledger, &chapter);
    let paragraph = resolved.inline_for_tag(&chapter, "p");
    assert_eq!(paragraph.paint.opacity.get(), 0.25);
}

#[test]
fn configured_root_font_size_is_the_initial_em_and_computed_rem_basis() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "html { font-size: 2em; } #target { font-size: 1rem; margin-left: 1rem; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p id="target">text</p></body></html>"#,
    ));
    let options = ChapterStyleOptions {
        root_font_size: 22.0,
        line_height_override: None,
        line_height_force: false,
        font_family_override: None,
        font_family_force: false,
    };

    let resolved = try_resolve_with_options(&base.stylesheet_ledger, &chapter, options).unwrap();
    let target = resolved.inline_for_id(&chapter, "target");
    assert_eq!(target.font.size.get(), 44.0);
    let layout = resolved.layout_for_id(&chapter, "target");
    let rito_style_contract::LengthPercentageOrAuto::Value(LengthPercentage::Length(margin_left)) =
        layout.margin.left
    else {
        panic!("margin-left resolves to a length: {:?}", layout.margin.left);
    };
    assert_eq!(margin_left.get(), 44.0);
}

#[test]
fn non_force_typography_overrides_body_then_allows_descendant_declarations() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "body { font-family: AuthorBody !important; line-height: 3 !important; } \
         #specific { font-family: \"Book Face\"; line-height: 2; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p id="inherited">one</p><p id="specific">two</p></body></html>"#,
    ));
    let options = ChapterStyleOptions {
        root_font_size: 16.0,
        line_height_override: Some(1.6),
        line_height_force: false,
        font_family_override: Some("Georgia, serif"),
        font_family_force: false,
    };

    let resolved = try_resolve_with_options(&base.stylesheet_ledger, &chapter, options).unwrap();
    let inherited = resolved.inline_for_id(&chapter, "inherited");
    let specific = resolved.inline_for_id(&chapter, "specific");
    assert_eq!(families(inherited), "Georgia, serif");
    assert_eq!(line_height_number(inherited), 1.6);
    assert_eq!(families(specific), "\"Book Face\"");
    assert_eq!(line_height_number(specific), 2.0);
}

#[test]
fn force_typography_still_overwrites_descendant_declarations() {
    let document = document_with_stylesheet(
        "styles/main.css",
        "#target { font-family: \"Book Face\"; line-height: 2; }",
    );
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter_with_href(
        "chapter-1.xhtml",
        r#"<html><head><link rel="stylesheet" href="styles/main.css" /></head><body><p id="target">text</p></body></html>"#,
    ));
    let options = ChapterStyleOptions {
        root_font_size: 16.0,
        line_height_override: Some(1.4),
        line_height_force: true,
        font_family_override: Some("Georgia, serif"),
        font_family_force: true,
    };

    let resolved = try_resolve_with_options(&base.stylesheet_ledger, &chapter, options).unwrap();
    let target = resolved.inline_for_id(&chapter, "target");
    assert_eq!(families(target), "Georgia, serif");
    assert_eq!(line_height_number(target), 1.4);
}

#[test]
fn invalid_font_family_override_is_rejected_before_stylesheet_injection() {
    let document = document_with_stylesheet("styles/main.css", "p { color: red; }");
    let base = prepare_loaded_document_base(&document);
    let chapter = parse_loaded_chapter_source(&chapter(
        r#"<html><body><p id="target">text</p></body></html>"#,
    ));
    let options = ChapterStyleOptions {
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: false,
        font_family_override: Some("Georgia; color: lime"),
        font_family_force: false,
    };

    let error = try_resolve_with_options(&base.stylesheet_ledger, &chapter, options)
        .expect_err("declaration injection must fail closed");
    assert!(error.to_string().contains("valid CSS font-family list"));
}

#[derive(Debug)]
struct Resolved {
    layout: rito_style_contract::LayoutStyleTable,
    inline: rito_style_contract::InlineStyleTable,
}

impl Resolved {
    fn inline_for_id(
        &self,
        chapter: &ParsedLoadedChapterSource,
        id: &str,
    ) -> &InlineFormattingStyle {
        self.inline
            .style_for_node(node_index_for_id(chapter, id))
            .expect("the node resolved an inline style")
    }

    fn layout_for_id(
        &self,
        chapter: &ParsedLoadedChapterSource,
        id: &str,
    ) -> &LayoutFormattingStyle {
        self.layout
            .style_for_node(node_index_for_id(chapter, id))
            .expect("the node resolved a layout style")
    }

    fn inline_for_tag(
        &self,
        chapter: &ParsedLoadedChapterSource,
        tag: &str,
    ) -> &InlineFormattingStyle {
        self.inline
            .style_for_node(node_index_for_tag(chapter, tag))
            .expect("the element resolved an inline style")
    }

    fn layout_for_tag(
        &self,
        chapter: &ParsedLoadedChapterSource,
        tag: &str,
    ) -> &LayoutFormattingStyle {
        self.layout
            .style_for_node(node_index_for_tag(chapter, tag))
            .expect("the element resolved a layout style")
    }
}

fn node_index_for_id(chapter: &ParsedLoadedChapterSource, id: &str) -> usize {
    chapter
        .source_arena
        .as_ref()
        .expect("canonical arena")
        .find_element_by_id(id)
        .expect("an element with the id")
        .index()
}

fn node_index_for_tag(chapter: &ParsedLoadedChapterSource, tag: &str) -> usize {
    chapter
        .source_arena
        .as_ref()
        .expect("canonical arena")
        .iter()
        .find_map(|(node_id, node)| {
            node.as_element()
                .filter(|element| element.name.local_name == tag)
                .map(|_| node_id.index())
        })
        .expect("an element with the tag")
}

fn color(value: rito_style_contract::AbsoluteColor) -> String {
    crate::render::test_support::color_css(paint_color(value).expect("an sRGB colour"))
}

fn is_transparent(value: ComputedColor, style: &InlineFormattingStyle) -> bool {
    value.resolve(style.paint.foreground).alpha().get() == 0.0
}

fn families(style: &InlineFormattingStyle) -> String {
    serialize_font_families(&style.font).expect("a font-family list")
}

fn line_height_number(style: &InlineFormattingStyle) -> f32 {
    let LineHeight::Number(number) = style.font.line_height else {
        panic!("a unitless line-height: {:?}", style.font.line_height);
    };
    number.get()
}

fn resolve(
    stylesheet_ledger: &StylesheetSourceLedger,
    chapter: &ParsedLoadedChapterSource,
) -> Resolved {
    try_resolve_with_options(
        stylesheet_ledger,
        chapter,
        ChapterStyleOptions {
            root_font_size: 16.0,
            line_height_override: None,
            line_height_force: false,
            font_family_override: None,
            font_family_force: false,
        },
    )
    .expect("supported Stylo chapter resolves")
}

fn try_resolve_with_options(
    stylesheet_ledger: &StylesheetSourceLedger,
    chapter: &ParsedLoadedChapterSource,
    options: ChapterStyleOptions<'_>,
) -> Result<Resolved, StyleBackendError> {
    resolve_prepared_chapter_style(
        PreparedStyleChapterInput {
            stylesheet_ledger,
            chapter_href: &chapter.source.href,
            source_arena: chapter.source_arena.as_ref(),
            body_source_node_id: chapter.parsed.body_source_node_id,
            author_stylesheets: &chapter.parsed.author_stylesheets,
        },
        Some(CssViewport::new(800.0, 600.0)),
        options,
    )
    .map(|resolved| Resolved {
        layout: resolved.layout_style_table,
        inline: resolved.inline_style_table,
    })
}

fn chapter(xhtml_source: &str) -> LoadedChapter {
    chapter_with_href("chapter-1.xhtml", xhtml_source)
}

fn chapter_with_href(href: &str, xhtml_source: &str) -> LoadedChapter {
    LoadedChapter {
        idref: "chapter-1".to_owned(),
        href: href.to_owned(),
        linear: true,
        xhtml_source: xhtml_source.to_owned(),
        source_loaded: true,
        image_refs: None,
    }
}

fn document_with_stylesheet(href: &str, text: &str) -> LoadedEpubDocument {
    LoadedEpubDocument {
        package: PackageDocument {
            metadata: PackageMetadata {
                title: "Prepared".to_owned(),
                language: "en".to_owned(),
                identifier: "prepared-test".to_owned(),
                creator: None,
            },
            manifest: Vec::new(),
            spine: Vec::new(),
            toc: Vec::new(),
        },
        stylesheets: vec![LoadedTextResource {
            href: href.to_owned(),
            text: text.to_owned(),
        }],
        fonts: Vec::new(),
        images: Vec::new(),
        chapters: Vec::new(),
        archive_source: None,
    }
}
