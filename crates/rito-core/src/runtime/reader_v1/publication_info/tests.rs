use crate::{
    epub::{
        LoadedChapter, LoadedEpubDocument, ManifestItem, PackageDocument, PackageMetadata,
        SpineItem, TocEntry,
    },
    runtime::RuntimeDocument,
};

use super::super::{ReaderPublicationTocTargetV1, READER_PROTOCOL_VERSION_V1};
use super::build_reader_publication_v1;

#[test]
fn package_mapping_preserves_all_spine_items_and_canonicalizes_nested_toc() {
    let document = RuntimeDocument::from_loaded_document(fixture_document());
    let publication = build_reader_publication_v1(73, &document).expect("publication maps");

    assert_eq!(publication.protocol_version, READER_PROTOCOL_VERSION_V1);
    assert_eq!(publication.session_id, 73);
    assert_eq!(publication.metadata.title, "Contract fixture");
    assert_eq!(publication.metadata.creator.as_deref(), Some("Reader Team"));
    assert_eq!(publication.spine.len(), 5);
    assert_eq!(
        publication
            .spine
            .iter()
            .map(|item| (item.spine_index, item.linear_index))
            .collect::<Vec<_>>(),
        vec![
            (0, Some(0)),
            (1, None),
            (2, Some(1)),
            (3, Some(2)),
            (4, Some(3))
        ]
    );

    assert_eq!(publication.toc.len(), 3);
    assert_eq!(publication.toc[0].toc_id, 0);
    assert_eq!(publication.toc[0].children[0].toc_id, 1);
    assert_eq!(publication.toc[0].children[1].toc_id, 2);
    assert_eq!(publication.toc[1].toc_id, 3);
    assert_eq!(publication.toc[2].toc_id, 4);

    match &publication.toc[0].children[0].target {
        ReaderPublicationTocTargetV1::Locator {
            spine_index,
            locator,
        } => {
            assert_eq!(*spine_index, 2);
            assert_eq!(locator.href, "Text/ch2.xhtml");
            assert_eq!(locator.anchor_id.as_deref(), Some("part one"));
            assert!(locator.source_point.is_none());
            assert!(locator.source_range.is_none());
            assert!(locator.progression.is_none());
        }
        target => panic!("expected canonical locator, got {target:?}"),
    }
    assert_eq!(
        publication.toc[0].children[1].target,
        ReaderPublicationTocTargetV1::External {
            href: "https://example.com/reference".into(),
        }
    );
    assert_eq!(
        publication.toc[1].target,
        ReaderPublicationTocTargetV1::Unresolved {
            href: "Text/missing.xhtml#lost".into(),
        }
    );
    assert_eq!(
        publication.toc[2].target,
        ReaderPublicationTocTargetV1::Unresolved {
            href: "Text/dup.xhtml#ambiguous".into(),
        },
        "an exact duplicate href must not silently bind to the first spine item"
    );
}

fn fixture_document() -> LoadedEpubDocument {
    let spine_items = [
        ("ch1", "Text/ch1.xhtml", true),
        ("notes", "Text/notes.xhtml", false),
        ("ch2", "Text/ch2.xhtml", true),
        ("dup-a", "Text/dup.xhtml", true),
        ("dup-b", "Text/dup.xhtml", true),
    ];
    LoadedEpubDocument {
        package: PackageDocument {
            metadata: PackageMetadata {
                title: "Contract fixture".into(),
                language: "en".into(),
                identifier: "contract-fixture".into(),
                creator: Some("Reader Team".into()),
            },
            manifest: spine_items
                .iter()
                .map(|(id, href, _)| ManifestItem {
                    id: (*id).into(),
                    href: (*href).into(),
                    media_type: "application/xhtml+xml".into(),
                    properties: Vec::new(),
                })
                .collect(),
            spine: spine_items
                .iter()
                .map(|(idref, _, linear)| SpineItem {
                    idref: (*idref).into(),
                    linear: *linear,
                })
                .collect(),
            toc: vec![
                TocEntry {
                    label: "Chapter one".into(),
                    href: "Text/ch1.xhtml".into(),
                    children: vec![
                        TocEntry {
                            label: "Chapter two section".into(),
                            href: "Text/ch2.xhtml#part%20one".into(),
                            children: Vec::new(),
                        },
                        TocEntry {
                            label: "External reference".into(),
                            href: "https://example.com/reference".into(),
                            children: Vec::new(),
                        },
                    ],
                },
                TocEntry {
                    label: "Missing".into(),
                    href: "Text/missing.xhtml#lost".into(),
                    children: Vec::new(),
                },
                TocEntry {
                    label: "Ambiguous".into(),
                    href: "Text/dup.xhtml#ambiguous".into(),
                    children: Vec::new(),
                },
            ],
        },
        stylesheets: Vec::new(),
        fonts: Vec::new(),
        images: Vec::new(),
        chapters: spine_items
            .iter()
            .map(|(idref, href, linear)| LoadedChapter {
                idref: (*idref).into(),
                href: (*href).into(),
                linear: *linear,
                xhtml_source: "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body/></html>".into(),
                source_loaded: true,
                image_refs: None,
            })
            .collect(),
        archive_source: None,
    }
}
