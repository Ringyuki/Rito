use std::io::{Cursor, Write};

use zip::{write::FileOptions, ZipWriter};

use crate::layout::{
    create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
};

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
    fixture_epub_with_chapter(
        br##"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><link rel="stylesheet" href="style.css"/></head><body><p id="intro">Hello runtime<a epub:type="noteref" href="#fn1">1</a></p><aside epub:type="footnote" id="fn1"><p>Runtime note</p></aside><img src="Images/cover.png" alt="cover"/></body></html>"##,
    )
}

pub fn malformed_chapter_fixture_epub() -> Vec<u8> {
    fixture_epub_with_chapter(br#"<html><body><p>broken</body></html>"#)
}

fn fixture_epub_with_chapter(chapter: &[u8]) -> Vec<u8> {
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
    add_file(
        &mut writer,
        options,
        "OPS/style.css",
        fixture_stylesheet().as_bytes(),
    );
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
        chapter_fixture_xhtml("chapter one").as_bytes(),
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-2.xhtml",
        chapter_fixture_xhtml("chapter two active window").as_bytes(),
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

pub fn many_chapter_fixture_epub(chapter_count: usize) -> Vec<u8> {
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
        let text = format!("chapter {index}");
        add_file(
            &mut writer,
            options,
            &path,
            chapter_fixture_xhtml(&text).as_bytes(),
        );
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

fn add_file(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: FileOptions<'_, ()>,
    path: &str,
    bytes: &[u8],
) {
    writer.start_file(path, options).expect("file starts");
    writer.write_all(bytes).expect("file writes");
}
