use std::borrow::Cow;

use roxmltree::{Document, Node};

use super::{
    archive::EpubArchive, join_epub_href, EpubResult, ManifestItem, PackageDocument, TocEntry,
};

const EPUB_OPS_NAMESPACE: &str = "http://www.idpf.org/2007/ops";
const NCX_MEDIA_TYPE: &str = "application/x-dtbncx+xml";

pub(super) fn load_toc(
    archive: &mut EpubArchive<'_>,
    package: &PackageDocument,
    opf_dir: &str,
) -> Vec<TocEntry> {
    if let Some(entries) = load_nav_toc(archive, &package.manifest, opf_dir) {
        if !entries.is_empty() {
            return entries;
        }
    }

    load_ncx_toc(archive, &package.manifest, opf_dir).unwrap_or_default()
}

fn load_nav_toc(
    archive: &mut EpubArchive<'_>,
    manifest: &[ManifestItem],
    opf_dir: &str,
) -> Option<Vec<TocEntry>> {
    let nav_item = manifest
        .iter()
        .find(|item| item.properties.iter().any(|property| property == "nav"))?;
    let path = join_epub_href(opf_dir, &nav_item.href);
    let xhtml = archive.read_text(&path).ok()?;
    parse_nav_document(&xhtml).ok()
}

fn load_ncx_toc(
    archive: &mut EpubArchive<'_>,
    manifest: &[ManifestItem],
    opf_dir: &str,
) -> Option<Vec<TocEntry>> {
    let ncx_item = manifest
        .iter()
        .find(|item| item.media_type == NCX_MEDIA_TYPE)?;
    let path = join_epub_href(opf_dir, &ncx_item.href);
    let xml = archive.read_text(&path).ok()?;
    parse_ncx(&xml).ok()
}

fn parse_nav_document(xhtml: &str) -> EpubResult<Vec<TocEntry>> {
    let source = strip_doctype(xhtml);
    let document = parse_toc_xml(source.as_ref())?;
    let Some(nav) = document
        .descendants()
        .find(|node| has_tag(node, "nav") && has_toc_type(*node))
    else {
        return Ok(Vec::new());
    };

    let Some(ol) = nav.descendants().find(|node| has_tag(node, "ol")) else {
        return Ok(Vec::new());
    };

    Ok(parse_ol_entries(ol))
}

fn parse_ncx(ncx_xml: &str) -> EpubResult<Vec<TocEntry>> {
    let source = strip_doctype(ncx_xml);
    let document = parse_toc_xml(source.as_ref())?;
    let Some(nav_map) = document.descendants().find(|node| has_tag(node, "navMap")) else {
        return Ok(Vec::new());
    };

    Ok(parse_nav_points(nav_map))
}

fn parse_ol_entries(ol: Node<'_, '_>) -> Vec<TocEntry> {
    ol.children()
        .filter(|node| has_tag(node, "li"))
        .filter_map(parse_li_entry)
        .collect()
}

fn parse_li_entry(li: Node<'_, '_>) -> Option<TocEntry> {
    let anchor = li.descendants().find(|node| has_tag(node, "a"))?;
    let label = node_text(anchor);
    if label.is_empty() {
        return None;
    }

    let href = anchor.attribute("href").unwrap_or_default().to_owned();
    let children = li
        .children()
        .find(|node| has_tag(node, "ol"))
        .map(parse_ol_entries)
        .unwrap_or_default();

    Some(TocEntry {
        label,
        href,
        children,
    })
}

fn parse_nav_points(parent: Node<'_, '_>) -> Vec<TocEntry> {
    parent
        .children()
        .filter(|node| has_tag(node, "navPoint"))
        .filter_map(parse_nav_point)
        .collect()
}

