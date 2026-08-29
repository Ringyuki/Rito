use std::io::{Cursor, Write};

use zip::{write::FileOptions, ZipWriter};

use crate::layout::{
    create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
};

mod footnotes;

pub use footnotes::{cross_chapter_footnote_fixture_epub, missing_future_chapter_fixture_epub};

pub fn layout() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 420.0,
        height: 640.0,
        margin: MarginInput::All(24.0),
        spread: SpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}

pub fn double_layout() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 900.0,
        height: 640.0,
        margin: MarginInput::All(24.0),
        spread: SpreadMode::Double,
        first_page_alone: true,
        spread_gap: 20.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}

pub fn fixture_epub() -> Vec<u8> {
    fixture_epub_with_stylesheet(fixture_stylesheet())
}

pub fn interaction_target_fixture_epub() -> Vec<u8> {
    fixture_epub_with_chapter_and_stylesheet(
        br##"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head></head><body><p id="intro"><a href="#intro">internal</a><a href="">current</a><a href="https://example.com/help#reader">external</a><a epub:type="noteref" href="#fn1">note</a><a href="#intro"><img src="Images/cover.png" alt="linked cover"/></a></p><img src="Images/cover.png" alt="standalone cover"/><aside epub:type="footnote" id="fn1"><p>Runtime note</p></aside></body></html>"##,
        fixture_stylesheet(),
    )
}

pub fn source_locator_fixture_epub() -> Vec<u8> {
    source_locator_fixture_epub_with_prefix("")
}

pub fn source_locator_image_fixture_epub() -> Vec<u8> {
    source_locator_fixture_epub_with_prefix(r#"<img src="Images/cover.png" alt="fixture cover"/>"#)
}

fn source_locator_fixture_epub_with_prefix(prefix: &str) -> Vec<u8> {
    let paragraphs = (0..48)
        .map(|index| {
            let content_prefix = if index == 0 { prefix } else { "" };
            format!(
                r#"<p id="point-{index}">{content_prefix}Source locator paragraph {index} has enough text to wrap across several lines in a narrow reader viewport.</p>"#
            )
        })
        .collect::<String>();
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>{paragraphs}</body></html>"#
    );
    fixture_epub_with_chapter(chapter.as_bytes())
}

pub fn long_source_text_fixture_epub() -> Vec<u8> {
    let text = "Portable reading anchor text with stable source ownership. ".repeat(160);
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>{text}</p></body></html>"#
    );
    fixture_epub_with_chapter(chapter.as_bytes())
}

pub fn long_chapter_window_fixture_epub() -> Vec<u8> {
    let paragraphs = (0..520)
        .map(|index| {
            format!(
                r#"<p id="window-point-{index}">Window paragraph {index:03} carries stable source text across bounded reader revision rollovers and adjacent navigation.</p>"#
            )
        })
        .collect::<String>();
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>{paragraphs}</body></html>"#
    );
    fixture_epub_with_chapter(chapter.as_bytes())
}

pub fn nested_transparent_container_fixture_epub() -> Vec<u8> {
    let paragraphs = (0..96)
        .map(|index| {
            format!("<p>Nested container paragraph {index} carries stable runtime content.</p>")
        })
        .collect::<String>();
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><section><div>{paragraphs}</div></section></body></html>"#
    );
    fixture_epub_with_chapter(chapter.as_bytes())
}

pub fn image_only_fixture_epub() -> Vec<u8> {
    fixture_epub_with_chapter(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><img src="Images/cover.png" alt="cover"/></body></html>"#,
    )
}

/// One chapter whose three full-page plates precede its only paragraph:
/// each text-free page must own a reading anchor that resolves back to
/// itself, not to the page that happens to hold the chapter's text.
pub fn image_plates_before_text_fixture_epub() -> Vec<u8> {
    fixture_epub_with_chapter(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><img src="Images/cover.png" alt="plate one" style="height: 580px"/><img src="Images/cover.png" alt="plate two" style="height: 580px"/><img src="Images/cover.png" alt="plate three" style="height: 580px"/><p>plate captions arrive after the plates</p></body></html>"#,
    )
}

