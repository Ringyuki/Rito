use roxmltree::{Document, Node};

use super::{EpubError, EpubResult, ManifestItem, PackageDocument, PackageMetadata, SpineItem};

pub(super) fn parse_container(container_xml: &str) -> EpubResult<String> {
    let document = parse_xml(container_xml, "container.xml")?;
    let rootfile = document
        .descendants()
        .find(|node| has_tag(node, "rootfile"))
        .ok_or_else(|| EpubError::new("No <rootfile> element found in container.xml"))?;

    rootfile
        .attribute("full-path")
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| EpubError::new("<rootfile> element missing full-path attribute"))
}

pub(super) fn parse_package_document(opf_xml: &str) -> EpubResult<PackageDocument> {
    let document = parse_xml(opf_xml, "OPF package document")?;
    Ok(PackageDocument {
        metadata: parse_metadata(&document)?,
        manifest: parse_manifest(&document)?,
        spine: parse_spine(&document)?,
        toc: Vec::new(),
    })
}

fn parse_metadata(document: &Document<'_>) -> EpubResult<PackageMetadata> {
    let title = required_metadata_text(
        document,
        "title",
        "Missing required <dc:title> in package metadata",
    )?;
    let language = required_metadata_text(
        document,
        "language",
        "Missing required <dc:language> in package metadata",
    )?;
    let identifier = required_metadata_text(
        document,
        "identifier",
        "Missing required <dc:identifier> in package metadata",
    )?;

    Ok(PackageMetadata {
        title,
        language,
        identifier,
        creator: metadata_text(document, "creator"),
    })
}

fn parse_manifest(document: &Document<'_>) -> EpubResult<Vec<ManifestItem>> {
    let manifest = document
        .descendants()
        .find(|node| has_tag(node, "manifest"))
        .ok_or_else(|| EpubError::new("Missing <manifest> element in package document"))?;

    Ok(manifest
        .descendants()
        .filter(|node| has_tag(node, "item"))
        .filter_map(parse_manifest_item)
        .collect())
}

fn parse_manifest_item(node: Node<'_, '_>) -> Option<ManifestItem> {
    let id = required_attr(node, "id")?;
    let href = required_attr(node, "href")?;
    let media_type = required_attr(node, "media-type")?;
    let properties = node
        .attribute("properties")
        .map(split_properties)
        .unwrap_or_default();

    Some(ManifestItem {
        id,
        href,
        media_type,
        properties,
    })
}

fn parse_spine(document: &Document<'_>) -> EpubResult<Vec<SpineItem>> {
    let spine = document
        .descendants()
        .find(|node| has_tag(node, "spine"))
        .ok_or_else(|| EpubError::new("Missing <spine> element in package document"))?;

    Ok(spine
        .descendants()
        .filter(|node| has_tag(node, "itemref"))
        .filter_map(parse_spine_item)
        .collect())
}

fn parse_spine_item(node: Node<'_, '_>) -> Option<SpineItem> {
    let idref = required_attr(node, "idref")?;
    Some(SpineItem {
        idref,
        linear: node.attribute("linear") != Some("no"),
    })
}

fn required_metadata_text(
    document: &Document<'_>,
    local_name: &str,
    message: &'static str,
) -> EpubResult<String> {
    metadata_text(document, local_name).ok_or_else(|| EpubError::new(message))
}

fn metadata_text(document: &Document<'_>, local_name: &str) -> Option<String> {
    let metadata = document
        .descendants()
        .find(|node| has_tag(node, "metadata"))?;
    let text = metadata
        .descendants()
        .find(|node| has_tag(node, local_name))?
        .text()?
        .trim()
        .to_owned();

    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn parse_xml<'a>(xml: &'a str, label: &str) -> EpubResult<Document<'a>> {
    Document::parse(xml).map_err(|error| EpubError::new(format!("Invalid {label}: {error}")))
}

fn has_tag(node: &Node<'_, '_>, local_name: &str) -> bool {
    node.is_element() && node.tag_name().name() == local_name
}

fn required_attr(node: Node<'_, '_>, name: &str) -> Option<String> {
    node.attribute(name)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn split_properties(value: &str) -> Vec<String> {
    value.split_whitespace().map(ToOwned::to_owned).collect()
}

#[cfg(test)]
mod tests {
    use super::{parse_container, parse_package_document};

    #[test]
    fn parses_container_rootfile_path() {
        let path = parse_container(
            r#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
        )
        .expect("container path");

        assert_eq!(path, "OEBPS/content.opf");
    }

    #[test]
    fn parses_package_metadata_manifest_and_spine() {
        let package = parse_package_document(
            r#"
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
              <metadata>
                <dc:title>Test Book</dc:title>
                <dc:language>en</dc:language>
                <dc:identifier>book-id</dc:identifier>
              </metadata>
              <manifest>
                <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
                <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav scripted"/>
              </manifest>
              <spine>
                <itemref idref="ch1"/>
                <itemref idref="nav" linear="no"/>
              </spine>
            </package>
            "#,
        )
        .expect("package");

        assert_eq!(package.metadata.title, "Test Book");
        assert_eq!(package.manifest.len(), 2);
        assert_eq!(package.manifest[1].properties, ["nav", "scripted"]);
        assert_eq!(package.spine.len(), 2);
        assert!(!package.spine[1].linear);
    }
}