fn parse_nav_point(nav_point: Node<'_, '_>) -> Option<TocEntry> {
    let label = nav_point
        .descendants()
        .find(|node| has_tag(node, "navLabel"))
        .and_then(|nav_label| nav_label.descendants().find(|node| has_tag(node, "text")))
        .map(node_text)
        .unwrap_or_default();

    if label.is_empty() {
        return None;
    }

    let href = nav_point
        .descendants()
        .find(|node| has_tag(node, "content"))
        .and_then(|content| content.attribute("src"))
        .unwrap_or_default()
        .to_owned();

    Some(TocEntry {
        label,
        href,
        children: parse_nav_points(nav_point),
    })
}

fn parse_toc_xml(xml: &str) -> EpubResult<Document<'_>> {
    Document::parse(xml).map_err(|error| super::EpubError::new(format!("Invalid TOC XML: {error}")))
}

fn has_toc_type(node: Node<'_, '_>) -> bool {
    node.attributes().any(|attribute| {
        attribute.name() == "type"
            && attribute.value() == "toc"
            && (attribute.namespace().is_none()
                || attribute.namespace() == Some(EPUB_OPS_NAMESPACE))
    })
}

fn has_tag(node: &Node<'_, '_>, local_name: &str) -> bool {
    node.is_element() && node.tag_name().name() == local_name
}

fn node_text(node: Node<'_, '_>) -> String {
    node.descendants()
        .filter(Node::is_text)
        .filter_map(|descendant| descendant.text())
        .collect::<String>()
        .trim()
        .to_owned()
}

fn strip_doctype(xml: &str) -> Cow<'_, str> {
    let Some(start) = xml.find("<!DOCTYPE") else {
        return Cow::Borrowed(xml);
    };
    let tail = &xml[start..];
    let Some(end) = doctype_end(tail) else {
        return Cow::Borrowed(xml);
    };

    let mut cleaned = String::with_capacity(xml.len().saturating_sub(end));
    cleaned.push_str(&xml[..start]);
    cleaned.push_str(&xml[start + end..]);
    Cow::Owned(cleaned)
}

fn doctype_end(value: &str) -> Option<usize> {
    if let Some(index) = value.find("]>") {
        return Some(index + 2);
    }

    value.find('>').map(|index| index + 1)
}

#[cfg(test)]
mod tests {
    use super::{parse_nav_document, parse_ncx};

    #[test]
    fn parses_epub3_nav_toc() {
        let entries = parse_nav_document(
            r#"
            <html xmlns:epub="http://www.idpf.org/2007/ops">
              <body>
                <nav epub:type="toc">
                  <ol>
                    <li><a href="Text/ch1.xhtml">Chapter 1</a></li>
                    <li><a href="Text/ch2.xhtml">Chapter 2</a><ol>
                      <li><a href="Text/ch2.xhtml#s1">Section</a></li>
                    </ol></li>
                  </ol>
                </nav>
              </body>
            </html>
            "#,
        )
        .expect("nav toc");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].children[0].href, "Text/ch2.xhtml#s1");
    }

    #[test]
    fn parses_epub2_ncx_toc() {
        let entries = parse_ncx(
            r#"
            <!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN"
              "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
            <ncx>
              <navMap>
                <navPoint>
                  <navLabel><text>Chapter 1</text></navLabel>
                  <content src="Text/ch1.xhtml"/>
                </navPoint>
              </navMap>
            </ncx>
            "#,
        )
        .expect("ncx toc");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].label, "Chapter 1");
    }

    #[test]
    fn parses_ncx_with_single_quoted_xml_declaration() {
        let entries = parse_ncx(
            r#"<?xml version='1.0' encoding='utf-8'?>
            <ncx>
              <navMap>
                <navPoint>
                  <navLabel><text>Chapter 1</text></navLabel>
                  <content src="Text/ch1.xhtml"/>
                </navPoint>
              </navMap>
            </ncx>
            "#,
        )
        .expect("ncx toc");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].label, "Chapter 1");
        assert_eq!(entries[0].href, "Text/ch1.xhtml");
    }
}