pub fn fixture_epub_with_stylesheet(stylesheet: &str) -> Vec<u8> {
    fixture_epub_with_chapter_and_stylesheet(
        br##"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><link rel="stylesheet" href="style.css"/></head><body><p id="intro">Hello runtime<a epub:type="noteref" href="#fn1">1</a></p><aside epub:type="footnote" id="fn1"><p>Runtime note</p></aside><img src="Images/cover.png" alt="cover"/></body></html>"##,
        stylesheet,
    )
}

pub fn malformed_chapter_fixture_epub() -> Vec<u8> {
    fixture_epub_with_chapter(br#"<html><body><p>broken</body></html>"#)
}

pub fn empty_chapter_fixture_epub() -> Vec<u8> {
    fixture_epub_with_chapter(br#"<html><body></body></html>"#)
}

pub fn search_source_gap_fixture_epub() -> Vec<u8> {
    fixture_epub_with_chapter(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>visible<span style="display: none">hidden</span>match</p></body></html>"#,
    )
}

fn fixture_epub_with_chapter(chapter: &[u8]) -> Vec<u8> {
    fixture_epub_with_chapter_and_stylesheet(chapter, fixture_stylesheet())
}

pub fn fixture_epub_with_chapter_and_stylesheet(chapter: &[u8], stylesheet: &str) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
<rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/package.opf",
        br#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Runtime document</dc:title>
<dc:language>en</dc:language>
<dc:identifier id="id">runtime</dc:identifier>
  </metadata>
  <manifest>
<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
<item id="style" href="style.css" media-type="text/css"/>
<item id="font" href="Fonts/book.otf" media-type="font/otf"/>
<item id="cover" href="Images/cover.png" media-type="image/png"/>
  </manifest>
  <spine>
<itemref idref="chapter"/>
  </spine>
</package>"#,
    );
    add_file(&mut writer, options, "OPS/style.css", stylesheet.as_bytes());
    add_file(&mut writer, options, "OPS/Fonts/book.otf", b"font-bytes");
    add_file(&mut writer, options, "OPS/Images/cover.png", &minimal_png());
    add_file(&mut writer, options, "OPS/chapter.xhtml", chapter);

    writer.finish().expect("zip finalizes").into_inner()
}

pub fn multi_chapter_fixture_epub() -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
<rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/package.opf",
        br#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Runtime document</dc:title>
<dc:language>en</dc:language>
<dc:identifier id="id">runtime</dc:identifier>
  </metadata>
  <manifest>
<item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
<item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
<item id="chapter-3" href="chapter-3.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
<itemref idref="chapter-1"/>
<itemref idref="chapter-2"/>
<itemref idref="chapter-3"/>
  </spine>
</package>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-1.xhtml",
        br##"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p><a href="chapter-2.xhtml#target">chapter one</a></p></body></html>"##,
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-2.xhtml",
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p id="target">chapter two active window</p></body></html>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-3.xhtml",
        chapter_fixture_xhtml("chapter three").as_bytes(),
    );
    add_file(
        &mut writer,
        options,
        "OPS/nav.xhtml",
        br##"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">One</a></li><li><a href="chapter-2.xhtml">Two</a><ol><li><a href="chapter-2.xhtml#missing">Missing</a></li></ol></li><li><a href="chapter-3.xhtml">Three</a></li></ol></nav></body></html>"##,
    );
    writer.finish().expect("zip finalizes").into_inner()
}

pub fn multi_chapter_image_fixture_epub() -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/package.opf",
        br#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Lazy image dimensions</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="id">lazy-image</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="late-image" href="Images/late.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
    <itemref idref="chapter-2"/>
  </spine>
</package>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-1.xhtml",
        chapter_fixture_xhtml("chapter one initializes the prepared base").as_bytes(),
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-2.xhtml",
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="Images/late.png" alt="late"/><p>chapter two follows the image</p></body></html>"#,
    );
    add_file(&mut writer, options, "OPS/Images/late.png", &minimal_png());
    writer.finish().expect("zip finalizes").into_inner()
}

