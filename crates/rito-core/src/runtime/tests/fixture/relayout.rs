use std::io::Cursor;

use zip::{write::FileOptions, ZipWriter};

use super::{add_file, minimal_png};

/// Three chapters built for laying one book out again and again at
/// different sizes and type settings: whatever the engine keeps between
/// layouts must never change what a layout paints.
///
/// - `latin.xhtml`: justified paragraphs long enough for several pages,
///   a floated image at the start of a paragraph whose sentence recurs
///   later with no float beside it, an image wider than any column, a
///   half-width image, an inline-block and a span with percentage
///   margins (both sized by the line's width), an inline-block of text
///   long enough to wrap at any width beside nothing else sized by it,
///   and a list.
/// - `cjk.xhtml`: Chinese paragraphs dense with punctuation the line ends
///   trim and pairs compress, and ruby.
/// - `viewport.xhtml`: a `vw` font size and paragraphs styled by
///   `@media` width queries that flip inside the widths the tests use
///   (the page content box is the CSS viewport).
pub fn relayout_fixture_epub() -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/package.opf",
        br#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Relayout</dc:title><dc:language>en</dc:language>
    <dc:identifier id="id">relayout</dc:identifier>
  </metadata>
  <manifest>
    <item id="latin" href="latin.xhtml" media-type="application/xhtml+xml"/>
    <item id="cjk" href="cjk.xhtml" media-type="application/xhtml+xml"/>
    <item id="viewport" href="viewport.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="float" href="Images/float.png" media-type="image/png"/>
    <item id="wide" href="Images/wide.png" media-type="image/png"/>
    <item id="plate" href="Images/plate.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="latin"/>
    <itemref idref="cjk"/>
    <itemref idref="viewport"/>
  </spine>
</package>"#,
    );
    add_file(&mut writer, options, "OPS/style.css", STYLESHEET.as_bytes());
    add_file(&mut writer, options, "OPS/Images/float.png", &png(96, 72));
    add_file(&mut writer, options, "OPS/Images/wide.png", &png(800, 200));
    add_file(&mut writer, options, "OPS/Images/plate.png", &png(300, 400));
    add_file(
        &mut writer,
        options,
        "OPS/latin.xhtml",
        latin_chapter().as_bytes(),
    );
    add_file(
        &mut writer,
        options,
        "OPS/cjk.xhtml",
        cjk_chapter().as_bytes(),
    );
    add_file(
        &mut writer,
        options,
        "OPS/viewport.xhtml",
        VIEWPORT_CHAPTER.as_bytes(),
    );
    writer.finish().expect("zip finalizes").into_inner()
}

const STYLESHEET: &str = r#"p { margin: 0 0 0.6em; text-align: justify; line-height: 1.5; }
h1 { font-size: 1.6em; margin: 0 0 0.8em; }
.float { float: left; width: 96px; height: 72px; margin: 0 10px 6px 0; }
.half { width: 50%; }
.ib { display: inline-block; padding: 2px 6px; border: 1px solid #444444; }
.pm { margin-left: 4%; margin-right: 4%; }
.vw { font-size: 3vw; }
@media (min-width: 340px) { .wide-only { font-size: 22px; color: #aa0000; } }
@media (max-width: 339px) { .narrow-only { letter-spacing: 1px; } }
"#;

const RECURRING: &str = "The same sentence is laid out twice in this chapter, once beside a floated image and once in the open, so a paragraph's layout can never be taken for the other's.";

fn latin_chapter() -> String {
    let filler = "Laying a book out again for every size of a window being dragged repeats work that does not depend on the width at all, while the lines and pages that do depend on it must come out exactly as a fresh layout would draw them.";
    let mut body = String::from("<h1>Relayout</h1>\n");
    body.push_str(&format!(
        "<p><img class=\"float\" src=\"Images/float.png\" alt=\"\"/>{RECURRING} {filler}</p>\n"
    ));
    for index in 0..10 {
        body.push_str(&format!("<p>Paragraph {index}. {filler} {filler}</p>\n"));
    }
    body.push_str("<p><img src=\"Images/wide.png\" alt=\"\"/></p>\n");
    body.push_str(&format!("<p>{RECURRING}</p>\n"));
    body.push_str("<p><img class=\"half\" src=\"Images/plate.png\" alt=\"\"/></p>\n");
    body.push_str(&format!(
        "<p>An <span class=\"ib\">inline block of text</span> rides the line and a <span class=\"pm\">span with percentage margins</span> widens by the line's width. {filler}</p>\n"
    ));
    body.push_str(&format!(
        "<p>{RECURRING} <span class=\"ib\">{filler} {filler}</span></p>\n"
    ));
    body.push_str("<ul><li>First item of a list</li><li>Second item of a list</li></ul>\n");
    for index in 10..16 {
        body.push_str(&format!("<p>Paragraph {index}. {filler}</p>\n"));
    }
    chapter("en", &body)
}

fn cjk_chapter() -> String {
    let filler = "「把书重新排一遍，」她说，「每拖动一下窗口，就要再排一遍。」宽度变了，行要重断；字形没有变，整形的结果不必重来。标点在行尾时会被挤压，成对的标点也会互相挤压——这些都要和浏览器一致！";
    let mut body = String::from("<h1>重排</h1>\n");
    for index in 0..8 {
        body.push_str(&format!("<p>第{index}段。{filler}{filler}</p>\n"));
    }
    body.push_str(&format!(
        "<p><ruby>漢字<rt>かんじ</rt></ruby>与<ruby>注音<rt>zhùyīn</rt></ruby>随行排布。{filler}</p>\n"
    ));
    for index in 8..12 {
        body.push_str(&format!("<p>第{index}段。{filler}</p>\n"));
    }
    chapter("zh-Hans", &body)
}

const VIEWPORT_CHAPTER: &str = r#"<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en"><head><link rel="stylesheet" type="text/css" href="style.css"/></head><body>
<p class="vw">A paragraph whose font size is three hundredths of the viewport width.</p>
<p class="wide-only">A paragraph styled only while the viewport is at least 340 pixels wide.</p>
<p class="narrow-only">A paragraph spaced out only while the viewport is narrower than 340 pixels.</p>
<p>A plain paragraph after them, whose place on the page follows theirs.</p>
</body></html>"#;

fn chapter(language: &str, body: &str) -> String {
    format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="{language}" lang="{language}"><head><link rel="stylesheet" type="text/css" href="style.css"/></head><body>
{body}</body></html>"#
    )
}

/// A PNG header claiming `width`×`height`: enough for the engine, which
/// sizes images by their header and never decodes them.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = minimal_png();
    bytes[16..20].copy_from_slice(&width.to_be_bytes());
    bytes[20..24].copy_from_slice(&height.to_be_bytes());
    bytes
}
