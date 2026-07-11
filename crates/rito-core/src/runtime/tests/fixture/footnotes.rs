use std::io::Cursor;

use zip::{write::FileOptions, ZipWriter};

use super::{add_file, minimal_png};

pub fn cross_chapter_footnote_fixture_epub() -> Vec<u8> {
    build_cross_chapter_footnote_epub(true)
}

pub fn missing_future_chapter_fixture_epub() -> Vec<u8> {
    build_cross_chapter_footnote_epub(false)
}

fn build_cross_chapter_footnote_epub(include_second_chapter: bool) -> Vec<u8> {
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
    <dc:title>Cross chapter footnotes</dc:title><dc:language>en</dc:language>
    <dc:identifier id="id">cross-footnotes</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-3" href="chapter-3.xhtml" media-type="application/xhtml+xml"/>
    <item id="font" href="Fonts/book.otf" media-type="font/otf"/>
    <item id="image" href="Images/late.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/><itemref idref="chapter-3"/></spine>
</package>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter-1.xhtml",
        br##"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><section>
<p>Chapter one <a epub:type="noteref" href="chapter-2.xhtml#%66orward">forward marker</a></p>
<aside epub:type="footnote" id="back"><p>Backward note body</p></aside>
<aside epub:type="footnote" id="unused"><p>Unreferenced note stays visible</p></aside>
</section></body></html>"##,
    );
    if include_second_chapter {
        add_file(
            &mut writer,
            options,
            "OPS/chapter-2.xhtml",
            br##"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><section>
<p>Chapter two <img src="Images/late.png" alt="late"/></p>
<aside epub:type="footnote" id="forward"><p>Forward note body</p></aside>
</section></body></html>"##,
        );
    }
    add_file(
        &mut writer,
        options,
        "OPS/chapter-3.xhtml",
        br##"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><section>
<p>Chapter three <a epub:type="noteref" href="chapter-1.xhtml#back">backward marker</a></p>
</section></body></html>"##,
    );
    add_file(&mut writer, options, "OPS/Fonts/book.otf", b"font-bytes");
    add_file(&mut writer, options, "OPS/Images/late.png", &minimal_png());
    writer.finish().expect("zip finalizes").into_inner()
}