/// Two structurally identical chapters whose paragraph styles differ only
/// in font size, so each chapter's style table interns the paragraph at
/// the SAME numeric id. A `line-height: normal` strut cached under a
/// style-table id (instead of the font inputs) would serve chapter one's
/// 32px strut to chapter two's 16px paragraphs on a shared engine.
pub fn strut_collision_fixture_epub() -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
<rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/package.opf",
        br#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Strut collision</dc:title>
<dc:language>en</dc:language>
<dc:identifier id="id">strut-collision</dc:identifier>
  </metadata>
  <manifest>
<item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
<item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
<itemref idref="chapter-1"/>
<itemref idref="chapter-2"/>
  </spine>
</package>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-1.xhtml",
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p style="font-size: 32px">big strut chapter</p><p style="font-size: 32px">second big paragraph</p></body></html>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-2.xhtml",
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p style="font-size: 16px">first plain paragraph</p><p style="font-size: 16px">second plain paragraph</p></body></html>"#,
    );
    writer.finish().expect("zip finalizes").into_inner()
}

pub fn many_chapter_fixture_epub(chapter_count: usize) -> Vec<u8> {
    many_chapter_fixture_epub_with(chapter_count, |index| {
        chapter_fixture_xhtml(&format!("chapter {index}"))
    })
}

pub fn many_empty_chapter_fixture_epub(chapter_count: usize) -> Vec<u8> {
    many_chapter_fixture_epub_with(chapter_count, |_| {
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><body></body></html>"#.to_owned()
    })
}

pub fn retained_adjacent_fixture_epub() -> Vec<u8> {
    many_chapter_fixture_epub_with(2, |index| {
        if index == 0 {
            let paragraphs = (0..96)
                .map(|paragraph| {
                    format!(
                        "<p>Retained adjacent paragraph {paragraph} must be laid out before the previous-chapter tail is published.</p>"
                    )
                })
                .collect::<String>();
            format!(
                r#"<html xmlns="http://www.w3.org/1999/xhtml"><body>{paragraphs}</body></html>"#
            )
        } else {
            chapter_fixture_xhtml("adjacent source chapter")
        }
    })
}

fn many_chapter_fixture_epub_with(
    chapter_count: usize,
    chapter_xhtml: impl Fn(usize) -> String,
) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    );
    let manifest = (0..chapter_count)
        .map(|index| {
            format!(
                r#"<item id="chapter-{index}" href="chapter-{index}.xhtml" media-type="application/xhtml+xml"/>"#
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let spine = (0..chapter_count)
        .map(|index| format!(r#"<itemref idref="chapter-{index}"/>"#))
        .collect::<Vec<_>>()
        .join("\n");
    let package = format!(
        r#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Many chapters</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="id">many-chapters</dc:identifier>
  </metadata>
  <manifest>{manifest}</manifest>
  <spine>{spine}</spine>
</package>"#
    );
    add_file(&mut writer, options, "OPS/package.opf", package.as_bytes());
    for index in 0..chapter_count {
        let path = format!("OPS/chapter-{index}.xhtml");
        let chapter = chapter_xhtml(index);
        add_file(&mut writer, options, &path, chapter.as_bytes());
    }
    writer.finish().expect("zip finalizes").into_inner()
}

pub fn minimal_png() -> Vec<u8> {
    let mut bytes = vec![0u8; 33];
    bytes[0..8].copy_from_slice(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes[12..16].copy_from_slice(b"IHDR");
    bytes[16..20].copy_from_slice(&2u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&3u32.to_be_bytes());
    bytes
}

pub fn fixture_stylesheet() -> &'static str {
    r#"@font-face { font-family: "Fixture"; src: url("Fonts/book.otf"); font-style: italic; font-weight: 700; }
p { color: #333; }"#
}

fn chapter_fixture_xhtml(text: &str) -> String {
    format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>{text}</p></body></html>"#
    )
}

pub(super) fn add_file(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: FileOptions<'_, ()>,
    path: &str,
    bytes: &[u8],
) {
    writer.start_file(path, options).expect("file starts");
    writer.write_all(bytes).expect("file writes");
}

/// Two-chapter book whose first chapter is tiny enough to complete
/// inside a single bounded quantum, in three tail shapes that exercise
/// the previous-chapter-tail (progression 1.0) projection.
pub fn short_previous_chapter_fixture_epub(tail: &str) -> Vec<u8> {
    let chapter_zero = match tail {
        "text" => r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>short chapter</p></body></html>"#.to_owned(),
        "trailing-image" => r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>short chapter</p><img src="missing.png" alt="tail image"/></body></html>"#.to_owned(),
        "image-only" => r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="missing.png" alt="only image"/></body></html>"#.to_owned(),
        "hidden-tail" => r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>short chapter</p><p style="display:none">hidden colophon text</p></body></html>"#.to_owned(),
        "ruby-tail" => r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>tail is <ruby>ruby<rt>annotated</rt></ruby></p></body></html>"#.to_owned(),
        "svg-image" => r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><image href="missing.png" width="100" height="150"/></svg></body></html>"#.to_owned(),
        "empty-tail" => r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>short chapter</p><p>&#160;</p><div></div></body></html>"#.to_owned(),
        other => panic!("unknown tail shape: {other}"),
    };
    many_chapter_fixture_epub_with(2, move |index| {
        if index == 0 {
            chapter_zero.clone()
        } else {
            chapter_fixture_xhtml("adjacent source chapter")
        }
    })
}

/// Three-chapter book whose middle spine item is an image-only plate,
/// exercising publication turns across text-free spreads.
pub fn image_plate_fixture_epub() -> Vec<u8> {
    many_chapter_fixture_epub_with(3, |index| {
        if index == 1 {
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="missing.png" alt="plate"/></body></html>"#.to_owned()
        } else {
            chapter_fixture_xhtml(&format!("plate neighbor chapter {index}"))
        }
    })
}

/// Pinned-face policy for tests that exercise the fragment engine
/// (chapter-local pagination requires pinned faces).
pub fn pinned_test_font_policy() -> crate::runtime::RuntimePinnedFontPolicyInput {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
    );
    let bytes = std::fs::read(path).expect("pinned Tinos test font reads");
    crate::runtime::RuntimePinnedFontPolicyInput {
        faces: vec![crate::runtime::RuntimePinnedFontFaceInput {
            expected_sha256: {
                use sha2::{Digest, Sha256};
                format!("{:x}", Sha256::digest(&bytes))
            },
            bytes,
            generic_role: crate::runtime::RuntimePinnedFontGenericRole::Serif,
            language: None,
        }],
    }
}

/// One chapter exercising the breadth of the paint-command domain
/// (border styles per edge, radius, shadows, hr, lists, table, ruby,
/// inline decoration, image): every page must survive the reader-v1
/// display-list encoding, or a styled real book kills the session.
pub fn paint_command_kitchen_sink_fixture_epub() -> Vec<u8> {
    let chapter = r##"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body style="background-image:url('Images/cover.png');background-repeat:no-repeat;background-position:center bottom;background-size:auto 40%">
<div style="background-image:url('Images/cover.png');background-size:100% 100%;height:40px">explicit background size box</div>
<div style="background-image:url('Images/cover.png');background-size:cover;height:24px">cover background box</div>
<p style="border: 2px dashed #cc0000; border-radius: 6px; background: #eef; padding: 4px">boxed paragraph with a dashed border and radius</p>
<hr/>
<p style="border-top: 3px double #007700; border-left: 1px dotted #333333; border-bottom: 2px solid #000066">mixed border edges</p>
<ul><li>unordered item one</li><li>unordered item two</li></ul>
<ol><li>ordered item one</li><li>ordered item two</li></ol>
<table><tr><td style="border: 1px solid #000000">cell one</td><td style="border: 1px dashed #444444">cell two</td></tr></table>
<p><ruby>漢字<rt>kanji</rt></ruby> with ruby annotation</p>
<p><span style="text-decoration: underline">under</span> and <span style="text-decoration: line-through">struck</span> inline decoration</p>
<blockquote style="border-left: 4px solid #cccccc; box-shadow: 1px 1px 2px #999999">a quoted block with a shadow</blockquote>
<p><img src="Images/cover.png" alt="inline image"/> paragraph with an image</p>
<p style="border: 1px solid currentColor">currentColor border</p>
</body></html>"##;
    fixture_epub_with_chapter(chapter.as_bytes())
}
